import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { conversationState, conversationTitle, customerName, escalationWhy, orderOf, SPEAKER, systemLine } from "@/components/conversation-copy";
import { PageHead } from "@/components/page-head";
import { Badge, Facts, Stat, TIER, tiny } from "@/components/plain";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { usd, when } from "@/lib/format";
import { ownerReplyAction, resolveEscalationAction } from "../../actions";

const input = "w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm";

export default async function ConversationPage({ params }: { params: Promise<{ id: string }> }) {
  const { shop } = await requireOwner();
  const { id } = await params;
  const { conversations, policy } = deps(shop.id);
  const c = conversations.get(decodeURIComponent(id));
  if (!c) notFound();
  const e = c.escalation;
  const open = c.status === "escalated" && e && !e.resolution;
  const state = conversationState(c);
  const order = orderOf(c);
  const product = e?.terms ? policy.catalog.find((p) => p.sku === e.terms!.sku)?.name ?? e.terms.sku : undefined;
  const replies = c.transcript.filter((l) => l.from === "agent").length;

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <Link href="/conversations" className="text-sm text-muted hover:text-text">← All conversations</Link>
        <PageHead eyebrow={`${customerName(c)} · started ${when(c.createdAt)}`} title={`“${conversationTitle(c, 70)}”`} />
        <Badge tone={state.tone}>{state.label}</Badge>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Order"
          value={order ? usd(order.total) : "None yet"}
          hint={order ? `${order.label}${order.discounted ? `. Discount: ${order.discounted}` : ""}` : "The agent hasn't offered a price yet."}
        />
        <Stat label="Messages" value={c.transcript.filter((l) => l.from !== "system").length} hint={`${replies} from your agent`} />
        <Stat label="Cost of the AI replies" value={tiny(c.aiSpent)} hint="Your agent paid this from its own wallet on Alta, inside the limits you set." />
      </div>

      {e ? (
        <div className={`space-y-4 rounded-lg border bg-panel p-5 ${open ? "border-red-500/60" : "border-border"}`}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-semibold">{open ? "Your agent needs your decision" : "You were asked to decide"}</h2>
            {e.resolution ? (
              <Badge tone={e.resolution.decision === "approved" ? "good" : "muted"}>
                {e.resolution.decision === "approved" ? "You approved" : "You said no"} · {when(e.resolution.at)}
              </Badge>
            ) : <Badge tone="alert">Waiting for you</Badge>}
          </div>
          <p className="text-sm text-muted">{escalationWhy(e.kind)}</p>
          <div className="rounded-md border border-border bg-bg px-4 py-3 text-sm">
            <p className="text-xs text-muted">Your agent's note</p>
            <p className="mt-1">{e.reason}</p>
          </div>
          {e.terms ? (
            <div className="rounded-md border border-border bg-bg px-4 py-2">
              <Facts
                rows={[
                  { label: "What the customer wants", value: `${e.terms.qty} x ${product}` },
                  { label: "Price per item", value: usd(e.terms.unitPrice) },
                  { label: "Total the customer would pay", value: usd(e.terms.total), strong: true },
                  { label: "Spent on AI replies so far", value: `${tiny(e.aiSpent)} of ${tiny(e.aiBudget)} allowed for this chat` },
                ]}
              />
            </div>
          ) : null}
          {open ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <ActionForm action={resolveEscalationAction} fields={{ id: c.id, decision: "approved" }} label={e.terms ? `Approve and send a payment link for ${usd(e.terms.total)}` : "Approve, hand it back to the agent"} small wide />
                <p className="text-xs text-muted">{e.terms ? "The customer gets a payment link for exactly this amount, nothing else." : "The agent picks the chat up again."}</p>
              </div>
              <div className="space-y-2">
                <ActionForm action={resolveEscalationAction} fields={{ id: c.id, decision: "declined" }} label="Say no" small secondary wide>
                  <label className="block text-sm">
                    <span className="mb-1.5 block text-muted">Note for the customer (optional)</span>
                    <input name="message" placeholder="Sorry, that's our best price." className={input} />
                  </label>
                </ActionForm>
                <p className="text-xs text-muted">The agent tells the customer and keeps helping them buy at your normal prices.</p>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="font-semibold">The chat</h2>
        <ol className="space-y-3 rounded-lg border border-border bg-panel p-3 sm:p-5">
          {c.transcript.length ? c.transcript.map((l, i) => {
            if (l.from === "system") {
              const s = systemLine(l.text);
              return (
                <li key={i} className="flex justify-center py-1">
                  <span className={`max-w-[95%] rounded-lg border px-3 py-2 text-center text-xs sm:max-w-[80%] ${s.tone === "alert" ? "border-red-500/40 bg-red-500/10 text-red-200" : s.tone === "good" ? "border-accent/40 bg-accent/10 text-text" : "border-border bg-bg text-muted"}`}>
                    {s.text}
                    {s.link ? <> <a href={s.link} target="_blank" rel="noreferrer" className="underline underline-offset-4 hover:text-text">Open the link</a></> : null}
                    <span className="mt-0.5 block text-[11px] text-faint">{when(l.at)}</span>
                  </span>
                </li>
              );
            }
            const mine = l.from !== "customer";
            return (
              <li key={i} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[90%] rounded-lg border px-3.5 py-2.5 text-sm sm:max-w-[75%] ${l.from === "customer" ? "border-border bg-bg" : l.from === "owner" ? "border-accent bg-panel-2" : "border-border bg-panel-2"}`}>
                  <p className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                    <span className={`font-semibold ${l.from === "owner" ? "text-accent" : "text-text"}`}>{SPEAKER[l.from]}</span>
                    <span>{when(l.at)}</span>
                  </p>
                  <p className="break-words whitespace-pre-wrap">{l.text}</p>
                  {l.from === "agent" && l.tier ? (
                    <p className="mt-1.5 text-[11px] text-faint">Answered by the {TIER[l.tier]?.toLowerCase() ?? l.tier}{l.cost !== undefined ? ` · cost ${tiny(l.cost)}` : ""}</p>
                  ) : null}
                </div>
              </li>
            );
          }) : <li className="py-6 text-center text-sm text-muted">No messages yet.</li>}
        </ol>
        <p className="text-xs text-muted">For each reply the agent uses the best AI the sale can afford: a bigger sale can pay for the advanced one, a small one gets a cheaper one.</p>
      </div>

      <div className="space-y-3 rounded-lg border border-border bg-panel p-5">
        <div className="space-y-1">
          <h2 className="font-semibold">Write to the customer yourself</h2>
          <p className="text-sm text-muted">Your message shows up in the customer&apos;s chat as coming from you. The agent reads it too, so it won&apos;t contradict you.</p>
        </div>
        <ActionForm action={ownerReplyAction} fields={{ id: c.id }} label="Send to the customer" pendingLabel="Sending..." small secondary>
          <textarea name="text" rows={3} placeholder="Hi! I'm the owner. Happy to help with this." className={input} />
        </ActionForm>
      </div>
    </section>
  );
}
