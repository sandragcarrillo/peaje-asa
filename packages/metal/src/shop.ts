/**
 * One Metal account per shop, owned by a key in the owner's browser, and one mandate per agent.
 *
 *   <platform>/            providers.json, bridge.json, sponsor.json: the platform's payees and gas sponsor
 *   <shop>/issuer.json     signs the shop's mandate credentials (an off-chain document; it binds nothing)
 *   <shop>/<agent>.json    the agent's credential, .key.json its mandate key
 *   <shop>/agents.json     written once every mandate is bound: the account and who each agent may pay
 *   <shop>/pending.json    a batch waiting for the owner's signature
 *
 * The server can write a credential, but only the owner's signature binds it on chain, and an unbound
 * credential pays nothing. Every step is safe to repeat: what already exists is reused.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { bindCall, ingestCredential, parseCredential, type MandateCall, type TrustedIssuer } from "@metalntwx/metal-pay/mandates";
import type { MandatedAgent, OwnerPolicy } from "@peaje-asa/policy";
import { getAddress, type Address, type Hex } from "viem";
import { accountBalance, metalCli, AGENTS } from "./mandate.js";
import { deployOwnerAccount, prepareOwnerCall, sponsorKey, submitOwnerCall, type PreparedOwnerCall } from "./owner.js";

export interface AgentSetup { payees: string[]; description: string }

const TIERS = ["cheap", "mid", "premium"] as const;
const DESCRIPTION: Record<MandatedAgent, string> = {
  seller: "Seller agent: model calls while selling",
  disputes: "Disputes agent: model calls to write chargeback defenses",
  treasury: "Treasury agent: sweeps the unused float to Airwallex",
};

const readJson = async <T>(path: string) => JSON.parse(await readFile(path, "utf8")) as T;

/** Who each agent may pay: the providers for the two AI agents, the bridge for the treasury. */
async function agentPayees(platformDir: string): Promise<Record<MandatedAgent, AgentSetup>> {
  const providers = await readJson<Record<string, string>>(join(platformDir, "providers.json")).catch(() => {
    throw new Error("the platform has no providers yet: run npm run metal:setup");
  });
  const { address: bridge } = await readJson<{ address: string }>(join(platformDir, "bridge.json"));
  const providerPayees = TIERS.map((t) => `${providers[t]},${t} provider,http://localhost`);
  return {
    seller: { payees: providerPayees, description: DESCRIPTION.seller },
    disputes: { payees: providerPayees, description: DESCRIPTION.disputes },
    treasury: { payees: [`${bridge},Airwallex bridge,https://www.airwallex.com`], description: DESCRIPTION.treasury },
  };
}

/** Writes a credential for `agent` with this cap and budget. `mandateKey` keeps the agent's key (a replacement); otherwise a new one is made beside `out`. */
export async function issueCredential(dir: string, o: { principal: Address; agent: MandatedAgent; cap: number; budget: number; setup: AgentSetup; out: string; mandateKey?: string }) {
  await metalCli([
    "mandate", "credential", "create",
    "--principal", o.principal,
    "--cap", o.cap.toFixed(2),
    "--budget", o.budget.toFixed(2),
    ...o.setup.payees.flatMap((p) => ["--payee", p]),
    "--expires-in", String(30 * 24 * 3600),
    "--description", o.setup.description,
    ...(o.mandateKey ? ["--mandate-key-file", o.mandateKey] : []),
    "--issuer-key", join(dir, "issuer.json"),
    "--out", o.out,
  ]);
}

/** The credential at `path`, checked against the shop's own issuer, ready to bind on `account`. */
export async function ingest(dir: string, path: string, account: Address) {
  const issuer = await readJson<TrustedIssuer>(join(dir, "issuer.public.json"));
  return ingestCredential(parseCredential(await readJson(path)), { trustedIssuers: [issuer], account });
}

export type SetupStep =
  | { done: true; account: Address; notes: string[] }
  | { done: false; account: Address; prepared: PreparedOwnerCall; notes: string[] };

/**
 * Everything up to the owner's signature: the account (sponsor pays), test USDZ from the faucet, a
 * credential per agent, and the batch that binds them. When every mandate is already bound it finishes.
 */
