import { paymentQuotes, type Conversation, type TranscriptLine } from "@peaje-asa/seller-agent";
import type { Tone } from "./plain";

/** Where a conversation stands, in the owner's words. */
export function conversationState(c: Conversation): { label: string; tone: Tone; forOwner: boolean } {
  if (c.status === "escalated" && !c.escalation?.resolution) return { label: "Waiting for you", tone: "alert", forOwner: true };
  if (c.status === "paid") return { label: "Paid", tone: "good", forOwner: false };
  if (c.status === "awaiting_payment") return { label: "Payment link sent", tone: "info", forOwner: false };
  return { label: "No sale yet", tone: "muted", forOwner: false };
}

/** A human title for a chat: what the customer first said, short. */
export function conversationTitle(c: Conversation, max = 90) {
  const first = c.transcript.find((l) => l.from === "customer")?.text.trim().replace(/\s+/g, " ");
  if (!first) return "New customer";
  return first.length > max ? `${first.slice(0, max - 1).trimEnd()}…` : first;
}

/** Who the customer is, when the chat knows more than its own id (an email, say). */
export function customerName(c: Conversation) {
  return c.customerRef && c.customerRef !== c.id && !c.customerRef.startsWith("c-") ? c.customerRef : "Customer";
}

export const SPEAKER: Record<TranscriptLine["from"], string> = { customer: "Customer", agent: "Your agent", owner: "You", system: "Update" };

/**
 * The system lines in the transcript are written for the books. This says the same thing to the owner,
 * plus a link when the line carries one.
 */
export function systemLine(text: string): { text: string; tone: Tone; link?: string } {
  let m: RegExpExecArray | null;
  if ((m = /^Escalated to the owner: (.*)$/s.exec(text))) return { text: `The agent stopped and asked you to decide: ${m[1]}`, tone: "alert" };
  if ((m = /^Owner approved (.*)\.$/s.exec(text))) return { text: `You approved ${m[1]}.`, tone: "good" };
  if (text === "The owner handed the chat back to the agent.") return { text: "You handed the chat back to the agent.", tone: "muted" };
  if (text === "The owner declined the request.") return { text: "You said no to the request. The agent tells the customer and keeps helping.", tone: "muted" };
  if ((m = /^Payment link for (\S+) (\S+): (\S+)$/.exec(text))) return { text: `Payment link sent to the customer for ${Number(m[1]).toFixed(2)} ${m[2]}.`, tone: "info", link: m[3] };
  if ((m = /^Payment mismatch: paid (.*), quote is (.*)$/.exec(text))) return { text: `The payment didn't match the price (paid ${m[1]}, price was ${m[2]}), so the order was not marked as paid.`, tone: "alert" };
  if (/^Payment verified with Airwallex/.test(text)) return { text: "Paid. Airwallex confirmed the payment and the order was saved with a signed receipt.", tone: "good" };
  return { text, tone: "muted" };
}

/** Why the agent handed a chat to the owner, in plain words. */
export function escalationWhy(kind: "unprofitable" | "owner_decision") {
  return kind === "unprofitable"
    ? "Answering this customer would cost more in AI replies than this sale earns, so the agent paused and handed it to you."
    : "The customer asked for something the agent isn't allowed to decide on its own, like a lower price than your rules allow.";
}

/**
 * What the chat's order is: everything on its payment link once there is one (a link can cover several
 * products), else the offer on the table. Undefined while nothing was priced.
 */
export function orderOf(c: Conversation): { label: string; total: number; currency: string; discounted?: string } | undefined {
  const qs = c.payment ? paymentQuotes(c) : c.quotes.filter((q) => q.id === c.activeQuoteId);
  if (!qs.length) return undefined;
  const total = Math.round(qs.reduce((n, q) => n + q.total, 0) * 100) / 100;
  const off = qs.filter((q) => q.unitPrice < q.listPrice);
  return {
    label: qs.map((q) => `${q.qty} x ${q.name}`).join(", "),
    total,
    currency: qs[0]!.currency,
    ...(off.length && { discounted: off.map((q) => `${q.name} at ${q.unitPrice.toFixed(2)} each (list ${q.listPrice.toFixed(2)})`).join(", ") }),
  };
}
