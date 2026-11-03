/**
 * Our own record of everything that happened. Airwallex does not store signed
 * orders or reserves, so this ledger is the source of truth for the dashboard,
 * dispute evidence and the advance offer.
 * In-memory for now; swap for SQLite/Postgres behind the same interface.
 */

export interface SignedOrder {
  orderId: string;
  customerRef: string;
  items: { sku: string; qty: number; unitPrice: number }[];
  total: number;
  /** Signature or payment proof binding the customer to this exact order. */
  signature: string;
  paymentIntentId?: string;
  createdAt: string;
}

export type LedgerEntry =
  | { kind: "sale"; orderId: string; amount: number; unitCost: number; at: string }
  | { kind: "ai_cost"; conversationId: string; provider: string; amount: number; at: string }
  | { kind: "supplier_payment"; ref: string; amount: number; at: string }
  | { kind: "owner_payout"; ref: string; amount: number; at: string }
  | { kind: "refund"; orderId: string; amount: number; at: string }
  | { kind: "dispute"; orderId: string; outcome: "won" | "lost" | "pending"; at: string };

export class Ledger {
  private entries: LedgerEntry[] = [];
  private orders = new Map<string, SignedOrder>();

  add(e: LedgerEntry) { this.entries.push(e); }
  addOrder(o: SignedOrder) { this.orders.set(o.orderId, o); }
  order(id: string) { return this.orders.get(id); }
  all() { return [...this.entries]; }

  pnl() {
    let revenue = 0, cogs = 0, aiCosts = 0, refunds = 0, payouts = 0, supplier = 0;
    for (const e of this.entries) {
      if (e.kind === "sale") { revenue += e.amount; cogs += e.unitCost; }
      if (e.kind === "ai_cost") aiCosts += e.amount;
      if (e.kind === "refund") refunds += e.amount;
      if (e.kind === "owner_payout") payouts += e.amount;
      if (e.kind === "supplier_payment") supplier += e.amount;
    }
    const grossProfit = revenue - cogs - refunds;
    const netProfit = grossProfit - aiCosts;
    return { revenue, cogs, aiCosts, refunds, grossProfit, netProfit, paidToOwner: payouts, paidToSuppliers: supplier };
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
