import { advanceDue, advanceOffer } from "@peaje-asa/treasury-agent";
import { ActionForm } from "@/components/action-form";
import { PageHead, Status } from "@/components/page-head";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { money, usd, when } from "@/lib/format";
import { acceptAdvanceAction } from "../actions";

export default async function Advance() {
  const { shop } = await requireOwner();
  const { ledger, policy } = deps(shop.id);
  const offer = advanceOffer(ledger, policy);
  const { taken, repaid, outstanding } = ledger.advances();
  const due = advanceDue(ledger);

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Agent-based credit"
        title="Advance"
        sub="Sized from what the agent itself sold and kept, and repaid from new sales by the close. Every number below comes from the books."
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5 border border-border bg-panel p-6">
          <div>
            <p className="text-sm text-muted">Your offer today</p>
            <p className="text-5xl font-bold tracking-tight tabular-nums">{money(offer.amount)}<span className="ml-2 text-xl font-semibold text-muted">USD</span></p>
          </div>
          <ol className="space-y-2.5 border-t border-border pt-4 text-sm">
            {offer.lines.map((l, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
                <span>{l}</span>
              </li>
            ))}
          </ol>
          {offer.amount > 0 ? (
            <div className="space-y-2 border-t border-border pt-4">
              <p className="text-sm text-muted">You get {usd(offer.amount)} now and repay {usd(offer.repayTotal)}, {Math.round(offer.repaymentShare * 100)}% of each new sale, before profit is paid to you.</p>
              <div className="max-w-sm">
                <ActionForm action={acceptAdvanceAction} fields={{ amount: offer.amount }} label={`Accept ${money(offer.amount)} USD`} pendingLabel="Funding..." />
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Advances taken</h2>
          {taken.length ? (
            <ul className="divide-y divide-border/60 border border-border bg-panel text-sm">
              {taken.map((a) => (
                <li key={a.ref} className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="flex flex-col">
                    <span className="font-mono text-xs">{a.ref}</span>
                    <span className="text-muted">{when(a.at)} · fee {money(a.fee)}</span>
                  </span>
                  <span className="font-mono tabular-nums">{money(a.amount)}</span>
                </li>
              ))}
              <li className="flex items-center justify-between gap-3 px-4 py-3">
                <span className="text-muted">Repaid · still owed</span>
                <span className="font-mono tabular-nums">{money(repaid)} · {money(outstanding)}</span>
              </li>
              {outstanding > 0 ? (
                <li className="flex items-center justify-between gap-3 px-4 py-3">
                  <span className="text-muted">Due at the next close</span>
                  <Status tone={due > 0 ? "accent" : "muted"}>{money(due)}</Status>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="border border-dashed border-border p-5 text-sm text-muted">None yet. {offer.orders} orders in the last {offer.windowDays} days, {offer.givenBack} given back after a dispute.</p>
          )}
        </div>
      </div>
    </section>
  );
}
