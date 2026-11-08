/**
 * M1 money rails, end to end against the Airwallex sandbox:
 * 1. The agent pays an inference provider for a reply (FakeInferencePayer) and books the AI cost.
 * 2. A customer order gets a hosted payment link (what the chat sends) and, for the scripted
 *    run, a payment intent confirmed with the sandbox test card.
 * 3. The payment is verified against Airwallex (status, amount, currency), then the order is signed and saved.
 * 4. The profit goes to the owner's US/USD account: beneficiary validated, transfer simulated to PAID.
 *
 * Flags: --wait-link  also wait for someone to pay the hosted link by hand.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { Airwallex, AirwallexError } from "../packages/airwallex/src/index.js";
import { Ledger, OrderSigner, verifyOrder, type OrderItem } from "../packages/ledger/src/index.js";
import { FakeInferencePayer } from "../packages/metal/src/index.js";
import { defaultPolicy, findProduct } from "../packages/policy/src/index.js";

const policy = defaultPolicy;
const awx = Airwallex.fromEnv();
const ledger = new Ledger(policy.currency, ":memory:"); // throwaway book for the rails check
const signer = OrderSigner.fromEnv();
const now = () => new Date().toISOString();
const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Sandbox test card from the builder guide (Kit 4). Real customers type cards on the hosted link. */
const TEST_CARD = { number: "4035501000000008", expiryMonth: "12", expiryYear: "2030", cvc: "123", name: "Demo Customer" };

/** Synthetic owner account: a real ABA routing number (JPMorgan Chase) with a made-up account number. */
const OWNER_NICKNAME = "Peaje ASA owner (demo)";
const OWNER_BENEFICIARY = {
  entity_type: "PERSONAL",
  first_name: "Sandra",
  last_name: "Demo",
  date_of_birth: "1990-01-15",
  personal_email: "owner@example.com",
  address: { street_address: "1 Main Street", city: "New York", state: "NY", postcode: "10001", country_code: "US" },
  bank_details: {
    bank_country_code: "US",
    account_currency: "USD",
    account_name: "Sandra Demo",
    account_number: "123456789",
    account_routing_type1: "aba",
    account_routing_value1: "021000021",
    bank_account_category: "Checking",
  },
};
/** The sandbox accepts any reason string; production validates it, so recheck this value before going live. */
const PAYOUT_REASON = "personal_remittance";

// --- 0. Mock inference providers (started here if they aren't already running)
let providers: ChildProcess | undefined;
const tiers = {
  cheap: { id: "cheap", url: process.env.PROVIDER_CHEAP_URL ?? "http://localhost:4101" },
  mid: { id: "mid", url: process.env.PROVIDER_MID_URL ?? "http://localhost:4102" },
  premium: { id: "premium", url: process.env.PROVIDER_PREMIUM_URL ?? "http://localhost:4103" },
};
const up = async () => fetch(tiers.cheap.url, { method: "POST" }).then(() => true, () => false);
if (!(await up())) {
  providers = spawn("npx", ["tsx", "providers/src/index.ts"], { stdio: "ignore" });
  for (let i = 0; i < 40 && !(await up()); i++) await sleep(250);
}

