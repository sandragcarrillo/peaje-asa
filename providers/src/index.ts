/**
 * Three mock inference providers at different prices.
 * Unpaid requests get a 402 with the current price; paid ones get an answer.
 * Prices can change at runtime (POST /price) to drive the "price rise" moment in the demo.
 * TODO: replace the x-paid header with real Metal clearing (ClearingServerScheme).
 */
import { createServer } from "node:http";

// Prices in USDZ major units per call (0.01 = one cent), matching Kit 12's 1/2/5 cents.
const providers = [
  { id: "cheap", port: 4101, price: 0.01, latencyMs: 300 },
  { id: "mid", port: 4102, price: 0.02, latencyMs: 200 },
  { id: "premium", port: 4103, price: 0.05, latencyMs: 150 },
];

for (const p of providers) {
  createServer(async (req, res) => {
    if (req.url === "/price" && req.method === "POST") {
      let body = ""; for await (const c of req) body += c;
      const { price, latencyMs } = JSON.parse(body || "{}");
      if (price !== undefined) p.price = price;
      if (latencyMs !== undefined) p.latencyMs = latencyMs;
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(p));
      return;
    }
    res.setHeader("x-price", String(p.price));
    if (req.headers["x-paid"] !== "1") {
      res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ provider: p.id, price: p.price }));
      return;
    }
    await new Promise((r) => setTimeout(r, p.latencyMs));
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ provider: p.id, text: `answer from ${p.id}` }));
  }).listen(p.port, () => console.log(`provider ${p.id} on :${p.port} @ ${p.price}`));
}
