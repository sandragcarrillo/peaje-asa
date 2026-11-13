import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { defaultPolicy } from "@peaje-asa/policy";
import { CheckoutStore, OAuthKey, OAuthServer, checkoutIdsIn, expectedTotal, feedFor, itemId, parseItemId, quoteCheckout, signCheckout, verifyCheckoutSignature, type ShopListing } from "./index.js";

const shop: ShopListing = { id: "tostadero-andino", name: "Tostadero Andino", policy: defaultPolicy };
const other: ShopListing = { id: "frutas-del-llano", name: "Frutas del Llano", policy: defaultPolicy };
const shops = (id: string) => [shop, other].find((s) => s.id === id);
const base = "https://shops.example";

test("item ids carry the shop and the sku", () => {
  assert.deepEqual(parseItemId(itemId("tostadero-andino", "BEAN-HUILA-250")), { shopId: "tostadero-andino", sku: "BEAN-HUILA-250" });
  assert.equal(parseItemId("BEAN-HUILA-250"), undefined);
});

test("the feed lists every product on sale in GMC form", () => {
  const feed = feedFor(shop, base);
  assert.equal(feed.length, defaultPolicy.catalog.length);
  const huila = feed.find((p) => p.id === "tostadero-andino__BEAN-HUILA-250")!;
  assert.equal(huila.price, "14.00 USD");
  assert.equal(huila.availability, "in_stock");
  assert.ok(huila.image_link.startsWith(`${base}/api/s/tostadero-andino/img/`));
});

test("a checkout call is trusted only with a fresh, matching signature", () => {
  const body = '{"line_items":[]}';
  const ts = String(Date.now());
  const sig = signCheckout("s3cret", ts, body);
  assert.ok(verifyCheckoutSignature("s3cret", ts, body, sig));
  assert.ok(!verifyCheckoutSignature("s3cret", ts, body + " ", sig), "body changed");
  assert.ok(!verifyCheckoutSignature("other", ts, body, sig), "wrong secret");
  assert.ok(!verifyCheckoutSignature("s3cret", String(Date.now() - 10 * 60_000), body, signCheckout("s3cret", String(Date.now() - 10 * 60_000), body)), "stale");
  assert.ok(!verifyCheckoutSignature("s3cret", null, body, sig));
});

test("a cart sells from one shop at list price, and the payment must match what was quoted", () => {
  const { response, record } = quoteCheckout({
    currency: "USD",
    line_items: [
      { id: "li_1", item_id: "tostadero-andino__BEAN-HUILA-250", requested_quantity: 2 },
      { id: "li_2", item_id: "frutas-del-llano__BEAN-HUILA-250", requested_quantity: 1 },
      { id: "li_3", item_id: "tostadero-andino__NOPE", requested_quantity: 1 },
    ],
  }, shops, base);
  assert.deepEqual(response.line_items.map((l) => l.available_quantity), [2, 0, 0]);
  assert.deepEqual(response.totals.find((t) => t.type === "total"), { type: "total", amount: 2800, display_text: "Total" });
  const method = (response.fulfillment!.methods[0] as any);
  assert.deepEqual(method.line_item_ids, ["li_1", "li_2", "li_3"], "every cart line, sold or not");
  assert.equal(record!.shopId, "tostadero-andino");
  assert.equal(record!.subtotal, 28);
  assert.equal(expectedTotal(record!, [{ selected_option_id: "std" }]), 33);
  assert.equal(expectedTotal(record!, [{ selected_option_id: "warp" }]), undefined);

  const store = new CheckoutStore(":memory:");
  store.save(record!);
  assert.equal(store.get(record!.id)!.items[0]!.qty, 2);
  assert.deepEqual(checkoutIdsIn({ merchant_order_id: record!.id, metadata: { x: 1 } }), [record!.id]);
});

test("a cart in another currency, or with nothing we sell, is quoted empty", () => {
  const { response, record } = quoteCheckout({ currency: "EUR", line_items: [{ id: "li_1", item_id: "tostadero-andino__BEAN-HUILA-250", requested_quantity: 1 }] }, shops, base);
  assert.equal(record, undefined);
  assert.equal(response.line_items[0]!.available_quantity, 0);
  assert.equal(response.fulfillment, undefined);
});

