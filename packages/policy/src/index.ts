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
  /** What a chargeback costs the business even when it wins. The sandbox doesn't deduct it, so it lives here. */
  disputeFee: number;
  /** USDZ to keep in the Metal float for upcoming model calls; the treasury sweeps the rest to Airwallex. */
  aiFloatTarget: number;
  /** Payouts smaller than this wait for the next close. */
  minPayout: number;
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
  disputeFee: 15,
  aiFloatTarget: 5,
  minPayout: 1,
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

/** What the treasury knows about a disputed charge, gathered from the ledger and the chat. */
export interface DisputeFacts {
  amount: number;
  /** Airwallex stage: RFI, PRE_CHARGEBACK, CHARGEBACK, PRE_ARBITRATION. */
  stage: string;
  /** Airwallex reason type, e.g. FRAUDULENT, PRODUCT_NOT_RECEIVED, CREDIT_NOT_PROCESSED. */
  reason: string;
  /** A signed order exists for this payment and its terms match the charge. */
  signedOrderMatches: boolean;
  /** The customer agreed to this purchase in their own words in the chat. */
  customerAgreedInChat: boolean;
  /** Carrier proof of delivery, and whether the customer signed for it. */
  delivery: "signed" | "unsigned" | "none";
  /** Messages the customer sent after asking for the owner that nobody answered. */
  unansweredContacts: number;
}

export type DisputeDecision =
  | { action: "challenge"; why: string }
  | { action: "accept"; reason: "LOW_VALUE_TRANSACTION" | "VALID_CUSTOMER_DISPUTE"; why: string }
  | { action: "escalate"; why: string };

/**
 * Challenge, accept or hand to the owner. The fee is charged once a case reaches chargeback,
 * win or lose, so at RFI defending only pays if the amount beats the fee; once it's sunk,
 * any case with strong evidence is worth defending.
 */
export function decideDispute(f: DisputeFacts, policy: OwnerPolicy): DisputeDecision {
  if (f.unansweredContacts > 0) {
    return { action: "escalate", why: `The customer wrote ${f.unansweredContacts} time(s) after asking for the owner and nobody answered. The owner should make this right.` };
  }
  const strong = f.signedOrderMatches && (
    f.reason === "FRAUDULENT" ? f.customerAgreedInChat || f.delivery === "signed"
    : f.reason === "PRODUCT_NOT_RECEIVED" ? f.delivery === "signed"
    : false);
  const feeAhead = f.stage === "RFI" ? policy.disputeFee : 0;
  if (strong && f.amount > feeAhead) {
    return { action: "challenge", why: "The signed order and the customer's own messages answer the claim." };
  }
  if (f.amount <= policy.disputeFee) {
    return { action: "accept", reason: "LOW_VALUE_TRANSACTION", why: `Defending costs ${policy.disputeFee} ${policy.currency}, more than the ${f.amount} at risk.` };
  }
  if (f.amount > policy.approvalThreshold) {
    return { action: "escalate", why: `The evidence doesn't answer the claim and ${f.amount} ${policy.currency} is above what the agent may give back on its own.` };
  }
  return { action: "accept", reason: "VALID_CUSTOMER_DISPUTE", why: "The evidence doesn't answer the claim." };
}
