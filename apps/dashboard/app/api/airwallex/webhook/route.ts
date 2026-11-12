import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Airwallex } from "@peaje-asa/airwallex";
import { bookCheckoutPayment, verifyWebhookSignature } from "@peaje-asa/storefront";
import { root } from "@/lib/env";
import { bookDeps } from "@/lib/storefront";

export const dynamic = "force-dynamic";

const g = globalThis as unknown as { asaAwx?: Airwallex };

/**
 * Airwallex webhooks. A payment_intent.succeeded for a buyer agent's checkout books the order in
 * the shop that sold it. The body only says which intent; the amount and status are read back
 * from Airwallex before anything is booked.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.AWX_WEBHOOK_SECRET;
  if (!secret || !verifyWebhookSignature(secret, req.headers.get("x-timestamp"), raw, req.headers.get("x-signature"))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  const event = JSON.parse(raw) as { id?: string; name?: string; data?: { object?: { id?: string } } };
  // Kept for the record (data/ is not committed): what Airwallex sent, as it sent it.
  const dir = join(root, "data/airwallex/webhooks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${Date.now()}-${(event.name ?? "event").replace(/[^a-z._]/gi, "")}.json`), raw);

  if (event.name !== "payment_intent.succeeded" || !event.data?.object?.id) return Response.json({ ok: true, ignored: event.name });
  const intent = await (g.asaAwx ??= Airwallex.fromEnv()).getPaymentIntent(event.data.object.id);
  // The fulfillment choice is on the event's intent; keep it if the read-back lacks it.
  const withChoice = { ...(event.data.object as object), ...(intent as object) } as any;
  withChoice.agentic_payment_data ??= (event.data.object as any).agentic_payment_data;
  const result = bookCheckoutPayment(withChoice, bookDeps());
  return Response.json({ ok: true, ...result });
}
