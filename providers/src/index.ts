/**
 * Three mock inference providers, each in front of a real Claude model.
 * Unpaid requests get a 402 offer with the current price and advertised latency;
 * paid requests are forwarded to Claude and the Messages API response comes back as is.
 * Each provider prices by demand: above its capacity of paid calls in the last ten minutes, every
 * extra call raises the price by a share of the base, and the price falls back as calls age out.
 * Nobody sets it by hand; the agents' own traffic moves it.
 *
 * With data/metal/providers.json (written by `npm run metal:setup`) each provider sells over x402 on
 * Metal testnet: the 402 is a real `exact` offer in USDZ to the provider's own address, and Metal's
 * facilitator settles the payment before Claude runs. Without it, the old `x-paid: 1` header stands in.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { METAL_NETWORKS, registerMetalScheme } from "@metalntwx/metal-pay";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";

// Base prices in USDZ major units per call (0.01 = one cent), matching Kit 12's 1/2/5 cents.
// Capacity: paid calls per window served at the base price. The premium model is the scarcest.
const providers = [
  { id: "cheap", port: 4101, model: "claude-haiku-5-5", base: 0.01, capacity: 12, latencyMs: 300, calls: [] as number[] },
  { id: "mid", port: 4102, model: "claude-sonnet-5-5", base: 0.02, capacity: 6, latencyMs: 200, calls: [] as number[] },
  { id: "premium", port: 4103, model: "claude-opus-5-5", base: 0.05, capacity: 3, latencyMs: 150, calls: [] as number[] },
];
type Provider = (typeof providers)[number];

const WINDOW_MS = Number(process.env.PROVIDER_DEMAND_WINDOW_MS ?? 10 * 60_000);
/** Each paid call above capacity adds this share of the base price. */
const STEP = 0.5;
const MAX_MULTIPLE = 20;

/** Paid calls in the window. */
function demand(p: Provider) {
  const since = Date.now() - WINDOW_MS;
  while (p.calls.length && p.calls[0] < since) p.calls.shift();
  return p.calls.length;
}

/** The price right now: the base up to capacity, then higher with every extra paid call. */
function priceOf(p: Provider) {
  const over = Math.max(0, demand(p) - p.capacity);
  return Math.round(p.base * Math.min(MAX_MULTIPLE, 1 + STEP * over) * 10_000) / 10_000;
}

/** Counts a paid call. The next offer already carries the new price. */
function served(p: Provider) {
  p.calls.push(Date.now());
  const price = priceOf(p);
  if (price !== p.base) console.log(`provider ${p.id}: ${demand(p)} paid calls in ${WINDOW_MS / 60_000} min, price ${price} (base ${p.base})`);
}

const terms = (p: Provider) => ({ "x-price": String(priceOf(p)), "x-latency-ms": String(p.latencyMs), "x-demand": String(demand(p)), "x-capacity": String(p.capacity) });

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
if (!client) console.warn("ANTHROPIC_API_KEY is not set: paid calls will answer 503");

/** What the seller agent sends with a paid call. The provider picks the model. */
interface PaidRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * On a fresh server, writes the platform's files into data/ from SEED_DATA (as scripts/seed-data.mjs
 * does), whatever the start command, so the providers sell over Metal like the app expects.
 * Files already on disk are kept.
 */
function seedData() {
  const seed = process.env.SEED_DATA;
  if (!seed) return;
  try {
    const files = JSON.parse(gunzipSync(Buffer.from(seed, "base64")).toString("utf8")) as Record<string, string>;
    let wrote = 0;
    for (const [rel, body] of Object.entries(files)) {
      if (!rel.startsWith("data/") || rel.includes("..")) throw new Error(`path outside data/: ${rel}`);
      const path = resolve(root, rel);
      if (existsSync(path)) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, body, { mode: 0o600 });
      wrote++;
    }
    console.log(`seed: wrote ${wrote} of ${Object.keys(files).length} file(s)`);
  } catch (e) {
    console.error(`seed: SEED_DATA could not be read: ${e instanceof Error ? e.message : String(e)}`);
  }
}
seedData();

const payeesFile = process.env.METAL_PROVIDERS_FILE ?? resolve(root, "data/metal/providers.json");
const payees: Record<string, `0x${string}`> | undefined = existsSync(payeesFile) ? JSON.parse(readFileSync(payeesFile, "utf8")) : undefined;

/** Runs the model the provider fronts. Same answer in both modes. */
async function answer(p: Provider, raw: string): Promise<{ status: number; body: unknown }> {
  if (!client) return { status: 503, body: { error: "missing ANTHROPIC_API_KEY" } };
  await new Promise((r) => setTimeout(r, p.latencyMs));
  try {
    const body = JSON.parse(raw) as PaidRequest;
    const message = await client.beta.messages.create({
      model: p.model,
      max_tokens: 4000,
      output_config: { effort: "low" },
      // Server-side refusal fallback; models without one just run alone.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      cache_control: { type: "ephemeral" },
      system: body.system,
      tools: body.tools,
      messages: body.messages,
    });
    return { status: 200, body: message };
  } catch (e) {
    const status = e instanceof Anthropic.APIError && e.status ? e.status : 500;
    return { status: 502, body: { error: "upstream_failed", upstreamStatus: status, message: e instanceof Error ? e.message : String(e) } };
  }
}

function metalProvider(p: Provider, payTo: `0x${string}`) {
  const testnet = METAL_NETWORKS.testnet;
  const server = registerMetalScheme(new x402ResourceServer(new HTTPFacilitatorClient({ url: testnet.facilitatorUrl })), { networks: ["testnet"] });
  const app = new Hono();
  // Every answer carries the current terms, the 402 included, so a buyer can compare before paying.
  app.use(async (c, next) => {
    await next();
    for (const [k, v] of Object.entries(terms(p))) c.res.headers.set(k, v);
  });
  app.use(
    paymentMiddleware(
      // The price is read per request, so a rise applies to the very next offer.
      { "POST /": { accepts: { scheme: "exact", network: testnet.network, payTo, price: () => String(priceOf(p)), maxTimeoutSeconds: 120 }, description: `${p.model} call` } },
      server,
    ),
  );
  app.post("/", async (c) => {
    // Reached only once Metal settled the payment.
    served(p);
    const { status, body } = await answer(p, await c.req.text());
    return c.json(body as object, status as 200);
  });
  serve({ fetch: app.fetch, port: p.port }, () => console.log(`provider ${p.id} (${p.model}) on :${p.port} @ ${p.base} USDZ base, capacity ${p.capacity} calls / ${WINDOW_MS / 60_000} min, over x402 on Metal testnet, paid to ${payTo}`));
}

function headerProvider(p: Provider) {
  createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

    for (const [k, v] of Object.entries(terms(p))) res.setHeader(k, v);
    if (req.headers["x-paid"] !== "1") return json(402, { provider: p.id, model: p.model, price: priceOf(p), latencyMs: p.latencyMs });
    served(p);
    const { status, body } = await answer(p, raw);
    json(status, body);
  }).listen(p.port, () => console.log(`provider ${p.id} (${p.model}) on :${p.port} @ ${p.base} base (x-paid header, no Metal)`));
}

for (const p of providers) {
  const payTo = payees?.[p.id];
  if (payTo) metalProvider(p, payTo);
  else headerProvider(p);
}
