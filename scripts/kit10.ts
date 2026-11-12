/**
 * The platform's Airwallex Agentic Commerce merchant (Kit 10).
 *
 *   npm run kit10 -- status     what Airwallex has (redacted)
 *   npm run kit10 -- setup      onboard once, or point the config at PUBLIC_URL again
 *   npm run kit10 -- products   upsert every shop's products into the catalogue
 *
 * Needs PUBLIC_URL (this app's public https origin). Writes AGENTIC_CHECKOUT_SECRET to .env the
 * first time; it never prints a secret.
 */
import { randomBytes } from "node:crypto";
import { appendFileSync, readFileSync } from "node:fs";
import { Airwallex, AirwallexError } from "@peaje-asa/airwallex";
import { ShopStore } from "@peaje-asa/ledger";
import { defaultPolicy } from "@peaje-asa/policy";
import { feedFor } from "@peaje-asa/storefront";

const awx = Airwallex.fromEnv();
const cmd = process.argv[2] ?? "status";
const MCP_HOST = process.env.AWX_MCP_HOST ?? "https://mcp.sandbox.airwallex.com";

function publicUrl() {
  const u = process.env.PUBLIC_URL?.replace(/\/+$/, "");
  if (!u?.startsWith("https://")) throw new Error("Set PUBLIC_URL to the app's public https origin");
  return u;
}

function checkoutSecret() {
  if (process.env.AGENTIC_CHECKOUT_SECRET) return process.env.AGENTIC_CHECKOUT_SECRET;
  const secret = randomBytes(32).toString("hex");
  const env = readFileSync(".env", "utf8");
  appendFileSync(".env", `${env.endsWith("\n") ? "" : "\n"}# HMAC secret Airwallex signs create-checkout calls with (Kit 10)\nAGENTIC_CHECKOUT_SECRET=${secret}\n`);
  console.log("Wrote AGENTIC_CHECKOUT_SECRET to .env (restart the app so it reads it).");
  return secret;
}

function show(c: any) {
  console.log(`merchant ${c.merchant_id} (${c.status})`);
  console.log(`checkout ${c.apis?.create_checkout} secret ${c.apis?.secret_key_configured ? "set" : "missing"}; psp ${c.psp_config?.psp_name} key ${c.psp_config?.api_key_configured ? "set" : "missing"}`);
  console.log(`images ${(c.whitelisted_image_domains ?? []).join(", ")}`);
  if (c.mcp_endpoints?.acp) console.log(`buyer MCP (ACP) ${MCP_HOST}${c.mcp_endpoints.acp}`);
}

async function config() {
  try { return await awx.agenticConfig(); }
  catch (e) { if (e instanceof AirwallexError && e.status === 404) return undefined; throw e; }
}

if (cmd === "status") {
  const c = await config();
  if (c) show(c); else console.log("No Agentic Commerce config yet: run setup.");
} else if (cmd === "setup") {
  const base = publicUrl();
  const apis = {
    create_checkout: `${base}/api/agentic/checkout`,
    secret_key: checkoutSecret(),
    oauth: { acp: { oauth_base: base, oauth_jwks: `${base}/oauth/jwks.json`, scopes: ["openid", "email"] } },
  };
  const images = [base];
  const existing = await config();
  const c = existing
    ? await awx.agenticUpdateConfig({ apis, whitelisted_image_domains: images })
    : await awx.agenticOnboard({
      psp_config: { api_key_data: { client_id: process.env.AWX_CLIENT_ID, api_key: process.env.AWX_API_KEY } },
      apis, whitelisted_image_domains: images,
    });
  console.log(existing ? "Updated the config." : "Onboarded.");
  show(c);
} else if (cmd === "products") {
  const base = publicUrl();
  const shops = new ShopStore().list();
  const feed = shops.flatMap((s) => feedFor({ id: s.id, name: s.name, about: s.about, policy: { ...defaultPolicy, ...s.policy } }, base));
  if (feed.length === 0) throw new Error("No shops in the book yet");
  for (let i = 0; i < feed.length; i += 300) {
    const r: any = await awx.agenticUpsertProducts(feed.slice(i, i + 300));
    console.log(`products ${i + 1}-${Math.min(i + 300, feed.length)}: added ${r.records_added}, updated ${r.records_updated}, failed ${r.records_failed}${r.error_gcs_file_loc ? ` (errors at ${r.error_gcs_file_loc})` : ""}`);
  }
  console.log(`${feed.length} products from ${shops.length} shop(s).`);
} else {
  throw new Error(`unknown command ${cmd}: status, setup or products`);
}
