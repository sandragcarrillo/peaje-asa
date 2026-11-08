import { evidencePdf } from "@peaje-asa/treasury-agent";
import { currentOwner } from "@/lib/auth";
import { deps } from "@/lib/deps";

export const runtime = "nodejs";

/** The evidence PDF for a dispute, rebuilt from the signed order, the shipment and the chat. Owner only. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const owner = await currentOwner();
  if (!owner) return new Response("Sign in first.", { status: 401 });
  const { id } = await params;
  const { ledger, chatFor, policy, shop } = deps(owner.shop.id);
  const d = ledger.disputes().find((x) => x.disputeId === id);
  const order = d?.orderId ? ledger.order(d.orderId) : undefined;
  if (!d || !order) return new Response("No order for this dispute.", { status: 404 });
  const statement = d.defense ?? `No defense was sent for this dispute (${d.status}). ${d.note ?? ""}`.trim();
  const pdf = evidencePdf(order, chatFor(order), ledger, statement, shop.name, policy.catalog);
  return new Response(new Uint8Array(pdf), {
    headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="evidence-${d.disputeId}.pdf"`, "cache-control": "no-store" },
  });
}