test("OAuth: registration, PKCE code exchange once, ES256 token that verifies with the JWKS, refresh rotates", () => {
  const dir = mkdtempSync(join(tmpdir(), "oauth-"));
  const key = OAuthKey.load(join(dir, "key.json"));
  const again = OAuthKey.load(join(dir, "key.json"));
  assert.equal(key.kid, again.kid, "the key is kept");
  const server = new OAuthServer(base, key, ":memory:");
  assert.throws(() => server.register({ redirect_uris: ["http://evil.example/cb"] }), /https or loopback/);
  const client = server.register({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude" });

  const verifier = "v".repeat(50);
  const req = {
    client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", response_type: "code",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), code_challenge_method: "S256", state: "st1",
  };
  assert.throws(() => server.check({ ...req, redirect_uri: "https://claude.ai/other" }), /not registered/);
  assert.throws(() => server.check({ ...req, code_challenge_method: "plain" }), /S256/);
  const to = new URL(server.approve(req, "Buyer@Example.com"));
  assert.equal(to.searchParams.get("state"), "st1");
  const code = to.searchParams.get("code")!;

  assert.throws(() => server.exchange({ grant_type: "authorization_code", code, redirect_uri: req.redirect_uri, code_verifier: "wrong".repeat(10) }), /PKCE/);
  // A failed exchange used the code up: the attacker's guess burns it.
  assert.throws(() => server.exchange({ grant_type: "authorization_code", code, redirect_uri: req.redirect_uri, code_verifier: verifier }), /unknown, used/);

  const code2 = new URL(server.approve(req, "buyer@example.com")).searchParams.get("code")!;
  const out = server.exchange({ grant_type: "authorization_code", code: code2, redirect_uri: req.redirect_uri, code_verifier: verifier, client_id: client.client_id }) as any;
  const [h, b, s] = String(out.access_token).split(".");
  const jwk = key.jwks().keys[0]!;
  assert.ok(verify("sha256", Buffer.from(`${h}.${b}`), { key: createPublicKey({ key: jwk as any, format: "jwk" }), dsaEncoding: "ieee-p1363" }, Buffer.from(s!, "base64url")));
  const claims = JSON.parse(Buffer.from(b!, "base64url").toString());
  assert.equal(claims.iss, base);
  assert.equal(claims.email, "buyer@example.com");
  assert.ok(claims.exp > claims.iat);
  assert.equal(claims.awx_customer_id, undefined, "guests carry no Airwallex customer id");

  const refreshed = server.exchange({ grant_type: "refresh_token", refresh_token: out.refresh_token }) as any;
  assert.ok(refreshed.access_token);
  assert.throws(() => server.exchange({ grant_type: "refresh_token", refresh_token: out.refresh_token }), /unknown, used/);
});

test("a succeeded intent books the quoted checkout once, in the shop that sold it", async () => {
  const { Ledger, OrderSigner, verifyOrder } = await import("@peaje-asa/ledger");
  const { bookCheckoutPayment } = await import("./index.js");
  process.env.ORDER_SIGNING_KEY = OrderSigner.generateEnvValue();
  const ledgers = new Map<string, InstanceType<typeof Ledger>>();
  const deps = {
    checkouts: new CheckoutStore(":memory:"), shopOf: shops, signer: OrderSigner.fromEnv(),
    ledgerFor: (id: string) => { if (!ledgers.has(id)) ledgers.set(id, new Ledger("USD", ":memory:", id)); return ledgers.get(id)!; },
  };
  const { record } = quoteCheckout({ currency: "USD", line_items: [{ id: "li_1", item_id: "tostadero-andino__BEAN-HUILA-250", requested_quantity: 2 }] }, shops, base);
  deps.checkouts.save(record!);
  const intent = { id: "int_1", status: "SUCCEEDED", amount: 33, currency: "USD", merchant_order_id: record!.id, agentic_payment_data: { fulfillment: [{ selected_option_id: "std" }] } };

  assert.deepEqual(bookCheckoutPayment({ ...intent, status: "REQUIRES_PAYMENT_METHOD" }, deps), { booked: false, reason: "intent is REQUIRES_PAYMENT_METHOD" });
  assert.match((bookCheckoutPayment({ ...intent, amount: 28 }, deps) as any).reason, /quoted 33/);
  const r = bookCheckoutPayment(intent, deps);
  assert.deepEqual(r, { booked: true, shopId: "tostadero-andino", orderId: `ord_${record!.id}`, total: 33 });
  const ledger = ledgers.get("tostadero-andino")!;
  const order = ledger.order(`ord_${record!.id}`)!;
  assert.ok(verifyOrder(order));
  assert.equal(ledger.all().filter((e) => e.kind === "sale").length, 1);
  assert.equal((bookCheckoutPayment(intent, deps) as any).reason, "already booked");
  assert.match((bookCheckoutPayment({ ...intent, id: "int_2" }, deps) as any).reason, /already paid by int_1/);
  assert.equal(ledger.all().filter((e) => e.kind === "sale").length, 1);
});
