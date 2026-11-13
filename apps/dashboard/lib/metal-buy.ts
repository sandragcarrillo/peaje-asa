/**
 * Buyer agents paying in USDZ on Metal (Kit 11 + 12): `POST /api/s/<shop>/metal/<sku>` sells one item
 * over x402. The 402 is an `exact` offer at list price to the platform's bridge, naming the item as
 * the one line it sells and asking for the agent's signed order. A payment is checked against the
 * agent's mandate before Metal's facilitator settles it (requireSignedOffer), the settlement is read
 * back from chain with the signed order (verifyMandatePayment), and only then is the sale booked in
 * the shop that sold it, like a card payment the Airwallex webhook confirms.
 */
import "./env";
import { readFileSync } from "node:fs";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { METAL_NETWORKS, formatUsdz, registerMetalScheme } from "@metalntwx/metal-pay";
import { SIGNED_OFFER_REQUIRED, requireSignedOffer, signedOfferOf, verifyMandatePayment } from "@metalntwx/metal-pay/mandates";
import { metalClient } from "@peaje-asa/metal";
import { findProduct } from "@peaje-asa/policy";
import { bookMandateSale, itemId, type BookResult } from "@peaje-asa/storefront";
import { HTTPFacilitatorClient, x402HTTPResourceServer, x402ResourceServer, type HTTPAdapter } from "@x402/core/server";
import type { Hash } from "viem";
import { root } from "./env";
import { platformMetalDir } from "./shops";
import { bookDeps, listing } from "./storefront";

const NET = METAL_NETWORKS.testnet;

const g = globalThis as unknown as { asaMetalSeller?: x402ResourceServer; asaMetalRoutes?: Map<string, Promise<x402HTTPResourceServer>> };

/** One resource server: Metal's scheme, and every offer that asks for a signed order checked before settling. */
function seller() {
  if (g.asaMetalSeller) return g.asaMetalSeller;
  const rpcUrl = process.env.METAL_RPC_URL;
  if (!rpcUrl) throw new Error("METAL_RPC_URL is not set");
  const server = registerMetalScheme(new x402ResourceServer(new HTTPFacilitatorClient({ url: NET.facilitatorUrl })), { networks: ["testnet"] });
  return (g.asaMetalSeller = requireSignedOffer(server, { rpcUrl }));
}

const bridge = () => (JSON.parse(readFileSync(join(platformMetalDir(), "bridge.json"), "utf8")) as { address: string }).address;

/** The route for one item at one price. A price change makes a new one. */
function routeFor(path: string, item: string, price: number, name: string) {
  const routes = (g.asaMetalRoutes ??= new Map());
  const key = `${path}@${price}`;
  let r = routes.get(key);
  if (!r) {
    const http = new x402HTTPResourceServer(seller(), {
      [`POST ${path}`]: {
        accepts: { scheme: "exact", network: NET.network, payTo: bridge(), price: price.toFixed(2), maxTimeoutSeconds: 300, extra: { ...SIGNED_OFFER_REQUIRED, resource: item } },
        description: name,
      },
    });
    r = http.initialize().then(() => http);
    r.catch(() => routes.delete(key));
    routes.set(key, r);
  }
  return r;
}

function adapterOf(req: Request, url: URL): HTTPAdapter {
  return {
    getHeader: (n) => req.headers.get(n) ?? undefined,
    getMethod: () => req.method,
    getPath: () => url.pathname,
    getUrl: () => url.toString(),
    getAcceptHeader: () => req.headers.get("accept") ?? "",
    getUserAgent: () => req.headers.get("user-agent") ?? "",
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...headers } });

/** A payment that settled but could not be booked: the money moved, so it is kept for a person to resolve. */
async function unbooked(entry: Record<string, unknown>) {
  await appendFile(join(root, "data/storefront/metal-unbooked.jsonl"), `${JSON.stringify({ ...entry, at: new Date().toISOString() })}\n`).catch(() => {});
  console.warn(`metal buy: settled but not booked ${JSON.stringify(entry).slice(0, 400)}`);
}

export async function sellOverMetal(req: Request, shopId: string, sku: string): Promise<Response> {
  const shop = listing(shopId);
  const p = shop && findProduct(shop.policy.catalog, sku);
  if (!shop || !p || p.archived) return json(404, { error: "no such item on sale" });
  if (shop.policy.currency !== "USD") return json(409, { error: `this shop sells in ${shop.policy.currency}; Metal pays in USDZ (USD)` });

  const url = new URL(req.url);
  const item = itemId(shop.id, p.sku);
  const http = await routeFor(url.pathname, item, p.listPrice, `${p.name} from ${shop.name}`);
  const context = { adapter: adapterOf(req, url), path: url.pathname, method: req.method, paymentHeader: req.headers.get("payment-signature") ?? req.headers.get("x-payment") ?? undefined };
  const result = await http.processHTTPRequest(context);
  if (result.type === "no-payment-required") return json(500, { error: "route not protected" });
  if (result.type === "payment-error") {
    const r = result.response;
    return json(r.status, r.body ?? { item, price: p.listPrice, currency: "USDZ" }, r.headers);
  }

  // Settle before booking: the sale exists only once the money moved on chain.
  const { paymentPayload, paymentRequirements, declaredExtensions } = result;
  const settled = await http.processSettlement(paymentPayload, paymentRequirements, declaredExtensions);
  if (!settled.success) return json(settled.response.status, settled.response.body ?? { error: settled.errorReason }, settled.headers);

  const tx = settled.transaction as Hash;
  const amount = Number(formatUsdz(BigInt(paymentRequirements.amount)));
  const verification = await verifyMandatePayment(metalClient(), { tx, requirements: paymentRequirements as any, checkoutMandate: signedOfferOf(paymentPayload) });
  const steps = verification.steps.map((s) => ({ step: s.step, outcome: s.outcome, detail: s.detail }));
  if (!verification.ok) {
    await unbooked({ shopId: shop.id, sku: p.sku, tx, payer: settled.payer, amount, steps });
    return json(502, { error: "paid, but the payment did not verify against the mandate; the shop will refund it", tx, steps }, settled.headers);
  }
  const booked: BookResult = bookMandateSale({ shopId: shop.id, sku: p.sku, tx, payer: settled.payer ?? verification.mandate?.principal ?? "unknown", amount }, bookDeps());
  if (!booked.booked && booked.reason !== "already booked") await unbooked({ shopId: shop.id, sku: p.sku, tx, amount, reason: booked.reason });
  return json(200, {
    order: booked.orderId,
    item: { id: item, name: p.name, price: p.listPrice, currency: "USDZ" },
    paid: { tx, payer: settled.payer, mandate: verification.mandate?.ref },
    verified: steps,
  }, settled.headers);
}
