import { shopOr404, validConversationId, view } from "@/lib/chat";
import { deps } from "@/lib/deps";

export const runtime = "nodejs";

/** A customer message to the shop's seller agent. */
export async function POST(req: Request, { params }: { params: Promise<{ shop: string }> }) {
  const found = shopOr404((await params).shop);
  if (found.error) return found.error;
  const { id, text } = (await req.json().catch(() => ({}))) as { id?: string; text?: string };
  if (!validConversationId(id) || !text?.trim()) return Response.json({ error: "id and text are required" }, { status: 400 });
  const { seller } = deps(found.shop.id);
  try {
    await seller.handleMessage(id, text.trim().slice(0, 2000));
    return Response.json(view(seller.conversation(id), id));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
