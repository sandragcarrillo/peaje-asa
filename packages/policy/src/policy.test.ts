import { test } from "node:test";
import assert from "node:assert/strict";
import { aiBudgetFor, checkOffer, chooseTier, defaultPolicy as p, expectedMargin, findProduct, lowestAutoPrice } from "./index.js";

const offers = {
  cheap: { price: 0.01, latencyMs: 300 },
  mid: { price: 0.02, latencyMs: 200 },
  premium: { price: 0.05, latencyMs: 150 },
};

test("discovery runs on the cheap tier", () => {
  const d = chooseTier(aiBudgetFor(undefined, p), 0, 0, offers, p);
  assert.equal(d.action === "reply" && d.tier, "cheap");
});

test("small sale gets mid, big sale gets premium", () => {
  const beans = findProduct("BEAN-HUILA-250")!;
  const small = aiBudgetFor(expectedMargin(beans.listPrice, beans.unitCost, 2), p); // 16 margin -> 0.32
  assert.equal((chooseTier(small, 0.02, 2, offers, p) as any).tier, "mid");

  const machine = findProduct("MACH-ESPRESSO-HOME")!;
  const big = aiBudgetFor(expectedMargin(machine.listPrice, machine.unitCost), p); // 150 margin -> 3.00
  assert.equal((chooseTier(big, 0.02, 2, offers, p) as any).tier, "premium");
});

test("price rise reroutes, then escalates when nothing fits", () => {
  const budget = aiBudgetFor(expectedMargin(14, 6), p); // 0.16
  const risen = { ...offers, cheap: { price: 0.05, latencyMs: 300 } };
  assert.equal((chooseTier(budget, 0.04, 4, risen, p) as any).tier, "mid"); // 0.02 * 6 = 0.12 <= 0.12
  assert.equal(chooseTier(budget, 0.1, 5, risen, p).action, "escalate"); // 0.02 * 5 = 0.10 > 0.06
});

test("slow providers are skipped", () => {
  const slow = { ...offers, premium: { price: 0.05, latencyMs: 9000 } };
  assert.equal((chooseTier(3, 0, 0, slow, p) as any).tier, "mid");
});

test("discount rules", () => {
  const m = findProduct("MACH-ESPRESSO-HOME")!; // 480 list, 330 cost
  assert.deepEqual(checkOffer(m.listPrice, 450, m.unitCost, p), { ok: true });
  assert.deepEqual(checkOffer(m.listPrice, 430, m.unitCost, p), { ok: false, reason: "below_margin_floor" });
  assert.equal(lowestAutoPrice(m.listPrice, m.unitCost, p), 440); // margin floor binds before the 10% cap
  const b = findProduct("BEAN-HUILA-250")!; // 14 list, 6 cost
  assert.equal(lowestAutoPrice(b.listPrice, b.unitCost, p), 12.6); // 10% cap binds
  assert.deepEqual(checkOffer(b.listPrice, 11, b.unitCost, p), { ok: false, reason: "needs_owner_approval" });
});
