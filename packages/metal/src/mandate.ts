/**
 * Real Metal testnet: one owner account, one mandate per agent (Kit 11), inference bought over
 * x402 under that mandate (Kit 12). Metal enforces each mandate on chain: payees, the most per
 * payment, the budget. A payment outside it is refused at settlement and moves nothing.
 *
 * Files live in data/metal/ (written by `npm run metal:setup`):
 *   owner.json                  the owner's key (signs binds and replacements; never given to an agent)
 *   <agent>.json, .key.json     each agent's credential and its mandate key
 *   providers.json, bridge.json the payees
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import { promisify } from "node:util";
import { USDZ, formatUsdz } from "@metalntwx/metal-pay";
import {
  createMandatePaymentClient,
  describeRefusal,
  extractTerms,
  hashCredential,
  mandateReference,
  p256DigestSigner,
  parseCredential,
  privateKeyHex,
  refusalOf,
  type Credential,
  type P256Jwk,
} from "@metalntwx/metal-pay/mandates";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { FakeInferencePayer, PaidCallFailed, PriceAboveCap, type InferencePayer, type InferenceProvider, type MetalBridge, type Offer, type PaidCall } from "./index.js";

export type AgentName = "seller" | "disputes" | "treasury";
export const AGENTS: readonly AgentName[] = ["seller", "disputes", "treasury"];

/** Metal refused the payment under the agent's mandate. Nothing moved. */
export class MandateRefused extends Error {
  constructor(public provider: string, public reason: string) {
    super(`mandate_refused: ${provider}: ${reason}`);
  }
}

const execFileP = promisify(execFile);
// Resolved from the working directory: a bundler can rewrite import.meta.url, and node walks up to the hoisted package either way.
const cliPath = () => createRequire(join(process.cwd(), "index.js")).resolve("@metalntwx/metal-agent/dist/index.js");

const parseLines = (stdout: string) => {
  const out: Record<string, string> = {};
  for (const line of stdout.split("\n")) {
    const i = line.indexOf(" ");
    if (i > 0) out[line.slice(0, i)] ??= line.slice(i + 1).trim();
  }
  return out;
};

/**
 * The metal-agent CLI, with its `name value` lines parsed. It reads METAL_RPC_URL from the
 * environment, so the endpoint (a credential) never appears in arguments. Exit codes in `accept`
 * (pull's 1 refused, 3 pending, 4 held) come back as `code` instead of throwing.
 */
export async function metalCli(args: string[], accept: number[] = []): Promise<Record<string, string> & { code?: string }> {
  const net = args[0] === "key" ? [] : ["--network", "testnet"];
  try {
    const { stdout } = await execFileP(process.execPath, [cliPath(), ...args, ...net], { maxBuffer: 1 << 20 });
    return { ...parseLines(stdout), code: "0" };
  } catch (e: any) {
    if (typeof e.code === "number" && accept.includes(e.code)) return { ...parseLines(String(e.stdout ?? "")), code: String(e.code) };
    // The CLI redacts RPC URLs itself; keep only its error line, and strip any URL just in case.
    const msg = String(e.stderr ?? e.message).split("\n").find((l: string) => l.startsWith("error:")) ?? String(e.stderr || e.message).split("\n").find((l: string) => /Error/.test(l)) ?? "metal-agent failed";
    throw new Error(msg.replace(/https?:\/\/\S+/g, "[url]"));
  }
}

export interface LoadedMandate { agent: AgentName; credential: Credential; reference: string; principal: string; cap: number; budget: number; credentialPath: string }

export async function loadMandate(dir: string, agent: AgentName): Promise<LoadedMandate> {
  const credentialPath = join(dir, `${agent}.json`);
  const credential = parseCredential(JSON.parse(await readFile(credentialPath, "utf8")));
  const terms = extractTerms(credential);
  return {
    agent,
    credential,
    credentialPath,
    principal: terms.principal,
    reference: mandateReference(terms.principal, terms.agentKey, hashCredential(credential)),
    cap: Number(formatUsdz(terms.constraints.perPaymentCap)),
    budget: Number(formatUsdz(terms.constraints.budget)),
  };
}

async function agentSigner(dir: string, agent: AgentName) {
  const key = JSON.parse(await readFile(join(dir, `${agent}.key.json`), "utf8")) as { kid: string; publicJwk: P256Jwk; privateJwk: P256Jwk & { d: string } };
  return p256DigestSigner(privateKeyHex(key as any));
}

/** Reads the provider's current terms from its 402 (price) and its x-latency-ms header. */
async function readOffer(p: InferenceProvider): Promise<Offer> {
  const res = await fetch(p.url, { method: "POST" });
  const required = res.headers.get("payment-required");
  const price = required ? Number(formatUsdz(BigInt(decodePaymentRequiredHeader(required).accepts[0].amount))) : Number(res.headers.get("x-price") ?? 0);
  return { price, latencyMs: Number(res.headers.get("x-latency-ms") ?? 0) };
}

