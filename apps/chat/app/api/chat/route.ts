import { agent, view } from "@/lib/agent";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { id, text } = (await req.json()) as { id?: string; text?: string };
  if (!id || !/^[a-z0-9-]{4,40}$/i.test(id) || !text?.trim()) return Response.json({ error: "id and text are required" }, { status: 400 });
  try {
    await agent().handleMessage(id, text.trim().slice(0, 2000));
    return Response.json(view(agent().conversation(id), id));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
