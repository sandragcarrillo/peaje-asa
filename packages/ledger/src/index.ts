/**
 * Our own record of everything that happened. Airwallex does not store signed
 * orders or reserves, so this ledger is the source of truth for the dashboard,
 * dispute evidence and the advance offer.
 * In-memory for now; swap for SQLite behind the same interface.
 */
import type { Currency } from "@peaje-asa/policy";

export * from "./signing.js";

export interface OrderItem { sku: string; qty: number; unitPrice: number }

export interface SignedOrder {
  orderId: string;
  customerRef: string;
  items: OrderItem[];
  total: number;
  currency: Currency;
  /** Airwallex payment intent that paid this exact order. */
  paymentIntentId: string;
  /** Hosted payment link the customer paid through, if any. */
  paymentLinkId?: string;
  createdAt: string;
  /** Ed25519 signature (base64) over the canonical JSON of every other field. */
  signature: string;
  signerPublicKey: string;
}

export type LedgerEntry =
  | { kind: "sale"; orderId: string; amount: number; cogs: number; currency: Currency; at: string }
  | { kind: "ai_cost"; conversationId: string; provider: string; amount: number; currency: Currency; at: string }
  | { kind: "supplier_payment"; ref: string; amount: number; currency: Currency; at: string }
  | { kind: "owner_payout"; ref: string; amount: number; currency: Currency; at: string }
  | { kind: "refund"; orderId: string; amount: number; currency: Currency; at: string }
  | { kind: "dispute"; orderId: string; outcome: "won" | "lost" | "pending"; at: string };

export class Ledger {
  private entries: LedgerEntry[] = [];
  private orders = new Map<string, SignedOrder>();

  constructor(readonly currency: Currency = "USD") {}

  add(e: LedgerEntry) {
    if ("currency" in e && e.currency !== this.currency) {
      throw new Error(`Ledger is in ${this.currency}; got ${e.kind} in ${e.currency}. Convert before recording.`);
    }
    this.entries.push(e);
  }
  addOrder(o: SignedOrder) { this.orders.set(o.orderId, o); }
  order(id: string) { return this.orders.get(id); }
  all() { return [...this.entries]; }

  pnl() {
    let revenue = 0, cogs = 0, aiCosts = 0, refunds = 0, payouts = 0, supplier = 0;
    for (const e of this.entries) {
      if (e.kind === "sale") { revenue += e.amount; cogs += e.cogs; }
      if (e.kind === "ai_cost") aiCosts += e.amount;
      if (e.kind === "refund") refunds += e.amount;
      if (e.kind === "owner_payout") payouts += e.amount;
      if (e.kind === "supplier_payment") supplier += e.amount;
    }
    const grossProfit = revenue - cogs - refunds;
    const netProfit = grossProfit - aiCosts;
    return { currency: this.currency, revenue, cogs, aiCosts, refunds, grossProfit, netProfit, paidToOwner: payouts, paidToSuppliers: supplier };
  }

  /**
   * Agent-based credit: a simple revenue-based advance offer from what the agent saw.
   * Deliberately conservative and explainable; tune with real data later.
   */
  advanceOffer(days = 30) {
    const { revenue, netProfit } = this.pnl();
    const disputes = this.entries.filter((e) => e.kind === "dispute");
    const lost = disputes.filter((d) => d.kind === "dispute" && d.outcome === "lost").length;
    const disputeRate = disputes.length ? lost / disputes.length : 0;
    const base = Math.max(0, netProfit) * 0.5;
    const amount = Math.round(base * (1 - disputeRate));
    return { amount, repaymentShare: 0.1, basedOnDays: days, revenue, netProfit, disputeRate };
  }
}
