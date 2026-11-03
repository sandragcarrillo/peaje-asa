/**
 * Our own record of everything that happened. Airwallex does not store signed
 * orders or reserves, so this ledger is the source of truth for the dashboard,
 * dispute evidence and the advance offer.
 * Backed by SQLite (node:sqlite) so the chat, the dashboard and scripts share one book.
 * Pass ":memory:" for throwaway runs and tests.
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
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

export type DisputeStatus = "open" | "challenged" | "accepted" | "escalated" | "won" | "lost";

export type LedgerEntry =
  | { kind: "sale"; orderId: string; amount: number; cogs: number; currency: Currency; at: string }
  /** Paid from the Metal float, not from the Airwallex wallet. */
  | { kind: "ai_cost"; conversationId: string; provider: string; amount: number; currency: Currency; at: string; txHash?: string }
  | { kind: "supplier_payment"; ref: string; amount: number; currency: Currency; at: string }
  | { kind: "owner_payout"; ref: string; amount: number; currency: Currency; at: string }
  | { kind: "refund"; orderId: string; amount: number; currency: Currency; at: string; ref?: string }
  /** One entry per status change; the latest one per dispute is its current state. */
  | { kind: "dispute"; disputeId: string; orderId?: string; amount: number; currency: Currency; stage: string; status: DisputeStatus; note?: string; defense?: string; fileId?: string; at: string }
  /** Revenue-based advance: cash in now, repaid from future sales. The fee is a cost when taken. */
  | { kind: "advance"; ref: string; amount: number; fee: number; repaymentShare: number; currency: Currency; at: string }
  | { kind: "advance_repayment"; ref: string; amount: number; currency: Currency; at: string }
  | { kind: "dispute_fee"; disputeId: string; amount: number; currency: Currency; at: string }
  /** USDZ swept from the Metal float into the Airwallex wallet. */
  | { kind: "bridge_in"; txHash: string; amount: number; currency: Currency; at: string }
  /** Shipment recorded by the shop. Not money; it's dispute evidence. */
  | { kind: "fulfillment"; orderId: string; carrier: string; tracking: string; shippedAt: string; deliveredAt?: string; signedBy?: string; at: string };

const round2 = (n: number) => Math.round(n * 100) / 100;
const OPEN_DISPUTE: DisputeStatus[] = ["open", "challenged", "escalated"];

/** Opens (and creates if needed) a SQLite file in WAL mode so several processes can share it. */
export function openDatabase(path: string) {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec("PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 3000;");
  return db;
}

/** DB_PATH from the environment, else data/peaje-asa.db under the current directory. */
export function defaultDbPath() {
  return process.env.DB_PATH ?? "data/peaje-asa.db";
}

export class Ledger {
  private db: DatabaseSync;

  constructor(readonly currency: Currency = "USD", path = defaultDbPath()) {
    this.db = openDatabase(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entries (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, at TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS orders (order_id TEXT PRIMARY KEY, body TEXT NOT NULL);
    `);
  }

  add(e: LedgerEntry) {
    if ("currency" in e && e.currency !== this.currency) {
      throw new Error(`Ledger is in ${this.currency}; got ${e.kind} in ${e.currency}. Convert before recording.`);
    }
    this.db.prepare("INSERT INTO entries (kind, at, body) VALUES (?, ?, ?)").run(e.kind, e.at, JSON.stringify(e));
  }

  /** Signed orders are immutable: a second write for the same id is refused. */
  addOrder(o: SignedOrder) {
    this.db.prepare("INSERT INTO orders (order_id, body) VALUES (?, ?)").run(o.orderId, JSON.stringify(o));
  }

  order(id: string): SignedOrder | undefined {
    const row = this.db.prepare("SELECT body FROM orders WHERE order_id = ?").get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  orders(): SignedOrder[] {
    return (this.db.prepare("SELECT body FROM orders").all() as { body: string }[]).map((r) => JSON.parse(r.body));
  }

  /** Disputes arrive with the payment intent; this is how they find the order. */
  orderByIntent(paymentIntentId: string): SignedOrder | undefined {
    return this.orders().find((o) => o.paymentIntentId === paymentIntentId);
  }

  fulfillment(orderId: string) {
    return this.all().filter((e) => e.kind === "fulfillment" && e.orderId === orderId).at(-1) as Extract<LedgerEntry, { kind: "fulfillment" }> | undefined;
  }

  /** Current state of every dispute (its latest entry). */
  disputes() {
    const latest = new Map<string, Extract<LedgerEntry, { kind: "dispute" }>>();
    for (const e of this.all()) if (e.kind === "dispute") latest.set(e.disputeId, e);
    return [...latest.values()];
  }

  /** Money still at risk in disputes that aren't settled. */
  openDisputeHold() {
    return round2(this.disputes().filter((d) => OPEN_DISPUTE.includes(d.status)).reduce((s, d) => s + d.amount, 0));
  }

  /**
   * The business's own cash in the Airwallex wallet: what it collected minus what left.
   * The sandbox wallet is prefunded, so the treasury plans from this, never the raw balance.
   * AI is paid from the Metal float; only what's swept back (bridge_in) counts here.
   */
  cash() {
    let cash = 0;
    for (const e of this.all()) {
      if (e.kind === "sale" || e.kind === "bridge_in" || e.kind === "advance") cash += e.amount;
      if (e.kind === "refund" || e.kind === "dispute_fee" || e.kind === "supplier_payment" || e.kind === "owner_payout" || e.kind === "advance_repayment") cash -= e.amount;
    }
    return round2(cash);
  }

  all(): LedgerEntry[] {
    return (this.db.prepare("SELECT body FROM entries ORDER BY id").all() as { body: string }[]).map((r) => JSON.parse(r.body));
  }

  /** Profit and loss, optionally only for entries at or after `since` (ISO time). */
  pnl(since?: string) {
    let revenue = 0, cogs = 0, aiCosts = 0, refunds = 0, disputeFees = 0, financing = 0, payouts = 0, supplier = 0;
    for (const e of this.all()) {
      if (since && e.at < since) continue;
      if (e.kind === "sale") { revenue += e.amount; cogs += e.cogs; }
      if (e.kind === "ai_cost") aiCosts += e.amount;
      if (e.kind === "refund") refunds += e.amount;
      if (e.kind === "dispute_fee") disputeFees += e.amount;
      if (e.kind === "advance") financing += e.fee;
      if (e.kind === "owner_payout") payouts += e.amount;
      if (e.kind === "supplier_payment") supplier += e.amount;
    }
    const grossProfit = revenue - cogs - refunds;
    const netProfit = grossProfit - aiCosts - disputeFees - financing;
    return {
      currency: this.currency, revenue: round2(revenue), cogs: round2(cogs), aiCosts: round2(aiCosts), refunds: round2(refunds),
      disputeFees: round2(disputeFees), financingCosts: round2(financing), grossProfit: round2(grossProfit), netProfit: round2(netProfit),
      paidToOwner: round2(payouts), paidToSuppliers: round2(supplier),
    };
  }

  /** Advances taken and what's left to repay (principal plus fee). */
  advances() {
    const taken = this.all().filter((e) => e.kind === "advance") as Extract<LedgerEntry, { kind: "advance" }>[];
    const repaid = round2(this.all().filter((e) => e.kind === "advance_repayment").reduce((s, e) => s + (e as { amount: number }).amount, 0));
    const owed = round2(taken.reduce((s, a) => s + a.amount + a.fee, 0));
    return { taken, repaid, owed, outstanding: round2(owed - repaid) };
  }

  close() { this.db.close(); }
}
