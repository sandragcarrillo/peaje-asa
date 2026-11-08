import { test } from "node:test";
import assert from "node:assert/strict";
import { aiBudgetFor, checkOffer, chooseTier, defaultPolicy as p, expectedMargin, findProduct, lowestAutoPrice, planRebalance } from "./index.js";

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
  const beans = findProduct(p.catalog, "BEAN-HUILA-250")!;
  const small = aiBudgetFor(expectedMargin(beans.listPrice, beans.unitCost, 2), p); // 16 margin -> 0.32
  assert.equal((chooseTier(small, 0.02, 2, offers, p) as any).tier, "mid");

  const machine = findProduct(p.catalog, "MACH-ESPRESSO-HOME")!;
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
  const m = findProduct(p.catalog, "MACH-ESPRESSO-HOME")!; // 480 list, 330 cost
  assert.deepEqual(checkOffer(m.listPrice, 450, m.unitCost, p), { ok: true });
  assert.deepEqual(checkOffer(m.listPrice, 430, m.unitCost, p), { ok: false, reason: "below_margin_floor" });
  assert.equal(lowestAutoPrice(m.listPrice, m.unitCost, p), 440); // margin floor binds before the 10% cap
  const b = findProduct(p.catalog, "BEAN-HUILA-250")!; // 14 list, 6 cost
  assert.equal(lowestAutoPrice(b.listPrice, b.unitCost, p), 12.6); // 10% cap binds
  assert.deepEqual(checkOffer(b.listPrice, 11, b.unitCost, p), { ok: false, reason: "needs_owner_approval" });
});

test("planRebalance: spare budget moves to the agent that can't pay its runway; the total never grows", () => {
  // runway: seller 100 calls, disputes 10
  const calm = planRebalance([{ agent: "seller", budget: 6, spent: 1 }, { agent: "disputes", budget: 2, spent: 0.1 }], { seller: 0.01, disputes: 0.01 }, p);
  assert.deepEqual(calm.changes, []);

  // Cheapest model goes from 0.01 to 0.06: the seller needs 6 left and has 5.
  const rise = planRebalance([{ agent: "seller", budget: 6, spent: 1 }, { agent: "disputes", budget: 2, spent: 0.1 }], { seller: 0.06, disputes: 0.06 }, p);
  assert.deepEqual(rise.need, { seller: 6, disputes: 0.6 });
  assert.deepEqual(rise.changes, [{ agent: "disputes", from: 2, to: 1 }, { agent: "seller", from: 6, to: 7 }], "the cut comes first");
  assert.equal(rise.shortfall, 0);
  const total = (cs: typeof rise.changes) => cs.reduce((s, c) => s + c.to - c.from, 0);
  assert.equal(Math.round(total(rise.changes) * 100), 0);

  // Not enough spare anywhere: move what there is, report the rest for the owner.
  const tight = planRebalance([{ agent: "seller", budget: 6, spent: 3 }, { agent: "disputes", budget: 2, spent: 0.1 }], { seller: 0.06, disputes: 0.06 }, p);
  assert.deepEqual(tight.changes, [{ agent: "disputes", from: 2, to: 0.7 }, { agent: "seller", from: 6, to: 7.3 }]);
  assert.equal(tight.shortfall, 1.7);
  assert.match(tight.why, /only the owner/);
});
