import { quoteCheckout, verifyCheckoutSignature, type CheckoutRequest } from "@peaje-asa/storefront";
import { checkouts, listing, publicUrl } from "@/lib/storefront";

export const dynamic = "force-dynamic";

/**
 * Airwallex's create-checkout call (Kit 10): stock, shipping and totals for a buyer agent's cart.
 * Trusted only with a fresh HMAC over the raw body. Airwallex takes the payment itself.
 */
export async function POST(req: Request) {
  const raw = await req.text();
  const secret = process.env.AGENTIC_CHECKOUT_SECRET;
  if (!secret || !verifyCheckoutSignature(secret, req.headers.get("x-timestamp"), raw, req.headers.get("x-signature"))) {
    return Response.json({ error: "invalid signature" }, { status: 401 });
  }
  let body: CheckoutRequest;
  try {
    body = JSON.parse(raw);
    if (!Array.isArray(body.line_items) || typeof body.currency !== "string") throw new Error();
  } catch {
    return Response.json({ error: "expected line_items and currency" }, { status: 400 });
  }
  const { response, record } = quoteCheckout(body, listing, publicUrl());
  if (record) checkouts().save(record);
  return Response.json(response);
}
