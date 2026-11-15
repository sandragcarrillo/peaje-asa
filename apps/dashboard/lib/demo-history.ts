/**
 * A "Try it" shop opens with real history, made the moment it's created, nothing staged:
 *
 * - The platform's buyer agent buys a few items from it over x402, paying USDZ on Alta testnet under
 *   its own mandate. Each sale is settled on chain, verified and booked by the same route any outside
 *   buyer agent uses (`POST /api/s/<shop>/metal/<sku>`), with its transaction hash.
 * - Once the judge's browser approves the shop's agents (a few seconds later, automatically), ten
 *   customers write to the shop's chat, three at a time. The seller agent answers them for real and pays for every AI
 *   reply from the shop's Alta wallet, within the limits just signed.
 *
 * Card sales are the one thing it can't make: the sandbox account confirms cards only on Airwallex's
 * hosted page, so those come from the judge paying in the chat. The buyer's USDZ goes back to it
 * from the bridge, where the shops' x402 sales land, so the demo keeps itself funded on testnet.
 */
import "./env";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bindCall, createMandatePaymentClient, p256DigestSigner, parseCredential, privateKeyHex } from "@metalntwx/metal-pay/mandates";
import { accountBalance, deployOwnerAccount, fundFromSponsor, ingest, metalCli, ownerTypedData, prepareOwnerCall, sponsorKey, submitOwnerCall } from "@peaje-asa/metal";
import { demoShops, findProduct } from "@peaje-asa/policy";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Address, Hex } from "viem";
import { newConversationId } from "./chat";
import { openShopAccount } from "./account";
import { closeDeps, deps } from "./deps";
import { runClose, reviewDisputes } from "@peaje-asa/treasury-agent";
import { root } from "./env";
import { getShop, platformMetalDir } from "./shops";

const CAP = 50, BUDGET = 1000;

export interface DemoRun { buys: number; bought: number; chats: number; chatted: number; selling: boolean; chatting: boolean; closing?: boolean; closed?: { paid: number; waiting: number; settled: number }; disputing?: boolean; error?: string }

const g = globalThis as unknown as { asaDemoRuns?: Map<string, DemoRun>; asaDemoQueue?: Promise<unknown> };
const runs = () => (g.asaDemoRuns ??= new Map());

/** Where the demo history of one shop stands, while this server runs. */
export const demoRun = (shopId: string): DemoRun | undefined => runs().get(shopId);

function patch(shopId: string, p: Partial<DemoRun>) {
  const r = runs().get(shopId) ?? { buys: 10, bought: 0, chats: 10, chatted: 0, selling: false, chatting: false };
  runs().set(shopId, { ...r, ...p });
}

/** One demo at a time: the buyer agent has one account and one mandate, and payments mustn't race. */
function queued<T>(fn: () => Promise<T>): Promise<T> {
  const next = (g.asaDemoQueue ?? Promise.resolve()).then(fn, fn);
  g.asaDemoQueue = next.catch(() => {});
  return next;
}

const buyerDir = () => process.env.BUYER_DIR ?? join(root, "data/buyer");
const readJson = <T>(path: string) => JSON.parse(readFileSync(path, "utf8")) as T;

function buyerOwner(dir: string) {
  const path = join(dir, "owner.json");
  if (!existsSync(path)) writeFileSync(path, `${JSON.stringify({ privateKey: generatePrivateKey() })}\n`, { mode: 0o600, flag: "wx" });
  return privateKeyToAccount(readJson<{ privateKey: Hex }>(path).privateKey);
}

/**
 * The buyer agent, ready to spend `need` USDZ: its account exists and holds enough, and it has a bound
 * mandate with that much budget left. A spent mandate is replaced by a new one, bound with the buyer
 * owner's key; the agent's own signing key stays the same.
 */
