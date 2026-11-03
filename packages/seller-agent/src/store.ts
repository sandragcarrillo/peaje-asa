/**
 * Conversations, in the same SQLite file as the ledger so the chat and the dashboard see them.
 * `llmMessages` is the exact Messages API history and is append-only: earlier turns are never
 * edited (thinking blocks are only valid in the conversation that produced them).
 */
import type Anthropic from "@anthropic-ai/sdk";
import { openDatabase, defaultDbPath } from "@peaje-asa/ledger";
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
  from: "customer" | "agent" | "system";
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
  /** Facts the system learned between turns (e.g. a verified payment), told to the model on the next turn. */
  pendingNotes: string[];
  escalation?: Escalation;
}

export class ConversationStore {
  private db;

  constructor(path = defaultDbPath()) {
    this.db = openDatabase(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS conversations (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL, body TEXT NOT NULL)");
  }

  get(id: string): Conversation | undefined {
    const row = this.db.prepare("SELECT body FROM conversations WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  getOrCreate(id: string, customerRef = id): Conversation {
    return this.get(id) ?? {
      id, customerRef, createdAt: new Date().toISOString(), status: "open",
      llmMessages: [], transcript: [], quotes: [], aiSpent: 0, calls: 0, pendingNotes: [],
    };
  }

  save(c: Conversation) {
    this.db.prepare("INSERT INTO conversations (id, updated_at, body) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body")
      .run(c.id, new Date().toISOString(), JSON.stringify(c));
  }

  list(): Conversation[] {
    return (this.db.prepare("SELECT body FROM conversations ORDER BY updated_at DESC").all() as { body: string }[]).map((r) => JSON.parse(r.body));
  }
}
