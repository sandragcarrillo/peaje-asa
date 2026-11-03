/**
 * One Metal testnet account for the business and one mandate per agent (Kit 11).
 *
 *   npm run metal:setup
 *
 * Needs METAL_RPC_URL in .env (your endpoint from console-testnet.metalntwx.com). Safe to rerun:
 * whatever already exists in data/metal/ is reused, nothing is created twice.
 *
 * 1. The owner's key and account (the faucet pays the owner key's gas first).
 * 2. USDZ into the account from the faucet: the float every agent pays from.
 * 3. Payee addresses: one per inference provider, and the bridge the treasury sweeps to.
 * 4. A mandate per agent with the caps and budgets in policy, bound on chain by the owner's key:
 *    seller and disputes may only pay the providers; treasury may only pay the bridge.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountBalance, metalCli } from "@peaje-asa/metal";
import { defaultPolicy, type MandatedAgent } from "@peaje-asa/policy";

const policy = defaultPolicy;
const dir = process.env.METAL_DIR ?? "data/metal";
if (!process.env.METAL_RPC_URL) {
  console.error("Set METAL_RPC_URL in .env first: create a testnet endpoint at https://console-testnet.metalntwx.com");
  process.exit(1);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = (name: string) => join(dir, name);
const addressOf = (name: string) => (JSON.parse(readFileSync(file(name), "utf8")) as { address: string }).address;

// --- 1. Owner and account
const owner = await metalCli(["account", "create", ...(existsSync(file("owner.json")) ? ["--key", file("owner.json")] : ["--out", file("owner.json")])]);
const principal = owner.account;
console.log(`1. Account ${principal}, owner ${owner.owner}${owner.deployed === "yes" ? " (already deployed)" : ""}`);

// --- 2. Float
if ((await accountBalance(principal)) < 50) {
  try {
    const f = await metalCli(["fund", principal]);
    console.log(`2. Faucet: ${f.funded ?? "funded"}${f.transaction ? ` (${f.transaction})` : ""}`);
  } catch (e) {
    console.log(`2. Faucet refused (${(e as Error).message}). Fund ${principal} from the Faucet page of the console, then rerun.`);
  }
}
console.log(`   Float: ${await accountBalance(principal)} USDZ`);

// --- 3. Payees
const tiers = ["cheap", "mid", "premium"] as const;
for (const name of [...tiers.map((t) => `provider-${t}.json`), "bridge.json"]) {
  if (!existsSync(file(name))) await metalCli(["key", "create", "--out", file(name)]);
}
const providers = Object.fromEntries(tiers.map((t) => [t, addressOf(`provider-${t}.json`)]));
writeFileSync(file("providers.json"), `${JSON.stringify(providers, null, 2)}\n`);
const bridge = addressOf("bridge.json");
console.log(`3. Providers ${tiers.map((t) => `${t} ${providers[t]}`).join(", ")}; bridge ${bridge}`);

// --- 4. Mandates
const providerPayees = tiers.map((t) => `${providers[t]},${t} provider,http://localhost`);
const agents: Record<MandatedAgent, { payees: string[]; description: string }> = {
  seller: { payees: providerPayees, description: "Seller agent: model calls while selling" },
  disputes: { payees: providerPayees, description: "Disputes agent: model calls to write chargeback defenses" },
  treasury: { payees: [`${bridge},Airwallex bridge,https://www.airwallex.com`], description: "Treasury agent: sweeps the unused float to Airwallex" },
};
for (const [agent, a] of Object.entries(agents) as [MandatedAgent, (typeof agents)[MandatedAgent]][]) {
  const { cap, budget } = policy.agentMandates[agent];
  if (!existsSync(file(`${agent}.json`))) {
    await metalCli([
      "mandate", "credential", "create",
      "--principal", principal,
      "--cap", cap.toFixed(2),
      "--budget", budget.toFixed(2),
      ...a.payees.flatMap((p) => ["--payee", p]),
      "--expires-in", String(30 * 24 * 3600),
      "--description", a.description,
      "--key", file("owner.json"),
      "--out", file(`${agent}.json`),
    ]);
  }
  const status = await metalCli(["mandate", "status", "--credential", file(`${agent}.json`)]);
  if (status.bound !== "yes") {
    const b = await metalCli(["mandate", "bind", "--credential", file(`${agent}.json`), "--key", file("owner.json")]);
    console.log(`4. ${agent}: bound ${b.bound} (${b.transaction})`);
  } else {
    console.log(`4. ${agent}: already bound, ${status.spent}`);
  }
  console.log(`   cap ${cap} per payment, budget ${budget}, may pay: ${a.payees.map((p) => p.split(",")[1]).join(", ")}`);
}
writeFileSync(file("agents.json"), `${JSON.stringify({ principal, agents }, null, 2)}\n`);
console.log(`\nDone. Restart the providers so they sell over x402 on Metal (they read ${file("providers.json")}).`);
