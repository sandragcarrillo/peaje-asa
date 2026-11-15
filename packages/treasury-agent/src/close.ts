/**
 * The daily close: what the business owes, what it can pay without breaking the reserve,
 * what needs the owner, and the transfers themselves. Amounts come from the ledger, never
 * from the wallet balance (the sandbox wallet is prefunded) and never from a model.
 */
import { createHash } from "node:crypto";
import type { Ledger } from "@peaje-asa/ledger";
import type { MetalBridge } from "@peaje-asa/metal";
import { needsApproval, type OwnerPolicy } from "@peaje-asa/policy";
import { advanceDue } from "./advance.js";
import { runMove, type MoneyRails, type Move, type Payees } from "./rails.js";
import type { ApprovalTerms, Approval, Payout, Settlement, TreasuryStore } from "./store.js";

const round2 = (n: number) => Math.round(n * 100) / 100;
const now = () => new Date().toISOString();

export interface Obligation {
  kind: "supplier" | "advance_repayment" | "owner_payout";
  amount: number;
  /** Pay what's available up to `amount` instead of all or nothing (the owner's profit). */
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
 * Supplier bills and the advance come before the owner and are paid in full; the owner's
 * profit is paid in parts when cash is short. A payment waiting for approval keeps its cash set aside, so approving it later
 * can't break the reserve.
 */
export function planClose(cash: number, obligations: Obligation[], policy: OwnerPolicy): ClosePlan {
  const order = { supplier: 0, advance_repayment: 1, owner_payout: 2 } as const;
  const sorted = [...obligations].sort((a, b) => order[a.kind] - order[b.kind]);
  let available = round2(cash - policy.reserveFloor);
  const plan: ClosePlan = { cash, pay: [], needsApproval: [], defer: [], reserveAfter: cash };
  // Debts (supplier bills, the advance) come before profit: if one can't be paid, the owner waits.
  let debtUnpaid = false;
  for (const o of sorted) {
    if (o.kind === "owner_payout" && debtUnpaid) {
      plan.defer.push({ obligation: o, why: "supplier bills and the advance are paid before profit" });
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

/** A supplier bill the owner entered: who, how much and the day it's due. The close pays it on or after that day. */
export interface SupplierBill {
  id: string;
  supplier: string;
  amount: number;
  /** YYYY-MM-DD. */
  dueDate: string;
  note?: string;
}

/** The reference a bill's payment carries, so the bill, its approval and its transfer are one thing. */
export const billReference = (b: Pick<SupplierBill, "id">) => `Bill ${b.id}`;

export type BillStatus = "paid" | "paying" | "waiting_approval" | "due" | "upcoming";

/** Where a bill stands, from the payouts and approvals the treasury keeps. */
export function billStatus(b: SupplierBill, store: TreasuryStore, day = now().slice(0, 10)): BillStatus {
  const ref = billReference(b);
  const payouts = store.payouts().filter((p) => p.kind === "supplier" && p.reference === ref);
  if (payouts.some((p) => p.status === "paid")) return "paid";
  if (payouts.some((p) => p.status === "creating" || p.status === "in_flight")) return "paying";
  if (store.approvals("pending").some((a) => a.terms.kind === "supplier" && a.terms.reference === ref)) return "waiting_approval";
  return b.dueDate <= day ? "due" : "upcoming";
}

/** What is owed: supplier bills due and not paid yet, the advance repayment due, and profit not yet paid out or held for disputes. */
export function obligationsFromLedger(ledger: Ledger, store: TreasuryStore, beneficiaries: Payees, day: string, bills: SupplierBill[] = []): Obligation[] {
  const pnl = ledger.pnl();
  const inFlight = (kind: Payout["kind"]) => store.inFlight().filter((p) => p.kind === kind).reduce((s, p) => s + p.amount, 0);
  const due = bills
    .filter((b) => b.amount > 0 && (["due", "waiting_approval"] as BillStatus[]).includes(billStatus(b, store, day)))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const ownerOwed = round2(pnl.netProfit - pnl.paidToOwner - inFlight("owner_payout") - ledger.openDisputeHold());
  const repayment = round2(advanceDue(ledger) - inFlight("advance_repayment"));
  return [
    ...due.map((b) => ({ kind: "supplier" as const, amount: round2(b.amount), beneficiaryId: beneficiaries.supplier, reference: billReference(b) })),
    ...(repayment > 0 ? [{ kind: "advance_repayment" as const, amount: repayment, beneficiaryId: beneficiaries.lender, reference: `Advance repayment ${day}` }] : []),
    { kind: "owner_payout", amount: Math.max(0, ownerOwed), flexible: true, beneficiaryId: beneficiaries.owner, reference: `Profit ${day}` },
  ];
}

export const approvalTerms = (o: Obligation, policy: OwnerPolicy): ApprovalTerms =>
  ({ kind: o.kind, amount: o.amount, currency: policy.currency, counterparty: o.beneficiaryId, reference: o.reference });

const LEDGER_KIND = { supplier: "supplier_payment", advance_repayment: "advance_repayment", owner_payout: "owner_payout" } as const;
const LABEL = { supplier: "Supplier bill", advance_repayment: "Advance repayment", owner_payout: "Profit payout" } as const;

export interface CloseDeps {
  ledger: Ledger;
  store: TreasuryStore;
  policy: OwnerPolicy;
  /** The shop's account and its payees. Nothing here forces a status: a move is done when the provider says so. */
  rails: MoneyRails;
  /** Day the close is for (YYYY-MM-DD). Part of each payment's reference, so it's part of what's approved. */
  day?: string;
  /** How long to wait for a move to finish before leaving it for the next close. */
  waitMs?: number;
  /** Supplier bills the owner entered. Only the ones due by `day` are paid. */
  bills?: SupplierBill[];
}

export interface CloseResult {
  plan: ClosePlan;
  /** What the shop's account could spend when the close planned. */
  available: number;
  settled: Settlement[];
  paid: Payout[];
  awaiting: Approval[];
  resumed: Payout[];
}

export async function runClose(deps: CloseDeps): Promise<CloseResult> {
  const { ledger, store, policy } = deps;
  const settled = await settleWithPlatform(deps);
  const resumed = await resumePayouts(deps);
  const day = deps.day ?? now().slice(0, 10);
  const committed = store.inFlight().reduce((s, p) => s + p.amount, 0);
  // The books say what the shop has; the account says what has arrived. Plan on the smaller one.
  const available = round2(await deps.rails.available(policy.currency));
  const cash = round2(Math.min(ledger.cash() - committed, available));
  const plan = planClose(cash, obligationsFromLedger(ledger, store, deps.rails.payees, day, deps.bills), policy);

  const paid: Payout[] = [];
  const awaiting: Approval[] = [];
  for (const o of plan.needsApproval) {
    const terms = approvalTerms(o, policy);
    const used = store.consumeApproval(terms);
    if (used) paid.push(await pay(deps, o, used.id));
    else awaiting.push(store.requestApproval(terms, `${LABEL[o.kind]} of ${o.amount} ${policy.currency} is above the ${policy.approvalThreshold} approval threshold.`));
  }
  for (const o of plan.pay) paid.push(await pay(deps, o));
  return { plan, available, settled, paid, awaiting, resumed };
}

/** Request ids are platform-wide, so the shop is part of the key. Same entry, same id, never two moves. */
const settlementRequestId = (shopId: string, key: string, attempt: number) => `st_${createHash("sha256").update(`${shopId}|${key}|${attempt}`).digest("hex").slice(0, 40)}`;

/**
 * The platform owns the card payments: it moves each sale to the shop's account, and takes back each
 * refund and dispute fee it paid for the shop. One move per ledger entry. A create that was refused or
 * cut off is retried with the same request id at the next close; one the provider failed, with a new one.
 */
export async function settleWithPlatform(deps: CloseDeps): Promise<Settlement[]> {
  const { ledger, store, policy, rails } = deps;
  const due: Pick<Settlement, "key" | "kind" | "amount" | "reference">[] = [];
  for (const e of ledger.all()) {
    // The platform keeps its fee and moves the rest.
    if (e.kind === "sale" && e.amount - (e.platformFee ?? 0) >= 0.01) due.push({ key: `sale:${e.orderId}`, kind: "sale", amount: round2(e.amount - (e.platformFee ?? 0)), reference: `Sale ${e.orderId}` });
    if (e.kind === "refund") due.push({ key: `refund:${e.ref ?? e.orderId}`, kind: "recovery", amount: e.amount, reference: `Refund ${e.orderId}` });
    if (e.kind === "dispute_fee") due.push({ key: `fee:${e.disputeId}`, kind: "recovery", amount: e.amount, reference: `Dispute fee ${e.disputeId}` });
  }
  const out: Settlement[] = [];
  for (const d of due) {
    let s = store.settlement(d.key);
    if (s?.status === "done") continue;
    s ??= { ...d, currency: policy.currency, attempt: 0, requestId: settlementRequestId(store.shopId, d.key, 0), status: "pending", createdAt: now() };
    // The provider ended the last attempt as failed: that request id is spent, try a new one.
    if (s.status === "failed") Object.assign(s, { attempt: (s.attempt ?? 0) + 1, status: "pending", moveId: undefined, reported: undefined });
    s.requestId = settlementRequestId(store.shopId, d.key, s.attempt ?? 0);
    store.saveSettlement(s);
    const m: Move = { kind: s.kind, requestId: s.requestId, amount: s.amount, currency: s.currency, reference: s.reference.slice(0, 50) };
    try {
      const r = await runMove(rails, m, deps.waitMs);
      Object.assign(s, { moveId: r.id, reported: r.reported, status: r.state, failure: r.failure });
    } catch (e) {
      // Refused or unreachable: stays pending, and the next close retries the same request id.
      s.failure = e instanceof Error ? e.message : String(e);
    }
    store.saveSettlement(s);
    out.push(s);
  }
  return out;
}

const moveOf = (p: Payout): Move => ({ kind: p.kind, requestId: p.requestId, amount: p.amount, currency: p.currency, reference: p.reference });

async function pay(deps: CloseDeps, o: Obligation, approvalId?: string): Promise<Payout> {
  const p = deps.store.startPayout({ kind: o.kind, amount: o.amount, currency: deps.policy.currency, beneficiaryId: o.beneficiaryId, reference: o.reference, approvalId });
  return createAndFinish(deps, p);
}

async function createAndFinish(deps: CloseDeps, p: Payout): Promise<Payout> {
  try {
    const s = await deps.rails.start(moveOf(p));
    p.transferId = s.id;
    p.reported = s.reported;
    p.status = "in_flight";
    deps.store.savePayout(p);
  } catch (e: any) {
    // A 4xx means the provider refused it; anything else may have gone through, so it stays "creating" and is looked up next close.
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

/** Book the payout in the ledger only once the provider says it's done. Still pending: the next close looks again. */
async function finish(deps: CloseDeps, p: Payout): Promise<Payout> {
  const deadline = Date.now() + (deps.waitMs ?? 15_000);
  let s = await deps.rails.check(moveOf(p), p.transferId!);
  while (s.state === "pending" && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1000));
    s = await deps.rails.check(moveOf(p), p.transferId!);
  }
  p.reported = s.reported;
  if (s.state === "done") {
    deps.ledger.add({ kind: LEDGER_KIND[p.kind], ref: p.transferId!, amount: p.amount, currency: p.currency, at: now() });
    p.status = "paid";
  } else if (s.state === "failed") {
    p.status = "failed";
    p.failure = s.failure;
  }
  deps.store.savePayout(p);
  return p;
}

/** Pick up payouts a previous close left unfinished, before planning anything new. */
async function resumePayouts(deps: CloseDeps): Promise<Payout[]> {
  const out: Payout[] = [];
  for (const p of deps.store.inFlight()) {
    if (p.status === "creating") {
      const existing = await deps.rails.find(moveOf(p));
      if (!existing) { out.push(await createAndFinish(deps, p)); continue; }
      p.transferId = existing.id;
      p.reported = existing.reported;
      p.status = "in_flight";
      deps.store.savePayout(p);
    }
    out.push(await finish(deps, p));
  }
  return out;
}

/**
 * Keep `aiFloatTarget` USDZ on Alta for upcoming model calls and move the rest to Airwallex.
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
    throw new Error(`Swept ${amount} USDZ on Alta (${txHash}) but the Airwallex credit failed; retry the credit with this hash. ${e}`);
  }
  ledger.add({ kind: "bridge_in", txHash, amount, currency: policy.currency, at: now() });
  return { swept: amount, txHash, balance: round2(balance - amount) };
}
