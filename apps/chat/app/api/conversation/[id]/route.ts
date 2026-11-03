import { agent, view } from "@/lib/agent";

export const runtime = "nodejs";

/** Returns the conversation, checking Airwallex first if a payment link is waiting. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return Response.json(view(await agent().checkPayment(id), id));
  } catch (e) {
    console.error(e);
    return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
