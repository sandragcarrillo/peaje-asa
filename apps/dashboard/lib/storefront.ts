/**
 * The buyer agents' storefront (Kit 10): one Airwallex merchant for the whole platform, every
 * shop's products in its catalogue, our checkout and OAuth server at PUBLIC_URL.
 */
import "./env";
import { join } from "node:path";
import { after } from "next/server";
import { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner } from "@peaje-asa/ledger";
import { CheckoutStore, OAuthKey, OAuthServer, feedFor, type BookDeps, type ShopListing } from "@peaje-asa/storefront";
import { root } from "./env";
import { getShop, policyOf, shops } from "./shops";

/** The public HTTPS origin Airwallex and the buyer's Claude reach this app at (a tunnel in dev, Railway in prod). */
export function publicUrl() {
  const u = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (!u) throw new Error("Set PUBLIC_URL to this app's public https origin");
  return u;
}

export const listing = (id: string): ShopListing | undefined => {
  const s = getShop(id);
  return s && { id: s.id, name: s.name, about: s.about, policy: policyOf(s) };
};
export const listings = () => shops().list().map((s) => listing(s.id)!);

const g = globalThis as unknown as { asaCheckouts?: CheckoutStore; asaOAuth?: { issuer: string; server: OAuthServer }; asaSigner?: OrderSigner };

export const checkouts = () => (g.asaCheckouts ??= new CheckoutStore());

/** The OAuth server, issuing under PUBLIC_URL. Its key lives in data/storefront/oauth-key.json. */
export function oauth() {
  const issuer = publicUrl();
  if (g.asaOAuth?.issuer !== issuer) g.asaOAuth = { issuer, server: new OAuthServer(issuer, OAuthKey.load(join(root, "data/storefront/oauth-key.json"))) };
  return g.asaOAuth.server;
}
export const oauthKey = () => OAuthKey.load(join(root, "data/storefront/oauth-key.json"));

export function bookDeps(): BookDeps {
  return {
    checkouts: checkouts(),
    shopOf: listing,
    ledgerFor: (id) => new Ledger(listing(id)!.policy.currency, undefined, id),
    signer: (g.asaSigner ??= OrderSigner.fromEnv()),
  };
}

const awx = () => ((globalThis as unknown as { asaAwx?: Airwallex }).asaAwx ??= Airwallex.fromEnv());

/**
 * Pushes the shop's products into the platform's Kit 10 catalogue after the response is sent, so
 * buyer agents see a new shop or an edited catalogue. Only on a public https origin with Kit 10
 * set up (`npm run kit10 -- setup`); a failure is logged and the next edit pushes again.
 */
export function syncCatalog(shopId: string) {
  if (!process.env.PUBLIC_URL?.startsWith("https://") || !process.env.AGENTIC_CHECKOUT_SECRET) return;
  after(async () => {
    const s = listing(shopId);
    if (!s || s.policy.catalog.length === 0) return;
    try {
      const r: any = await awx().agenticUpsertProducts(feedFor(s, publicUrl()));
      if (r.records_failed) console.warn(`kit10 sync ${shopId}: ${r.records_failed} product(s) failed`);
    } catch (e) {
      console.warn(`kit10 sync ${shopId}: ${e instanceof Error ? e.message.slice(0, 300) : String(e)}`);
    }
  });
}
