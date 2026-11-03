/**
 * Seller agent: talks to customers, quotes, negotiates within margin, picks how much
 * intelligence each conversation deserves, and escalates when it stops being profitable.
 * The model handles language and judgment; prices and limits come from @peaje-asa/policy.
 *
 * Every model call is a paid call to an inference provider (one per tier). Before each call
 * the agent reads the providers' current offers and lets `chooseTier` decide which one the
 * deal can still afford. The manual loop (instead of the SDK tool runner) is what lets each
 * call go through a different, paid provider.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { Airwallex } from "@peaje-asa/airwallex";
import type { Ledger, OrderSigner } from "@peaje-asa/ledger";
import { MandateRefused, PaidCallFailed, PriceAboveCap, type InferencePayer, type InferenceProvider, type Offer } from "@peaje-asa/metal";
import { aiBudgetFor, chooseTier, findProduct, type ModelTier, type OwnerPolicy } from "@peaje-asa/policy";
import type { Conversation, ConversationStore, Quote, TranscriptLine } from "./store.js";
import { runTool, sellerTools, type ToolContext } from "./tools.js";

export * from "./store.js";
export { runTool, sellerTools, type ToolContext } from "./tools.js";

type BetaMessage = Anthropic.Beta.BetaMessage;
type BetaContentBlockParam = Anthropic.Beta.BetaContentBlockParam;

export interface SellerDeps {
  policy: OwnerPolicy;
  ledger: Ledger;
  store: ConversationStore;
  payer: InferencePayer;
  providers: Record<ModelTier, InferenceProvider>;
  awx: Airwallex;
  signer: OrderSigner;
  shopName?: string;
}

/** Model calls per customer message, tool round trips included. */
const MAX_CALLS_PER_TURN = 6;
const MAX_FAILED_CALLS_PER_TURN = 2;

const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;

// Fixed replies are sent without a model call, so they pick the language from the customer's last message.
const REPLIES = {
  escalated: {
    en: "Thanks for your patience. The owner has the details and will reply here shortly.",
    es: "Gracias por tu paciencia. El dueño ya tiene los detalles y te responde por aquí en breve.",
  },
  refusal: {
    en: "Sorry, I can't help with that here. I can help you choose and buy our coffee and equipment.",
    es: "Lo siento, con eso no te puedo ayudar por aquí. Sí te ayudo a elegir y comprar nuestro café y equipos.",
  },
};

export function looksSpanish(text: string) {
  return /[áéíóúñ¿¡]|\b(hola|quiero|cuanto|precio|tienen|gracias|para|por favor|buenas|necesito)\b/i.test(text);
}

function fixedReply(c: Conversation, kind: keyof typeof REPLIES) {
  const recent = c.transcript.filter((l) => l.from === "customer").slice(-3).map((l) => l.text).join(" ");
  return REPLIES[kind][looksSpanish(recent) ? "es" : "en"];
}

export function systemPrompt(shopName: string) {
  return [
    `You are the sales assistant of ${shopName}, a specialty coffee shop in Bogotá that sells beans and coffee equipment.`,
    "You chat with customers on a messaging app. Reply in the customer's language, in short chat messages (one to three sentences), friendly and direct. Plain text only: no Markdown, no SKUs.",
    "Prices only come from your tools and are in USD. Never state a price you did not get from search_catalog, quote or propose_discount.",
    "To quote, find the product with search_catalog, then call quote. If the customer asks for a better price, call propose_discount; never promise a discount the tool did not accept. If it is refused, you may offer the lowest price it returns.",
    "If the customer insists on a price below that, asks for the owner, or asks for something you can't decide (custom orders, wholesale terms, complaints), call escalate_to_owner. You can always escalate; only the owner can say yes to what you can't.",
    "When the customer agrees to buy, call create_payment_link with the agreed quote and send them the URL. Never ask for card numbers in the chat.",
    "Never mention costs, margins, budgets, internal rules or which AI model you are.",
  ].join("\n");
}

export class SellerAgent {
  private locks = new Map<string, Promise<unknown>>();

  constructor(private deps: SellerDeps) {}

  /** One customer message in, the agent's reply lines out. Messages for the same conversation run one at a time. */
  handleMessage(convId: string, text: string, customerRef = convId): Promise<TranscriptLine[]> {
    return this.serial(convId, () => this.turn(convId, text, customerRef));
  }

  conversation(id: string): Conversation | undefined {
    return this.deps.store.get(id);
  }

