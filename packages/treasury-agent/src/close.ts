/**
 * The daily close: what the business owes, what it can pay without breaking the reserve,
 * what needs the owner, and the transfers themselves. Amounts come from the ledger, never
 * from the wallet balance (the sandbox wallet is prefunded) and never from a model.
 */
import type { Airwallex } from "@peaje-asa/airwallex";
import type { Ledger } from "@peaje-asa/ledger";
import type { MetalBridge } from "@peaje-asa/metal";
import { needsApproval, type OwnerPolicy } from "@peaje-asa/policy";
import { advanceDue } from "./advance.js";
import type { ApprovalTerms, Approval, Payout, TreasuryStore } from "./store.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();

export interface Obligation {
  kind: "supplier" | "advance_repayment" | "owner_payout";
  amount: number;
  /** Pay what's available up to `amount` instead of all or nothing (inventory and the owner's profit). */
  flexible?: boolean;
  beneficiaryId: string;
  reference: string;
}

export interface ClosePlan {
  /** Ledger cash minus payouts already in flight. */
  cash: number;
  pay: Obligation[];
  needsApproval: Obligation[];
  defer: { obligation: Obligation; why: string }[];
  /** Cash left once everything planned goes out, approvals included. Never below the reserve floor. */
  reserveAfter: number;
}

/**
 * Decide what to pay without breaking the reserve floor. Pure, testable.
 * Suppliers come before the owner. Inventory is paid in parts when cash is short, the advance
 * in full. A payment waiting for approval keeps its cash set aside, so approving it later
 * can't break the reserve.
 */
export function planClose(cash: number, obligations: Obligation[], policy: OwnerPolicy): ClosePlan {
  const order = { supplier: 0, advance_repayment: 1, owner_payout: 2 } as const;
  const sorted = [...obligations].sort((a, b) => order[a.kind] - order[b.kind]);
  let available = round2(cash - policy.reserveFloor);
  const plan: ClosePlan = { cash, pay: [], needsApproval: [], defer: [], reserveAfter: cash };
  // Debts (inventory, the advance) come before profit: if one can't be paid, the owner waits.
  let debtUnpaid = false;
  for (const o of sorted) {
    if (o.kind === "owner_payout" && debtUnpaid) {
      plan.defer.push({ obligation: o, why: "inventory and the advance are paid before profit" });
      continue;
    }
    const amount = round2(o.flexible ? Math.min(o.amount, available) : o.amount);
    if (amount < policy.minPayout) {
      if (o.kind !== "owner_payout" && o.amount >= policy.minPayout) debtUnpaid = true;
      plan.defer.push({ obligation: o, why: o.amount < policy.minPayout ? "nothing owed" : `only ${Math.max(0, available)} above the ${policy.reserveFloor} reserve` });
      continue;
    }
    if (amount > available + 1e-9) {
      plan.defer.push({ obligation: o, why: `${amount} owed, ${Math.max(0, available)} available above the ${policy.reserveFloor} reserve` });
      if (o.kind !== "owner_payout") debtUnpaid = true;
      continue;
    }
    if (amount < o.amount && o.kind !== "owner_payout") debtUnpaid = true;
    const sized = { ...o, amount };
    (needsApproval(amount, policy) ? plan.needsApproval : plan.pay).push(sized);
    available = round2(available - amount);
  }
  plan.reserveAfter = round2(policy.reserveFloor + available);
  return plan;
}

/** Who gets paid. The lender is only needed once an advance was taken. */
export interface Payees { supplier: string; owner: string; lender?: string }

/** What the books say is owed: inventory cost not yet paid, the advance repayment due, and profit not yet paid out or held for disputes. */
export function obligationsFromLedger(ledger: Ledger, store: TreasuryStore, beneficiaries: Payees, day: string): Obligation[] {
  const pnl = ledger.pnl();
  const inFlight = (kind: Payout["kind"]) => store.inFlight().filter((p) => p.kind === kind).reduce((s, p) => s + p.amount, 0);
  const supplierOwed = round2(pnl.cogs - pnl.paidToSuppliers - inFlight("supplier"));
  const ownerOwed = round2(pnl.netProfit - pnl.paidToOwner - inFlight("owner_payout") - ledger.openDisputeHold());
  const repayment = round2(advanceDue(ledger) - inFlight("advance_repayment"));
  return [
    { kind: "supplier", amount: Math.max(0, supplierOwed), flexible: true, beneficiaryId: beneficiaries.supplier, reference: `Inventory ${day}` },
    ...(beneficiaries.lender && repayment > 0 ? [{ kind: "advance_repayment" as const, amount: repayment, beneficiaryId: beneficiaries.lender, reference: `Advance repayment ${day}` }] : []),
    { kind: "owner_payout", amount: Math.max(0, ownerOwed), flexible: true, beneficiaryId: beneficiaries.owner, reference: `Profit ${day}` },
  ];
}

export const approvalTerms = (o: Obligation, policy: OwnerPolicy): ApprovalTerms =>
  ({ kind: o.kind, amount: o.amount, currency: policy.currency, counterparty: o.beneficiaryId, reference: o.reference });

/** The sandbox accepts any reason string; production validates it, so recheck these before going live. */
const TRANSFER_REASON: Record<Payout["kind"], string> = { supplier: "payment_to_supplier", advance_repayment: "loan_repayment", owner_payout: "personal_remittance" };
const LEDGER_KIND = { supplier: "supplier_payment", advance_repayment: "advance_repayment", owner_payout: "owner_payout" } as const;
const LABEL = { supplier: "Inventory payment", advance_repayment: "Advance repayment", owner_payout: "Profit payout" } as const;

