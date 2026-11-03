/**
 * Agent-based credit: an advance sized from what the agent itself sold and kept, repaid from
 * future sales. Every number comes from the ledger and every rule from policy, and the offer
 * carries its own explanation so the owner sees why it's that amount.
 */
import { randomUUID } from "node:crypto";
import type { Ledger } from "@peaje-asa/ledger";
import type { OwnerPolicy } from "@peaje-asa/policy";

const round2 = (n: number) => Math.round(n * 100) / 100;
const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export interface AdvanceOffer {
  amount: number;
  fee: number;
  repayTotal: number;
  repaymentShare: number;
  windowDays: number;
  revenue: number;
  netProfit: number;
  orders: number;
  givenBack: number;
  disputeRate: number;
  outstanding: number;
  /** The calculation in order, one line per step. */
  lines: string[];
}

export function advanceOffer(ledger: Ledger, policy: OwnerPolicy, nowMs = Date.now()): AdvanceOffer {
  const since = new Date(nowMs - policy.advanceWindowDays * 86_400_000).toISOString();
  const pnl = ledger.pnl(since);
  const orders = ledger.orders().filter((o) => o.createdAt >= since).map((o) => o.orderId);
  const givenBack = ledger.disputes().filter((d) => (d.status === "accepted" || d.status === "lost") && d.orderId && orders.includes(d.orderId)).length;
  const disputeRate = orders.length ? givenBack / orders.length : 0;
  const { outstanding } = ledger.advances();
  const c = policy.currency;

  const base = Math.max(0, pnl.netProfit) * policy.advanceShareOfProfit;
  const amount = outstanding > 0 ? 0 : Math.floor((base * (1 - disputeRate)) / 10) * 10;
  const fee = round2(amount * policy.advanceFee);
  const lines = [
    `Net profit in the last ${policy.advanceWindowDays} days: ${pnl.netProfit} ${c} on ${pnl.revenue} ${c} of sales.`,
    `${pct(policy.advanceShareOfProfit)} of it: ${round2(base)} ${c}.`,
    `Orders given back after a dispute: ${givenBack} of ${orders.length} (${pct(disputeRate)}), so x ${round2(1 - disputeRate)}.`,
    outstanding > 0
      ? `An advance is still being repaid (${outstanding} ${c} left), so no new offer.`
      : `Offer, rounded down to 10: ${amount} ${c}. Fee ${pct(policy.advanceFee)}: ${fee} ${c}. Repaid with ${pct(policy.advanceRepaymentShare)} of each new sale.`,
  ];
  return {
    amount, fee, repayTotal: round2(amount + fee), repaymentShare: policy.advanceRepaymentShare, windowDays: policy.advanceWindowDays,
    revenue: pnl.revenue, netProfit: pnl.netProfit, orders: orders.length, givenBack, disputeRate, outstanding, lines,
  };
}

let accepting: Promise<unknown> = Promise.resolve();

/**
 * Take the advance the owner was shown. The offer is recomputed here; if it changed since the owner
 * saw it, nothing happens. `receive` credits the wallet (in the sandbox, a simulated deposit).
 */
export function acceptAdvance(ledger: Ledger, policy: OwnerPolicy, shownAmount: number, receive: (amount: number, ref: string) => Promise<unknown>) {
  const run = accepting.then(async () => {
    const offer = advanceOffer(ledger, policy);
    if (offer.amount <= 0 || offer.amount !== shownAmount) throw new Error(`The offer is now ${offer.amount} ${policy.currency}; review it again.`);
    const ref = `adv_${randomUUID().slice(0, 8)}`;
    await receive(offer.amount, ref);
    ledger.add({ kind: "advance", ref, amount: offer.amount, fee: offer.fee, repaymentShare: offer.repaymentShare, currency: policy.currency, at: new Date().toISOString() });
    return { ref, ...offer };
  });
  accepting = run.catch(() => undefined);
  return run;
}

/** What the close should repay now: the repayment share of sales since the advance, minus what's been repaid, up to what's owed. */
export function advanceDue(ledger: Ledger): number {
  const { taken, outstanding } = ledger.advances();
  const last = taken.at(-1);
  if (!last || outstanding <= 0) return 0;
  const entries = ledger.all().filter((e) => e.at >= last.at);
  const sales = entries.reduce((s, e) => s + (e.kind === "sale" ? e.amount : 0), 0);
  const repaid = entries.reduce((s, e) => s + (e.kind === "advance_repayment" ? e.amount : 0), 0);
  return round2(Math.min(outstanding, Math.max(0, sales * last.repaymentShare - repaid)));
}