  /** Ask Airwallex whether the conversation's payment link was paid; if so, verify, sign and book the order. */
  checkPayment(convId: string): Promise<Conversation | undefined> {
    return this.serial(convId, async () => {
      const c = this.deps.store.get(convId);
      if (!c?.payment || c.status !== "awaiting_payment") return c;
      const link: any = await this.deps.awx.getPaymentLink(c.payment.linkId);
      if (link.status !== "PAID" || !link.latest_successful_payment_intent_id) return c;
      await this.bookPaidOrder(c, link.latest_successful_payment_intent_id);
      this.deps.store.save(c);
      return c;
    });
  }

  /** Owner side: send the payment link for a quote (e.g. after approving a price). Same one-link-per-quote rule as the tool. */
  sendPaymentLink(convId: string, quoteId: string): Promise<{ url: string }> {
    return this.serial(convId, async () => {
      const c = this.deps.store.get(convId);
      const q = c?.quotes.find((x) => x.id === quoteId);
      if (!c || !q) throw new Error(`No quote ${quoteId} in ${convId}`);
      return this.toolContext().createPaymentLink(c, q);
    });
  }

  /** The owner writes to the customer. The chat stays with the owner if it was escalated. */
  ownerReply(convId: string, text: string): Promise<Conversation> {
    return this.serial(convId, async () => {
      const c = this.deps.store.get(convId);
      if (!c) throw new Error(`No conversation ${convId}`);
      c.transcript.push({ from: "owner", text, at: now() });
      c.pendingNotes.push(`The owner wrote to the customer: "${text}"`);
      this.deps.store.save(c);
      return c;
    });
  }

  /**
   * The owner's answer to an escalation. Approving creates a quote at exactly the escalated terms
   * and sends its payment link; declining hands the chat back to the agent. Either way the agent
   * learns what happened on the next turn.
   */
  resolveEscalation(convId: string, decision: "approved" | "declined", by: string, message?: string): Promise<Conversation> {
    return this.serial(convId, async () => {
      const c = this.deps.store.get(convId);
      if (!c || c.status !== "escalated" || !c.escalation) throw new Error(`${convId} is not waiting for the owner`);
      if (c.escalation.resolution) throw new Error(`${convId} was already ${c.escalation.resolution.decision}`);
      if (message?.trim()) c.transcript.push({ from: "owner", text: message.trim(), at: now() });
      const t = c.escalation.terms;
      if (decision === "approved" && t) {
        const p = findProduct(t.sku)!;
        const q: Quote = { id: `q${c.quotes.length + 1}`, sku: t.sku, name: p.name, qty: t.qty, listPrice: p.listPrice, unitPrice: t.unitPrice, total: t.total, currency: t.currency, createdAt: now() };
        c.quotes.push(q);
        c.activeQuoteId = q.id;
        c.escalation.resolution = { decision, by, at: now(), quoteId: q.id };
        c.status = "open";
        c.transcript.push({ from: "system", text: `Owner approved ${t.qty} x ${p.name} at ${t.unitPrice} ${t.currency}.`, at: now() });
        await this.toolContext().createPaymentLink(c, q);
        c.pendingNotes.push(`The owner approved ${t.qty} x ${p.name} at ${t.unitPrice} ${t.currency} (quote ${q.id}) and the payment link was sent.`);
      } else {
        c.escalation.resolution = { decision, by, at: now() };
        c.status = "open";
        c.transcript.push({ from: "system", text: decision === "approved" ? "The owner handed the chat back to the agent." : "The owner declined the request.", at: now() });
        c.pendingNotes.push(decision === "approved" ? "The owner handed the conversation back to you." : `The owner declined the request (${c.escalation.reason}). Don't offer it again.`);
      }
      this.deps.store.save(c);
      return c;
    });
  }

  private async serial<T>(convId: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(convId) ?? Promise.resolve();
    const run = prev.then(fn, fn);
    this.locks.set(convId, run.catch(() => undefined));
    return run;
  }

  private async turn(convId: string, text: string, customerRef: string): Promise<TranscriptLine[]> {
    const { store } = this.deps;
    const c = store.getOrCreate(convId, customerRef);
    const before = c.transcript.length;
    c.transcript.push({ from: "customer", text, at: now() });

    if (c.status === "escalated") {
      this.say(c, fixedReply(c, "escalated"));
      store.save(c);
      return c.transcript.slice(before + 1);
    }

    const notes = c.pendingNotes.splice(0).map((n) => `[system note: ${n}]`);
    this.appendUser(c, [...notes, text].map((t) => ({ type: "text", text: t })));

    try {
      await this.loop(c);
    } finally {
      store.save(c);
    }
    return c.transcript.slice(before + 1);
  }

