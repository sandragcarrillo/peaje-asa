import { getShop } from "@/lib/shops";

export const runtime = "nodejs";

/**
 * Asked by widget.js before it draws the button: may this website show the shop's chat? The answer
 * only saves an empty box; the frame-ancestors header on /embed/<shop> is what enforces it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ shop: string }> }) {
  const shop = getShop((await params).shop);
  const origin = req.headers.get("origin");
  const allowed = Boolean(shop && origin && (shop.embedOrigins ?? []).includes(origin));
  return Response.json({ allowed }, { headers: { "access-control-allow-origin": "*", "cache-control": "no-store" } });
}
