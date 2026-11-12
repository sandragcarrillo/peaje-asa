/**
 * Thin Airwallex sandbox client.
 * - Amounts are MAJOR units (100 = one hundred), not cents.
 * - Every mutating call gets a request_id. Reuse it only to retry the same operation.
 * - Never retry a payment or transfer without checking what the first attempt did.
 * - Sandbox-only simulation calls are isolated in `simulate` so they can be swapped later.
 * Docs MCP: https://mcp.sandbox.airwallex.com/docs
 */
import { randomUUID } from "node:crypto";

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
}

/** Card details for sandbox confirms only. Real customers enter cards on the hosted payment link. */
export interface TestCard {
  number: string;
  expiryMonth: string;
  expiryYear: string;
  cvc: string;
  name: string;
}

export interface TransferInput {
  beneficiaryId: string;
  amount: number;
  currency: string;
  reference: string;
  reason: string;
  /** Pass the id of a previous attempt only to retry that same transfer. */
  requestId?: string;
}

/** What Airwallex needs to open a shop's business account. US entities for now. */
export interface ConnectedAccountDetails {
  businessName: string;
  ein: string;
  description: string;
  url: string;
  email: string;
  phone: string;
  monthlyRevenue: number;
  industryCode?: string;
  address: { line1: string; city: string; state: string; postcode: string; country: string };
  person: { firstName: string; lastName: string; dateOfBirth: string; idNumber: string };
}

/** A transfer is done when it reaches one of these. CANCELLED is how failures end (read failure_type). */
export const TRANSFER_TERMINAL = ["PAID", "CANCELLED"] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Airwallex wants `2026-11-13T04:09:48+0000`. */
const isoIn = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().replace(/\.\d+Z$/, "+0000");

export class Airwallex {
  private token?: string;
  private tokenExp = 0;
  private base: string;

  constructor(private cfg: AirwallexConfig) {
    this.base = cfg.baseUrl ?? "https://api.sandbox.airwallex.com";
  }

  static fromEnv() {
    const { AWX_CLIENT_ID, AWX_API_KEY, AWX_BASE_URL } = process.env;
    if (!AWX_CLIENT_ID || !AWX_API_KEY) throw new Error("Missing AWX_CLIENT_ID / AWX_API_KEY");
    return new Airwallex({ clientId: AWX_CLIENT_ID, apiKey: AWX_API_KEY, baseUrl: AWX_BASE_URL });
  }

  static requestId() { return randomUUID(); }

  private async login() {
    if (this.token && Date.now() < this.tokenExp) return this.token;
    const res = await fetch(`${this.base}/api/v1/authentication/login`, {
      method: "POST",
      headers: { "x-client-id": this.cfg.clientId, "x-api-key": this.cfg.apiKey },
    });
    if (!res.ok) throw new Error(`Airwallex login failed: ${res.status} ${await res.text()}`);
    const body = (await res.json()) as { token: string };
    this.token = body.token;
    this.tokenExp = Date.now() + 25 * 60 * 1000; // token lasts 30 min, refresh early
    return this.token;
  }

