/** What the customer's browser gets back from the shop chat: the transcript and status, never the model history. */
import type { Conversation } from "@peaje-asa/seller-agent";
import { getShop } from "./shops";

export function view(c: Conversation | undefined, id: string) {
  if (!c) return { id, status: "open", transcript: [], aiSpent: 0, calls: 0 };
  const { status, transcript, aiSpent, calls, escalation, payment } = c;
  return { id, status, transcript, aiSpent, calls, escalation, paymentUrl: payment?.url };
}

export const validConversationId = (id: unknown): id is string => typeof id === "string" && /^[a-z0-9-]{4,40}$/i.test(id);

/** The shop named in the URL, or a 404 response. */
export function shopOr404(id: string) {
  const shop = getShop(id);
  return shop ? { shop } : { error: Response.json({ error: "no such shop" }, { status: 404 }) };
}
