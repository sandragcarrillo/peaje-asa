/**
 * Thin Airwallex sandbox client.
 * - Amounts are MAJOR units (100 = one hundred), not cents.
 * - Every mutating call gets a request_id. Reuse it only to retry the same operation.
 * - Sandbox-only simulation calls are isolated in `simulate` so they can be swapped later.
 * Docs MCP: https://mcp.sandbox.airwallex.com/docs
 */
import { randomUUID } from "node:crypto";

export interface AirwallexConfig {
  clientId: string;
  apiKey: string;
  baseUrl?: string;
}

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
  createPaymentIntent(amount: number, currency: string, merchantOrderId: string) {
    return this.call("POST", "/pa/payment_intents/create", {
      request_id: Airwallex.requestId(), amount, currency, merchant_order_id: merchantOrderId,
    });
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
  createBeneficiary(beneficiary: unknown) {
    return this.call("POST", "/beneficiaries/create", { beneficiary, transfer_methods: ["LOCAL"] });
  }
  createTransfer(input: { beneficiaryId: string; amount: number; currency: string; reference: string; requestId?: string }) {
    return this.call("POST", "/transfers/create", {
      request_id: input.requestId ?? Airwallex.requestId(),
      beneficiary_id: input.beneficiaryId,
      transfer_amount: input.amount,
      transfer_currency: input.currency,
      transfer_method: "LOCAL",
      reference: input.reference,
    });
  }

  // --- Sandbox-only simulations. Keep everything sandbox-specific here.
  simulate = {
    deposit: (globalAccountId: string, amount: number, reference?: string) =>
      this.call("POST", "/simulation/deposit/create", { global_account_id: globalAccountId, amount, payer_name: reference ?? "Peaje ASA" }),
    transferTo: (transferId: string, nextStatus: "SENT" | "PAID" | "FAILED", failureType?: string) =>
      this.call("POST", `/simulation/transfers/${transferId}/transition`, { next_status: nextStatus, failure_type: failureType }),
  };
}

export class AirwallexError extends Error {
  constructor(public status: number, public path: string, public body: string) {
    super(`Airwallex ${status} on ${path}: ${body}`);
  }
}
