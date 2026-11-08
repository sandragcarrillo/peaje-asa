import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Ledger, OrderSigner, verifyOrder } from "./index.js";

const at = "2026-11-02T00:00:00.000Z";

test("pnl, currency guard and persistence across connections", () => {
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "t.db");
  const a = new Ledger("USD", path);
  a.add({ kind: "sale", orderId: "o1", amount: 28, cogs: 12, currency: "USD", at });
  a.add({ kind: "ai_cost", conversationId: "c1", provider: "cheap", amount: 0.01, currency: "USD", at });
  assert.throws(() => a.add({ kind: "refund", orderId: "o1", amount: 1, currency: "COP", at }));

  const b = new Ledger("USD", path); // a second process would see the same book
  const pnl = b.pnl();
  assert.equal(pnl.revenue, 28);
  assert.equal(pnl.netProfit, 28 - 12 - 0.01);
  a.close(); b.close();
});

test("signed orders round-trip and can't be overwritten", () => {
  process.env.ORDER_SIGNING_KEY = OrderSigner.generateEnvValue();
  const signer = OrderSigner.fromEnv();
  const ledger = new Ledger("USD", ":memory:");
  const order = signer.sign({
    orderId: "o1", customerRef: "c", items: [{ sku: "X", qty: 1, unitPrice: 10 }], total: 10, currency: "USD", paymentIntentId: "int_1", createdAt: at,
  });
  ledger.addOrder(order);
  assert.ok(verifyOrder(ledger.order("o1")!));
  assert.throws(() => ledger.addOrder({ ...order, total: 1 }));
});

test("each shop reads only its own book, and shops get free ids", async () => {
  const { ShopStore } = await import("./index.js");
  const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "t.db");
  const a = new Ledger("USD", path, "shop-a");
  const b = new Ledger("USD", path, "shop-b");
  a.add({ kind: "sale", orderId: "o1", amount: 28, cogs: 12, currency: "USD", at });
  assert.equal(a.cash(), 28);
  assert.equal(b.cash(), 0);
  assert.equal(b.order("o1"), undefined);

  const shops = new ShopStore(path);
  assert.equal(shops.freeId("Café Ñandú"), "cafe-nandu");
  shops.create({ id: "cafe-nandu", name: "Café Ñandú", about: "x", ownerEmail: "A@x.com", passwordHash: "h", policy: {} as any });
  assert.equal(shops.freeId("Café Ñandú"), "cafe-nandu-2");
  assert.equal(shops.byEmail(" a@X.com ")?.id, "cafe-nandu"); // emails are stored and looked up lowercased
  assert.throws(() => shops.create({ id: "other", name: "o", about: "x", ownerEmail: "a@x.com", passwordHash: "h", policy: {} as any }));
});
