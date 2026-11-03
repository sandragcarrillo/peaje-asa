import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { PageHead, Status } from "@/components/page-head";
import { deps } from "@/lib/deps";
import { money, usd, when } from "@/lib/format";
import { ownerReplyAction, resolveEscalationAction } from "../../actions";

const input = "w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = deps().conversations.get(decodeURIComponent(id));
  if (!c) notFound();
  const e = c.escalation;
  const open = c.status === "escalated" && e && !e.resolution;

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <Link href="/conversations" className="font-mono text-xs text-muted hover:text-text">← Conversations</Link>
        <PageHead eyebrow={`Customer ${c.customerRef}`} title={c.id} sub={`${c.calls} model calls, ${usd(c.aiSpent)} spent. Started ${when(c.createdAt)}.`} />
      </div>

      {e ? (
        <div className={`space-y-4 border bg-panel p-5 ${open ? "border-accent" : "border-border"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm font-semibold">{open ? "The agent is asking you" : "Escalation"}</p>
            {e.resolution ? <Status tone={e.resolution.decision === "approved" ? "accent" : "muted"}>{e.resolution.decision} by {e.resolution.by}</Status> : <Status tone="alert">waiting</Status>}
          </div>
          <p className="text-sm">{e.reason}</p>
          {e.terms ? (
            <dl className="grid grid-cols-2 gap-3 font-mono text-xs sm:grid-cols-4">
              <div><dt className="text-muted">Product</dt><dd>{e.terms.qty} x {e.terms.sku}</dd></div>
              <div><dt className="text-muted">Unit price</dt><dd>{usd(e.terms.unitPrice)}</dd></div>
              <div><dt className="text-muted">Total</dt><dd className="font-bold text-accent">{usd(e.terms.total)}</dd></div>
              <div><dt className="text-muted">AI so far</dt><dd>{money(e.aiSpent)} of {money(e.aiBudget)}</dd></div>
            </dl>
          ) : null}
          {open ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <ActionForm action={resolveEscalationAction} fields={{ id: c.id, decision: "approved" }} label={e.terms ? `Approve and send link for ${money(e.terms.total)}` : "Approve"} small />
              <ActionForm action={resolveEscalationAction} fields={{ id: c.id, decision: "declined" }} label="Decline" small secondary>
                <input name="message" placeholder="Optional note for the agent to pass on" className={input} />
              </ActionForm>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Chat</h2>
        <ol className="space-y-2 border border-border bg-panel p-4">
          {c.transcript.map((l, i) =>
            l.from === "system" ? (
              <li key={i} className="py-1 text-center font-mono text-xs text-muted">{l.text}</li>
            ) : (
              <li key={i} className={`flex ${l.from === "customer" ? "justify-start" : "justify-end"}`}>
                <div className={`max-w-[80%] border px-3 py-2 text-sm whitespace-pre-wrap ${l.from === "customer" ? "border-border bg-bg" : l.from === "owner" ? "border-accent bg-panel-2" : "border-border bg-panel-2"}`}>
                  <p className="mb-1 flex items-center gap-2 font-mono text-[10px] text-muted">
                    <span className={l.from === "owner" ? "font-bold text-accent" : ""}>{l.from === "agent" ? "agent" : l.from}</span>
                    {l.tier ? <span>{l.tier}{l.cost !== undefined ? ` · ${money(l.cost)}` : ""}</span> : null}
                    <span>{when(l.at)}</span>
                  </p>
                  <span className="break-words">{l.text}</span>
                </div>
              </li>
            ),
          )}
        </ol>
        <ActionForm action={ownerReplyAction} fields={{ id: c.id }} label="Reply as the owner" small secondary>
          <textarea name="text" rows={2} placeholder="Write to the customer. The agent sees it too." className={input} />
        </ActionForm>
      </div>
    </section>
  );
}
