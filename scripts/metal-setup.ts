/**
 * The platform's side of Metal testnet: the payees every shop's agents may pay, and the sponsor that
 * sends the batches shop owners sign and pays their gas.
 *
 *   npm run metal:setup
 *
 * Needs METAL_RPC_URL in .env (your endpoint from console-testnet.metalntwx.com). Safe to rerun:
 * whatever already exists in data/metal/ is reused, nothing is created twice.
 *
 * 1. Payee addresses: one per inference provider, and the bridge the treasury sweeps to.
 * 2. The sponsor key, with USDZ for gas from the faucet. It has no say over any shop's account.
 *
 * Shops get their own account from the Agents page: the owner's key is made in their browser and
 * signs the mandates there. No owner key is ever written here.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { accountBalance, metalCli, sponsorKey } from "@peaje-asa/metal";

const dir = process.env.METAL_DIR ?? "data/metal";
if (!process.env.METAL_RPC_URL) {
  console.error("Set METAL_RPC_URL in .env first: create a testnet endpoint at https://console-testnet.metalntwx.com");
  process.exit(1);
}
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = (name: string) => join(dir, name);
const addressOf = (name: string) => (JSON.parse(readFileSync(file(name), "utf8")) as { address: string }).address;

// --- 1. Payees
const tiers = ["cheap", "mid", "premium"] as const;
for (const name of [...tiers.map((t) => `provider-${t}.json`), "bridge.json"]) {
  if (!existsSync(file(name))) await metalCli(["key", "create", "--out", file(name)]);
}
const providers = Object.fromEntries(tiers.map((t) => [t, addressOf(`provider-${t}.json`)]));
writeFileSync(file("providers.json"), `${JSON.stringify(providers, null, 2)}\n`);
console.log(`1. Providers ${tiers.map((t) => `${t} ${providers[t]}`).join(", ")}; bridge ${addressOf("bridge.json")}`);

// --- 2. Sponsor
const sponsor = await sponsorKey(file("sponsor.json"));
if ((await accountBalance(sponsor.address)) < 5) {
  try {
    const f = await metalCli(["fund", sponsor.address]);
    console.log(`2. Faucet: ${f.funded ?? "funded"}`);
  } catch (e) {
    console.log(`2. Faucet refused (${(e as Error).message}). Fund ${sponsor.address} from the Faucet page of the console, then rerun.`);
  }
}
console.log(`   Sponsor ${sponsor.address}: ${await accountBalance(sponsor.address)} USDZ for gas`);
console.log(`\nDone. Restart the providers so they sell over x402 on Metal (they read ${file("providers.json")}).`);
