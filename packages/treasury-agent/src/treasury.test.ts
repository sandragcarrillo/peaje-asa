import { test } from "node:test";
import assert from "node:assert/strict";
import type { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner } from "@peaje-asa/ledger";
import { FakeMetalBridge } from "@peaje-asa/metal";
import { decideDispute, defaultPolicy as p, type DisputeFacts } from "@peaje-asa/policy";
import { approvalTerms, planClose, reviewDisputes, runClose, sweepFloat, textPdf, TreasuryStore, unansweredAfterEscalation, type AwxDispute, type ChatLine, type Obligation } from "./index.js";

process.env.ORDER_SIGNING_KEY ??= OrderSigner.generateEnvValue();
const at = "2026-11-02T00:00:00.000Z";
const ben = { supplier: "ben_supplier", owner: "ben_owner" };

/** Transfers settle as soon as they're read; disputes accept and challenge in memory. */
function fakeAwx() {
  const transfers: any[] = [];
  const disputes: AwxDispute[] = [];
  const calls: string[] = [];
  return {
    transfers, disputes, calls,
    async createTransferOnce(input: any) { const t = { id: `tr_${transfers.length + 1}`, request_id: input.requestId, status: "SCHEDULED", ...input }; transfers.push(t); return t; },
    async findTransferByRequestId(id: string) { return transfers.find((t) => t.request_id === id); },
    async getTransfer(id: string) { return transfers.find((t) => t.id === id); },
    async waitForTransfer(id: string) { const t = transfers.find((x) => x.id === id); t.status = "PAID"; return t; },
    async listDisputes() { return { items: disputes.filter((d) => d.status === "REQUIRES_RESPONSE") }; },
    async acceptDispute(id: string, input: any) { calls.push(`accept ${id} ${input.reason}`); disputes.find((d) => d.id === id)!.status = "ACCEPTED"; },
    async challengeDispute(id: string, body: any) { calls.push(`challenge ${id} ${body.supporting_documents.documents[0].file_ids[0]}`); disputes.find((d) => d.id === id)!.status = "CHALLENGED"; },
    async uploadFile(name: string, bytes: Uint8Array) { assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-"); return { file_id: `file_${name}`, filename: name, size: bytes.length }; },
  };
}

function sell(ledger: Ledger, orderId: string, amount: number, cogs: number, intent = `int_${orderId}`) {
  const order = OrderSigner.fromEnv().sign({ orderId, customerRef: orderId, items: [{ sku: "MACH-ESPRESSO-HOME", qty: 1, unitPrice: amount }], total: amount, currency: "USD", paymentIntentId: intent, createdAt: at });
  ledger.addOrder(order);
  ledger.add({ kind: "sale", orderId, amount, cogs, currency: "USD", at });
  return order;
}

test("planClose: the reserve binds, approvals keep their cash set aside, the owner gets what's left", () => {
  const supplier: Obligation = { kind: "supplier", amount: 330, beneficiaryId: "s", reference: "Inventory" };
  const owner: Obligation = { kind: "owner_payout", amount: 1000, flexible: true, beneficiaryId: "o", reference: "Profit" };

  const short = planClose(600, [supplier, owner], p); // 100 above the 500 reserve
  assert.equal(short.defer.length, 2);
  assert.equal(short.reserveAfter, 600);

  const plan = planClose(1200, [owner, supplier], p); // 700 above the reserve
  // Both above the 300 threshold; the owner's share is sized after the supplier's reservation.
  assert.deepEqual(plan.needsApproval.map((o) => [o.kind, o.amount]), [["supplier", 330], ["owner_payout", 370]]);
  assert.equal(plan.reserveAfter, 500, "approving both later can't break the reserve");

  const small = planClose(900, [supplier, owner], { ...p, approvalThreshold: 1000 });
  assert.deepEqual(small.pay.map((o) => [o.kind, o.amount]), [["supplier", 330], ["owner_payout", 70]]);
});

test("approvals are bound to exact terms and used once", () => {
  const store = new TreasuryStore(":memory:");
  const o: Obligation = { kind: "owner_payout", amount: 420, beneficiaryId: "ben_owner", reference: "Profit 2026-11-02" };
  const a = store.requestApproval(approvalTerms(o, p), "above threshold");
  assert.equal(store.requestApproval(approvalTerms(o, p), "again").id, a.id, "same terms, same request");
  assert.equal(store.consumeApproval(approvalTerms(o, p)), undefined, "pending can't be used");
  store.decide(a.id, "approved", "owner");
  assert.equal(store.consumeApproval(approvalTerms({ ...o, amount: 421 }, p)), undefined, "a different amount never matches");
  assert.equal(store.consumeApproval(approvalTerms({ ...o, beneficiaryId: "ben_other" }, p)), undefined, "a different payee never matches");
  assert.equal(store.consumeApproval(approvalTerms(o, p))?.status, "used");
  assert.equal(store.consumeApproval(approvalTerms(o, p)), undefined, "used once");
});

test("close: nothing above the threshold moves until the owner approves those exact amounts", async () => {
  const ledger = new Ledger("USD", ":memory:");
  const store = new TreasuryStore(":memory:");
  const awx = fakeAwx();
  sell(ledger, "o1", 480, 330);
  sell(ledger, "o2", 480, 0);
  sell(ledger, "o3", 200, 120); // cash 1160, inventory owed 450, profit 710
  const policy = { ...p, reserveFloor: 100 };
  const deps = { ledger, store, awx: awx as unknown as Airwallex, policy, beneficiaries: ben, day: "2026-11-02" };

  const first = await runClose(deps);
  assert.equal(first.paid.length, 0);
  assert.deepEqual(first.awaiting.map((a) => [a.terms.kind, a.terms.amount]), [["supplier", 450], ["owner_payout", 610]]); // 1060 above the reserve
  assert.equal(awx.transfers.length, 0);

  for (const a of first.awaiting) store.decide(a.id, "approved", "owner");
  const second = await runClose(deps);
  assert.deepEqual(second.paid.map((x) => [x.kind, x.amount, x.status]), [["supplier", 450, "paid"], ["owner_payout", 610, "paid"]]);
  assert.equal(ledger.cash(), 100, "left exactly at the reserve floor");
  assert.equal(store.approvals("used").length, 2);

  const third = await runClose(deps);
  assert.equal(third.paid.length + third.awaiting.length, 0, "nothing left to pay");
});

test("a payout interrupted after the transfer was created is found by request_id, not paid twice", async () => {
  const ledger = new Ledger("USD", ":memory:");
  const store = new TreasuryStore(":memory:");
  const awx = fakeAwx();
  sell(ledger, "o1", 1000, 200);
  const stuck = store.startPayout({ kind: "supplier", amount: 200, currency: "USD", beneficiaryId: ben.supplier, reference: "Inventory 2026-11-01" });
  awx.transfers.push({ id: "tr_crash", request_id: stuck.requestId, status: "SENT" }); // created, then we crashed
  const r = await runClose({ ledger, store, awx: awx as unknown as Airwallex, policy: p, beneficiaries: ben, day: "2026-11-02" });
  assert.equal(r.resumed[0].transferId, "tr_crash");
  assert.equal(awx.transfers.filter((t) => t.kind === "supplier" || t.reference?.startsWith("Inventory")).length, 0, "no second supplier transfer");
  assert.equal(ledger.pnl().paidToSuppliers, 200);
});

test("dispute rules: small accepted, strong challenged, ignored customer escalated, rejection re-challenged", () => {
  const base: DisputeFacts = { amount: 440, stage: "RFI", reason: "FRAUDULENT", signedOrderMatches: true, customerAgreedInChat: true, delivery: "signed", unansweredContacts: 0 };
  assert.equal(decideDispute(base, p).action, "challenge");
  assert.equal(decideDispute({ ...base, signedOrderMatches: false }, p).action, "escalate"); // weak and above 300
  const small = decideDispute({ ...base, amount: 14, reason: "PRODUCT_NOT_RECEIVED", delivery: "unsigned" }, p);
  assert.deepEqual([small.action, (small as any).reason], ["accept", "LOW_VALUE_TRANSACTION"]);
  assert.equal(decideDispute({ ...base, amount: 14 }, p).action, "accept", "strong but cheaper to give back than to defend at RFI");
  assert.equal(decideDispute({ ...base, amount: 14, stage: "CHARGEBACK" }, p).action, "challenge", "the fee is sunk at chargeback");
  assert.equal(decideDispute({ ...base, amount: 120, reason: "CREDIT_NOT_PROCESSED", unansweredContacts: 2 }, p).action, "escalate");
  assert.equal(decideDispute({ ...base, amount: 120, reason: "CREDIT_NOT_PROCESSED" }, p).action, "accept");
});

test("chat facts: unanswered messages after asking for the owner", () => {
  const chat: ChatLine[] = [
    { from: "customer", text: "I want to return it", at },
    { from: "system", text: "Escalated to the owner: return request", at },
    { from: "agent", text: "The owner will reply here shortly.", at },
    { from: "customer", text: "Hello?", at },
    { from: "customer", text: "Still waiting for my refund", at },
  ];
  assert.equal(unansweredAfterEscalation(chat), 2);
  assert.equal(unansweredAfterEscalation([...chat, { from: "owner", text: "Sorry, refunding now", at }]), 0);
});

test("dispute queue: accept, challenge with a PDF of the signed order, escalate, then follow the owner", async () => {
  const ledger = new Ledger("USD", ":memory:");
  const store = new TreasuryStore(":memory:");
  const awx = fakeAwx();
  const fraud = sell(ledger, "big", 440, 330);
  const small = sell(ledger, "small", 14, 6);
  const credit = sell(ledger, "credit", 120, 60);
  ledger.add({ kind: "fulfillment", orderId: "big", carrier: "UPS", tracking: "1Z1", shippedAt: at, deliveredAt: at, signedBy: "A. Customer", at });
  ledger.add({ kind: "fulfillment", orderId: "small", carrier: "USPS", tracking: "94001", shippedAt: at, deliveredAt: at, at });
  const dispute = (id: string, intent: string, amount: number, type: string, due: string): AwxDispute =>
    ({ id, stage: "RFI", status: "REQUIRES_RESPONSE", amount, currency: "USD", payment_intent_id: intent, due_at: due, reason: { original_code: "x", type, description: type } });
  awx.disputes.push(
    dispute("dst_big", fraud.paymentIntentId, 440, "FRAUDULENT", "2026-11-12"),
    dispute("dst_small", small.paymentIntentId, 14, "PRODUCT_NOT_RECEIVED", "2026-11-10"),
    dispute("dst_credit", credit.paymentIntentId, 120, "CREDIT_NOT_PROCESSED", "2026-11-11"),
    dispute("dst_other", "int_not_ours", 28, "CREDIT_NOT_PROCESSED", "2026-11-09"),
  );
  const chats: Record<string, ChatLine[]> = {
    big: [{ from: "customer", text: "I'll take the machine at 440", at }, { from: "system", text: "Payment link for 440 USD: https://pay", at }],
    credit: [{ from: "system", text: "Escalated to the owner: wants a refund", at }, { from: "customer", text: "Any news?", at }, { from: "customer", text: "Please answer", at }],
  };
  const deps = { ledger, store, awx: awx as unknown as Airwallex, policy: p, chatFor: (o: any) => chats[o.orderId], shopName: "Tostadero Andino" };

  const reviews = await reviewDisputes(deps);
  assert.deepEqual(reviews.map((r) => [r.dispute.id, r.decision.action]), [["dst_other", "ignore"], ["dst_small", "accept"], ["dst_credit", "escalate"], ["dst_big", "challenge"]]);
  assert.deepEqual(awx.calls, ["accept dst_small LOW_VALUE_TRANSACTION", "challenge dst_big file_big.pdf"]);
  assert.equal(ledger.pnl().refunds, 14);

  const asked = store.approvals("pending")[0];
  assert.deepEqual([asked.terms.kind, asked.terms.amount, asked.terms.counterparty], ["dispute_refund", 120, "dst_credit"]);
  assert.equal((await reviewDisputes(deps)).find((r) => r.dispute.id === "dst_credit")?.decision.action, "wait");
  store.decide(asked.id, "approved", "owner");
  await reviewDisputes(deps);
  assert.equal(awx.calls.at(-1), "accept dst_credit VALID_CUSTOMER_DISPUTE");
  assert.equal(ledger.pnl().refunds, 134);
  assert.equal(ledger.openDisputeHold(), 440, "only the challenged case is still at risk");
});

test("float sweep keeps the target on Metal and books the rest as cash", async () => {
  const ledger = new Ledger("USD", ":memory:");
  const bridge = new FakeMetalBridge(12.4);
  const credited: [number, string][] = [];
  const r = await sweepFloat(bridge, ledger, p, async (a, h) => { credited.push([a, h]); });
  assert.equal(r.swept, 7.4);
  assert.equal(await bridge.floatBalance(), 5);
  assert.equal(ledger.cash(), 7.4);
  assert.equal(credited[0][1], (r as any).txHash);
  assert.equal((await sweepFloat(bridge, ledger, p, async () => {})).swept, 0);
});

test("evidence PDF has a valid cross-reference table", () => {
  const pdf = Buffer.from(textPdf(["Café de Huila (2 bolsas)", "x".repeat(300), ...Array.from({ length: 80 }, (_, i) => `line ${i}`)])).toString("latin1");
  const xref = Number(pdf.match(/startxref\n(\d+)/)![1]);
  assert.equal(pdf.slice(xref, xref + 4), "xref");
  const offsets = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) => Number(m[1]));
  offsets.forEach((o, i) => assert.equal(pdf.slice(o, o + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`));
  assert.match(pdf, /\/Count 2/);
});
