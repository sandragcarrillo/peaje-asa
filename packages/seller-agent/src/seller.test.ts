import { test } from "node:test";
import assert from "node:assert/strict";
import type { Airwallex } from "@peaje-asa/airwallex";
import { Ledger, OrderSigner, verifyOrder } from "@peaje-asa/ledger";
import type { InferencePayer, InferenceProvider, Offer, PaidCall } from "@peaje-asa/metal";
import { defaultPolicy, type ModelTier } from "@peaje-asa/policy";
import { ConversationStore, SellerAgent, runTool, type ToolContext } from "./index.js";

process.env.ORDER_SIGNING_KEY ??= OrderSigner.generateEnvValue();

const providers = Object.fromEntries((["cheap", "mid", "premium"] as ModelTier[]).map((t) => [t, { id: t, url: `fake://${t}` }])) as Record<ModelTier, InferenceProvider>;

/** Plays scripted model replies and records which tier answered each call. */
class ScriptedPayer implements InferencePayer {
  prices: Record<string, Offer> = { cheap: { price: 0.01, latencyMs: 300 }, mid: { price: 0.02, latencyMs: 200 }, premium: { price: 0.05, latencyMs: 150 } };
  used: string[] = [];
  constructor(private replies: any[]) {}
  async quote(p: InferenceProvider) { return this.prices[p.id]; }
  async payAndCall<T>(p: InferenceProvider): Promise<PaidCall<T>> {
    this.used.push(p.id);
    const r = this.replies.shift();
    if (!r) throw new Error("no scripted reply left");
    return { provider: p.id, pricePaid: this.prices[p.id].price, result: r as T };
  }
}

const text = (t: string) => ({ content: [{ type: "text", text: t }], stop_reason: "end_turn" });
const call = (id: string, name: string, input: unknown) => ({ content: [{ type: "tool_use", id, name, input }], stop_reason: "tool_use" });

function fakeAwx(paid = { status: "SUCCEEDED", amount: 0, currency: "USD" }) {
  const links: any[] = [];
  return {
    links,
    paid,
    async createPaymentLink(input: any) { const l = { id: `lnk_${links.length + 1}`, url: `https://pay.example/${links.length + 1}`, status: "UNPAID", ...input }; links.push(l); return l; },
    async getPaymentLink(id: string) { return links.find((l) => l.id === id); },
    async getPaymentIntent() { return paid; },
  };
}

function setup(replies: any[]) {
  const payer = new ScriptedPayer(replies);
  const awx = fakeAwx();
  const ledger = new Ledger("USD", ":memory:");
  const store = new ConversationStore(":memory:");
  const agent = new SellerAgent({ policy: defaultPolicy, ledger, store, payer, providers, awx: awx as unknown as Airwallex, signer: OrderSigner.fromEnv() });
  return { payer, awx, ledger, store, agent };
}

test("discounts: refused below the auto limit with the lowest allowed price, accepted inside it", async () => {
  const store = new ConversationStore(":memory:");
  const c = store.getOrCreate("t1");
  const ctx: ToolContext = { policy: defaultPolicy, createPaymentLink: async () => ({ url: "" }), escalate: () => {} };
  const q = JSON.parse((await runTool("quote", { sku: "MACH-ESPRESSO-HOME", qty: 1 }, c, ctx)).content);
  assert.equal(q.total, 480);
  const no = JSON.parse((await runTool("propose_discount", { quote_id: q.quote_id, unit_price: 400 }, c, ctx)).content);
  assert.equal(no.accepted, false);
  assert.equal(no.lowest_unit_price_you_may_offer, 440);
  const yes = JSON.parse((await runTool("propose_discount", { quote_id: q.quote_id, unit_price: 445 }, c, ctx)).content);
  assert.equal(yes.accepted, true);
  assert.equal(c.activeQuoteId, yes.quote_id);
  const search = (await runTool("search_catalog", { query: "grinder" }, c, ctx)).content;
  assert.ok(!search.includes("unit_cost") && !search.includes("unitCost"), "costs never reach the model");
});

test("discovery runs on cheap and a small sale on mid; the payment link amount comes from the quote, payment books a signed order", async () => {
  const { payer, awx, ledger, store, agent } = setup([
    call("a", "search_catalog", { query: "huila" }),
    call("b", "quote", { sku: "BEAN-HUILA-250", qty: 2 }),
    text("2 bags of Huila are 28 USD. Want them?"),
    call("c", "create_payment_link", { quote_id: "q1" }),
    text("Here is your link: https://pay.example/1"),
  ]);
  await agent.handleMessage("c1", "Hi, 2 bags of Huila please");
  const lines = await agent.handleMessage("c1", "yes");
  assert.equal(lines.at(-1)?.text, "Here is your link: https://pay.example/1");
  assert.deepEqual(payer.used, ["cheap", "cheap", "mid", "mid", "mid"]);
  assert.equal(awx.links[0].amount, 28);
  assert.equal(awx.links.length, 1);

  // History stays valid: every tool_use is answered by a tool_result in the next user turn.
  const c = store.get("c1")!;
  assert.equal(c.status, "awaiting_payment");
  c.llmMessages.forEach((m, i) => {
    const uses = Array.isArray(m.content) ? m.content.filter((b: any) => b.type === "tool_use").map((b: any) => b.id) : [];
    if (!uses.length) return;
    const next = c.llmMessages[i + 1].content as any[];
    assert.deepEqual(next.filter((b) => b.type === "tool_result").map((b) => b.tool_use_id), uses);
  });

  awx.links[0].status = "PAID";
  awx.links[0].latest_successful_payment_intent_id = "int_1";
  awx.paid.amount = 28;
  const paid = await agent.checkPayment("c1");
  assert.equal(paid?.status, "paid");
  const order = ledger.order("ord_c1_q1")!;
  assert.ok(verifyOrder(order));
  const pnl = ledger.pnl();
  assert.equal(pnl.revenue, 28);
  assert.equal(pnl.cogs, 12);
  assert.equal(Math.round(pnl.aiCosts * 100) / 100, 0.08);
});

test("a premium deal gets the premium tier; a price rise reroutes, then escalates with the terms bound", async () => {
  const { payer, store, agent } = setup([
    call("a", "quote", { sku: "MACH-ESPRESSO-HOME", qty: 1 }),
    text("The home espresso machine is 480 USD."),
    text("Sure, it ships tomorrow."),
    text("It comes with a one year warranty."),
  ]);
  await agent.handleMessage("c2", "How much is the home espresso machine?");
  assert.deepEqual(payer.used, ["cheap", "premium"]); // discovery on cheap, then the 150 margin buys premium

  payer.prices.premium = { price: 0.5, latencyMs: 150 };
  await agent.handleMessage("c2", "When does it ship?");
  assert.equal(payer.used.at(-1), "mid");

  payer.prices.mid = { price: 0.5, latencyMs: 200 };
  payer.prices.cheap = { price: 0.5, latencyMs: 300 };
  const lines = await agent.handleMessage("c2", "And the warranty?");
  const c = store.get("c2")!;
  assert.equal(c.status, "escalated");
  assert.equal(c.escalation?.kind, "unprofitable");
  assert.deepEqual(c.escalation?.terms, { sku: "MACH-ESPRESSO-HOME", qty: 1, unitPrice: 480, total: 480, currency: "USD", customerRef: "c2" });
  assert.match(lines.at(-1)!.text, /owner/);
  assert.equal(payer.used.length, 3, "no model call after escalating");
});
