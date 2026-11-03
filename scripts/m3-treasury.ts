/**
 * M3 treasury, end to end against the Airwallex sandbox, in its own book (data/m3.db unless DB_PATH is set).
 * Safe to rerun: links, disputes, approvals and payouts are looked up before anything is created again.
 *
 * 1. Four sales from seeded chats. Each gets a real payment link; pay them by hand with the test card.
 * 2. Three chargebacks staged on them (Kit 4): a small not-received claim, a credit-not-processed claim
 *    from a customer nobody answered, and a fraud claim on a sale the customer negotiated in the chat.
 * 3. The treasury accepts the small one, escalates the ignored customer, challenges the fraud claim with
 *    a PDF of the signed order and chat. The issuer rejects the evidence; the treasury defends again; we win.
 * 4. The unused AI float is swept from Metal to Airwallex (fake bridge until M5: simulated deposit, fake hash).
 * 5. The close: inventory and profit above the approval threshold wait for the owner, then go out as transfers.
 *
 * Owner approvals are given by this script and printed; in M4 they are buttons in the dashboard.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner, type SignedOrder } from "@peaje-asa/ledger";
import { FakeInferencePayer, FakeMetalBridge } from "@peaje-asa/metal";
import { defaultPolicy, findProduct, type ModelTier } from "@peaje-asa/policy";
import { ConversationStore, SellerAgent, type Conversation } from "@peaje-asa/seller-agent";
import { ensurePayees, ProviderDisputeWriter, reviewDisputes, runClose, sweepFloat, syncDisputeOutcomes, TreasuryStore, usdGlobalAccount, type DisputeReview } from "@peaje-asa/treasury-agent";

process.env.DB_PATH ??= "data/m3.db";
const policy = defaultPolicy;
const awx = Airwallex.fromEnv();
const ledger = new Ledger(policy.currency);
const store = new ConversationStore();
const treasury = new TreasuryStore();
const now = () => new Date().toISOString();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const SHOP = "Tostadero Andino";
/** USDZ the owner put on Metal for the agents' model calls (fake bridge until M5). */
const FLOAT_FUNDED = 20;

// --- Seeded chats (what the seller agent would have produced) and what happened after the sale.
interface Case {
  id: string; sku: string; qty: number; unitPrice: number;
  chat: [from: "customer" | "agent", text: string][];
  shipment: { carrier: string; tracking: string; delivered: boolean; signedBy?: string };
  dispute?: { code: "10.4" | "13.1" | "13.6"; stage: "RFI" | "CHARGEBACK" };
  /** Messages after the sale: the customer asks for the owner and nobody answers. */
  afterSale?: string[];
}
const CASES: Case[] = [
  {
    id: "m3-fraud", sku: "MACH-ESPRESSO-HOME", qty: 1, unitPrice: 440,
    chat: [["customer", "Hi, how much is the home espresso machine?"], ["agent", "It's 480 USD and ships tomorrow."], ["customer", "Can you do 440? I'd buy it today."], ["agent", "Yes, 440 USD works. Want the payment link?"], ["customer", "Yes please, send it."]],
    shipment: { carrier: "UPS", tracking: "1Z999AA10123456784", delivered: true, signedBy: "M. Rivera" },
    dispute: { code: "10.4", stage: "RFI" },
  },
  {
    id: "m3-small", sku: "BEAN-HUILA-250", qty: 1, unitPrice: 14,
    chat: [["customer", "One bag of Huila please"], ["agent", "One Huila washed 250 g is 14 USD. Shall I send the link?"], ["customer", "Yes"]],
    shipment: { carrier: "USPS", tracking: "9400111899223197428490", delivered: true },
    dispute: { code: "13.1", stage: "RFI" },
  },
  {
    id: "m3-credit", sku: "MACH-GRINDER", qty: 1, unitPrice: 220,
    chat: [["customer", "I need a burr grinder"], ["agent", "Our burr grinder is 220 USD. Want it?"], ["customer", "Yes, send the link"]],
    shipment: { carrier: "UPS", tracking: "1Z999AA10123456791", delivered: true, signedBy: "J. Ortiz" },
    dispute: { code: "13.6", stage: "RFI" },
    afterSale: ["The grinder arrived but I want to return it, can I talk to the owner?", "I sent it back last week, where is my refund?", "Hello? Still no refund."],
  },
  {
    id: "m3-cafe", sku: "MACH-ESPRESSO-PRO", qty: 1, unitPrice: 3200,
    chat: [["customer", "We're opening a café. Price for the two-group machine?"], ["agent", "The two-group espresso machine is 3,200 USD."], ["customer", "Great, we'll take it."]],
    shipment: { carrier: "FedEx Freight", tracking: "FX7712001", delivered: true, signedBy: "Café La Esquina" },
  },
];

