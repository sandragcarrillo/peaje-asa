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

/** A transfer is done when it reaches one of these. CANCELLED is how failures end (read failure_type). */
export const TRANSFER_TERMINAL = ["PAID", "CANCELLED"] as const;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

  // --- Sandbox-only simulations. Keep everything sandbox-specific here.
  simulate = {
    deposit: (globalAccountId: string, amount: number, reference?: string) =>
      this.call("POST", "/simulation/deposit/create", { global_account_id: globalAccountId, amount, payer_name: reference ?? "Peaje ASA" }),
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
