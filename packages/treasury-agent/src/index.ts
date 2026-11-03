/**
 * Treasury agent: after sales, it pays the agents' costs, keeps the reserve,
 * pays inventory suppliers, defends disputes with signed orders, sends profit
 * to the owner, and computes the advance offer.
 */
import { needsApproval, type OwnerPolicy } from "@peaje-asa/policy";
import type { Ledger } from "@peaje-asa/ledger";
import type { Airwallex } from "@peaje-asa/airwallex";

export interface Obligation {
  id: string;
  kind: "supplier" | "ai_float" | "owner_payout";
  amount: number;
  dueBy?: string;
  beneficiaryId?: string;
}

export interface ClosePlan {
  pay: Obligation[];
  needsApproval: Obligation[];
  defer: Obligation[];
  reserveAfter: number;
}

/** Decide what to pay today without breaking the reserve floor. Pure, testable. */
export function planClose(cash: number, obligations: Obligation[], policy: OwnerPolicy): ClosePlan {
  const order = { ai_float: 0, supplier: 1, owner_payout: 2 } as const;
  const sorted = [...obligations].sort((a, b) => order[a.kind] - order[b.kind]);
  let available = cash - policy.reserveFloor;
  const plan: ClosePlan = { pay: [], needsApproval: [], defer: [], reserveAfter: cash };
  for (const o of sorted) {
    if (o.amount > available) { plan.defer.push(o); continue; }
    if (needsApproval(o.amount, policy)) { plan.needsApproval.push(o); continue; }
    plan.pay.push(o);
    available -= o.amount;
  }
  plan.reserveAfter = policy.reserveFloor + available;
  return plan;
}

/** Evidence for a disputed charge, straight from the ledger. */
export function disputeEvidence(ledger: Ledger, orderId: string) {
  const order = ledger.order(orderId);
  if (!order) return { defendable: false as const };
  return { defendable: true as const, order };
}

export async function executePayout(awx: Airwallex, o: Obligation, policy: OwnerPolicy, reference: string, reason: string) {
  if (!o.beneficiaryId) throw new Error(`Obligation ${o.id} has no beneficiary`);
  return awx.createTransferOnce({ beneficiaryId: o.beneficiaryId, amount: o.amount, currency: policy.currency, reference, reason });
}
