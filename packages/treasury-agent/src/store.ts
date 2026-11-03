/**
 * Approvals and payouts, in the shared SQLite file so the dashboard can approve what the treasury asked.
 * An approval is bound to exact terms (amount, currency, counterparty, reference): it can be used once,
 * and only for those terms. If the amount changes, the owner approves again.
 */
import { createHash, randomUUID } from "node:crypto";
import { canonicalJson, defaultDbPath, openDatabase } from "@peaje-asa/ledger";
import type { Currency } from "@peaje-asa/policy";

export interface ApprovalTerms {
  kind: "supplier" | "advance_repayment" | "owner_payout" | "dispute_refund";
  amount: number;
  currency: Currency;
  /** Beneficiary id for payouts, dispute id for refunds. */
  counterparty: string;
  reference: string;
}

export interface Approval {
  id: string;
  terms: ApprovalTerms;
  termsHash: string;
  /** Why the treasury is asking, in one sentence the owner reads. */
  reason: string;
  status: "pending" | "approved" | "rejected" | "used";
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface Payout {
  /** The Airwallex request_id. Saved before the transfer is created, so a crash can't pay twice. */
  requestId: string;
  kind: "supplier" | "advance_repayment" | "owner_payout";
  amount: number;
  currency: Currency;
  beneficiaryId: string;
  reference: string;
  approvalId?: string;
  transferId?: string;
  status: "creating" | "in_flight" | "paid" | "failed";
  failure?: string;
  createdAt: string;
}

export const termsHash = (t: ApprovalTerms) => createHash("sha256").update(canonicalJson(t)).digest("hex");
const now = () => new Date().toISOString();

export class TreasuryStore {
  private db;

  constructor(path = defaultDbPath()) {
    this.db = openDatabase(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS approvals (id TEXT PRIMARY KEY, terms_hash TEXT NOT NULL, status TEXT NOT NULL, body TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS payouts (request_id TEXT PRIMARY KEY, status TEXT NOT NULL, body TEXT NOT NULL);
    `);
  }

  // --- Approvals

  /** Ask the owner. Asking again for the same terms returns the open request instead of a second one. */
  requestApproval(terms: ApprovalTerms, reason: string): Approval {
    const hash = termsHash(terms);
    const open = this.approvals().find((a) => a.termsHash === hash && (a.status === "pending" || a.status === "approved"));
    if (open) return open;
    const a: Approval = { id: `apr_${randomUUID().slice(0, 8)}`, terms, termsHash: hash, reason, status: "pending", createdAt: now() };
    this.db.prepare("INSERT INTO approvals (id, terms_hash, status, body) VALUES (?, ?, ?, ?)").run(a.id, hash, a.status, JSON.stringify(a));
    return a;
  }

  approval(id: string): Approval | undefined {
    const row = this.db.prepare("SELECT body FROM approvals WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  approvals(status?: Approval["status"]): Approval[] {
    const rows = (status
      ? this.db.prepare("SELECT body FROM approvals WHERE status = ? ORDER BY rowid").all(status)
      : this.db.prepare("SELECT body FROM approvals ORDER BY rowid").all()) as { body: string }[];
    return rows.map((r) => JSON.parse(r.body));
  }

  /** The owner's answer. Only a pending request can be decided. */
  decide(id: string, decision: "approved" | "rejected", by: string): Approval {
    const a = this.approval(id);
    if (!a) throw new Error(`No approval ${id}`);
    if (a.status !== "pending") throw new Error(`Approval ${id} is ${a.status}`);
    return this.setApproval({ ...a, status: decision, decidedAt: now(), decidedBy: by }, "pending");
  }

  /**
   * Use an approval for exactly these terms, once. Returns undefined if there is no approved
   * request with the same terms (a different amount or beneficiary never matches).
   */
  consumeApproval(terms: ApprovalTerms): Approval | undefined {
    const hash = termsHash(terms);
    const a = this.approvals("approved").find((x) => x.termsHash === hash);
    if (!a) return undefined;
    try { return this.setApproval({ ...a, status: "used" }, "approved"); } catch { return undefined; }
  }

  /** Compare-and-set on status, so two processes can't both use the same approval. */
  private setApproval(a: Approval, expected: Approval["status"]) {
    const r = this.db.prepare("UPDATE approvals SET status = ?, body = ? WHERE id = ? AND status = ?").run(a.status, JSON.stringify(a), a.id, expected);
    if (r.changes !== 1) throw new Error(`Approval ${a.id} changed under us`);
    return a;
  }

  // --- Payouts

  startPayout(p: Omit<Payout, "requestId" | "status" | "createdAt">): Payout {
    const payout: Payout = { ...p, requestId: randomUUID(), status: "creating", createdAt: now() };
    this.db.prepare("INSERT INTO payouts (request_id, status, body) VALUES (?, ?, ?)").run(payout.requestId, payout.status, JSON.stringify(payout));
    return payout;
  }

  savePayout(p: Payout) {
    this.db.prepare("UPDATE payouts SET status = ?, body = ? WHERE request_id = ?").run(p.status, JSON.stringify(p), p.requestId);
  }

  payouts(): Payout[] {
    return (this.db.prepare("SELECT body FROM payouts ORDER BY rowid").all() as { body: string }[]).map((r) => JSON.parse(r.body));
  }

  /** Created or sent but not settled: the money is committed even though the ledger hasn't booked it. */
  inFlight(): Payout[] {
    return this.payouts().filter((p) => p.status === "creating" || p.status === "in_flight");
  }
}