async function buyerReady(need: number) {
  const dir = buyerDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const platform = platformMetalDir();
  const owner = buyerOwner(dir);
  const sponsor = await sponsorKey(join(platform, "sponsor.json"));
  const { account } = await deployOwnerAccount(owner.address, sponsor);

  await topUp(account, need, platform, sponsor);

  const pointer = join(dir, "current.json");
  let name = existsSync(pointer) ? readJson<{ credential: string }>(pointer).credential : "buyer.json";
  let status = existsSync(join(dir, name)) ? await metalCli(["mandate", "status", "--credential", join(dir, name)]) : undefined;
  const left = status ? BUDGET_OF(status) - Number((status.spent ?? "0").split(" ")[0]) : 0;
  if (!status || status.revoked === "yes" || left < need) {
    name = `buyer-${Date.now()}.json`;
    const payee = readJson<{ address: string }>(join(platform, "bridge.json")).address;
    const key = join(dir, "buyer.key.json");
    await metalCli([
      "mandate", "credential", "create", "--principal", account, "--cap", CAP.toFixed(2), "--budget", BUDGET.toFixed(2),
      "--payee", `${payee},Peaje ASA shops,https://asa.usepeaje.com`, "--expires-in", String(30 * 24 * 3600),
      "--description", "Buyer agent: buys from Peaje ASA shops", "--issuer-key", join(dir, "issuer.json"),
      ...(existsSync(key) ? ["--mandate-key-file", key] : []), "--out", join(dir, name),
    ]);
    writeFileSync(pointer, `${JSON.stringify({ credential: name })}\n`, { mode: 0o600 });
    status = undefined;
  }
  if ((status ?? (await metalCli(["mandate", "status", "--credential", join(dir, name)]))).bound !== "yes") {
    const p = await prepareOwnerCall([bindCall(await ingest(dir, join(dir, name), account))], "buyer-bind", ["Bind the buyer agent's mandate"]);
    const signature = await owner.signTypedData(ownerTypedData({ account: p.account, chainId: p.chainId, executionData: p.executionData, nonce: BigInt(p.nonce), validUntil: BigInt(p.validUntil) }));
    await submitOwnerCall(p, owner.address, signature, sponsor);
  }
  const keyFile = existsSync(join(dir, name.replace(/\.json$/, ".key.json"))) ? name.replace(/\.json$/, ".key.json") : "buyer.key.json";
  return createMandatePaymentClient({
    credential: parseCredential(readJson(join(dir, name))),
    signDigest: p256DigestSigner(privateKeyHex(readJson(join(dir, keyFile)))),
    network: "testnet",
  });
}

/**
 * Brings the buyer's account to `need` USDZ. The bridge holds what buyer agents paid the shops, so it
 * goes back first; the faucet and then the sponsor cover the rest. Testnet money either way.
 */
async function topUp(account: Address, need: number, platform: string, sponsor: ReturnType<typeof privateKeyToAccount>) {
  const short = async () => Math.ceil(need + 1 - (await accountBalance(account)));
  if ((await short()) <= 0) return;
  const bridgeFile = join(platform, "bridge.json");
  if (existsSync(bridgeFile)) {
    const bridge = privateKeyToAccount(readJson<{ privateKey: Hex }>(bridgeFile).privateKey);
    const spare = Math.floor((await accountBalance(bridge.address)) - 1);
    const amount = Math.min(spare, await short());
    if (amount > 0) await fundFromSponsor(account, amount, bridge);
  }
  if ((await short()) > 0) await metalCli(["fund", account]).catch(() => undefined);
  const left = await short();
  if (left > 0) await fundFromSponsor(account, left, sponsor);
}

/** The mandate's total budget, from `metal-agent mandate status` ("28 USDZ of 200 USDZ"). */
function BUDGET_OF(status: Record<string, string>) {
  const of = /of\s+([\d.]+)/.exec(status.spent ?? "");
  return of ? Number(of[1]) : BUDGET;
}

/** Right after "Try it": the buyer agent buys from the new shop over x402, through `origin`. */
export function startDemoSales(shopId: string, origin: string, buys: string[]) {
  patch(shopId, { selling: true, buys: buys.length });
  return queued(async () => {
    try {
      const shop = getShop(shopId);
      const items = buys.map((sku) => shop && findProduct(shop.policy.catalog, sku)).filter((p) => p && !p.archived);
      const client = await buyerReady(items.reduce((n, p) => n + p!.listPrice, 0));
      // One purchase failing doesn't stop the others. No retries: a failure after settling would pay twice.
      let failed = 0;
      for (const p of items) {
        const res = await client.fetchWithPayment(`${origin}/api/s/${shopId}/metal/${p!.sku}`, { method: "POST" });
        if (res.ok) patch(shopId, { bought: (demoRun(shopId)?.bought ?? 0) + 1 });
        else {
          failed++;
          console.error(`try it: buying ${p!.sku} for ${shopId} answered ${res.status}: ${(await res.text()).slice(0, 200)}`);
        }
      }
      if (failed === items.length) throw new Error("no purchase went through");
    } catch (e) {
      console.error(`try it: buyer agent sales for ${shopId}:`, e);
      patch(shopId, { error: "The buyer agent couldn't finish its purchases on Alta testnet." });
    } finally {
      patch(shopId, { selling: false });
    }
  });
}

