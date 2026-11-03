/**
 * Smoke test: login, reuse (or create) a USD global account, top it up only when
 * the USD balance is under the demo minimum, show balances, and confirm the
 * payout corridors (US/USD now, CO/COP later).
 */
import { Airwallex, AirwallexError } from "../packages/airwallex/src/index.js";

/** USD the demo needs on hand. Deposits only happen below this, so reruns don't keep inflating the wallet. */
const MIN_USD = 25_000;

const awx = Airwallex.fromEnv();

const accounts: any = await awx.listGlobalAccounts();
let account = accounts.items?.find(
  (a: any) => a.status === "ACTIVE" && a.required_features?.some((f: any) => f.currency === "USD"),
);
if (!account) {
  account = await awx.createUsdGlobalAccount();
  console.log("Created USD global account", account.id);
} else {
  console.log("Using USD global account", account.id);
}

const usdAvailable = async () => {
  const balances: any[] = await awx.balances();
  return balances.find((b) => b.currency === "USD")?.available_amount ?? 0;
};

const before = await usdAvailable();
if (before < MIN_USD) {
  const amount = MIN_USD - before;
  await awx.simulate.deposit(account.id, amount, "Seed funding");
  console.log(`Deposited ${amount} USD (had ${before})`);
} else {
  console.log(`USD balance ${before} >= ${MIN_USD}, no deposit`);
}

const balances: any[] = await awx.balances();
console.log("Balances:");
for (const b of balances.filter((b) => b.available_amount || b.total_amount)) {
  console.log(`  ${b.currency.padEnd(4)} available ${b.available_amount}  total ${b.total_amount}`);
}

/** Owner payouts use US/USD LOCAL for now (required). CO/COP LOCAL is checked for later (informational). */
for (const [country, currency, required] of [["US", "USD", true], ["CO", "COP", false]] as const) {
  try {
    const schema: any = await awx.beneficiarySchema(country, currency);
    const fields = (schema.fields ?? []).map((f: any) => f.key ?? f.path ?? f.field).filter(Boolean);
    console.log(`${country}/${currency} LOCAL schema OK.`, fields.length ? `Fields: ${fields.join(", ")}` : JSON.stringify(schema).slice(0, 800));
  } catch (e) {
    if (!(e instanceof AirwallexError)) throw e;
    console.error(`${country}/${currency} LOCAL schema FAILED:`, e.status, e.body);
    if (required) process.exitCode = 1;
  }
}
