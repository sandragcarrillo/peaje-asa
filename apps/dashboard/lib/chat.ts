/**
 * What the customer's browser gets back from the shop chat: the transcript and status, never the
 * model history, the AI budget and spend, the model tiers or why the chat went to the owner.
 */
import { randomBytes } from "node:crypto";
import type { Conversation } from "@peaje-asa/seller-agent";
import { getShop } from "./shops";

export interface CustomerLine { from: "customer" | "agent" | "owner" | "system"; text: string; at: string }

/** The reason an escalation gives (margin, AI budget) is for the owner; the customer only learns who answers next. */
const customerLine = ({ from, text, at }: Conversation["transcript"][number]): CustomerLine =>
  from === "system" && text.startsWith("Escalated to the owner:")
    ? { from, text: "Someone from the shop will reply here shortly.", at }
    : { from, text, at };

export function view(c: Conversation, id: string) {
  return { id, status: c.status, transcript: c.transcript.map(customerLine), paymentUrl: c.payment?.url };
}

/**
 * Conversation ids are made here, 128 random bits, never by the browser: the id is all it takes to
 * read and write a conversation, so it has to be impossible to guess.
 */
export const newConversationId = () => `c-${randomBytes(16).toString("hex")}`;
export const validConversationId = (id: unknown): id is string => typeof id === "string" && /^c-[0-9a-f]{32}$/.test(id);

/** The shop named in the URL, or a 404 response. */
export function shopOr404(id: string) {
  const shop = getShop(id);
  return shop ? { shop } : { error: Response.json({ error: "no such shop" }, { status: 404 }) };
}

const g = globalThis as unknown as { asaChatHits?: Map<string, number[]> };

/**
 * A fixed cap on how often one client can use a shop's chat, so nobody can run up the shop's AI
 * bill: at most `limit` hits per `windowMs` for the key. In memory: the app runs as one process.
 */
export function allow(key: string, limit: number, windowMs: number) {
  const hits = (g.asaChatHits ??= new Map<string, number[]>());
  const now = Date.now();
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) return false;
  recent.push(now);
  hits.set(key, recent);
  if (hits.size > 10_000) for (const [k, ts] of hits) if (ts.every((t) => now - t >= windowMs)) hits.delete(k);
  return true;
}

/** The caller's address as the proxy in front of the app reports it (Railway sets X-Forwarded-For). */
export const clientIp = (req: Request) => req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";

export const tooMany = () => Response.json({ error: "Too many messages. Wait a minute and try again." }, { status: 429 });
