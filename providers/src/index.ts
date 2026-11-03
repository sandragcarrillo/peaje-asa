/**
 * Three mock inference providers, each in front of a real Claude model.
 * Unpaid requests get a 402 offer with the current price and advertised latency;
 * paid requests are forwarded to Claude and the Messages API response comes back as is.
 * Prices and latency can change at runtime (POST /price) to drive the "price rise" moment in the demo.
 * TODO: replace the x-paid header with real Metal clearing (ClearingServerScheme).
 */
import { createServer } from "node:http";
import Anthropic from "@anthropic-ai/sdk";

// Prices in USDZ major units per call (0.01 = one cent), matching Kit 12's 1/2/5 cents.
const providers = [
  { id: "cheap", port: 4101, model: "claude-haiku-5-5", price: 0.01, latencyMs: 300 },
  { id: "mid", port: 4102, model: "claude-sonnet-5-5", price: 0.02, latencyMs: 200 },
  { id: "premium", port: 4103, model: "claude-opus-5-5", price: 0.05, latencyMs: 150 },
];

const client = process.env.ANTHROPIC_API_KEY ? new Anthropic() : undefined;
if (!client) console.warn("ANTHROPIC_API_KEY is not set: paid calls will answer 503");

/** What the seller agent sends with a paid call. The provider picks the model. */
interface PaidRequest {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaToolUnion[];
}

for (const p of providers) {
  createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const json = (status: number, body: unknown) =>
      res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));

    if (req.url === "/price" && req.method === "POST") {
      const { price, latencyMs } = JSON.parse(raw || "{}");
      if (price !== undefined) p.price = price;
      if (latencyMs !== undefined) p.latencyMs = latencyMs;
      console.log(`provider ${p.id} now @ ${p.price}, ${p.latencyMs} ms`);
      return json(200, p);
    }

    res.setHeader("x-price", String(p.price));
    res.setHeader("x-latency-ms", String(p.latencyMs));
    if (req.headers["x-paid"] !== "1") return json(402, { provider: p.id, model: p.model, price: p.price, latencyMs: p.latencyMs });
    if (!client) return json(503, { error: "missing ANTHROPIC_API_KEY" });

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
      json(200, message);
    } catch (e) {
      const status = e instanceof Anthropic.APIError && e.status ? e.status : 500;
      json(502, { error: "upstream_failed", upstreamStatus: status, message: e instanceof Error ? e.message : String(e) });
    }
  }).listen(p.port, () => console.log(`provider ${p.id} (${p.model}) on :${p.port} @ ${p.price}`));
}
