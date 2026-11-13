import { shopOr404, validConversationId, view } from "@/lib/chat";
import { deps } from "@/lib/deps";

export const runtime = "nodejs";

/** The conversation, after asking Airwallex whether its payment link was paid. */
export async function GET(_req: Request, { params }: { params: Promise<{ shop: string; id: string }> }) {
  const { shop, id } = await params;
  const found = shopOr404(shop);
  if (found.error) return found.error;
  const notFound = () => Response.json({ error: "no such conversation" }, { status: 404 });
  if (!validConversationId(id)) return notFound();
  try {
    const c = await deps(found.shop.id).seller.checkPayment(id);
    return c ? Response.json(view(c, id)) : notFound();
  } catch (e) {
    console.error(e);
    return Response.json({ error: "Could not load the conversation just now." }, { status: 502 });
  }
}