  async call<T = any>(method: "GET" | "POST", path: string, body?: unknown, onBehalfOf?: string): Promise<T> {
    const token = await this.login();
    const headers: Record<string, string> = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
    if (onBehalfOf) headers["x-on-behalf-of"] = onBehalfOf;
    const res = await fetch(`${this.base}/api/v1${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new AirwallexError(res.status, path, text);
    return (text ? JSON.parse(text) : {}) as T;
  }

  // --- Accounts & balances
  listGlobalAccounts() { return this.call("GET", "/global_accounts"); }
  createUsdGlobalAccount() {
    return this.call("POST", "/global_accounts/create", {
      request_id: Airwallex.requestId(),
      country_code: "US",
      required_features: [{ currency: "USD", transfer_method: "LOCAL" }],
    });
  }
  balances() { return this.call("GET", "/balances/current"); }

  // --- Collect from customers (card). Kit 4 / Kit 12 patterns.
  createPaymentIntent(amount: number, currency: string, merchantOrderId: string, metadata?: Record<string, string>) {
    return this.call("POST", "/pa/payment_intents/create", {
      request_id: Airwallex.requestId(), amount, currency, merchant_order_id: merchantOrderId, metadata,
    });
  }
  getPaymentIntent(id: string) { return this.call("GET", `/pa/payment_intents/${id}`); }
  /** Sandbox/scripted path: confirm with a test card. Check the intent before calling this again. */
  confirmPaymentIntent(id: string, card: TestCard, requestId = Airwallex.requestId()) {
    return this.call("POST", `/pa/payment_intents/${id}/confirm`, {
      request_id: requestId,
      payment_method: {
        type: "card",
        card: { number: card.number, expiry_month: card.expiryMonth, expiry_year: card.expiryYear, cvc: card.cvc, name: card.name },
      },
    });
  }

  /**
   * Hosted payment page the chat sends to the customer. The endpoint takes no request_id,
   * so callers must store the link id and never create a second link for the same order.
   */
  createPaymentLink(input: { amount: number; currency: string; title: string; reference: string; description?: string; metadata?: Record<string, string> }) {
    return this.call("POST", "/pa/payment_links/create", {
      reusable: false,
      amount: input.amount,
      currency: input.currency,
      title: input.title,
      reference: input.reference,
      description: input.description,
      metadata: input.metadata,
    });
  }
  getPaymentLink(id: string) { return this.call("GET", `/pa/payment_links/${id}`); }

  // --- Agentic Commerce (Kit 10). The merchant is the account the token belongs to.
  agenticOnboard(body: unknown) { return this.call("POST", "/pa/agentic_commerce/onboard", body); }
  agenticConfig() { return this.call("GET", "/pa/agentic_commerce/config"); }
  /** Replaces only the sections sent; a section sent must carry all its values, secrets included. */
  agenticUpdateConfig(body: unknown) { return this.call("POST", "/pa/agentic_commerce/config/update", body); }
  /** Upserts up to 300 GMC products, matched by id. */
  agenticUpsertProducts(products: unknown[]) { return this.call("POST", "/pa/agentic_commerce/products", { type: "gmc", gmc_products: products }); }

  // --- Disputes (Kit 4). REST only: the challenge tool lacks required fields.
  // A dispute carries the payment intent; merchant_order_id is the link's title, not our order id.
  listDisputes(status?: string) {
    return this.call("GET", `/pa/payment_disputes${status ? `?status=${status}` : ""}`);
  }
  getDispute(id: string) { return this.call("GET", `/pa/payment_disputes/${id}`); }
  /** Accepting at RFI refunds the customer in full. Read the dispute before retrying. */
  acceptDispute(id: string, input: { reason: string; description: string; requestId?: string }) {
    return this.call("POST", `/pa/payment_disputes/${id}/accept`, {
      request_id: input.requestId ?? Airwallex.requestId(), reason: input.reason, description: input.description, accepted_by: "peaje-asa-treasury",
    });
  }
  /** `body` carries the evidence fields (order_info, customer_info, delivery_info, supporting_documents...). */
  challengeDispute(id: string, body: Record<string, unknown>, requestId = Airwallex.requestId()) {
    return this.call("POST", `/pa/payment_disputes/${id}/challenge`, { request_id: requestId, challenged_by: "peaje-asa-treasury", ...body });
  }
  listRefunds(paymentIntentId: string) {
    return this.call("GET", `/pa/refunds?payment_intent_id=${encodeURIComponent(paymentIntentId)}`);
  }

  /** Evidence goes to the files host. JPG or PDF only: PNG is rejected. */
  async uploadFile(filename: string, bytes: Uint8Array, contentType: "application/pdf" | "image/jpeg", notes?: string) {
    const token = await this.login();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(bytes)], { type: contentType }), filename);
    if (notes) form.append("notes", notes.slice(0, 50));
    const url = `${this.base.replace("//api.", "//files.")}/api/v1/files/upload`;
    const res = await fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: form });
    const text = await res.text();
    if (!res.ok) throw new AirwallexError(res.status, "/files/upload", text);
    return JSON.parse(text) as { file_id: string; filename: string; size: number };
  }

  // --- FX (REST only, no MCP tool). Leave x-api-version off.
  convert(sell: string, buy: string, buyAmount: number) {
    return this.call("POST", "/fx/conversions/create", {
      request_id: Airwallex.requestId(), sell_currency: sell, buy_currency: buy, buy_amount: String(buyAmount),
    });
  }

  // --- Payouts. Check the schema for the corridor first (CO/COP LOCAL goes over CENIT, needs ID + email/phone).
  // The builder guide calls this /beneficiaries/schema; the API reference path is /beneficiary_api_schemas/generate.
  beneficiarySchema(country: string, currency: string, entityType: "PERSONAL" | "COMPANY" = "PERSONAL") {
    return this.call("POST", "/beneficiary_api_schemas/generate", {
      bank_country_code: country, account_currency: currency, entity_type: entityType, transfer_method: "LOCAL",
    });
  }
  /** Validates without creating anything. */
  validateBeneficiary(beneficiary: unknown) {
    return this.call("POST", "/beneficiaries/validate", { beneficiary, transfer_methods: ["LOCAL"] });
  }
  createBeneficiary(beneficiary: unknown, nickname?: string) {
    return this.call("POST", "/beneficiaries/create", { beneficiary, nickname, transfer_methods: ["LOCAL"] });
  }
  listBeneficiaries() { return this.call("GET", "/beneficiaries"); }

  /**
   * Validate, then reuse an existing beneficiary with the same bank account or create it.
   * The list doesn't return nicknames, so bank details are the match key.
   */
  async ensureBeneficiary(beneficiary: { bank_details: { account_number: string; account_routing_value1: string } }, nickname: string): Promise<string> {
    await this.validateBeneficiary(beneficiary);
    const bank = beneficiary.bank_details;
    const list: any = await this.listBeneficiaries();
    const found = list.items?.find((b: any) =>
      b.beneficiary?.bank_details?.account_number === bank.account_number &&
      b.beneficiary?.bank_details?.account_routing_value1 === bank.account_routing_value1);
    return found?.id ?? ((await this.createBeneficiary(beneficiary, nickname)) as any).id;
  }

  getTransfer(id: string) { return this.call("GET", `/transfers/${id}`); }
  async findTransferByRequestId(requestId: string) {
    const res: any = await this.call("GET", `/transfers?request_id=${encodeURIComponent(requestId)}`);
    return res.items?.[0] as any | undefined;
  }

  createTransfer(input: TransferInput & { requestId: string }) {
    return this.call("POST", "/transfers/create", {
      request_id: input.requestId,
      beneficiary_id: input.beneficiaryId,
      transfer_amount: input.amount,
      transfer_currency: input.currency,
      source_currency: input.currency,
      transfer_method: "LOCAL",
      reference: input.reference,
      reason: input.reason,
    });
  }

  /**
   * Create a transfer at most once. If the create call fails or times out, look the
   * request_id up before trying again, so an ambiguous failure can't pay twice.
   */
  async createTransferOnce(input: TransferInput, attempts = 3) {
    const requestId = input.requestId ?? Airwallex.requestId();
    let lastError: unknown;
    for (let i = 0; i < attempts; i++) {
      if (i > 0) {
        const existing = await this.findTransferByRequestId(requestId);
        if (existing) return existing;
        await sleep(500 * i);
      }
      try {
        return await this.createTransfer({ ...input, requestId });
      } catch (e) {
        lastError = e;
        // 4xx validation errors won't change on retry; only ambiguous failures are retried.
        if (e instanceof AirwallexError && e.status >= 400 && e.status < 500 && e.status !== 429) throw e;
      }
    }
    throw lastError;
  }

  /** Poll until PAID or CANCELLED. SENT is in flight, never final. */
  async waitForTransfer(id: string, timeoutMs = 30_000) {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const t: any = await this.getTransfer(id);
      if ((TRANSFER_TERMINAL as readonly string[]).includes(t.status)) return t;
      if (Date.now() > deadline) return t;
      await sleep(1000);
    }
  }

  // --- Platform: one connected account per shop (Kit 5). The platform owns the card payments;
  // money moves to and from each shop's account with connected-account transfers and charges.

  /** Opens a business account and submits it for review. Airwallex reviews it (in the sandbox, `simulate.reviewAccount`). */
  async openConnectedAccount(details: ConnectedAccountDetails) {
    const address = { address_line1: details.address.line1, suburb: details.address.city, state: details.address.state, postcode: details.address.postcode, country_code: details.address.country };
    const acct: any = await this.call("POST", "/accounts/create", {
      account_details: {
        business_details: {
          business_name: details.businessName, business_structure: "COMPANY", industry_category_code: details.industryCode ?? "ICCV3_1209XX",
          registration_address: address, address, operating_country: [details.address.country],
          business_identifiers: [{ type: "EIN", number: details.ein, country_code: details.address.country }],
          contact_number: details.phone, url: details.url, description_of_goods_or_services: details.description,
          account_usage: { product_reference: ["ACCEPT_ONLINE_PAYMENTS", "RECEIVE_TRANSFERS", "MAKE_TRANSFERS"], estimated_monthly_revenue: { currency: "USD", amount: String(details.monthlyRevenue) } },
        },
        business_person_details: [{
          first_name: details.person.firstName, last_name: details.person.lastName, roles: ["DIRECTOR", "AUTHORISED_PERSON", "BENEFICIAL_OWNER"],
          date_of_birth: details.person.dateOfBirth, nationality: details.address.country, residential_address: address, email: details.email, ownership_percentage: 100,
          identifications: { primary: { identification_type: "PERSONAL_ID", issuing_country_code: details.address.country, personal_id: { number: details.person.idNumber } } },
        }],
      },
      primary_contact: { email: details.email, mobile: details.phone },
      customer_agreements: { agreed_to_data_usage: true, agreed_to_terms_and_conditions: true },
    });
    await this.call("POST", `/accounts/${acct.id}/submit`, {});
    return acct.id as string;
  }
  getAccount(id: string) { return this.call("GET", `/accounts/${id}`); }
  /** The account number and name another Airwallex account pays to (Airwallex Pay). */
  walletInfo(onBehalfOf?: string) { return this.call<{ account_name: string; account_number: string }>("GET", "/account/wallet_info", undefined, onBehalfOf); }
  balancesOf(onBehalfOf: string) { return this.call("GET", "/balances/current", undefined, onBehalfOf); }
  globalAccountsOf(onBehalfOf: string) { return this.call("GET", "/global_accounts", undefined, onBehalfOf); }

  /** Platform to shop. Settles in seconds. `request_id` makes it once-only: a repeat is refused and `findConnectedTransfer` finds the first. */
  createConnectedTransfer(input: { destination: string; amount: number; currency: string; reason: string; reference: string; requestId: string }) {
    return this.call("POST", "/connected_account_transfers/create", { request_id: input.requestId, amount: input.amount, currency: input.currency, destination: input.destination, reason: input.reason, reference: input.reference });
  }
  getConnectedTransfer(id: string) { return this.call("GET", `/connected_account_transfers/${id}`); }
  async findConnectedTransfer(requestId: string) {
    return ((await this.call("GET", `/connected_account_transfers?request_id=${encodeURIComponent(requestId)}`)) as any).items?.[0] as any | undefined;
  }

  /** Shop to platform (the advance repayment, a refund the platform paid for the shop). Settles in seconds. */
  createCharge(input: { source: string; amount: number; currency: string; reason: string; reference: string; requestId: string }) {
    return this.call("POST", "/charges/create", { request_id: input.requestId, amount: input.amount, currency: input.currency, source: input.source, reason: input.reason, reference: input.reference });
  }
  getCharge(id: string) { return this.call("GET", `/charges/${id}`); }
  async findCharge(requestId: string) {
    return ((await this.call("GET", `/charges?request_id=${encodeURIComponent(requestId)}`)) as any).items?.[0] as any | undefined;
  }

  /**
   * Pays another Airwallex account (Airwallex Pay) from `onBehalfOf` (the shop's account), by its
   * account number and name. Internal to Airwallex: it reaches PAID in seconds, no bank in between.
   */
  createWalletTransfer(input: { onBehalfOf: string; accountNumber: string; accountName: string; amount: number; currency: string; reason: string; reference: string; requestId: string }) {
    return this.call("POST", "/transfers/create", {
      request_id: input.requestId, transfer_amount: input.amount, transfer_currency: input.currency, source_currency: input.currency, transfer_method: "LOCAL",
      reason: input.reason, reference: input.reference,
      beneficiary: { type: "DIGITAL_WALLET", digital_wallet: { provider: "AIRWALLEX", id_type: "account_number", id_value: input.accountNumber, account_name: input.accountName } },
    }, input.onBehalfOf);
  }
  getTransferOf(id: string, onBehalfOf: string) { return this.call("GET", `/transfers/${id}`, undefined, onBehalfOf); }
  async findTransferOf(requestId: string, onBehalfOf: string) {
    return ((await this.call("GET", `/transfers?request_id=${encodeURIComponent(requestId)}`, undefined, onBehalfOf)) as any).items?.[0] as any | undefined;
  }

  // --- Sandbox-only simulations. Keep everything sandbox-specific here.
  simulate = {
    /** Money arriving from outside Airwallex into a global account (the shop's, with `onBehalfOf`). */
    deposit: (globalAccountId: string, amount: number, reference?: string, payerName = "Peaje ASA", onBehalfOf?: string) =>
      this.call("POST", "/simulation/deposit/create", { global_account_id: globalAccountId, amount, reference, payer_name: payerName }, onBehalfOf),
    /**
     * Airwallex's KYC review of a submitted account, which in production its compliance team does.
     * `force: false` runs the simulated review; a forced ACTIVE leaves the account unable to move money.
     */
    reviewAccount: (accountId: string) =>
      this.call("POST", `/simulation/accounts/${accountId}/update_status`, { next_status: "ACTIVE", force: false }),
    /**
     * Stage a chargeback on a paid intent (link-paid intents work). Use RFI or CHARGEBACK:
     * PRE_CHARGEBACK auto-accepts in the same second. Visa codes: 10.4 fraud, 13.1 not received, 13.6 credit not processed.
     */
    createDispute: (paymentIntentId: string, stage: "RFI" | "CHARGEBACK", reasonCode: "10.4" | "13.1" | "13.6", dueInDays = 10) =>
      this.call("POST", "/simulation/pa/payment_disputes/create", {
        payment_intent_id: paymentIntentId, stage, reason_code: reasonCode, due_at: isoIn(dueInDays),
      }),
    /** The issuer rejects a challenged RFI: it moves to CHARGEBACK and needs a response again. Fails from CHARGEBACK. */
    escalateDispute: (disputeId: string, dueInDays = 10) =>
      this.call("POST", `/simulation/pa/payment_disputes/${disputeId}/escalate`, { due_at: isoIn(dueInDays) }),
    /** End a challenged case. "MERCHANT" means we won. */
    resolveDispute: (disputeId: string, inFavorOf: "MERCHANT" | string) =>
      this.call("POST", `/simulation/pa/payment_disputes/${disputeId}/resolve`, { in_favor_of: inFavorOf }),
    /** Move a transfer forward. A failure_type only applies once the transfer has reached SENT. */
    transferTo: (transferId: string, nextStatus: "SENT" | "PAID" | "FAILED", failureType?: string) =>
      this.call("POST", `/simulation/transfers/${transferId}/transition`, { next_status: nextStatus, failure_type: failureType }),
    /**
     * Drive a new transfer to PAID (or to FAILED with a failure_type). Transitions from
     * SCHEDULED fail with a 500, so wait for PROCESSING first, then SENT, then the end state.
     */
    settleTransfer: async (transferId: string, end: "PAID" | { failureType: string } = "PAID", timeoutMs = 30_000) => {
      const deadline = Date.now() + timeoutMs;
      let t: any = await this.getTransfer(transferId);
      while (t.status === "SCHEDULED") {
        if (Date.now() > deadline) throw new Error(`Transfer ${transferId} still SCHEDULED after ${timeoutMs} ms`);
        await sleep(1000);
        t = await this.getTransfer(transferId);
      }
      if (t.status !== "SENT") await this.simulate.transferTo(transferId, "SENT");
      if (end === "PAID") await this.simulate.transferTo(transferId, "PAID");
      else await this.simulate.transferTo(transferId, "FAILED", end.failureType);
      return this.waitForTransfer(transferId);
    },
  };
}

export class AirwallexError extends Error {
  constructor(public status: number, public path: string, public body: string) {
    super(`Airwallex ${status} on ${path}: ${body}`);
  }
}
