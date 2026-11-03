/**
 * Seller agent: talks to customers, quotes, negotiates within margin,
 * chooses how much intelligence each conversation deserves, and escalates
 * when a conversation stops being profitable.
 * The LLM handles language and judgment; numbers come from @peaje-asa/policy.
 */
import { aiBudgetFor, checkOffer, chooseTier, expectedMargin, type ModelTier, type OwnerPolicy } from "@peaje-asa/policy";
import type { Ledger } from "@peaje-asa/ledger";

export interface Conversation {
  id: string;
  customerRef: string;
  sku?: string;
  qty: number;
  listPrice?: number;
  unitCost?: number;
  aiSpent: number;
}

export interface SellerDeps {
  policy: OwnerPolicy;
  ledger: Ledger;
  tierPrices: Record<ModelTier, number>;
}

export type NextStep =
  | { action: "reply"; tier: ModelTier }
  | { action: "escalate"; reason: "unprofitable" | "needs_owner_approval" };

/** Decide how to handle the next customer message. */
export function planTurn(c: Conversation, deps: SellerDeps): NextStep {
  const margin = c.listPrice && c.unitCost ? expectedMargin(c.listPrice, c.unitCost, c.qty) : 0;
  // Before we know what they want, allow a small discovery budget.
  const budget = margin > 0 ? aiBudgetFor(margin, deps.policy) : deps.tierPrices.cheap * 3;
  const tier = chooseTier(budget - c.aiSpent, deps.tierPrices);
  if (tier === "escalate") return { action: "escalate", reason: "unprofitable" };
  return { action: "reply", tier };
}

/** Validate a discount the model wants to offer. */
export function proposeDiscount(c: Conversation, offerPrice: number, deps: SellerDeps) {
  if (!c.listPrice || !c.unitCost) throw new Error("Unknown product economics");
  return checkOffer(c.listPrice, offerPrice, c.unitCost, deps.policy);
}

// TODO: LLM loop (Claude) with typed tools: search_catalog, quote, propose_discount, create_payment_link.
