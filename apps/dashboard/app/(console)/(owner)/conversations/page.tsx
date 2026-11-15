import Link from "next/link";
import { conversationState, conversationTitle, customerName, orderOf, SPEAKER, systemLine } from "@/components/conversation-copy";
import { PageHead } from "@/components/page-head";
import { ago, Badge, EmptyState, tiny } from "@/components/plain";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { money } from "@/lib/format";

export default async function Conversations({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { shop } = await requireOwner();
  const { show } = await searchParams;
  // Newest first, so the chat that just happened is on top. The cards above filter the list.
  const list = deps(shop.id).conversations.list()
    .map((c) => ({ c, last: c.transcript.at(-1), state: conversationState(c) }))
    .sort((a, b) => (b.last?.at ?? b.c.createdAt).localeCompare(a.last?.at ?? a.c.createdAt));

  const count = (label: string) => list.filter((x) => x.state.label === label).length;
  const summary = [
    { key: "waiting", label: "Waiting for you", value: count("Waiting for you"), hint: "The agent needs your yes or no", alert: true },
    { key: "link", label: "Payment link sent", value: count("Payment link sent"), hint: "The customer can pay now" },
    { key: "paid", label: "Paid", value: count("Paid"), hint: "Confirmed by Airwallex" },
    { key: "", label: "All chats", value: list.length, hint: "Every customer so far" },
  ];
  const active = summary.find((s) => s.key && s.key === show);
  const shown = active ? list.filter((x) => x.state.label === active.label) : list;

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Your sales agent"
        title="Conversations"
        sub="Every chat your AI sales agent had with a customer. It answers questions, offers prices inside your rules and sends a payment link. When a customer asks for something it can't decide, the chat waits for your answer. Newest chats first; tap a box to see only those."
      />

      {list.length ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {summary.map((s) => {
              const on = (active?.key ?? "") === s.key;
              return (
                <Link key={s.label} href={s.key ? `/conversations?show=${s.key}` : "/conversations"} aria-current={on ? "true" : undefined}
                  className={`rounded-lg border p-4 transition-colors hover:bg-panel-2 ${on ? "bg-panel-2 ring-1 ring-accent" : "bg-panel"} ${s.alert && s.value ? "border-red-500/50" : "border-border"}`}>
                  <p className="text-2xl font-bold tabular-nums">{s.value}</p>
                  <p className="text-sm font-medium">{s.label}</p>
                  <p className="text-xs text-muted">{s.hint}</p>
                </Link>
              );
            })}
          </div>

          {shown.length === 0 ? <p className="text-sm text-muted">No chats here right now. <Link href="/conversations" className="underline">See all chats</Link>.</p> : null}
          <ul className="space-y-2">
            {shown.map(({ c, last, state }) => {
              const order = orderOf(c);
              const preview = last ? (last.from === "system" ? systemLine(last.text).text : `${SPEAKER[last.from]}: ${last.text}`) : "No messages yet";
              return (
                <li key={c.id}>
                  <Link
                    href={`/conversations/${encodeURIComponent(c.id)}`}
                    className={`group flex flex-col gap-3 rounded-lg border bg-panel p-4 transition-colors hover:bg-panel-2 sm:flex-row sm:items-center sm:justify-between ${state.forOwner ? "border-red-500/50" : "border-border"}`}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge tone={state.tone}>{state.label}</Badge>
                        <span className="text-xs text-muted">{customerName(c)} · {ago(last?.at ?? c.createdAt)}</span>
                      </span>
                      <span className="font-medium break-words">&ldquo;{conversationTitle(c)}&rdquo;</span>
                      <span className="truncate text-sm text-muted">{preview}</span>
                    </span>
                    <span className="flex shrink-0 items-end justify-between gap-6 border-t border-border/60 pt-3 sm:flex-col sm:items-end sm:gap-1 sm:border-0 sm:pt-0">
                      <span className="flex flex-col sm:items-end">
                        <span className="text-xs text-muted">{order ? order.label : "Order"}</span>
                        <span className="font-semibold tabular-nums">{order ? `${money(order.total)} ${order.currency}` : "None yet"}</span>
                      </span>
                      <span className="text-right text-xs text-muted">AI replies cost {tiny(c.aiSpent)}</span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      ) : (
        <EmptyState
          title="No conversations yet"
          action={<a href={`/s/${shop.id}`} target="_blank" rel="noreferrer" className="btn btn-primario btn-chico">Open your shop chat</a>}
        >
          <p>Each time a customer writes to your shop&apos;s chat, the conversation shows up here: what they asked, what the agent answered and whether they paid.</p>
          <p>Try it yourself: open your shop chat and ask for something from your catalog.</p>
        </EmptyState>
      )}
    </section>
  );
}
