import { shopOr404, validConversationId, view } from "@/lib/chat";
import { deps } from "@/lib/deps";

export const runtime = "nodejs";

/** The conversation, after asking Airwallex whether its payment link was paid. */
export async function GET(_req: Request, { params }: { params: Promise<{ shop: string; id: string }> }) {
  const { shop, id } = await params;
  const found = shopOr404(shop);
  if (found.error) return found.error;
  if (!validConversationId(id)) return Response.json({ error: "bad conversation id" }, { status: 400 });
  try {
    return Response.json(view(await deps(found.shop.id).seller.checkPayment(id), id));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