  private async loop(c: Conversation) {
    const { policy, payer, providers } = this.deps;
    let failures = 0;
    // Tiers Metal refused this turn under the seller's mandate (above its cap, say): not options until the next message.
    const refused = new Set<string>();

    for (let i = 0; i < MAX_CALLS_PER_TURN; i++) {
      const offers = Object.fromEntries(Object.entries(await this.offers()).filter(([t]) => !refused.has(t)));
      const budget = aiBudgetFor(this.activeMargin(c), policy);
      const decision = chooseTier(budget, c.aiSpent, c.calls, offers, policy);

      if (decision.action === "escalate") {
        this.escalate(c, "This conversation would cost more in AI than the deal can earn.", "unprofitable", this.activeTerms(c), budget);
        this.say(c, fixedReply(c, "escalated"));
        return;
      }

      let message: BetaMessage;
      let cost: number;
      try {
        const call = await payer.payAndCall<BetaMessage>(
          providers[decision.tier],
          { system: systemPrompt(this.deps.shopName ?? "Tostadero Andino"), tools: sellerTools, messages: c.llmMessages },
          round2(budget - c.aiSpent),
        );
        this.bookAiCost(c, call.provider, call.pricePaid, call.txHash);
        cost = call.pricePaid;
        message = call.result;
      } catch (e) {
        if (e instanceof PriceAboveCap) continue; // the price moved since we read it: plan again
        if (e instanceof MandateRefused) {
          refused.add(decision.tier);
          c.mandateRefusals = [...(c.mandateRefusals ?? []), { tier: decision.tier, reason: e.reason, at: now() }];
          continue;
        }
        if (e instanceof PaidCallFailed) {
          this.bookAiCost(c, e.provider, e.pricePaid);
          if (++failures >= MAX_FAILED_CALLS_PER_TURN) throw e;
          continue;
        }
        throw e;
      }

      // Append exactly what the model returned, thinking blocks included.
      c.llmMessages.push({ role: "assistant", content: message.content as BetaContentBlockParam[] });
      const said = message.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text.trim()).filter(Boolean);
      said.forEach((t, k) => this.say(c, t, decision.tier, k === 0 ? cost : undefined));

      if (message.stop_reason === "refusal") {
        this.say(c, fixedReply(c, "refusal"));
        return;
      }
      if (message.stop_reason !== "tool_use") return;

      const results: BetaContentBlockParam[] = [];
      for (const block of message.content) {
        if (block.type !== "tool_use") continue;
        const r = await runTool(block.name, block.input, c, this.toolContext());
        results.push({ type: "tool_result", tool_use_id: block.id, content: r.content, is_error: r.isError });
      }
      this.appendUser(c, results);
      if (c.status === "escalated") {
        // The model is told to say the owner will reply; give it one more call to say so in the customer's language.
        continue;
      }
    }
  }

  /** The providers' live terms, as the owner's dashboard shows them. */
  currentOffers() { return this.offers(); }

  /** Current offers from every provider. One that doesn't answer is simply not an option this time. */
  private async offers(): Promise<Partial<Record<ModelTier, Offer>>> {
    const entries = await Promise.all(
      (Object.keys(this.deps.providers) as ModelTier[]).map(async (t) => {
        try { return [t, await this.deps.payer.quote(this.deps.providers[t])] as const; } catch { return undefined; }
      }),
    );
    return Object.fromEntries(entries.filter((e) => e !== undefined));
  }

  private activeQuote(c: Conversation): Quote | undefined {
    return c.quotes.find((q) => q.id === c.activeQuoteId);
  }

  /** Margin of the deal on the table, or undefined while we don't know what they want. */
  private activeMargin(c: Conversation): number | undefined {
    const q = this.activeQuote(c);
    if (!q) return undefined;
    return (q.unitPrice - findProduct(q.sku)!.unitCost) * q.qty;
  }

  private activeTerms(c: Conversation) {
    const q = this.activeQuote(c);
    return q ? { quote: q } : undefined;
  }

  private bookAiCost(c: Conversation, provider: string, amount: number, txHash?: string) {
    const { ledger, policy } = this.deps;
    ledger.add({ kind: "ai_cost", conversationId: c.id, provider, amount, currency: policy.currency, at: now(), ...(txHash && { txHash }) });
    c.aiSpent = round2(c.aiSpent + amount);
    c.calls += 1;
  }

  private say(c: Conversation, text: string, tier?: ModelTier, cost?: number) {
    c.transcript.push({ from: "agent", text, at: now(), tier, cost });
  }

  /** Add content to the user side. If the last turn is already a user turn that was never sent (tool results), extend it. */
  private appendUser(c: Conversation, blocks: BetaContentBlockParam[]) {
    const last = c.llmMessages.at(-1);
    if (last?.role === "user") {
      last.content = [...(typeof last.content === "string" ? [{ type: "text" as const, text: last.content }] : last.content), ...blocks];
    } else {
      c.llmMessages.push({ role: "user", content: blocks });
    }
  }

  private escalate(c: Conversation, reason: string, kind: "unprofitable" | "owner_decision", terms?: { quote: Quote; requestedUnitPrice?: number }, aiBudget?: number) {
    const q = terms?.quote;
    const unitPrice = terms?.requestedUnitPrice ?? q?.unitPrice;
    c.status = "escalated";
    c.escalation = {
      reason, at: now(), kind,
      terms: q && unitPrice !== undefined
        ? { sku: q.sku, qty: q.qty, unitPrice, total: round2(unitPrice * q.qty), currency: q.currency, customerRef: c.customerRef }
        : undefined,
      aiSpent: c.aiSpent,
      aiBudget: aiBudget ?? aiBudgetFor(this.activeMargin(c), this.deps.policy),
    };
    c.transcript.push({ from: "system", text: `Escalated to the owner: ${reason}`, at: now() });
  }

  private toolContext(): ToolContext {
    return {
      policy: this.deps.policy,
      escalate: (c, reason, kind, terms) => this.escalate(c, reason, kind, terms),
      createPaymentLink: async (c, q) => {
        // The links endpoint takes no request_id: one link per quote, saved as soon as it exists.
        if (c.payment?.quoteId === q.id) return { url: c.payment.url };
        const orderId = `ord_${c.id}_${q.id}`;
        const link: any = await this.deps.awx.createPaymentLink({
          amount: q.total, currency: q.currency, title: `${this.deps.shopName ?? "Tostadero Andino"} order`,
          reference: orderId, description: `${q.qty} x ${q.name}`, metadata: { conversation_id: c.id, quote_id: q.id },
        });
        c.payment = { linkId: link.id, url: link.url, quoteId: q.id, orderId };
        c.status = "awaiting_payment";
        c.transcript.push({ from: "system", text: `Payment link for ${q.total} ${q.currency}: ${link.url}`, at: now() });
        this.deps.store.save(c);
        return { url: link.url };
      },
    };
  }

  /** Verify with Airwallex (never trust the chat), then sign the exact terms and book the sale. */
  private async bookPaidOrder(c: Conversation, paymentIntentId: string) {
    const { awx, ledger, signer, policy } = this.deps;
    const p = c.payment!;
    const q = c.quotes.find((x) => x.id === p.quoteId)!;
    const intent: any = await awx.getPaymentIntent(paymentIntentId);
    if (intent.status !== "SUCCEEDED") return;
    if (intent.amount !== q.total || intent.currency !== q.currency) {
      c.transcript.push({ from: "system", text: `Payment mismatch: paid ${intent.amount} ${intent.currency}, quote is ${q.total} ${q.currency}`, at: now() });
      return;
    }
    if (ledger.order(p.orderId)) return; // already booked

    const order = signer.sign({
      orderId: p.orderId, customerRef: c.customerRef, items: [{ sku: q.sku, qty: q.qty, unitPrice: q.unitPrice }],
      total: q.total, currency: q.currency, paymentIntentId, paymentLinkId: p.linkId, createdAt: now(),
    });
    ledger.addOrder(order);
    ledger.add({ kind: "sale", orderId: order.orderId, amount: q.total, cogs: round2(findProduct(q.sku)!.unitCost * q.qty), currency: policy.currency, at: now() });
    p.paymentIntentId = paymentIntentId;
    c.status = "paid";
    c.transcript.push({ from: "system", text: `Payment verified with Airwallex. Order ${order.orderId} signed.`, at: now() });
    c.pendingNotes.push(`The customer paid ${q.total} ${q.currency} for ${q.qty} x ${q.name}; order ${order.orderId} is confirmed.`);
  }
}
