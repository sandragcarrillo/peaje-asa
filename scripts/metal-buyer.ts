/**
 * A buyer agent that pays shops in USDZ on Metal testnet, within a mandate its owner set.
 *
 *   npm run metal:buyer -- setup [item url]   account, test USDZ, and a mandate bound on chain
 *   npm run metal:buyer -- buy <item url>     buy one item: POST https://<app>/api/s/<shop>/metal/<sku>
 *   npm run metal:buyer -- status             the account's balance and what the mandate has spent
 *
 * The owner's key lives in data/buyer/ (BUYER_DIR) and signs the bind locally; the platform's sponsor
 * only sends it and pays the gas, as it does for shop owners. The mandate lets the agent pay one
 * payee, the address the shops' 402 offers name (read from the item url, else data/metal/bridge.json),
 * at most 50 USDZ a payment and 200 in all, for 30 days. Metal refuses anything outside it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bindCall, createMandatePaymentClient, p256DigestSigner, parseCredential, privateKeyHex } from "@metalntwx/metal-pay/mandates";
import { accountBalance, deployOwnerAccount, ingest, metalCli, ownerAccountAddress, ownerTypedData, prepareOwnerCall, sponsorKey, submitOwnerCall } from "@peaje-asa/metal";
import { decodePaymentRequiredHeader, decodePaymentResponseHeader } from "@x402/core/http";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

const dir = process.env.BUYER_DIR ?? "data/buyer";
const platform = process.env.METAL_DIR ?? "data/metal";
const CAP = 50, BUDGET = 200;
const [cmd = "status", url] = process.argv.slice(2);
if (!process.env.METAL_RPC_URL) throw new Error("Set METAL_RPC_URL in .env");
mkdirSync(dir, { recursive: true, mode: 0o700 });
const file = (n: string) => join(dir, n);

function ownerKey() {
  if (!existsSync(file("owner.json"))) writeFileSync(file("owner.json"), `${JSON.stringify({ privateKey: generatePrivateKey() })}\n`, { mode: 0o600, flag: "wx" });
  return privateKeyToAccount((JSON.parse(readFileSync(file("owner.json"), "utf8")) as { privateKey: Hex }).privateKey);
}

/** Who the shops ask to be paid: the payTo of an item's 402 offer. */
async function payee(): Promise<string> {
  if (url) {
    const res = await fetch(url, { method: "POST" });
    const required = res.headers.get("payment-required");
    if (res.status !== 402 || !required) throw new Error(`${url} answered ${res.status}, not a 402 offer`);
    return decodePaymentRequiredHeader(required).accepts[0]!.payTo;
  }
  return (JSON.parse(readFileSync(join(platform, "bridge.json"), "utf8")) as { address: string }).address;
}

async function setup() {
  const owner = ownerKey();
  const sponsor = await sponsorKey(join(platform, "sponsor.json"));
  const { account, transaction } = await deployOwnerAccount(owner.address, sponsor);
  console.log(`Account ${account}${transaction ? ` created in ${transaction}` : ""}`);
  if ((await accountBalance(account)) < CAP) {
    await metalCli(["fund", account]).then(
      (f) => console.log(`Faucet: ${f.funded ?? "funded"}`),
      (e) => console.log(`Faucet didn't fund it (${(e as Error).message}); try again in a minute.`),
    );
  }
  const cred = file("buyer.json");
  if (!existsSync(cred)) {
    const to = await payee();
    await metalCli([
      "mandate", "credential", "create", "--principal", account, "--cap", CAP.toFixed(2), "--budget", BUDGET.toFixed(2),
      "--payee", `${to},Peaje ASA shops,https://asa.usepeaje.com`, "--expires-in", String(30 * 24 * 3600),
      "--description", "Buyer agent: buys from Peaje ASA shops", "--issuer-key", file("issuer.json"), "--out", cred,
    ]);
    console.log(`Mandate written: pay ${to} at most ${CAP} USDZ a payment, ${BUDGET} in all`);
  }
  if ((await metalCli(["mandate", "status", "--credential", cred])).bound === "yes") return console.log("Mandate bound. Ready to buy.");
  const p = await prepareOwnerCall([bindCall(await ingest(dir, cred, account))], "buyer-bind", ["Bind the buyer agent's mandate"]);
  const signature = await owner.signTypedData(ownerTypedData({ account: p.account, chainId: p.chainId, executionData: p.executionData, nonce: BigInt(p.nonce), validUntil: BigInt(p.validUntil) }));
  console.log(`Mandate bound in ${await submitOwnerCall(p, owner.address, signature, sponsor)}. Ready to buy.`);
}

async function buy() {
  if (!url) throw new Error("buy <item url>");
  const credential = parseCredential(JSON.parse(readFileSync(file("buyer.json"), "utf8")));
  const key = JSON.parse(readFileSync(file("buyer.key.json"), "utf8"));
  const client = createMandatePaymentClient({ credential, signDigest: p256DigestSigner(privateKeyHex(key)), network: "testnet" });
  const res = await client.fetchWithPayment(url, { method: "POST" });
  const body = await res.text();
  const settled = res.headers.get("payment-response");
  console.log(`${res.status} ${body}`);
  if (settled) console.log(`settlement ${JSON.stringify(decodePaymentResponseHeader(settled))}`);
  if (res.status === 402 && res.headers.get("payment-required")) console.log(`refused: ${decodePaymentRequiredHeader(res.headers.get("payment-required")!).error ?? "no reason"}`);
  if (!res.ok) process.exitCode = 1;
}

async function status() {
  const owner = ownerKey();
  const account = await ownerAccountAddress(owner.address);
  console.log(`Account ${account}: ${await accountBalance(account)} USDZ`);
  if (existsSync(file("buyer.json"))) {
    const s = await metalCli(["mandate", "status", "--credential", file("buyer.json")]);
    console.log(`Mandate bound ${s.bound ?? "?"}, spent ${s.spent ?? "0"}, payments ${s.payments ?? 0}`);
  }
}

if (cmd === "setup") await setup();
else if (cmd === "buy") await buy();
else if (cmd === "status") await status();
else throw new Error(`unknown command ${cmd}: setup, buy or status`);
