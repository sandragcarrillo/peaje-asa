/**
 * Chargebacks (Kit 4). Policy decides challenge / accept / escalate from facts the books hold:
 * the signed order, the chat that sold it, and the shipment. A model only writes the defense
 * text, paid through the same providers and capped by what's at stake.
 */
import type { Airwallex } from "@peaje-asa/airwallex";
import { verifyOrder, type Ledger, type SignedOrder } from "@peaje-asa/ledger";
import type { InferencePayer, InferenceProvider } from "@peaje-asa/metal";
import { chooseTier, decideDispute, findProduct, type Product, type DisputeDecision, type DisputeFacts, type ModelTier, type OwnerPolicy } from "@peaje-asa/policy";
import { textPdf } from "./pdf.js";
import type { Approval, TreasuryStore } from "./store.js";

const now = () => new Date().toISOString();

export interface ChatLine { from: string; text: string; at: string }

/** The slice of an Airwallex payment dispute the treasury reads. */
export interface AwxDispute {
  id: string;
  stage: string;
  status: string;
  amount: number;
  currency: string;
  payment_intent_id: string;
  due_at: string;
  reason: { original_code: string; type: string; description: string };
}

/** Customer lines after the chat was handed to the owner, with no owner reply after them. */
export function unansweredAfterEscalation(lines: ChatLine[]): number {
  const start = lines.findIndex((l) => l.from === "system" && l.text.startsWith("Escalated to the owner"));
  if (start < 0) return 0;
  let n = 0;
  for (const l of lines.slice(start + 1)) {
    if (l.from === "owner") n = 0;
    if (l.from === "customer") n++;
  }
  return n;
}

export function gatherFacts(d: AwxDispute, order: SignedOrder | undefined, chat: ChatLine[] | undefined, ledger: Ledger): DisputeFacts {
  const signedOrderMatches = !!order && verifyOrder(order) && order.paymentIntentId === d.payment_intent_id
    && order.currency === d.currency && d.amount <= order.total + 1e-9;
  const linkAt = chat?.findIndex((l) => l.from === "system" && l.text.startsWith("Payment link for")) ?? -1;
  const customerAgreedInChat = linkAt > 0 && chat!.slice(0, linkAt).some((l) => l.from === "customer");
  const f = order ? ledger.fulfillment(order.orderId) : undefined;
  return {
    amount: d.amount,
    stage: d.stage,
    reason: d.reason.type,
    signedOrderMatches,
    customerAgreedInChat,
    delivery: !f?.deliveredAt ? "none" : f.signedBy ? "signed" : "unsigned",
    unansweredContacts: chat ? unansweredAfterEscalation(chat) : 0,
  };
}

/** Writes the defense the issuer reads. Must not decide anything. */
export interface DisputeWriter {
  write(d: AwxDispute, order: SignedOrder, chat: ChatLine[] | undefined, facts: DisputeFacts): Promise<string>;
}

/** Fixed text built from the facts. Also the fallback when no model fits the budget. */
export function templateDefense(d: AwxDispute, order: SignedOrder, facts: DisputeFacts) {
  return [
    `The cardholder disputes ${d.amount} ${d.currency} as "${d.reason.description}".`,
    `Order ${order.orderId} was placed in a chat with our sales agent${facts.customerAgreedInChat ? ", where the customer chose the products and agreed to the price in their own messages" : ""}, and paid through the payment link sent in that chat (payment ${order.paymentIntentId}).`,
    `The order record is signed with our Ed25519 key at the moment the payment was verified; the attached file includes the signature and public key, so any change to the items, prices or payment would fail verification.`,
    facts.delivery === "signed" ? "The carrier delivered it and the customer signed for it." : facts.delivery === "unsigned" ? "The carrier delivered it." : "",
  ].filter(Boolean).join(" ");
}

/**
 * Asks a model through the paid providers. Budget: the same share of what's at stake the seller
 * uses for a sale's margin. One call; the best tier the budget covers; template if nothing fits.
 */
export class ProviderDisputeWriter implements DisputeWriter {
  constructor(private deps: { payer: InferencePayer; providers: Record<ModelTier, InferenceProvider>; policy: OwnerPolicy; ledger: Ledger }) {}

