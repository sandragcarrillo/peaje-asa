/**
 * The buyer agents' storefront (Kit 10): one Airwallex merchant for the whole platform, every
 * shop's products in its catalogue, our checkout and OAuth server at PUBLIC_URL.
 */
import "./env";
import { join } from "node:path";
import { Ledger, OrderSigner } from "@peaje-asa/ledger";
import { CheckoutStore, OAuthKey, OAuthServer, type BookDeps, type ShopListing } from "@peaje-asa/storefront";
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
