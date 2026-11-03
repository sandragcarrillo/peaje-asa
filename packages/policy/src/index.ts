/**
 * Business rules live here, in code, never in prompts.
 * The model reads conversations and proposes; policy decides what is allowed.
 * All money values are in major units of the business currency (USD for now).
 * AI is paid in USDZ, a dollar token, so 1 USDZ = 1 USD and AI prices compare
 * directly against deal margins. A non-USD business currency would need an FX rate here.
 */

export * from "./catalog.js";

export type Currency = "COP" | "USD" | "EUR";

export interface OwnerPolicy {
  currency: Currency;
  /** Minimum margin the agent may accept on any sale, as a fraction (0.25 = 25%). */
  marginFloor: number;
  /** Max discount the seller can offer without asking, as a fraction of list price. */
  maxAutoDiscount: number;
  /** Cash the treasury must always keep. */
  reserveFloor: number;
  /** Any single payment above this needs the owner's approval. */
  approvalThreshold: number;
  /** Max share of a deal's expected margin the agent may spend on AI for that conversation. */
  maxAiSpendShare: number;
  /** AI the agent may spend before it knows what the customer wants to buy. */
  discoveryBudget: number;
  /** Model calls a conversation usually takes; the tier must afford what's left of them. */
  expectedCallsPerConversation: number;
  /** Providers advertising a slower answer than this are skipped. */
  maxProviderLatencyMs: number;
}

export const defaultPolicy: OwnerPolicy = {
  currency: "USD",
  marginFloor: 0.25,
  maxAutoDiscount: 0.1,
  reserveFloor: 500,
  approvalThreshold: 300,
  maxAiSpendShare: 0.02,
  discoveryBudget: 0.1,
  expectedCallsPerConversation: 10,
  maxProviderLatencyMs: 4000,
};

export type ModelTier = "cheap" | "mid" | "premium";
export const TIERS_BEST_FIRST: readonly ModelTier[] = ["premium", "mid", "cheap"];

/** What a provider's latest 402 offer says: its price per call and how fast it currently answers. */
export interface ProviderOffer { price: number; latencyMs: number }

/** Expected margin of a deal at a given price. */
export function expectedMargin(price: number, unitCost: number, qty = 1): number {
  return (price - unitCost) * qty;
}

/** How much AI spend a conversation is allowed, given what's at stake (or the discovery allowance before a quote). */
export function aiBudgetFor(dealMargin: number | undefined, policy: OwnerPolicy): number {
  if (dealMargin === undefined) return policy.discoveryBudget;
  return Math.max(0, dealMargin * policy.maxAiSpendShare);
}

export type TierDecision =
  | { action: "reply"; tier: ModelTier; price: number; budget: number; spent: number; callsLeft: number }
  | { action: "escalate"; reason: "unprofitable"; budget: number; spent: number; callsLeft: number };

/**
 * Pick the best model the deal can still afford: the most capable tier whose current
 * price covers the calls this conversation is expected to need, skipping slow providers.
 * If not even the cheapest fits, the conversation costs more than it can earn: escalate.
 */
export function chooseTier(
  budget: number,
  spent: number,
  callsMade: number,
  offers: Partial<Record<ModelTier, ProviderOffer>>,
  policy: OwnerPolicy,
): TierDecision {
  const remaining = budget - spent;
  const callsLeft = Math.max(1, policy.expectedCallsPerConversation - callsMade);
  for (const tier of TIERS_BEST_FIRST) {
    const offer = offers[tier];
    if (!offer || offer.latencyMs > policy.maxProviderLatencyMs) continue;
    if (offer.price * callsLeft <= remaining + 1e-9) {
      return { action: "reply", tier, price: offer.price, budget, spent, callsLeft };
    }
  }
  return { action: "escalate", reason: "unprofitable", budget, spent, callsLeft };
}

/** Lowest unit price the seller may offer without asking the owner, rounded up to the cent. */
export function lowestAutoPrice(listPrice: number, unitCost: number, policy: OwnerPolicy): number {
  const byDiscount = listPrice * (1 - policy.maxAutoDiscount);
  const byMargin = unitCost / (1 - policy.marginFloor);
  return Math.ceil(Math.max(byDiscount, byMargin) * 100) / 100;
}

/** Can the seller offer this price on its own? */
export function checkOffer(
  listPrice: number,
  offerPrice: number,
  unitCost: number,
  policy: OwnerPolicy,
): { ok: true } | { ok: false; reason: "below_margin_floor" | "needs_owner_approval" } {
  const margin = (offerPrice - unitCost) / offerPrice;
  if (margin < policy.marginFloor) return { ok: false, reason: "below_margin_floor" };
  const discount = (listPrice - offerPrice) / listPrice;
  if (discount > policy.maxAutoDiscount) return { ok: false, reason: "needs_owner_approval" };
  return { ok: true };
}

/** Does a treasury payment need the owner? */
export function needsApproval(amount: number, policy: OwnerPolicy): boolean {
  return amount > policy.approvalThreshold;
}