// --- Providers for the dispute writer (started here if they aren't already running)
const tiers: Record<ModelTier, { id: string; url: string }> = {
  cheap: { id: "cheap", url: process.env.PROVIDER_CHEAP_URL ?? "http://localhost:4101" },
  mid: { id: "mid", url: process.env.PROVIDER_MID_URL ?? "http://localhost:4102" },
  premium: { id: "premium", url: process.env.PROVIDER_PREMIUM_URL ?? "http://localhost:4103" },
};
let providers: ChildProcess | undefined;
const up = () => fetch(tiers.cheap.url, { method: "POST" }).then(() => true, () => false);
if (!(await up())) {
  providers = spawn("npx", ["tsx", "--env-file=.env", "providers/src/index.ts"], { stdio: "ignore" });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
}

const payer = new FakeInferencePayer();
const seller = new SellerAgent({ policy, ledger, store, payer, providers: tiers, awx, signer: OrderSigner.fromEnv(), shopName: SHOP });
const chatFor = (o: SignedOrder) => store.list().find((c) => c.payment?.orderId === o.orderId)?.transcript;
const disputeDeps = { ledger, store: treasury, awx, policy, chatFor, shopName: SHOP, writer: new ProviderDisputeWriter({ payer, providers: tiers, policy, ledger }) };
const show = (rs: DisputeReview[]) => rs.forEach((r) =>
  console.log(`   ${r.dispute.id} ${r.dispute.stage} ${r.dispute.reason.description} ${r.dispute.amount} USD -> ${r.decision.action}: ${r.decision.why}${r.approval ? ` [approval ${r.approval.id} ${r.approval.status}]` : ""}${r.fileId ? ` [evidence ${r.fileId}]` : ""}`));

