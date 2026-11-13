/**
 * The shops' storefront for buyer agents on Airwallex Agentic Commerce (Kit 10).
 *
 * The platform holds one merchant configuration (Airwallex derives the merchant from the API
 * token, and the platform owns the card payments). Every shop's products go into that one
 * catalogue under `<shop>__<sku>`, so a buyer's Claude finds them through the platform's
 * merchant MCP. Airwallex calls our create-checkout endpoint (signed with HMAC) for stock,
 * shipping and totals, takes the payment on its own page and tells our webhook when it
 * succeeded; the order then goes into the book of the shop that sold it, like any chat sale.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { openDatabase, defaultDbPath, type Ledger, type OrderItem, type OrderSigner } from "@peaje-asa/ledger";
import { findProduct, type Currency, type OwnerPolicy } from "@peaje-asa/policy";

export * from "./oauth.js";

/** Separates the shop from the sku in a catalogue item id. Shop ids are slugs and never contain it. */
export const ITEM_SEP = "__";
export const itemId = (shopId: string, sku: string) => `${shopId}${ITEM_SEP}${sku}`;
export function parseItemId(id: string): { shopId: string; sku: string } | undefined {
  const i = id.indexOf(ITEM_SEP);
  return i > 0 ? { shopId: id.slice(0, i), sku: id.slice(i + ITEM_SEP.length) } : undefined;
}

const minor = (n: number) => Math.round(n * 100);
const major = (n: number) => Math.round(n) / 100;

// --- Catalogue (Google Merchant Center product format, JSON form)

export interface ShopListing { id: string; name: string; about?: string; policy: OwnerPolicy }

export interface GmcProduct {
  id: string; title: string; description: string; link: string; image_link: string;
  availability: "in_stock" | "out_of_stock"; price: string; brand: string; product_type: string; condition: "new";
}

/**
 * One GMC row per product, served by this app at `baseUrl`. Archived products stay in the feed as
 * out of stock: an upsert leaves products it doesn't name unchanged, so dropping one would keep it on sale.
 */
export function feedFor(shop: ShopListing, baseUrl: string): GmcProduct[] {
  return shop.policy.catalog.map((p) => ({
    id: itemId(shop.id, p.sku),
    title: p.name,
    description: `${p.name} from ${shop.name}${shop.about ? `, ${shop.about}` : ""}.`,
    link: `${baseUrl}/s/${shop.id}?sku=${encodeURIComponent(p.sku)}`,
    image_link: `${baseUrl}/api/s/${shop.id}/img/${encodeURIComponent(p.sku)}`,
    availability: p.archived ? "out_of_stock" : "in_stock",
    price: `${p.listPrice.toFixed(2)} ${shop.policy.currency}`,
    brand: shop.name,
    product_type: p.category,
    condition: "new",
  }));
}

// --- Request signatures

/**
 * Airwallex signs each create-checkout call: hex HMAC-SHA256 of `x-timestamp` followed by the
 * raw body, keyed with the checkout secret. Timestamps are epoch milliseconds.
 */
export function signCheckout(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(timestamp + rawBody).digest("hex");
}

