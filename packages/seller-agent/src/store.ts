/**
 * Conversations, in the same SQLite file as the ledger, one set per shop.
 * `llmMessages` is the exact Messages API history and is append-only: earlier turns are never
 * edited (thinking blocks are only valid in the conversation that produced them).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { DEFAULT_SHOP, ensureShopColumn, openDatabase, defaultDbPath } from "@peaje-asa/ledger";
import type { Currency, ModelTier } from "@peaje-asa/policy";

export interface Quote {
  id: string;
  sku: string;
  name: string;
  qty: number;
  listPrice: number;
  unitPrice: number;
  total: number;
  currency: Currency;
  createdAt: string;
}

export interface TranscriptLine {
  from: "customer" | "agent" | "owner" | "system";
  text: string;
  at: string;
  /** For agent lines: which model tier answered and what that call cost. */
  tier?: ModelTier;
  cost?: number;
}

/** What the owner is asked to approve. Bound to exact terms so an approval can't be reused for different ones. */
export interface Escalation {
  reason: string;
  at: string;
  kind: "unprofitable" | "owner_decision";
  terms?: { sku: string; qty: number; unitPrice: number; total: number; currency: Currency; customerRef: string };
  aiSpent: number;
  aiBudget: number;
  /** The owner's answer. An approval only ever covers `terms` as they were escalated. */
  resolution?: { decision: "approved" | "declined"; by: string; at: string; quoteId?: string };
}

export interface Conversation {
  id: string;
  customerRef: string;
  createdAt: string;
  status: "open" | "awaiting_payment" | "paid" | "escalated";
  llmMessages: Anthropic.Beta.BetaMessageParam[];
  transcript: TranscriptLine[];
  quotes: Quote[];
  activeQuoteId?: string;
  payment?: { linkId: string; url: string; quoteId: string; orderId: string; paymentIntentId?: string };
  aiSpent: number;
  calls: number;
  /** Payments Metal refused under the seller's mandate, kept so the owner sees the chain said no. */
  mandateRefusals?: { tier: string; reason: string; at: string }[];
  /** Facts the system learned between turns (e.g. a verified payment), told to the model on the next turn. */
  pendingNotes: string[];
  escalation?: Escalation;
}

export class ConversationStore {
  private db;

  /** One shop's conversations. Ids are global, so a write never takes over another shop's row. */
  constructor(path = defaultDbPath(), readonly shopId = DEFAULT_SHOP) {
    this.db = openDatabase(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, body TEXT NOT NULL)");
    ensureShopColumn(this.db, "conversations");
  }

  get(id: string): Conversation | undefined {
    const row = this.db.prepare("SELECT body FROM conversations WHERE id = ? AND shop_id = ?").get(id, this.shopId) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  getOrCreate(id: string, customerRef = id): Conversation {
    return this.get(id) ?? {
      id, customerRef, createdAt: new Date().toISOString(), status: "open",
      llmMessages: [], transcript: [], quotes: [], aiSpent: 0, calls: 0, pendingNotes: [],
    };
  }

  save(c: Conversation) {
    const r = this.db.prepare("INSERT INTO conversations (id, shop_id, updated_at, body) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body WHERE conversations.shop_id = excluded.shop_id")
      .run(c.id, this.shopId, new Date().toISOString(), JSON.stringify(c));
    if (r.changes !== 1) throw new Error(`Conversation ${c.id} belongs to another shop`);
  }

  list(): Conversation[] {
    return (this.db.prepare("SELECT body FROM conversations WHERE shop_id = ? ORDER BY updated_at DESC").all(this.shopId) as { body: string }[]).map((r) => JSON.parse(r.body));
  }
}
