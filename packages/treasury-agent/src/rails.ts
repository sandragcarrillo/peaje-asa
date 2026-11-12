/**
 * Where the shop's money moves. The treasury decides what to move and when; a rails adapter moves
 * it and reports what the provider says. Airwallex is one adapter (the platform owns the card
 * payments and each shop has a connected account); another provider plugs in here without
 * touching the close, the advance or the policy.
 */
import type { Airwallex } from "@peaje-asa/airwallex";
import type { Currency } from "@peaje-asa/policy";

/**
 * supplier / owner_payout: shop to a payee. advance_repayment and recovery: shop to platform
 * (recovery is a refund or dispute fee the platform paid). sale and advance: platform to shop.
 */
export type MoveKind = "supplier" | "owner_payout" | "advance_repayment" | "recovery" | "sale" | "advance";

export interface Move {
  kind: MoveKind;
  /** Idempotency key. The same key never moves money twice. */
  requestId: string;
  amount: number;
  currency: Currency;
  reference: string;
}

export interface MoveState {
  id: string;
  /** The status as the provider reports it, shown as is. */
  reported: string;
  state: "done" | "failed" | "pending";
  failure?: string;
}

/** Who each kind of payout goes to: bound into approvals, so a different payee needs a new one. */
export interface Payees { supplier: string; owner: string; lender: string }

export interface MoneyRails {
  readonly payees: Payees;
  /** Starts the move. A repeat with the same requestId returns the first one. */
  start(m: Move): Promise<MoveState>;
  /** The move started with this requestId, if there is one (after an ambiguous failure). */
  find(m: Move): Promise<MoveState | undefined>;
  check(m: Move, id: string): Promise<MoveState>;
  /** What the shop's account holds and can spend now. */
  available(currency: Currency): Promise<number>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Starts (or finds) the move and waits until the provider says it's done or failed, up to `timeoutMs`. */
export async function runMove(rails: MoneyRails, m: Move, timeoutMs = 15_000): Promise<MoveState> {
  let s = (await rails.find(m)) ?? (await rails.start(m));
  const deadline = Date.now() + timeoutMs;
  // Read it back at least once: a create answers before the provider has moved anything.
  for (let first = true; s.state === "pending" && (first || Date.now() < deadline); first = false) {
    if (!first) await sleep(1000);
    s = await rails.check(m, s.id);
  }
  return s;
}

/** An Airwallex Pay destination: another Airwallex account, by number and name. */
export interface Wallet { accountNumber: string; accountName: string }

/** Reasons from Airwallex's enums (checked against the sandbox). */
const REASON: Record<MoveKind, string> = {
  supplier: "goods_purchased",
  owner_payout: "transfer_to_own_account",
  advance_repayment: "loan_credit_repayment",
  recovery: "business_expenses",
  sale: "goods_purchased",
  advance: "business_expenses",
};

type Api = "wallet" | "charge" | "connected";
const API: Record<MoveKind, Api> = { supplier: "wallet", owner_payout: "wallet", advance_repayment: "charge", recovery: "charge", sale: "connected", advance: "connected" };

/** Payouts end PAID or CANCELLED/FAILED; charges and connected-account transfers end SETTLED or FAILED. */
function stateOf(api: Api, t: any): MoveState {
  const done = api === "wallet" ? t.status === "PAID" : t.status === "SETTLED";
  const failed = ["CANCELLED", "FAILED", "SUSPENDED"].includes(t.status);
  return { id: t.id, reported: t.status, state: done ? "done" : failed ? "failed" : "pending", failure: failed ? [t.failure_type, t.failure_reason].filter(Boolean).join(": ") || t.status : undefined };
}

/**
 * The shop's Airwallex connected account. Payouts go by Airwallex Pay from the shop's account;
 * the platform funds sales and the advance with connected-account transfers and takes
 * repayments and refunds back with charges.
 */
export function airwallexRails(awx: Airwallex, shopAccount: string, payTo: { supplier: Wallet; owner: Wallet }): MoneyRails {
  const wallet = (k: MoveKind) => (k === "supplier" ? payTo.supplier : payTo.owner);
  return {
    payees: { supplier: payTo.supplier.accountNumber, owner: payTo.owner.accountNumber, lender: "platform" },
    async start(m) {
      const api = API[m.kind];
      const base = { amount: m.amount, currency: m.currency, reason: REASON[m.kind], reference: m.reference, requestId: m.requestId };
      try {
        if (api === "wallet") return stateOf(api, await awx.createWalletTransfer({ ...base, onBehalfOf: shopAccount, ...wallet(m.kind) }));
        if (api === "charge") return stateOf(api, await awx.createCharge({ ...base, source: shopAccount }));
        return stateOf(api, await awx.createConnectedTransfer({ ...base, destination: shopAccount }));
      } catch (e: any) {
        // A request_id already used means the first attempt went through: return that one.
        if (e?.status === 400 && String(e.body).includes("request_id_duplicate")) {
          const first = await this.find(m);
          if (first) return first;
        }
        throw e;
      }
    },
    async find(m) {
      const api = API[m.kind];
      const t = api === "wallet" ? await awx.findTransferOf(m.requestId, shopAccount) : api === "charge" ? await awx.findCharge(m.requestId) : await awx.findConnectedTransfer(m.requestId);
      return t ? stateOf(api, t) : undefined;
    },
    async check(m, id) {
      const api = API[m.kind];
      return stateOf(api, api === "wallet" ? await awx.getTransferOf(id, shopAccount) : api === "charge" ? await awx.getCharge(id) : await awx.getConnectedTransfer(id));
    },
    async available(currency) {
      const balances: any[] = (await awx.balancesOf(shopAccount)) as any;
      return balances.find((b) => b.currency === currency)?.available_amount ?? 0;
    },
  };
}

/** In-memory rails for tests: everything settles on the first check unless `failNext` is set. */
export function fakeRails(opening = 0) {
  const moves: (Move & MoveState)[] = [];
  let balance = opening;
  const out = {
    moves,
    failNext: undefined as string | undefined,
    payees: { supplier: "wallet_supplier", owner: "wallet_owner", lender: "platform" },
    async start(m: Move): Promise<MoveState> {
      const found = await out.find(m);
      if (found) return found;
      const s: Move & MoveState = { ...m, id: `mv_${moves.length + 1}`, reported: "NEW", state: "pending" };
      if (out.failNext) { s.state = "failed"; s.reported = "FAILED"; s.failure = out.failNext; out.failNext = undefined; }
      moves.push(s);
      return { ...s };
    },
    async find(m: Move) { const s = moves.find((x) => x.requestId === m.requestId); return s && { id: s.id, reported: s.reported, state: s.state, failure: s.failure }; },
    async check(_m: Move, id: string): Promise<MoveState> {
      const s = moves.find((x) => x.id === id)!;
      if (s.state === "pending") {
        s.state = "done";
        s.reported = "SETTLED";
        balance += s.kind === "sale" || s.kind === "advance" ? s.amount : -s.amount;
      }
      return { id: s.id, reported: s.reported, state: s.state, failure: s.failure };
    },
    async available() { return balance; },
    setBalance(n: number) { balance = n; },
  };
  return out;
}