export interface CloseDeps {
  ledger: Ledger;
  store: TreasuryStore;
  awx: Airwallex;
  policy: OwnerPolicy;
  beneficiaries: Payees;
  /**
   * Moves a created transfer to its end state. Sandbox transfers don't settle on their own, so the
   * script passes `awx.simulate.settleTransfer`; without it the close waits briefly and resumes next time.
   */
  settle?: (transferId: string) => Promise<any>;
  /** Day the close is for (YYYY-MM-DD). Part of each payment's reference, so it's part of what's approved. */
  day?: string;
}

export interface CloseResult {
  plan: ClosePlan;
  paid: Payout[];
  awaiting: Approval[];
  resumed: Payout[];
}

export async function runClose(deps: CloseDeps): Promise<CloseResult> {
  const { ledger, store, policy } = deps;
  const resumed = await resumePayouts(deps);
  const day = deps.day ?? now().slice(0, 10);
  const committed = store.inFlight().reduce((s, p) => s + p.amount, 0);
  const plan = planClose(round2(ledger.cash() - committed), obligationsFromLedger(ledger, store, deps.beneficiaries, day), policy);

  const paid: Payout[] = [];
  const awaiting: Approval[] = [];
  for (const o of plan.needsApproval) {
    const terms = approvalTerms(o, policy);
    const used = store.consumeApproval(terms);
    if (used) paid.push(await pay(deps, o, used.id));
    else awaiting.push(store.requestApproval(terms, `${LABEL[o.kind]} of ${o.amount} ${policy.currency} is above the ${policy.approvalThreshold} approval threshold.`));
  }
  for (const o of plan.pay) paid.push(await pay(deps, o));
  return { plan, paid, awaiting, resumed };
}

async function pay(deps: CloseDeps, o: Obligation, approvalId?: string): Promise<Payout> {
  const p = deps.store.startPayout({ kind: o.kind, amount: o.amount, currency: deps.policy.currency, beneficiaryId: o.beneficiaryId, reference: o.reference, approvalId });
  return createAndFinish(deps, p);
}

async function createAndFinish(deps: CloseDeps, p: Payout): Promise<Payout> {
  try {
    const t: any = await deps.awx.createTransferOnce({
      beneficiaryId: p.beneficiaryId, amount: p.amount, currency: p.currency, reference: p.reference, reason: TRANSFER_REASON[p.kind], requestId: p.requestId,
    });
    p.transferId = t.id;
    p.status = "in_flight";
    deps.store.savePayout(p);
  } catch (e: any) {
    // A 4xx means Airwallex refused it; anything else may have gone through, so it stays "creating" and is looked up next close.
    if (e?.status >= 400 && e?.status < 500 && e?.status !== 429) {
      p.status = "failed";
      p.failure = e.message;
      deps.store.savePayout(p);
      return p;
    }
    throw e;
  }
  return finish(deps, p);
}

/** Book the payout in the ledger only once Airwallex says PAID. */
async function finish(deps: CloseDeps, p: Payout): Promise<Payout> {
  let t: any = await deps.awx.getTransfer(p.transferId!);
  if (t.status !== "PAID" && t.status !== "CANCELLED" && t.status !== "FAILED") {
    t = deps.settle ? await deps.settle(p.transferId!) : await deps.awx.waitForTransfer(p.transferId!, 10_000);
  }
  if (t.status === "PAID") {
    deps.ledger.add({ kind: LEDGER_KIND[p.kind], ref: p.transferId!, amount: p.amount, currency: p.currency, at: now() });
    p.status = "paid";
  } else if (t.status === "CANCELLED" || t.status === "FAILED") {
    p.status = "failed";
    p.failure = [t.failure_type, t.failure_reason].filter(Boolean).join(": ") || t.status;
  }
  deps.store.savePayout(p);
  return p;
}

/** Pick up payouts a previous close left unfinished, before planning anything new. */
async function resumePayouts(deps: CloseDeps): Promise<Payout[]> {
  const out: Payout[] = [];
  for (const p of deps.store.inFlight()) {
    if (p.status === "creating") {
      const existing: any = await deps.awx.findTransferByRequestId(p.requestId);
      if (!existing) { out.push(await createAndFinish(deps, p)); continue; }
      p.transferId = existing.id;
      p.status = "in_flight";
      deps.store.savePayout(p);
    }
    out.push(await finish(deps, p));
  }
  return out;
}

/**
 * Keep `aiFloatTarget` USDZ on Metal for upcoming model calls and move the rest to Airwallex.
 * `receive` credits the Airwallex side (in the sandbox, a simulated deposit referencing the hash).
 */
export async function sweepFloat(bridge: MetalBridge, ledger: Ledger, policy: OwnerPolicy, receive: (amount: number, txHash: string) => Promise<unknown>) {
  const balance = await bridge.floatBalance();
  const amount = round2(balance - policy.aiFloatTarget);
  if (amount < policy.minPayout) return { swept: 0, balance };
  const { txHash } = await bridge.sweep(amount);
  try {
    await receive(amount, txHash);
  } catch (e) {
    throw new Error(`Swept ${amount} USDZ on Metal (${txHash}) but the Airwallex credit failed; retry the credit with this hash. ${e}`);
  }
  ledger.add({ kind: "bridge_in", txHash, amount, currency: policy.currency, at: now() });
  return { swept: amount, txHash, balance: round2(balance - amount) };
}
