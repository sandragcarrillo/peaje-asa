/**
 * The demo's payees and USD account, shared by the scripts and the dashboard. Synthetic accounts:
 * a real ABA routing number (JPMorgan Chase) with made-up account numbers.
 */
import type { Airwallex } from "@peaje-asa/airwallex";
import type { Payees } from "./close.js";

const US_BANK = { bank_country_code: "US", account_currency: "USD", account_routing_type1: "aba", account_routing_value1: "021000021", bank_account_category: "Checking" };
const address = (street_address: string, city: string, state: string, postcode: string) => ({ street_address, city, state, postcode, country_code: "US" });

export const DEMO_PAYEES = {
  owner: {
    entity_type: "PERSONAL", first_name: "Sandra", last_name: "Demo", date_of_birth: "1990-01-15", personal_email: "owner@example.com",
    address: address("1 Main Street", "New York", "NY", "10001"),
    bank_details: { ...US_BANK, account_name: "Sandra Demo", account_number: "123456789" },
  },
  supplier: {
    entity_type: "COMPANY", company_name: "Andes Green Coffee Imports", business_email: "billing@example.com",
    address: address("200 Harbor Way", "Miami", "FL", "33132"),
    bank_details: { ...US_BANK, account_name: "Andes Green Coffee Imports", account_number: "987654321" },
  },
  /** Who funds the advance and receives its repayments. */
  lender: {
    entity_type: "COMPANY", company_name: "Peaje Capital", business_email: "advances@example.com",
    address: address("50 Fremont Street", "San Francisco", "CA", "94105"),
    bank_details: { ...US_BANK, account_name: "Peaje Capital", account_number: "555000111" },
  },
};

/** Creates the beneficiaries once and reuses them after (matched by bank account). */
export async function ensurePayees(awx: Airwallex, withLender = false): Promise<Payees> {
  const [owner, supplier] = await Promise.all([
    awx.ensureBeneficiary(DEMO_PAYEES.owner, "Peaje ASA owner (demo)"),
    awx.ensureBeneficiary(DEMO_PAYEES.supplier, "Peaje ASA supplier (demo)"),
  ]);
  const lender = withLender ? await awx.ensureBeneficiary(DEMO_PAYEES.lender, "Peaje ASA lender (demo)") : undefined;
  return { owner, supplier, lender };
}

/** The active USD global account, where the sandbox simulates incoming deposits. */
export async function usdGlobalAccount(awx: Airwallex): Promise<string> {
  const ga: any = ((await awx.listGlobalAccounts()) as any).items?.find((g: any) => g.status === "ACTIVE" && g.required_features?.some((f: any) => f.currency === "USD"));
  if (!ga) throw new Error("No active USD global account (run npm run check:airwallex)");
  return ga.id;
}
