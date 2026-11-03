/**
 * The agents the dashboard drives, wired like the chat and the scripts: the Airwallex sandbox,
 * the shared SQLite book and the mock inference providers. One set per server process.
 */
import { root } from "./env";
import { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner, type SignedOrder } from "@peaje-asa/ledger";
import { FakeMetalBridge, MandateBridge, metalDir, metalReady, payerFor } from "@peaje-asa/metal";
import { defaultPolicy, type ModelTier } from "@peaje-asa/policy";
import { ConversationStore, SellerAgent } from "@peaje-asa/seller-agent";
import { ProviderDisputeWriter, TreasuryStore, type CloseDeps, type DisputeDeps, ensurePayees } from "@peaje-asa/treasury-agent";

export const SHOP = "Tostadero Andino";
/** USDZ the owner put on Metal for the agents' model calls. On testnet the faucet gives more; only this much is the business's. */
const FLOAT_FUNDED = Number(process.env.METAL_FLOAT_FUNDED ?? 20);
const round2 = (n: number) => Math.round(n * 100) / 100;
export const METAL = metalDir(root);

function build() {
  const policy = defaultPolicy;
  const awx = Airwallex.fromEnv();
  const ledger = new Ledger(policy.currency);
  const conversations = new ConversationStore();
  const treasury = new TreasuryStore();
  const providers: Record<ModelTier, { id: string; url: string }> = {
    cheap: { id: "cheap", url: process.env.PROVIDER_CHEAP_URL ?? "http://localhost:4101" },
    mid: { id: "mid", url: process.env.PROVIDER_MID_URL ?? "http://localhost:4102" },
    premium: { id: "premium", url: process.env.PROVIDER_PREMIUM_URL ?? "http://localhost:4103" },
  };
  const seller = new SellerAgent({ policy, ledger, store: conversations, payer: payerFor("seller", METAL), providers, awx, signer: OrderSigner.fromEnv(), shopName: SHOP });
  const chatFor = (o: SignedOrder) => conversations.list().find((c) => c.payment?.orderId === o.orderId)?.transcript;
  const disputes: DisputeDeps = { ledger, store: treasury, awx, policy, chatFor, shopName: SHOP, writer: new ProviderDisputeWriter({ payer: payerFor("disputes", METAL), providers, policy, ledger }) };
  return { policy, awx, ledger, conversations, treasury, seller, chatFor, disputes, providers };
}

const g = globalThis as unknown as { asaDeps?: ReturnType<typeof build> };
export const deps = () => (g.asaDeps ??= build());

/** Close deps with the payees; the lender only once an advance was taken. Sandbox transfers are settled by simulation. */
export async function closeDeps(): Promise<CloseDeps> {
  const { ledger, treasury, awx, policy } = deps();
  const beneficiaries = await ensurePayees(awx, ledger.advances().taken.length > 0);
  return { ledger, store: treasury, awx, policy, beneficiaries, settle: (id) => awx.simulate.settleTransfer(id) };
}

/** The Metal float, from the books: what the owner funded, minus model calls, minus what was already swept. */
export function metalFloat() {
  const { ledger } = deps();
  const bridged = ledger.all().reduce((s, e) => s + (e.kind === "bridge_in" ? e.amount : 0), 0);
  return round2(FLOAT_FUNDED - ledger.pnl().aiCosts - bridged);
}
export const metalBridge = () => (metalReady(METAL) ? new MandateBridge(METAL, metalFloat()) : new FakeMetalBridge(metalFloat()));

/** Model spend per tier, from the ai_cost entries. */
export function aiSpendByTier() {
  const out: Record<string, { amount: number; calls: number }> = { cheap: { amount: 0, calls: 0 }, mid: { amount: 0, calls: 0 }, premium: { amount: 0, calls: 0 } };
  for (const e of deps().ledger.all()) {
    if (e.kind !== "ai_cost") continue;
    const t = (out[e.provider] ??= { amount: 0, calls: 0 });
    t.amount = round2(t.amount + e.amount);
    t.calls++;
  }
  return out;
}
