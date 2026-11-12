/**
 * Opening Airwallex accounts under the platform: the shop's own, and in the sandbox the accounts
 * standing in for the supplier and the owner it pays.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { Airwallex, ConnectedAccountDetails } from "@peaje-asa/airwallex";
import type { Wallet } from "./rails.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * KYC sample for the sandbox only. In production the owner goes through Airwallex's own
 * onboarding and these come from them.
 */
export function sandboxKyc(businessName: string, email: string, description: string): ConnectedAccountDetails {
  return {
    businessName, description, email, ein: "123456789", url: "https://peaje-asa.example.com", phone: "5125550100", monthlyRevenue: 20000,
    address: { line1: "100 Main St", city: "Austin", state: "TX", postcode: "78701", country: "US" },
    person: { firstName: "Ana", lastName: "Owner", dateOfBirth: "1990-01-01", idNumber: "123456789" },
  };
}

/**
 * Opens a business account under the platform and waits until Airwallex's review makes it ACTIVE.
 * In the sandbox the review is simulated (`simulate.reviewAccount`); in production Airwallex does it.
 */
export async function openAccount(awx: Airwallex, details: ConnectedAccountDetails, timeoutMs = 30_000): Promise<{ accountId: string; wallet: Wallet }> {
  const accountId = await awx.openConnectedAccount(details);
  await sleep(2000);
  await awx.simulate.reviewAccount(accountId);
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const a: any = await awx.getAccount(accountId);
    if (a.status === "ACTIVE") break;
    if (Date.now() > deadline) throw new Error(`Airwallex account ${accountId} is ${a.status}, not ACTIVE yet. Try again in a minute.`);
    await sleep(2000);
  }
  const w = await awx.walletInfo(accountId);
  return { accountId, wallet: { accountNumber: w.account_number, accountName: w.account_name } };
}

/**
 * In the sandbox, the supplier and the owner need an Airwallex account to be paid by Airwallex Pay.
 * The platform opens one for each, standing in for the account the real supplier or owner gives.
 * Saved in `file` so each is opened once.
 */
export async function sandboxPayee(awx: Airwallex, file: string, key: string, name: string, description: string): Promise<Wallet & { accountId: string }> {
  const saved: Record<string, Wallet & { accountId: string }> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  if (saved[key]) return saved[key];
  const { accountId, wallet } = await openAccount(awx, sandboxKyc(name, "payee@example.com", description));
  saved[key] = { accountId, ...wallet };
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(saved, null, 2)}\n`);
  return saved[key];
}