export function verifyCheckoutSignature(secret: string, timestamp: string | null, rawBody: string, signature: string | null, now = Date.now(), toleranceMs = 5 * 60_000): boolean {
  if (!timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(now - Number(timestamp)) > toleranceMs) return false;
  const want = Buffer.from(signCheckout(secret, timestamp, rawBody), "hex");
  const got = Buffer.from(signature, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Airwallex webhooks: HMAC-SHA256 of `x-timestamp` + raw body with the webhook's own secret. */
export const verifyWebhookSignature = verifyCheckoutSignature;

// --- Checkout

export interface CheckoutRequest {
  line_items: { id: string; item_id: string; requested_quantity: number }[];
  currency: string;
  customer?: { id?: string; email?: string; first_name?: string; last_name?: string; phone_number?: string };
  shipping_address?: { street?: string; city?: string; state?: string; postcode?: string; country_code?: string };
}

/** Shipping the shops offer buyer agents, in minor units. Airwallex adds the chosen one to the total. */
export const SHIPPING_OPTIONS = [
  { id: "std", title: "Standard shipping (4-6 days)", cost: 500 },
  { id: "exp", title: "Express shipping (1-2 days)", cost: 1500 },
] as const;

/** What we quoted, kept so the payment can be matched to it and booked to the right shop. */
export interface CheckoutRecord {
  id: string;
  shopId: string;
  currency: Currency;
  /** Only the lines we can sell; amounts in major units, like the ledger. */
  items: (OrderItem & { lineId: string })[];
  subtotal: number;
  shipping: Record<string, number>;
  customer?: CheckoutRequest["customer"];
  createdAt: string;
  /** Set once the payment that settled it was booked. */
  paymentIntentId?: string;
  orderId?: string;
}

export interface CheckoutResponse {
  id: string;
  line_items: { id: string; item_id: string; requested_quantity: number; available_quantity: number }[];
  fulfillment?: { methods: unknown[] };
  totals: { type: "subtotal" | "tax" | "fee" | "total"; amount: number; display_text: string }[];
  permalink_url?: string;
}

/**
 * Quotes a cart at list price. A cart sells from one shop: lines of any other shop, unknown
 * items and a currency the shop doesn't sell in come back with `available_quantity: 0`.
 * Quantities above 50 are cut to 50, the same cap the chat agent has.
 */
export function quoteCheckout(req: CheckoutRequest, shopOf: (id: string) => ShopListing | undefined, baseUrl: string, newId = () => `chk_${randomBytes(9).toString("base64url")}`): { response: CheckoutResponse; record?: CheckoutRecord } {
  const first = req.line_items.map((l) => parseItemId(l.item_id)).find(Boolean);
  const shop = first && shopOf(first.shopId);
  const id = newId();
  const items: CheckoutRecord["items"] = [];
  const lines = req.line_items.map((l) => {
    const ref = parseItemId(l.item_id);
    const p = shop && ref?.shopId === shop.id && req.currency === shop.policy.currency ? findProduct(shop.policy.catalog, ref.sku) : undefined;
    const qty = p && !p.archived && Number.isInteger(l.requested_quantity) && l.requested_quantity > 0 ? Math.min(l.requested_quantity, 50) : 0;
    if (qty > 0) items.push({ lineId: l.id, sku: p!.sku, qty, unitPrice: p!.listPrice });
    return { id: l.id, item_id: l.item_id, requested_quantity: l.requested_quantity, available_quantity: qty };
  });
  const subtotal = minor(items.reduce((s, i) => s + i.unitPrice * i.qty, 0));
  const totals: CheckoutResponse["totals"] = [
    { type: "subtotal", amount: subtotal, display_text: "Subtotal" },
    { type: "total", amount: subtotal, display_text: "Total" },
  ];
  if (!shop || items.length === 0) return { response: { id, line_items: lines, totals } };
  const response: CheckoutResponse = {
    id,
    line_items: lines,
    fulfillment: {
      methods: [{
        // Airwallex fails a checkout whose methods leave out any cart line, even one we can't sell.
        id: "ship", type: "SHIPPING", line_item_ids: req.line_items.map((l) => l.id),
        destinations: [{ id: "dest_1", name: "Shipping address", ...(req.shipping_address && { address: req.shipping_address }) }],
        options: SHIPPING_OPTIONS.map((o) => ({ ...o })),
      }],
    },
    totals,
    permalink_url: `${baseUrl}/s/${shop.id}`,
  };
  const record: CheckoutRecord = {
    id, shopId: shop.id, currency: shop.policy.currency, items, subtotal: major(subtotal),
    shipping: Object.fromEntries(SHIPPING_OPTIONS.map((o) => [o.id, major(o.cost)])),
    customer: req.customer, createdAt: new Date().toISOString(),
  };
  return { response, record };
}

/** Checkouts we quoted, in the shared SQLite file. */
export class CheckoutStore {
  private db;
  constructor(path = defaultDbPath()) {
    this.db = openDatabase(path);
    this.db.exec("CREATE TABLE IF NOT EXISTS agentic_checkouts (id TEXT PRIMARY KEY, shop_id TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL)");
  }
  save(r: CheckoutRecord) {
    this.db.prepare("INSERT INTO agentic_checkouts (id, shop_id, body, created_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET body = excluded.body").run(r.id, r.shopId, JSON.stringify(r), r.createdAt);
  }
  get(id: string): CheckoutRecord | undefined {
    const row = this.db.prepare("SELECT body FROM agentic_checkouts WHERE id = ?").get(id) as { body: string } | undefined;
    return row && JSON.parse(row.body);
  }
}

/** The checkout ids an intent names anywhere (merchant order id, metadata, agentic data). */
export function checkoutIdsIn(intent: unknown): string[] {
  return [...new Set(JSON.stringify(intent ?? null).match(/chk_[A-Za-z0-9_-]{12}/g) ?? [])];
}

/** The amount the intent must carry for this checkout and the fulfillment the shopper chose. */
export function expectedTotal(r: CheckoutRecord, fulfillment: { selected_option_id?: string }[] | undefined): number | undefined {
  const option = fulfillment?.[0]?.selected_option_id;
  const shipping = option === undefined ? 0 : r.shipping[option];
  return shipping === undefined ? undefined : Math.round((r.subtotal + shipping) * 100) / 100;
}

// --- Booking a paid checkout

export interface BookDeps {
  checkouts: CheckoutStore;
  shopOf(id: string): ShopListing | undefined;
  ledgerFor(shopId: string): Ledger;
  signer: OrderSigner;
}

export type BookResult =
  | { booked: true; shopId: string; orderId: string; total: number }
  | { booked: false; reason: string; shopId?: string; orderId?: string };

/**
 * Books a succeeded payment intent (read from Airwallex, never from the webhook body alone) for
 * the checkout it names: the amount must be the quoted subtotal plus the shipping the shopper
 * chose. Signs the order and books the sale in that shop's book, once.
 */
export function bookCheckoutPayment(intent: any, d: BookDeps): BookResult {
  if (intent?.status !== "SUCCEEDED") return { booked: false, reason: `intent is ${intent?.status ?? "missing"}` };
  const ids = checkoutIdsIn(intent).filter((id) => d.checkouts.get(id));
  if (ids.length !== 1) return { booked: false, reason: ids.length === 0 ? "names no checkout of ours" : `names ${ids.length} checkouts` };
  const r = d.checkouts.get(ids[0]!)!;
  const orderId = `ord_${r.id}`;
  if (r.paymentIntentId) return r.paymentIntentId === intent.id ? { booked: false, reason: "already booked", shopId: r.shopId, orderId } : { booked: false, reason: `checkout already paid by ${r.paymentIntentId}`, shopId: r.shopId };
  const shop = d.shopOf(r.shopId);
  if (!shop) return { booked: false, reason: `no shop ${r.shopId}` };
  const fulfillment = intent.agentic_payment_data?.fulfillment as { selected_option_id?: string }[] | undefined;
  const want = expectedTotal(r, fulfillment);
  if (want === undefined || intent.currency !== r.currency || Math.abs(Number(intent.amount) - want) > 0.001) {
    return { booked: false, reason: `paid ${intent.amount} ${intent.currency}, quoted ${want ?? "?"} ${r.currency}`, shopId: r.shopId };
  }
  const ledger = d.ledgerFor(r.shopId);
  if (!ledger.order(orderId)) {
    const at = new Date().toISOString();
    const order = d.signer.sign({
      orderId, customerRef: r.customer?.email ?? r.customer?.id ?? "agentic-guest",
      items: r.items.map(({ sku, qty, unitPrice }) => ({ sku, qty, unitPrice })),
      total: want, currency: r.currency, paymentIntentId: intent.id, createdAt: at,
    });
    const cogs = r.items.reduce((s, i) => s + (findProduct(shop.policy.catalog, i.sku)?.unitCost ?? 0) * i.qty, 0);
    ledger.addOrder(order);
    ledger.add({ kind: "sale", orderId, amount: want, cogs: Math.round(cogs * 100) / 100, currency: r.currency, at });
  }
  d.checkouts.save({ ...r, paymentIntentId: intent.id, orderId });
  return { booked: true, shopId: r.shopId, orderId, total: want };
}

/** A buyer agent's payment in USDZ on Metal for one item, already settled and verified against its mandate. */
export interface MandateSale {
  shopId: string;
  sku: string;
  /** The settlement transaction on Metal. */
  tx: string;
  /** The buyer agent's account, which paid. */
  payer: string;
  /** What settled, in USDZ major units (= USD). */
  amount: number;
}

/** The order a Metal settlement books as: one per transaction. */
export const mandateOrderId = (tx: string) => `ord_metal_${tx.slice(2, 18).toLowerCase()}`;

/**
 * Books one item paid by a buyer agent under its Metal mandate: a signed order and a sale at list
 * price in the shop that sold it. The caller has settled the payment and verified it on chain; this
 * checks only that what settled is what the item costs. Same transaction twice books once.
 */
export function bookMandateSale(s: MandateSale, d: Omit<BookDeps, "checkouts">): BookResult {
  const shop = d.shopOf(s.shopId);
  const p = shop && findProduct(shop.policy.catalog, s.sku);
  if (!shop || !p) return { booked: false, reason: `no product ${s.sku} in ${s.shopId}` };
  if (Math.abs(s.amount - p.listPrice) > 0.001) return { booked: false, reason: `paid ${s.amount}, the item costs ${p.listPrice}`, shopId: shop.id };
  const orderId = mandateOrderId(s.tx);
  const ledger = d.ledgerFor(shop.id);
  if (ledger.order(orderId)) return { booked: false, reason: "already booked", shopId: shop.id, orderId };
  const at = new Date().toISOString();
  const order = d.signer.sign({
    orderId, customerRef: `metal:${s.payer}`,
    items: [{ sku: p.sku, qty: 1, unitPrice: p.listPrice }],
    total: p.listPrice, currency: shop.policy.currency, paymentIntentId: `metal:${s.tx}`, createdAt: at,
  });
  ledger.addOrder(order);
  ledger.add({ kind: "sale", orderId, amount: p.listPrice, cogs: p.unitCost ?? 0, currency: shop.policy.currency, at });
  return { booked: true, shopId: shop.id, orderId, total: p.listPrice };
}