/**
 * Pays providers from the owner's account under one agent's mandate. Same contract as the fake:
 * PriceAboveCap before anything is signed, PaidCallFailed when it was paid but no answer came back,
 * plus MandateRefused when Metal says no.
 */
export class MandatePayer implements InferencePayer {
  private client?: ReturnType<typeof createMandatePaymentClient>;
  private loadedAt = 0;
  constructor(private dir: string, readonly agent: AgentName = "seller") {}

  /** Reloads when the treasury replaced the mandate: the old one is refused from that transaction on. */
  private async paying() {
    const mtime = (await stat(join(this.dir, `${this.agent}.json`))).mtimeMs;
    if (this.client && mtime === this.loadedAt) return this.client;
    this.loadedAt = mtime;
    const { credential } = await loadMandate(this.dir, this.agent);
    this.client = createMandatePaymentClient({ credential, signDigest: await agentSigner(this.dir, this.agent), network: "testnet" });
    return this.client;
  }

  quote(p: InferenceProvider) { return readOffer(p); }

  async payAndCall<T>(p: InferenceProvider, payload: unknown, maxPrice: number): Promise<PaidCall<T>> {
    const { price } = await this.quote(p);
    if (price > maxPrice + 1e-9) throw new PriceAboveCap(p.id, price, maxPrice);
    const { fetchWithPayment } = await this.paying();
    const res = await fetchWithPayment(p.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const body = await res.text();
    const required = res.headers.get("payment-required");
    if (res.status === 402 && required) throw new MandateRefused(p.id, reasonText(decodePaymentRequiredHeader(required).error));
    const settled = res.headers.get("payment-response") ? decodePaymentResponseHeader(res.headers.get("payment-response")!) : undefined;
    if (settled && !settled.success) throw new MandateRefused(p.id, reasonText(settled.errorReason));
    if (!res.ok) throw new PaidCallFailed(p.id, price, `${res.status} ${body.slice(0, 300)}`);
    return { provider: p.id, pricePaid: price, result: JSON.parse(body) as T, txHash: settled?.transaction };
  }
}

function reasonText(reason?: string) {
  if (!reason) return "no reason given";
  const mandate = refusalOf(reason);
  return mandate === undefined ? reason : describeRefusal(mandate);
}

/** USDZ held by the owner's account, which every mandate pays from. */
export async function accountBalance(principal: string, rpcUrl = process.env.METAL_RPC_URL): Promise<number> {
  if (!rpcUrl) throw new Error("METAL_RPC_URL is not set");
  const data = `0x70a08231${principal.slice(2).toLowerCase().padStart(64, "0")}`;
  const res = await fetch(rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: USDZ.address, data }, "latest"] }) });
  const { result, error } = (await res.json()) as { result?: string; error?: { message: string } };
  if (error || !result) throw new Error(`balance read failed${error ? `: ${error.message}` : ""}`);
  return Number(formatUsdz(BigInt(result)));
}

/** Spend so far under one mandate, read from chain. */
export async function mandateSpent(m: LoadedMandate): Promise<{ spent: number; payments: number; revoked: boolean }> {
  const out = await metalCli(["mandate", "status", "--credential", m.credentialPath]);
  return { spent: Number((out.spent ?? "0").split(" ")[0]), payments: Number(out.payments ?? 0), revoked: out.revoked === "yes" };
}

/**
 * The treasury agent's side of the float: it pulls USDZ to the bridge address under its own mandate.
 * Airwallex can't receive stablecoins, so the Airwallex side is a simulated deposit with this hash.
 */
export class MandateBridge implements MetalBridge {
  /** `booked` is the float per the books (what the business funded, less model calls and sweeps): the faucet's extra USDZ is not the business's money and is never swept in as cash. */
  constructor(private dir: string, private booked = Infinity) {}
  async floatBalance() {
    const m = await loadMandate(this.dir, "treasury");
    return Math.min(await accountBalance(m.principal), this.booked);
  }
  async sweep(amount: number) {
    const { address } = JSON.parse(await readFile(join(this.dir, "bridge.json"), "utf8")) as { address: string };
    const out = await metalCli(["mandate", "pull", "--credential", join(this.dir, "treasury.json"), "--to", address, "--amount", amount.toFixed(2)], [1, 3, 4]);
    if (out.code !== "0" || !out.transaction) throw new Error(`sweep ${out.code === "1" ? "refused" : "not settled yet"}${out.reason ? `: ${out.reason}` : ""}`);
    return { txHash: out.transaction };
  }
}

/** Where setup keeps the Metal files: METAL_DIR, else <repo>/data/metal. */
export const metalDir = (root: string) => process.env.METAL_DIR ?? join(root, "data/metal");

/** Real Metal needs an endpoint and a finished setup; otherwise everything runs on the fakes. */
export const metalReady = (dir: string) => Boolean(process.env.METAL_RPC_URL) && existsSync(join(dir, "agents.json"));

/** The agent's payer: under its own mandate on Metal when set up, the fake otherwise. */
export const payerFor = (agent: AgentName, dir: string): InferencePayer => (metalReady(dir) ? new MandatePayer(dir, agent) : new FakeInferencePayer());