/** Once the shop's agents can pay for their AI: ten customers write in, and the agent answers them for real. */
export async function startDemoChats(shopId: string) {
  const r = demoRun(shopId);
  if (r?.chatting || (r?.chatted ?? 0) > 0) return;
  patch(shopId, { chatting: true });
  try {
    const { seller } = deps(shopId);
    // No AI service answering: don't fill the shop with chats the agent couldn't reply to.
    if (Object.keys(await seller.currentOffers()).length === 0) throw new Error("no AI service answered");
    const kind = demoShops.find((k) => k.name === getShop(shopId)?.name) ?? demoShops[0]!;
    patch(shopId, { chats: kind.chats.length });
    // A few customers at a time, like a real shop; each one's messages in order.
    const queue = [...kind.chats];
    const customer = async () => {
      for (let lines = queue.shift(); lines; lines = queue.shift()) {
        const id = newConversationId();
        try {
          for (const text of lines) await seller.handleMessage(id, text);
        } catch (e) {
          console.error(`try it: a demo customer of ${shopId}:`, e);
        }
        patch(shopId, { chatted: (demoRun(shopId)?.chatted ?? 0) + 1 });
      }
    };
    await Promise.all([customer(), customer(), customer()]);
  } catch (e) {
    console.error(`try it: demo chats for ${shopId}:`, e);
    patch(shopId, { error: "A demo customer's chat didn't finish." });
  } finally {
    patch(shopId, { chatting: false });
  }
}

/**
 * Everything a new demo shop does on its own: its Airwallex account opens while the buyer agent buys,
 * then the day's close runs on those sales. The close is the real one: the platform moves the sales
 * to the shop's sandbox account, pays the supplier bills that are due and the owner, and leaves anything above the
 * shop's approval limit waiting for the owner.
 */
export async function runDemo(shopId: string, origin: string, buys: string[]) {
  const account = openShopAccount(shopId).catch((e) => {
    console.error(`try it: Airwallex account for ${shopId} didn't open:`, e);
    return undefined;
  });
  await startDemoSales(shopId, origin, buys);
  if (!(await account) || !(demoRun(shopId)?.bought ?? 0)) return;
  patch(shopId, { closing: true });
  try {
    const r = await runClose(closeDeps(shopId));
    patch(shopId, { closed: { paid: r.paid.filter((p) => p.status === "paid").length, waiting: r.awaiting.length, settled: r.settled.filter((x) => x.kind === "sale").length } });
  } catch (e) {
    console.error(`try it: close for ${shopId}:`, e);
  } finally {
    patch(shopId, { closing: false });
  }
}

/**
 * A demo shop's card sale (the judge's own purchase) gets a chargeback a minute later: the order is
 * marked shipped and delivered, Airwallex's sandbox opens a "not received" dispute on the real payment,
 * and the disputes agent answers it with the signed order, the chat and the delivery as evidence.
 */
export async function stageDemoDispute(shopId: string, convId: string) {
  const { seller, ledger, awx, disputes } = deps(shopId);
  const c = seller.conversation(convId);
  const intent = c?.payment?.paymentIntentId;
  if (!c?.payment || !intent || ledger.disputes().some((d) => d.orderId === c.payment!.orderId)) return;
  patch(shopId, { disputing: true });
  try {
    const at = new Date().toISOString();
    if (!ledger.fulfillment(c.payment.orderId)) {
      ledger.add({ kind: "fulfillment", orderId: c.payment.orderId, carrier: "FedEx", tracking: `FX${Date.now().toString().slice(-9)}`, shippedAt: at, deliveredAt: at, signedBy: "Front desk", at });
    }
    await new Promise((r) => setTimeout(r, 45_000));
    await awx.simulate.createDispute(intent, "RFI", "13.1");
    await new Promise((r) => setTimeout(r, 5_000));
    await reviewDisputes(disputes);
  } catch (e) {
    console.error(`try it: staged dispute for ${shopId}:`, e);
  } finally {
    patch(shopId, { disputing: false });
  }
}
