/**
 * The seller's typed tools. The model asks; this code decides with @peaje-asa/policy.
 * Amounts never come from the model: a payment link is built from a quote id, and the
 * quote's price was set by the catalog or by a discount policy accepted.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { catalog, checkOffer, findProduct, lowestAutoPrice, type OwnerPolicy } from "@peaje-asa/policy";
import type { Conversation, Quote } from "./store.js";

const round2 = (n: number) => Math.round(n * 100) / 100;

export const sellerTools: Anthropic.Beta.BetaToolUnion[] = [
  {
    name: "search_catalog",
    description: "Find products the shop sells. Returns sku, name, category and list price in USD. Pass an empty query to list everything.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { query: { type: "string", description: "Words to match, e.g. 'espresso machine' or 'beans'" } },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "quote",
    description: "Price a product at list price for a quantity. Returns a quote_id to use for discounts and payment.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { sku: { type: "string" }, qty: { type: "integer", description: "Units, 1 to 50" } },
      required: ["sku", "qty"],
      additionalProperties: false,
    },
  },
  {
    name: "propose_discount",
    description: "Ask whether a lower unit price is allowed for an existing quote. If accepted you get a new quote_id; if not, the lowest price you may offer.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { quote_id: { type: "string" }, unit_price: { type: "number", description: "Proposed price per unit in USD" } },
      required: ["quote_id", "unit_price"],
      additionalProperties: false,
    },
  },
  {
    name: "create_payment_link",
    description: "Create the card payment link for a quote once the customer agrees to buy. Returns the URL to send.",
    strict: true,
    input_schema: {
      type: "object",
      properties: { quote_id: { type: "string" } },
      required: ["quote_id"],
      additionalProperties: false,
    },
  },
  {
    name: "escalate_to_owner",
    description: "Hand the conversation to the shop owner: for a price below what you may offer, a request you can't handle, or anything that needs a human decision.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        reason: { type: "string", description: "One sentence the owner will read" },
        quote_id: { type: ["string", "null"], description: "Quote the request is about, if any" },
        requested_unit_price: { type: ["number", "null"], description: "Price per unit the customer asked for, if any" },
      },
      required: ["reason", "quote_id", "requested_unit_price"],
      additionalProperties: false,
    },
  },
];

/** Side effects the tools need from outside: payment links and escalations. */
export interface ToolContext {
  policy: OwnerPolicy;
  createPaymentLink(c: Conversation, q: Quote): Promise<{ url: string }>;
  escalate(c: Conversation, reason: string, kind: "owner_decision", terms?: { quote: Quote; requestedUnitPrice?: number }): void;
}

type ToolResult = { content: string; isError?: boolean };
const ok = (v: unknown): ToolResult => ({ content: JSON.stringify(v) });
const fail = (msg: string): ToolResult => ({ content: JSON.stringify({ error: msg }), isError: true });

function newQuote(c: Conversation, sku: string, qty: number, unitPrice: number, policy: OwnerPolicy): Quote {
  const p = findProduct(sku)!;
  const q: Quote = {
    id: `q${c.quotes.length + 1}`, sku, name: p.name, qty, listPrice: p.listPrice, unitPrice,
    total: round2(unitPrice * qty), currency: policy.currency, createdAt: new Date().toISOString(),
  };
  c.quotes.push(q);
  c.activeQuoteId = q.id;
  return q;
}

const publicQuote = (q: Quote) => ({ quote_id: q.id, sku: q.sku, name: q.name, qty: q.qty, unit_price: q.unitPrice, total: q.total, currency: q.currency });

export async function runTool(name: string, input: any, c: Conversation, ctx: ToolContext): Promise<ToolResult> {
  const { policy } = ctx;
  switch (name) {
    case "search_catalog": {
      const words = String(input.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
      const hits = catalog.filter((p) => words.length === 0 || words.some((w) => `${p.sku} ${p.name} ${p.category}`.toLowerCase().includes(w)));
      return ok((hits.length ? hits : catalog).map((p) => ({ sku: p.sku, name: p.name, category: p.category, list_price: p.listPrice, currency: policy.currency })));
    }
    case "quote": {
      const p = findProduct(input.sku);
      if (!p) return fail(`unknown sku ${input.sku}`);
      const qty = Number(input.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 50) return fail("qty must be an integer from 1 to 50");
      return ok(publicQuote(newQuote(c, p.sku, qty, p.listPrice, policy)));
    }
    case "propose_discount": {
      const q = c.quotes.find((x) => x.id === input.quote_id);
      if (!q) return fail(`unknown quote ${input.quote_id}`);
      const p = findProduct(q.sku)!;
      const price = round2(Number(input.unit_price));
      const verdict = checkOffer(p.listPrice, price, p.unitCost, policy);
      if (verdict.ok) return ok({ accepted: true, ...publicQuote(newQuote(c, q.sku, q.qty, price, policy)) });
      return ok({
        accepted: false,
        reason: verdict.reason === "below_margin_floor" ? "below what the owner allows" : "bigger than the discount you may give without the owner",
        lowest_unit_price_you_may_offer: lowestAutoPrice(p.listPrice, p.unitCost, policy),
      });
    }
    case "create_payment_link": {
      const q = c.quotes.find((x) => x.id === input.quote_id);
      if (!q) return fail(`unknown quote ${input.quote_id}`);
      if (c.status === "paid") return fail("this conversation's order is already paid");
      const { url } = await ctx.createPaymentLink(c, q);
      return ok({ url, total: q.total, currency: q.currency, note: "Send this link. Payment is confirmed automatically once the customer pays." });
    }
    case "escalate_to_owner": {
      const q = input.quote_id ? c.quotes.find((x) => x.id === input.quote_id) : undefined;
      ctx.escalate(c, String(input.reason), "owner_decision", q ? { quote: q, requestedUnitPrice: input.requested_unit_price ?? undefined } : undefined);
      return ok({ escalated: true, note: "The owner has the details. Tell the customer the owner will reply here shortly." });
    }
    default:
      return fail(`unknown tool ${name}`);
  }
}
