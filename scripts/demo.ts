/**
 * The demo, on the main book (data/peaje-asa.db unless DB_PATH is set), so the dashboard shows it.
 * The seller agent is the real one: real Claude models behind the paid providers. Only the customers are scripted.
 *
 *   npm run demo             continue where the last run stopped (chats already played are skipped)
 *   npm run demo -- --fresh  move the current book to data/backup-<time>/ and start over
 *
 * 1. Three customers write. One asks about an espresso machine and the premium provider raises its price
 *    mid-conversation: the agent moves to a cheaper model and still closes at a price it may offer.
 *    One buys beans. One wants two machines below what the agent may offer: it asks the owner.
 * 2. You: approve the café's price in the dashboard (Conversations), then pay the links with the test card.
 * 3. Paid orders ship. Two chargebacks are staged: a small one and a fraud claim on the negotiated sale.
 * 4. On Metal, every provider raises its price (supplier costs rise) and stays there: the seller's budget buys fewer calls.
 * 5. You, in the dashboard: Agents > Rebalance, Review disputes, Run close, approve what's above the threshold, Sweep float, Advance.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ModelTier } from "@peaje-asa/policy";

const DB = (process.env.DB_PATH ??= "data/peaje-asa.db");
if (process.argv.includes("--fresh")) {
  const backup = join(dirname(DB), `backup-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  const files = [DB, `${DB}-wal`, `${DB}-shm`].filter(existsSync);
  if (files.length) {
    mkdirSync(backup, { recursive: true });
    for (const f of files) renameSync(f, join(backup, basename(f)));
    // A running chat or dashboard keeps the moved file open and would keep reading it.
    console.log(`Moved the old book to ${backup}. Restart the app (dashboard and chat) so it opens the new one.`);
  }
}

// Imported after DB_PATH is settled: the stores open the file when they're created.
const { Airwallex } = await import("@peaje-asa/airwallex");
const { Ledger, OrderSigner } = await import("@peaje-asa/ledger");
const { metalReady, payerFor } = await import("@peaje-asa/metal");
const { defaultPolicy } = await import("@peaje-asa/policy");
const { ConversationStore, SellerAgent } = await import("@peaje-asa/seller-agent");
const { ensurePayees } = await import("@peaje-asa/treasury-agent");

const policy = defaultPolicy;
const awx = Airwallex.fromEnv();
const ledger = new Ledger(policy.currency);
const store = new ConversationStore();
const SHOP = "Tostadero Andino";
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const DASHBOARD = process.env.DASHBOARD_URL ?? "http://localhost:3001";

const tiers: Record<ModelTier, { id: string; url: string }> = {
  cheap: { id: "cheap", url: process.env.PROVIDER_CHEAP_URL ?? "http://localhost:4101" },
  mid: { id: "mid", url: process.env.PROVIDER_MID_URL ?? "http://localhost:4102" },
  premium: { id: "premium", url: process.env.PROVIDER_PREMIUM_URL ?? "http://localhost:4103" },
};
const BASE_PRICE: Record<ModelTier, number> = { cheap: 0.01, mid: 0.02, premium: 0.05 };
/** After the chats: the cheapest call costs 6x, so the seller's 100-call runway needs 6 USDZ left. */
const MARKET_RISE: Record<ModelTier, number> = { cheap: 0.06, mid: 0.07, premium: 0.09 };
const setPrice = (t: ModelTier, price: number) =>
  fetch(`${tiers[t].url}/price`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ price }) });

let providers: ChildProcess | undefined;
const up = () => fetch(tiers.cheap.url, { method: "POST" }).then(() => true, () => false);
if (!(await up())) {
  providers = spawn("npx", ["tsx", "--env-file=.env", "providers/src/index.ts"], { stdio: "ignore" });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
  if (!(await up())) throw new Error("The inference providers didn't start (npm run dev:providers)");
}

// The demo shop's own mandates, bound from its Agents page with the owner key in the browser.
const METAL = join(process.cwd(), "data/shops/tostadero-andino/metal");
console.log(metalReady(METAL) ? `Paying models on Metal testnet under the agents' mandates (${METAL}).` : "The demo shop has no Metal mandates yet (Agents page in the dashboard): model calls use the fake payer.");
const seller = new SellerAgent({ policy, ledger, store, payer: payerFor("seller", METAL), providers: tiers, awx, signer: OrderSigner.fromEnv(), shopName: SHOP });

/** A scripted customer turn, or a moment between turns (a provider changing its price). */
type Step = string | { price: Partial<Record<ModelTier, number>>; say: string };
interface Customer {
  id: string;
  steps: Step[];
  /** What happens once it's paid and delivered. */
  shipment: { carrier: string; tracking: string; signedBy?: string };
  dispute?: { code: "10.4" | "13.1"; stage: "RFI" };
}

