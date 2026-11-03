/**
 * One SellerAgent per server process, wired to the real Airwallex sandbox, the shared SQLite
 * book and the mock inference providers. Reads the repo's root .env, like the scripts do.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner } from "@peaje-asa/ledger";
import { metalDir, payerFor } from "@peaje-asa/metal";
import { defaultPolicy } from "@peaje-asa/policy";
import { ConversationStore, SellerAgent, type Conversation } from "@peaje-asa/seller-agent";

const root = resolve(process.cwd(), "../..");
if (existsSync(resolve(root, ".env"))) process.loadEnvFile(resolve(root, ".env"));
process.env.DB_PATH ??= resolve(root, "data/peaje-asa.db");

const g = globalThis as unknown as { sellerAgent?: SellerAgent };

export function agent(): SellerAgent {
  if (g.sellerAgent) return g.sellerAgent;
  const policy = defaultPolicy;
  g.sellerAgent = new SellerAgent({
    policy,
    ledger: new Ledger(policy.currency),
    store: new ConversationStore(),
    payer: payerFor("seller", metalDir(root)),
    providers: {
      cheap: { id: "cheap", url: process.env.PROVIDER_CHEAP_URL ?? "http://localhost:4101" },
      mid: { id: "mid", url: process.env.PROVIDER_MID_URL ?? "http://localhost:4102" },
      premium: { id: "premium", url: process.env.PROVIDER_PREMIUM_URL ?? "http://localhost:4103" },
    },
    awx: Airwallex.fromEnv(),
    signer: OrderSigner.fromEnv(),
  });
  return g.sellerAgent;
}

/** What the browser gets: the transcript and status, never the model history. */
export function view(c: Conversation | undefined, id: string) {
  if (!c) return { id, status: "open", transcript: [], aiSpent: 0, calls: 0 };
  const { status, transcript, aiSpent, calls, escalation, payment } = c;
  return { id, status, transcript, aiSpent, calls, escalation, paymentUrl: payment?.url };
}