try {
  // --- 1. AI cost for the conversation that sold the order
  const payer = new FakeInferencePayer();
  const conversationId = "conv-m1";
  const call = await payer.payAndCall<{ text: string }>(tiers.cheap, { prompt: "quote 2x Huila" }, 0.02);
  ledger.add({ kind: "ai_cost", conversationId, provider: call.provider, amount: call.pricePaid, currency: policy.currency, at: now() });
  console.log(`1. Paid ${call.provider} ${call.pricePaid} USDZ for a reply: "${call.result.text}"`);

  // --- 2. Order and payment
  const product = findProduct(policy.catalog, "BEAN-HUILA-250")!;
  const items: OrderItem[] = [{ sku: product.sku, qty: 2, unitPrice: product.listPrice }];
  const total = round2(items.reduce((s, i) => s + i.qty * i.unitPrice, 0));
  const orderId = `ord_${Date.now()}`;

  const link: any = await awx.createPaymentLink({
    amount: total, currency: policy.currency, title: `Order ${orderId}`, reference: orderId,
    description: items.map((i) => `${i.qty} x ${findProduct(policy.catalog, i.sku)!.name}`).join(", "),
  });
  console.log(`2. Payment link for the chat: ${link.url} (${link.status})`);

  const waitForLink = async () => {
    console.log(`   Waiting up to 10 min for someone to pay ${link.url} (test card 4035 5010 0000 0008, any future expiry and CVC)...`);
    const deadline = Date.now() + 10 * 60_000;
    let l: any = link;
    while (l.status !== "PAID") {
      if (Date.now() > deadline) throw new Error("Payment link not paid in time");
      await sleep(3000);
      l = await awx.getPaymentLink(link.id);
    }
    return l.latest_successful_payment_intent_id as string;
  };

  let paymentIntentId: string;
  if (process.argv.includes("--wait-link")) {
    paymentIntentId = await waitForLink();
  } else {
    // Confirming with raw card data needs "native API access" (PCI) on the account.
    // Without it, fall back to the hosted link, which is how a real customer pays anyway.
    const intent: any = await awx.createPaymentIntent(total, policy.currency, orderId);
    try {
      const confirmed: any = await awx.confirmPaymentIntent(intent.id, TEST_CARD);
      console.log(`   Scripted card payment: intent ${intent.id} -> ${confirmed.status}`);
      paymentIntentId = intent.id;
    } catch (e) {
      if (!(e instanceof AirwallexError && e.body.includes("native API access"))) throw e;
      console.log("   Account can't confirm raw cards over the API (no native API access).");
      paymentIntentId = await waitForLink();
    }
  }

  // --- 3. Verify with Airwallex, never with a screenshot. Then sign and store.
  let paid: any = await awx.getPaymentIntent(paymentIntentId);
  for (let i = 0; i < 10 && paid.status === "PENDING"; i++) { await sleep(1000); paid = await awx.getPaymentIntent(paymentIntentId); }
  if (paid.status !== "SUCCEEDED") throw new Error(`Payment not verified: ${paid.status}`);
  if (paid.amount !== total || paid.currency !== policy.currency) {
    throw new Error(`Payment mismatch: paid ${paid.amount} ${paid.currency}, order is ${total} ${policy.currency}`);
  }

  const order = signer.sign({
    orderId, customerRef: "cust-demo-1", items, total, currency: policy.currency,
    paymentIntentId, paymentLinkId: link.id, createdAt: now(),
  });
  ledger.addOrder(order);
  const cogs = items.reduce((s, i) => s + i.qty * findProduct(policy.catalog, i.sku)!.unitCost, 0);
  ledger.add({ kind: "sale", orderId, amount: total, cogs, currency: policy.currency, at: now() });
  const tampered = { ...order, total: order.total - 1 };
  console.log(`3. Verified ${paid.status} ${paid.amount} ${paid.currency}. Signed order ${orderId}: valid=${verifyOrder(order)}, tampered copy valid=${verifyOrder(tampered)}`);

  // --- 4. Owner payout over US/USD LOCAL
  await awx.validateBeneficiary(OWNER_BENEFICIARY);
  // The list doesn't return nicknames, so reuse the owner's beneficiary by its bank details.
  const list: any = await awx.listBeneficiaries();
  const ownerBank = OWNER_BENEFICIARY.bank_details;
  let beneficiaryId: string | undefined = list.items?.find((b: any) =>
    b.beneficiary?.bank_details?.account_number === ownerBank.account_number &&
    b.beneficiary?.bank_details?.account_routing_value1 === ownerBank.account_routing_value1)?.id;
  if (!beneficiaryId) beneficiaryId = ((await awx.createBeneficiary(OWNER_BENEFICIARY, OWNER_NICKNAME)) as any).id;

  const payout = round2(ledger.pnl().netProfit);
  const transfer: any = await awx.createTransferOnce({
    beneficiaryId: beneficiaryId!, amount: payout, currency: policy.currency, reference: `Profit ${orderId}`, reason: PAYOUT_REASON,
  });
  console.log(`4. Transfer ${transfer.id} for ${payout} ${policy.currency}: ${transfer.status}`);
  const settled: any = await awx.simulate.settleTransfer(transfer.id);
  if (settled.status !== "PAID") throw new Error(`Payout ended ${settled.status}: ${settled.failure_type ?? ""} ${settled.failure_reason ?? ""}`);
  ledger.add({ kind: "owner_payout", ref: transfer.id, amount: payout, currency: policy.currency, at: now() });
  console.log(`   Payout ${settled.status}`);

  console.log("P&L:", ledger.pnl());
} finally {
  providers?.kill();
}
