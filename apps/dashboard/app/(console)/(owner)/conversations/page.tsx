import Link from "next/link";
import { Empty, PageHead, Status } from "@/components/page-head";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { money, when } from "@/lib/format";

const STATUS = { open: "talking", awaiting_payment: "link sent", paid: "paid", escalated: "needs you" } as const;

export default async function Conversations() {
  const { shop } = await requireOwner();
  const list = deps(shop.id).conversations.list()
    .map((c) => ({ c, last: c.transcript.at(-1), forOwner: c.status === "escalated" && !c.escalation?.resolution }))
    .sort((a, b) => Number(b.forOwner) - Number(a.forOwner) || (b.last?.at ?? b.c.createdAt).localeCompare(a.last?.at ?? a.c.createdAt));

  return (
    <section className="space-y-8">
      <PageHead eyebrow="Seller agent" title="Conversations" sub="Every chat the agent handled. The ones it couldn't close inside your rules wait for you at the top." />
      {list.length ? (
        <ul className="divide-y divide-border/60 border border-border bg-panel text-sm">
          {list.map(({ c, last, forOwner }) => {
            const quote = c.quotes.find((q) => q.id === c.activeQuoteId);
            return (
              <li key={c.id}>
                <Link href={`/conversations/${encodeURIComponent(c.id)}`} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 hover:bg-panel-2">
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="flex items-center gap-3">
                      <span className="font-mono text-xs">{c.id}</span>
                      <Status tone={forOwner ? "alert" : c.status === "paid" ? "accent" : "muted"}>{STATUS[c.status]}</Status>
                    </span>
                    <span className="truncate text-muted">{last ? `${last.from}: ${last.text}` : "No messages yet"}</span>
                  </span>
                  <span className="flex shrink-0 flex-col items-end gap-0.5 font-mono text-xs text-muted">
                    <span className="text-text tabular-nums">{quote ? money(quote.total) : "-"}</span>
                    <span>AI {money(c.aiSpent)} · {when(last?.at ?? c.createdAt)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>No conversations yet. Open the shop chat and ask for a coffee, or run npm run demo.</Empty>
      )}
    </section>
  );
}
