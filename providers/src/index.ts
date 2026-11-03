/**
 * Three mock inference providers, each in front of a real Claude model.
 * Unpaid requests get a 402 offer with the current price and advertised latency;
 * paid requests are forwarded to Claude and the Messages API response comes back as is.
 * Prices and latency can change at runtime (POST /price) to drive the "price rise" moment in the demo.
 *
 * With data/metal/providers.json (written by `npm run metal:setup`) each provider sells over x402 on
 * Metal testnet: the 402 is a real `exact` offer in USDZ to the provider's own address, and Metal's
 * facilitator settles the payment before Claude runs. Without it, the old `x-paid: 1` header stands in.
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { serve } from "@hono/node-server";
import { METAL_NETWORKS, registerMetalScheme } from "@metalntwx/metal-pay";
import { HTTPFacilitatorClient, x402ResourceServer } from "@x402/core/server";
import { paymentMiddleware } from "@x402/hono";
import { Hono } from "hono";

// Prices in USDZ major units per call (0.01 = one cent), matching Kit 12's 1/2/5 cents.
const providers = [
  { id: "cheap", port: 4101, model: "claude-haiku-5-5", price: 0.01, latencyMs: 300 },
  { id: "mid", port: 4102, model: "claude-sonnet-5-5", price: 0.02, latencyMs: 200 },
  { id: "premium", port: 4103, model: "claude-opus-5-5", price: 0.05, latencyMs: 150 },
];
type Provider = (typeof providers)[number];

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
if (!client) console.warn("ANTHROPIC_API_KEY is not set: paid calls will answer 503");

/** What the seller agent sends with a paid call. The provider picks the model. */
interface PaidRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
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

function setPrice(p: Provider, raw: string) {
  const { price, latencyMs } = JSON.parse(raw || "{}");
  if (price !== undefined) p.price = price;
  if (latencyMs !== undefined) p.latencyMs = latencyMs;
  console.log(`provider ${p.id} now @ ${p.price}, ${p.latencyMs} ms`);
  return p;
}

function metalProvider(p: Provider, payTo: `0x${string}`) {
  const testnet = METAL_NETWORKS.testnet;
  const server = registerMetalScheme(new x402ResourceServer(new HTTPFacilitatorClient({ url: testnet.facilitatorUrl })), { networks: ["testnet"] });
  const app = new Hono();
  // Every answer carries the current terms, the 402 included, so a buyer can compare before paying.
  app.use(async (c, next) => {
    await next();
    c.res.headers.set("x-price", String(p.price));
    c.res.headers.set("x-latency-ms", String(p.latencyMs));
  });
  app.post("/price", async (c) => c.json(setPrice(p, await c.req.text())));
  app.use(
    paymentMiddleware(
      // The price is read per request, so a rise applies to the very next offer.
      { "POST /": { accepts: { scheme: "exact", network: testnet.network, payTo, price: () => String(p.price), maxTimeoutSeconds: 120 }, description: `${p.model} call` } },
      server,
    ),
  );
  app.post("/", async (c) => {
    const { status, body } = await answer(p, await c.req.text());
    return c.json(body as object, status as 200);
  });
  serve({ fetch: app.fetch, port: p.port }, () => console.log(`provider ${p.id} (${p.model}) on :${p.port} @ ${p.price} USDZ over x402 on Metal testnet, paid to ${payTo}`));
}

function headerProvider(p: Provider) {
  createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

    if (req.url === "/price" && req.method === "POST") return json(200, setPrice(p, raw));

    res.setHeader("x-price", String(p.price));
    res.setHeader("x-latency-ms", String(p.latencyMs));
    if (req.headers["x-paid"] !== "1") return json(402, { provider: p.id, model: p.model, price: p.price, latencyMs: p.latencyMs });
    const { status, body } = await answer(p, raw);
    json(status, body);
  }).listen(p.port, () => console.log(`provider ${p.id} (${p.model}) on :${p.port} @ ${p.price} (x-paid header, no Metal)`));
}

for (const p of providers) {
  const payTo = payees?.[p.id];
  if (payTo) metalProvider(p, payTo);
  else headerProvider(p);
}
