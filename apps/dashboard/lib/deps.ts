/**
 * The agents for one shop, wired like the scripts: the Airwallex sandbox, the shop's book in the
 * shared SQLite file and the inference providers. Built once per shop per server process, and again
 * when the shop's name, about or rules change.
 */
import { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner, type SignedOrder } from "@peaje-asa/ledger";
import { FakeMetalBridge, MandateBridge, metalReady, payerFor } from "@peaje-asa/metal";
import type { ModelTier } from "@peaje-asa/policy";
import { ConversationStore, SellerAgent } from "@peaje-asa/seller-agent";
import { airwallexRails, ProviderDisputeWriter, TreasuryStore, type CloseDeps, type DisputeDeps, type MoneyRails } from "@peaje-asa/treasury-agent";
import { getShop, metalDirFor, policyOf } from "./shops";

/** USDZ the owner put on Metal for the agents' model calls. On testnet the faucet gives more; only this much is the business's. */
const FLOAT_FUNDED = Number(process.env.METAL_FLOAT_FUNDED ?? 20);
const round2 = (n: number) => Math.round(n * 100) / 100;

export const providers: Record<ModelTier, { id: string; url: string }> = {
  cheap: { id: "cheap", url: process.env.PROVIDER_CHEAP_URL ?? "http://localhost:4101" },
  mid: { id: "mid", url: process.env.PROVIDER_MID_URL ?? "http://localhost:4102" },
  premium: { id: "premium", url: process.env.PROVIDER_PREMIUM_URL ?? "http://localhost:4103" },
};

const g = globalThis as unknown as { asaAwx?: Airwallex; asaSigner?: OrderSigner; asaDeps?: Map<string, { key: string; deps: ReturnType<typeof build> }> };
const awx = () => (g.asaAwx ??= Airwallex.fromEnv());
const signer = () => (g.asaSigner ??= OrderSigner.fromEnv());

function build(shopId: string) {
  const shop = getShop(shopId);
  if (!shop) throw new Error(`No shop ${shopId}`);
  const policy = policyOf(shop);
  const metal = metalDirFor(shop.id);
  const ledger = new Ledger(policy.currency, undefined, shop.id);
  const conversations = new ConversationStore(undefined, shop.id);
  const treasury = new TreasuryStore(undefined, shop.id);
  const seller = new SellerAgent({ policy, ledger, store: conversations, payer: payerFor("seller", metal), providers, awx: awx(), signer: signer(), shopName: shop.name, shopAbout: shop.about });
  const chatFor = (o: SignedOrder) => conversations.list().find((c) => c.payment?.orderId === o.orderId)?.transcript;
  const disputes: DisputeDeps = { ledger, store: treasury, awx: awx(), policy, chatFor, shopName: shop.name, writer: new ProviderDisputeWriter({ payer: payerFor("disputes", metal), providers, policy, ledger }) };
  return { shop, policy, metal, awx: awx(), ledger, conversations, treasury, seller, chatFor, disputes, providers };
}

export type ShopDeps = ReturnType<typeof build>;

/** The shop's agents. Rebuilt when the stored shop changed (an edited catalog or rule takes effect on the next request) and once its Metal mandates are bound (the agents switch to paying on chain). */
export function deps(shopId: string): ShopDeps {
  const shop = getShop(shopId);
  if (!shop) throw new Error(`No shop ${shopId}`);
  const key = `${metalReady(metalDirFor(shop.id))}:${JSON.stringify(shop)}`;
  const cache = (g.asaDeps ??= new Map());
  const hit = cache.get(shopId);
  if (hit && hit.key === key) return hit.deps;
  const built = build(shopId);
  cache.set(shopId, { key, deps: built });
  return built;
}

/** The shop's money rails: its Airwallex account and who it pays. Undefined until the account is open. */
export function railsFor(shopId: string): MoneyRails | undefined {
  const shop = getShop(shopId);
  if (!shop?.airwallexAccountId || !shop.payTo) return undefined;
  return airwallexRails(awx(), shop.airwallexAccountId, shop.payTo);
}

export class NoAccount extends Error {
  constructor() { super("Open the shop's Airwallex account first (Overview > Airwallex account)."); }
}

/** The close's deps. Every move goes through the shop's account and ends when Airwallex says so. */
export function closeDeps(shopId: string): CloseDeps {
  const { ledger, treasury, policy } = deps(shopId);
  const rails = railsFor(shopId);
  if (!rails) throw new NoAccount();
  return { ledger, store: treasury, policy, rails };
}

/** The Metal float, from the books: what the owner funded, minus model calls, minus what was already swept. */
export function metalFloat(shopId: string) {
  const { ledger } = deps(shopId);
  const bridged = ledger.all().reduce((s, e) => s + (e.kind === "bridge_in" ? e.amount : 0), 0);
  return round2(FLOAT_FUNDED - ledger.pnl().aiCosts - bridged);
}
export const metalBridge = (shopId: string) => {
  const dir = metalDirFor(shopId);
  return metalReady(dir) ? new MandateBridge(dir, metalFloat(shopId)) : new FakeMetalBridge(metalFloat(shopId));
};

/** Model spend per tier, from the ai_cost entries. */
export function aiSpendByTier(shopId: string) {
  const out: Record<string, { amount: number; calls: number }> = { cheap: { amount: 0, calls: 0 }, mid: { amount: 0, calls: 0 }, premium: { amount: 0, calls: 0 } };
  for (const e of deps(shopId).ledger.all()) {
    if (e.kind !== "ai_cost") continue;
    const t = (out[e.provider] ??= { amount: 0, calls: 0 });
    t.amount = round2(t.amount + e.amount);
    t.calls++;
  }
  return out;
}