try {
  // --- 1. Sales
  const { owner, supplier } = await ensurePayees(awx);
  console.log(`0. Owner beneficiary ${owner}, supplier beneficiary ${supplier}`);

  for (const k of CASES) {
    if (!store.get(k.id)) {
      const p = findProduct(k.sku)!;
      const c: Conversation = store.getOrCreate(k.id);
      c.transcript = k.chat.map(([from, text]) => ({ from, text, at: now() }));
      c.quotes.push({ id: "q1", sku: k.sku, name: p.name, qty: k.qty, listPrice: p.listPrice, unitPrice: k.unitPrice, total: k.qty * k.unitPrice, currency: policy.currency, createdAt: now() });
      c.activeQuoteId = "q1";
      store.save(c);
    }
    await seller.sendPaymentLink(k.id, "q1");
  }
  const unpaid = () => CASES.filter((k) => store.get(k.id)!.status !== "paid");
  if (unpaid().length) {
    console.log("1. Pay these links with the test card 4035 5010 0000 0008 (any future expiry and CVC):");
    for (const k of unpaid()) console.log(`   ${store.get(k.id)!.payment!.url}  ${k.qty} x ${findProduct(k.sku)!.name}, ${k.qty * k.unitPrice} USD`);
    const deadline = Date.now() + 20 * 60_000;
    while (unpaid().length) {
      if (Date.now() > deadline) throw new Error(`Not paid in time: ${unpaid().map((k) => k.id).join(", ")}`);
      await sleep(3000);
      for (const k of unpaid()) if ((await seller.checkPayment(k.id))?.status === "paid") console.log(`   Paid and signed: ${store.get(k.id)!.payment!.orderId}`);
    }
  }
  for (const k of CASES) {
    const c = store.get(k.id)!;
    const orderId = c.payment!.orderId;
    if (!ledger.fulfillment(orderId)) {
      ledger.add({ kind: "fulfillment", orderId, carrier: k.shipment.carrier, tracking: k.shipment.tracking, shippedAt: now(), deliveredAt: k.shipment.delivered ? now() : undefined, signedBy: k.shipment.signedBy, at: now() });
    }
    if (k.afterSale && !c.transcript.some((l) => l.from === "system" && l.text.startsWith("Escalated"))) {
      const [first, ...rest] = k.afterSale;
      c.transcript.push({ from: "customer", text: first, at: now() }, { from: "system", text: "Escalated to the owner: return and refund request", at: now() }, { from: "agent", text: "Thanks for your patience. The owner has the details and will reply here shortly.", at: now() });
      for (const t of rest) c.transcript.push({ from: "customer", text: t, at: now() });
      store.save(c);
    }
  }
  console.log(`1. Sales booked. Cash ${ledger.cash()} USD.`, ledger.pnl());

  // --- 2. Chargebacks
  const existing: any[] = (await awx.listDisputes() as any).items ?? [];
  for (const k of CASES.filter((x) => x.dispute)) {
    const intent = store.get(k.id)!.payment!.paymentIntentId!;
    if (existing.some((d) => d.payment_intent_id === intent)) continue;
    const d: any = await awx.simulate.createDispute(intent, k.dispute!.stage, k.dispute!.code);
    console.log(`2. Staged ${d.id} on ${k.id}: ${d.reason.description}, ${d.amount} USD at ${d.stage}`);
  }

  // --- 3. The treasury works the queue
  console.log("3. Review:");
  show(await reviewDisputes(disputeDeps));
  for (const a of treasury.approvals("pending").filter((x) => x.terms.kind === "dispute_refund")) {
    treasury.decide(a.id, "approved", "owner (m3 script)");
    console.log(`   Owner approves ${a.id}: refund ${a.terms.amount} USD (${a.reason})`);
  }
  show(await reviewDisputes(disputeDeps));

  const fraudOrder = store.get("m3-fraud")!.payment!.orderId;
  const fraud = ledger.disputes().find((d) => d.orderId === fraudOrder);
  // Read the live stage: escalating from CHARGEBACK fails, so a rerun must not repeat it.
  const live: any = fraud && await awx.getDispute(fraud.disputeId);
  if (live?.stage === "RFI" && live.status === "CHALLENGED") {
    await awx.simulate.escalateDispute(fraud!.disputeId);
    console.log(`   Issuer rejects the evidence on ${fraud!.disputeId}: now at chargeback`);
    await sleep(2000);
  }
  if (live) show(await reviewDisputes(disputeDeps));
  const again = ledger.disputes().find((d) => d.orderId === fraudOrder);
  if (again?.status === "challenged" && again.stage === "CHARGEBACK") {
    await awx.simulate.resolveDispute(again.disputeId, "MERCHANT");
    await sleep(2000);
    console.log("   Outcomes:", await syncDisputeOutcomes(disputeDeps));
  }

  // --- 4. Metal float back to Airwallex
  const ga = await usdGlobalAccount(awx);
  const bridged = ledger.all().filter((e) => e.kind === "bridge_in").reduce((s, e) => s + (e as any).amount, 0);
  const bridge = new FakeMetalBridge(Math.round((FLOAT_FUNDED - ledger.pnl().aiCosts - bridged) * 100) / 100);
  const sweep = await sweepFloat(bridge, ledger, policy, (amount, txHash) => awx.simulate.deposit(ga, amount, txHash, "Peaje ASA Metal float"));
  console.log(`4. Float sweep: ${sweep.swept} USDZ to Airwallex${"txHash" in sweep ? ` (${sweep.txHash}, fake until M5)` : ""}, ${sweep.balance} left on Metal`);

  // --- 5. The close
  const closeDeps = { ledger, store: treasury, awx, policy, beneficiaries: { supplier, owner }, settle: (id: string) => awx.simulate.settleTransfer(id) };
  const first = await runClose(closeDeps);
  console.log(`5. Close on ${first.plan.cash} USD cash (reserve ${policy.reserveFloor}, approval above ${policy.approvalThreshold}):`);
  for (const o of first.plan.pay) console.log(`   pay ${o.kind} ${o.amount}`);
  for (const o of first.plan.needsApproval) console.log(`   needs approval: ${o.kind} ${o.amount} (${o.reference})`);
  for (const { obligation, why } of first.plan.defer) console.log(`   defer ${obligation.kind}: ${why}`);
  for (const p of first.paid) console.log(`   ${p.kind} ${p.amount} -> ${p.transferId} ${p.status}`);
  for (const a of first.awaiting) {
    treasury.decide(a.id, "approved", "owner (m3 script)");
    console.log(`   Owner approves ${a.id}: ${a.terms.kind} ${a.terms.amount} USD to ${a.terms.counterparty}`);
  }
  if (first.awaiting.length) {
    const second = await runClose(closeDeps);
    for (const p of second.paid) console.log(`   ${p.kind} ${p.amount} -> ${p.transferId} ${p.status}${p.failure ? ` (${p.failure})` : ""}`);
  }
  console.log(`Cash ${ledger.cash()} USD (reserve ${policy.reserveFloor}). Open dispute hold ${ledger.openDisputeHold()}.`, ledger.pnl());
} finally {
  providers?.kill();
}
