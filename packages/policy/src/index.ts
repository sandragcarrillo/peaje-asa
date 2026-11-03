/**
 * Business rules live here, in code, never in prompts.
 * The model reads conversations and proposes; policy decides what is allowed.
 * All money values are in major units of the business currency (USD for now).
 * AI is paid in USDZ, a dollar token, so 1 USDZ = 1 USD and AI prices compare
 * directly against deal margins. A non-USD business currency would need an FX rate here.
 */

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
}

export const defaultPolicy: OwnerPolicy = {
  currency: "USD",
  marginFloor: 0.25,
  maxAutoDiscount: 0.1,
  reserveFloor: 500,
  approvalThreshold: 300,
  maxAiSpendShare: 0.05,
};

export type ModelTier = "cheap" | "mid" | "premium";

/** Expected margin of a deal at a given price. */
export function expectedMargin(price: number, unitCost: number, qty = 1): number {
  return (price - unitCost) * qty;
}

/** How much AI spend a conversation is allowed, given what's at stake. */
export function aiBudgetFor(dealMargin: number, policy: OwnerPolicy): number {
  return Math.max(0, dealMargin * policy.maxAiSpendShare);
}

/** Pick the model tier the deal can afford. Prices are per call, in USD (= USDZ). */
export function chooseTier(
  remainingBudget: number,
  prices: Record<ModelTier, number>,
): ModelTier | "escalate" {
  if (remainingBudget >= prices.premium * 4) return "premium";
  if (remainingBudget >= prices.mid * 3) return "mid";
  if (remainingBudget >= prices.cheap) return "cheap";
  return "escalate";
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