  async write(d: AwxDispute, order: SignedOrder, chat: ChatLine[] | undefined, facts: DisputeFacts) {
    const { payer, providers, policy, ledger } = this.deps;
    const budget = d.amount * policy.maxAiSpendShare;
    const offers = Object.fromEntries(await Promise.all((Object.keys(providers) as ModelTier[]).map(async (t) => [t, await payer.quote(providers[t]).catch(() => undefined)])));
    const pick = chooseTier(budget, 0, 0, offers, { ...policy, expectedCallsPerConversation: 1 });
    if (pick.action !== "reply") return templateDefense(d, order, facts);
    try {
      const call = await payer.payAndCall<any>(providers[pick.tier], {
        system: "You write chargeback defense statements for a small online shop. Use only the facts given. Plain text, 120 words or fewer, no greeting, no Markdown. State what the cardholder claims, then why the evidence answers it.",
        messages: [{ role: "user", content: JSON.stringify({ dispute: { amount: d.amount, currency: d.currency, reason: d.reason.description, stage: d.stage }, order: { id: order.orderId, items: order.items, total: order.total, paidWith: order.paymentIntentId, signed: true }, facts, chat: chat?.filter((l) => l.from !== "system").slice(-12) }) }],
      }, budget);
      ledger.add({ kind: "ai_cost", conversationId: `dispute:${d.id}`, provider: call.provider, amount: call.pricePaid, currency: policy.currency, at: now(), ...(call.txHash && { txHash: call.txHash }) });
      const text = (call.result.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim();
      return text || templateDefense(d, order, facts);
    } catch {
      return templateDefense(d, order, facts);
    }
  }
}

export function evidencePdf(order: SignedOrder, chat: ChatLine[] | undefined, ledger: Ledger, defense: string, shopName: string, catalog: readonly Product[]) {
  const f = ledger.fulfillment(order.orderId);
  const lines = [
    `${shopName}: dispute evidence for order ${order.orderId}`,
    "",
    "Statement",
    defense,
    "",
    "Signed order",
    `Order: ${order.orderId}   Created: ${order.createdAt}`,
    `Payment: ${order.paymentIntentId}${order.paymentLinkId ? `   Payment link: ${order.paymentLinkId}` : ""}`,
    ...order.items.map((i) => `  ${i.qty} x ${findProduct(catalog, i.sku)?.name ?? i.sku} (${i.sku}) at ${i.unitPrice} ${order.currency}`),
    `Total: ${order.total} ${order.currency}`,
    `Ed25519 signature (base64, over the canonical JSON of the fields above): ${order.signature}`,
    `Verifies: ${verifyOrder(order) ? "yes" : "NO"}`,
    "Public key:",
    ...order.signerPublicKey.trim().split("\n"),
    "",
    "Shipment",
    f ? `${f.carrier} ${f.tracking}, shipped ${f.shippedAt}${f.deliveredAt ? `, delivered ${f.deliveredAt}` : ""}${f.signedBy ? `, signed by ${f.signedBy}` : ", no signature"}` : "No shipment recorded.",
    "",
    "Chat transcript",
    ...(chat?.length ? chat.map((l) => `[${l.at.slice(0, 16).replace("T", " ")}] ${l.from}: ${l.text}`) : ["No chat on file."]),
  ];
  return textPdf(lines);
}

export interface DisputeDeps {
  ledger: Ledger;
  store: TreasuryStore;
  awx: Airwallex;
  policy: OwnerPolicy;
  /** The chat that sold the order, if any. */
  chatFor(order: SignedOrder): ChatLine[] | undefined;
  writer?: DisputeWriter;
  shopName: string;
}

export interface DisputeReview {
  dispute: AwxDispute;
  orderId?: string;
  facts: DisputeFacts;
  decision: DisputeDecision | { action: "wait" | "ignore"; why: string };
  approval?: Approval;
  fileId?: string;
  defense?: string;
}

/** Work the queue: every dispute waiting for our response, soonest deadline first. */
export async function reviewDisputes(deps: DisputeDeps): Promise<DisputeReview[]> {
  const { awx } = deps;
  const list: any = await awx.listDisputes("REQUIRES_RESPONSE");
  const queue = ((list.items ?? []) as AwxDispute[]).sort((a, b) => a.due_at.localeCompare(b.due_at));
  const out: DisputeReview[] = [];
  for (const d of queue) out.push(await reviewOne(deps, d));
  return out;
}

async function reviewOne(deps: DisputeDeps, d: AwxDispute): Promise<DisputeReview> {
  const { ledger, store, awx, policy } = deps;
  const order = ledger.orderByIntent(d.payment_intent_id);
  const chat = order ? deps.chatFor(order) : undefined;
  const facts = gatherFacts(d, order, chat, ledger);
  // A payment the agent didn't sell (no order in these books) is the owner's, outside this queue.
  if (!order) return { dispute: d, facts, decision: { action: "ignore", why: "No agent order for this payment." } };
  const record = (status: "open" | "challenged" | "accepted" | "escalated", note?: string, evidence?: { defense: string; fileId: string }) =>
    ledger.add({ kind: "dispute", disputeId: d.id, orderId: order.orderId, amount: d.amount, currency: policy.currency, stage: d.stage, status, note, ...evidence, at: now() });

  const previous = ledger.disputes().find((x) => x.disputeId === d.id);
  if (!previous) record("open", `${d.reason.original_code} ${d.reason.description}`);
  // The fee is charged when a case reaches chargeback, whatever happens next. Book it once.
  if (d.stage === "CHARGEBACK" && !ledger.all().some((e) => e.kind === "dispute_fee" && e.disputeId === d.id)) {
    ledger.add({ kind: "dispute_fee", disputeId: d.id, amount: policy.disputeFee, currency: policy.currency, at: now() });
  }

  let decision: DisputeReview["decision"] = decideDispute(facts, policy);
  let approval: Approval | undefined;
  if (previous?.status === "escalated") {
    // The owner decides an escalated case: approve the refund, or reject it to defend.
    approval = store.approvals().filter((a) => a.terms.kind === "dispute_refund" && a.terms.counterparty === d.id).at(-1);
    if (approval?.status === "approved") { store.consumeApproval(approval.terms); decision = { action: "accept", reason: "VALID_CUSTOMER_DISPUTE", why: "The owner approved the refund." }; }
    else if (approval?.status === "rejected") decision = { action: "challenge", why: "The owner chose to defend it." };
    else return { dispute: d, orderId: order.orderId, facts, decision: { action: "wait", why: "Waiting for the owner." }, approval };
  }

  if (decision.action === "accept") {
    await awx.acceptDispute(d.id, { reason: decision.reason, description: decision.why });
    record("accepted", decision.why);
    ledger.add({ kind: "refund", orderId: order.orderId, amount: d.amount, currency: policy.currency, ref: d.id, at: now() });
    return { dispute: d, orderId: order.orderId, facts, decision, approval };
  }

  if (decision.action === "escalate") {
    approval = store.requestApproval(
      { kind: "dispute_refund", amount: d.amount, currency: policy.currency, counterparty: d.id, reference: `Refund ${order.orderId}` },
      decision.why,
    );
    record("escalated", decision.why);
    return { dispute: d, orderId: order.orderId, facts, decision, approval };
  }

  const catalog = policy.catalog;
  const defense = deps.writer ? await deps.writer.write(d, order, chat, facts) : templateDefense(d, order, facts);
  const file = await awx.uploadFile(`${order.orderId}.pdf`.slice(-50), evidencePdf(order, chat, ledger, defense, deps.shopName, policy.catalog), "application/pdf", "Signed order and chat");
  const f = ledger.fulfillment(order.orderId);
  await awx.challengeDispute(d.id, {
    order_info: {
      id: order.orderId, created_at: order.createdAt, total_amount: order.total, total_currency: order.currency,
      products: order.items.map((i) => ({ sku: i.sku, code: i.sku, name: findProduct(catalog, i.sku)?.name ?? i.sku, quantity: i.qty, unit_price: i.unitPrice, type: "physical" })),
    },
    delivery_info: f ? { shipping_company: f.carrier, tracking_number: f.tracking, shipped_at: f.shippedAt, delivered_at: f.deliveredAt } : undefined,
    seller_info: { name: deps.shopName, store_name: deps.shopName },
    product_type: "PHYSICAL_GOODS", // required at CHARGEBACK
    reason: facts.delivery !== "none" ? "PRODUCT_RECEIVED" : "OTHER_REASONS",
    product_description: order.items.map((i) => findProduct(catalog, i.sku)?.name ?? i.sku).join(", "),
    supporting_documents: {
      documents: [{ type: "OTHER", file_ids: [file.file_id], description: defense.slice(0, 1000) }],
      customer_communication_documents: [file.file_id],
      receipt_documents: [file.file_id],
    },
  });
  record("challenged", decision.why, { defense, fileId: file.file_id });
  return { dispute: d, orderId: order.orderId, facts, decision, fileId: file.file_id, defense };
}

/** Read final outcomes of challenged disputes. A lost case is money out. */
export async function syncDisputeOutcomes(deps: Pick<DisputeDeps, "awx" | "ledger" | "policy">) {
  const { awx, ledger, policy } = deps;
  const changed: { disputeId: string; status: "won" | "lost" }[] = [];
  for (const d of ledger.disputes().filter((x) => x.status === "challenged")) {
    const live: any = await awx.getDispute(d.disputeId);
    const status = live.status === "WON" ? "won" : live.status === "LOST" ? "lost" : undefined;
    if (!status) continue;
    ledger.add({ ...d, status, note: `Airwallex: ${live.status}`, at: now() });
    if (status === "lost") ledger.add({ kind: "refund", orderId: d.orderId ?? d.disputeId, amount: d.amount, currency: policy.currency, ref: d.disputeId, at: now() });
    changed.push({ disputeId: d.disputeId, status });
  }
  return changed;
}