export async function prepareShopSetup(o: { dir: string; platformDir: string; owner: Address; policy: OwnerPolicy }): Promise<SetupStep> {
  const { dir, platformDir, policy } = o;
  const owner = getAddress(o.owner);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const notes: string[] = [];
  const sponsor = await sponsorKey(join(platformDir, "sponsor.json"));
  const { account, transaction } = await deployOwnerAccount(owner, sponsor);
  if (transaction) notes.push(`Account created: ${transaction}`);

  // Testnet stand-in for the owner's deposit: the faucet grants USDZ once per address.
  if ((await accountBalance(account)) < 1) {
    await metalCli(["fund", account]).then(
      (f) => notes.push(`Faucet: ${f.funded ?? "funded"}`),
      (e) => notes.push(`The faucet didn't fund it yet (${(e as Error).message}). Your agents can't pay until it holds USDZ; try again in a minute.`),
    );
  }

  const setup = await agentPayees(platformDir);
  const { address: bridge } = await readJson<{ address: string }>(join(platformDir, "bridge.json"));
  await writeFile(join(dir, "bridge.json"), `${JSON.stringify({ address: bridge }, null, 2)}\n`);

  const calls: MandateCall[] = [];
  const summary: string[] = [];
  for (const agent of AGENTS) {
    const path = join(dir, `${agent}.json`);
    const { cap, budget } = policy.agentMandates[agent];
    if (!existsSync(path)) await issueCredential(dir, { principal: account, agent, cap, budget, setup: setup[agent], out: path });
    const status = await metalCli(["mandate", "status", "--credential", path]);
    if (status.bound === "yes") continue;
    calls.push(bindCall(await ingest(dir, path, account)));
    summary.push(`Let the ${agent} agent pay ${agent === "treasury" ? "the Airwallex bridge" : "the three model providers"}: at most ${cap.toFixed(2)} USDZ per payment, ${budget.toFixed(2)} USDZ in all, for 30 days.`);
  }
  if (!calls.length) {
    await writeFile(join(dir, "agents.json"), `${JSON.stringify({ principal: account, owner, agents: setup }, null, 2)}\n`);
    return { done: true, account, notes };
  }
  const prepared = await prepareOwnerCall(calls, "setup", summary, { setup });
  await writeFile(join(dir, "pending.json"), `${JSON.stringify(prepared, null, 2)}\n`);
  return { done: false, account, prepared, notes };
}

/** The batch waiting for the owner's signature, if any and not expired. */
export async function pendingApproval(dir: string): Promise<PreparedOwnerCall | undefined> {
  const path = join(dir, "pending.json");
  if (!existsSync(path)) return undefined;
  const p = await readJson<PreparedOwnerCall>(path);
  return BigInt(Math.floor(Date.now() / 1000)) < BigInt(p.validUntil) - 30n ? p : undefined;
}

export async function dropPending(dir: string) {
  await rm(join(dir, "pending.json"), { force: true });
}

/** Sends the pending batch with the owner's signature. Returns it with its transaction; the caller finishes its own side. */
export async function submitPending(o: { dir: string; platformDir: string; owner: Address; signature: Hex; kind: string; digest: Hex }) {
  const p = await pendingApproval(o.dir);
  if (!p || p.kind !== o.kind || p.digest !== o.digest) throw new Error("that approval is no longer waiting: start it again");
  const transaction = await submitOwnerCall(p, getAddress(o.owner), o.signature, await sponsorKey(join(o.platformDir, "sponsor.json")));
  await dropPending(o.dir);
  return { prepared: p, transaction };
}

/** Finishes setup once the binds landed. */
export async function finishShopSetup(o: { dir: string; platformDir: string; owner: Address; signature: Hex; digest: Hex }) {
  const { prepared, transaction } = await submitPending({ ...o, kind: "setup" });
  const { setup } = prepared.meta as { setup: Record<MandatedAgent, AgentSetup> };
  await writeFile(join(o.dir, "agents.json"), `${JSON.stringify({ principal: prepared.account, owner: getAddress(o.owner), agents: setup }, null, 2)}\n`);
  return { account: prepared.account, transaction };
}
