import { allow, clientIp, newConversationId, shopOr404, tooMany, validConversationId, view } from "@/lib/chat";
import { deps } from "@/lib/deps";

export const runtime = "nodejs";

/**
 * A customer message to the shop's seller agent. Without an id it starts a conversation and the
 * response carries the id the server made for it; with one, the conversation has to exist.
 */
export async function POST(req: Request, { params }: { params: Promise<{ shop: string }> }) {
  const found = shopOr404((await params).shop);
  if (found.error) return found.error;
  const { id: given, text } = (await req.json().catch(() => ({}))) as { id?: string; text?: string };
  if (!text?.trim()) return Response.json({ error: "text is required" }, { status: 400 });
  const { seller } = deps(found.shop.id);
  if (given !== undefined && (!validConversationId(given) || !seller.conversation(given))) {
    return Response.json({ error: "no such conversation" }, { status: 404 });
  }

  const ip = clientIp(req);
  if (!allow(`msg:${ip}`, 20, 60_000)) return tooMany();
  if (!given && !allow(`new:${ip}`, 10, 3_600_000)) return tooMany();

  const id = given ?? newConversationId();
  try {
    await seller.handleMessage(id, text.trim().slice(0, 2000));
    return Response.json(view(seller.conversation(id)!, id));
  } catch (e) {
    console.error(e);
    return Response.json({ error: "The shop could not answer just now. Try again in a moment." }, { status: 502 });
  }
}