const CUSTOMERS: Customer[] = [
  {
    id: "demo-espresso",
    steps: [
      "Hi! Can you give me a quote for one home espresso machine?",
      { price: { premium: 1 }, say: "The premium provider raises its price from 0.05 to 1.00 per call." },
      "Is it a good machine for someone who is just starting with espresso?",
      "Could you do 440? I'd buy it today.",
      "Great, send me the payment link.",
    ],
    shipment: { carrier: "UPS", tracking: "1Z999AA10123456784", signedBy: "M. Rivera" },
    dispute: { code: "10.4", stage: "RFI" },
  },
  {
    id: "demo-beans",
    steps: ["Hola, quiero dos bolsas del café de Huila de 250 g", "Sí, mándame el link"],
    shipment: { carrier: "USPS", tracking: "9400111899223197428490" },
    dispute: { code: "13.1", stage: "RFI" },
  },
  {
    id: "demo-cafe",
    steps: [
      "We're opening a café and need two home espresso machines. What's the price?",
      "Can you do 400 each for the two?",
      "400 is our budget, it's the only way we can buy both. Can you check with the owner?",
    ],
    shipment: { carrier: "FedEx", tracking: "FX7712001", signedBy: "Café La Esquina" },
  },
];

const show = (who: string, lines: { from: string; text: string; tier?: string; cost?: number }[]) => {
  for (const l of lines) {
    const tag = l.from === "agent" && l.tier ? ` [${l.tier} ${l.cost}]` : "";
    console.log(`   ${l.from === "system" ? "--" : l.from}${tag}: ${l.text}`);
  }
};

try {
  await ensurePayees(awx);

  // --- 1. The chats. A customer whose chat already has messages isn't replayed.
  for (const k of CUSTOMERS) {
    if (store.get(k.id)?.transcript.length) continue;
    console.log(`\n1. ${k.id}`);
    for (const step of k.steps) {
      if (typeof step !== "string") {
        console.log(`   >> ${step.say}`);
        for (const [t, p] of Object.entries(step.price)) await setPrice(t as ModelTier, p);
        continue;
      }
      console.log(`   customer: ${step}`);
      show(k.id, await seller.handleMessage(k.id, step));
      if (store.get(k.id)!.status === "escalated") break;
    }
    for (const [t, p] of Object.entries(BASE_PRICE)) await setPrice(t as ModelTier, p);
  }

  // --- 2. The owner and the payments
  const unpaid = () => CUSTOMERS.filter((k) => store.get(k.id)?.status !== "paid");
  const forOwner = () => CUSTOMERS.filter((k) => store.get(k.id)?.status === "escalated");
  if (forOwner().length) console.log(`\n2. Waiting for you in ${DASHBOARD}/conversations: ${forOwner().map((k) => k.id).join(", ")}`);
  const printed = new Set<string>();
  const deadline = Date.now() + 30 * 60_000;
  while (unpaid().length && Date.now() < deadline) {
    for (const k of unpaid()) {
      const c = await seller.checkPayment(k.id);
      if (c?.payment && !printed.has(c.payment.url) && c.status === "awaiting_payment") {
        printed.add(c.payment.url);
        console.log(`   Pay with 4035 5010 0000 0008 (any future expiry, any CVC): ${c.payment.url}  (${k.id})`);
      }
      if (c?.status === "paid") console.log(`   Paid and signed: ${k.id} -> ${c.payment!.orderId}`);
    }
    // Chats that stopped without a link or an escalation (the model didn't close): nothing to wait for.
    const stuck = unpaid().filter((k) => store.get(k.id)?.status === "open");
    if (stuck.length === unpaid().length) break;
    await sleep(4000);
  }
  if (unpaid().length) console.log(`   Not paid: ${unpaid().map((k) => `${k.id} (${store.get(k.id)?.status})`).join(", ")}. Run npm run demo again once they are.`);

  // --- 3. Shipments and chargebacks on what was paid
  const existing: any[] = ((await awx.listDisputes()) as any).items ?? [];
  for (const k of CUSTOMERS) {
    const c = store.get(k.id);
    if (c?.status !== "paid") continue;
    const orderId = c.payment!.orderId;
    if (!ledger.fulfillment(orderId)) {
      ledger.add({ kind: "fulfillment", orderId, carrier: k.shipment.carrier, tracking: k.shipment.tracking, shippedAt: now(), deliveredAt: now(), signedBy: k.shipment.signedBy, at: now() });
      console.log(`3. Shipped ${orderId} by ${k.shipment.carrier}${k.shipment.signedBy ? `, signed by ${k.shipment.signedBy}` : ""}`);
    }
    const intent = c.payment!.paymentIntentId!;
    if (k.dispute && !existing.some((d) => d.payment_intent_id === intent)) {
      const d: any = await awx.simulate.createDispute(intent, k.dispute.stage, k.dispute.code);
      console.log(`   Chargeback ${d.id} on ${k.id}: ${d.reason.description}, ${d.amount} USD at ${d.stage}`);
    }
  }

  // --- 4. Supplier costs rise (Kit 11). Left in place so Agents > Rebalance sees them; restart the providers to reset.
  if (metalReady(METAL)) {
    for (const [t, p] of Object.entries(MARKET_RISE)) await setPrice(t as ModelTier, p);
    console.log(`\n4. Every provider raised its price: ${Object.entries(MARKET_RISE).map(([t, p]) => `${t} ${p}`).join(", ")} USDZ per call. The seller's budget now buys fewer calls.`);
  }

  console.log(`\n5. In ${DASHBOARD}: ${metalReady(METAL) ? "Agents > Rebalance, then " : ""}Review disputes, Run close (approve what's above ${policy.approvalThreshold} USD), Sweep float, then Advance.`);
  console.log(`   Cash ${ledger.cash()} USD.`, ledger.pnl());
} finally {
  providers?.kill();
}
