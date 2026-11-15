import { advanceDue, advanceOffer } from "@peaje-asa/treasury-agent";
import { ActionForm } from "@/components/action-form";
import { PageHead } from "@/components/page-head";
import { Badge, EmptyState, Facts, HowItWorks, SectionHead } from "@/components/plain";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { money, usd, when } from "@/lib/format";
import { acceptAdvanceAction } from "../actions";

const pct = (n: number) => `${Math.round(n * 1000) / 10}%`;

export default async function Advance() {
  const { shop } = await requireOwner();
  const { ledger, policy } = deps(shop.id);
  const offer = advanceOffer(ledger, policy);
  const { taken, repaid, outstanding } = ledger.advances();
  const due = advanceDue(ledger);
  const base = Math.max(0, offer.netProfit) * policy.advanceShareOfProfit;

  // The same calculation as the offer, step by step, in plain words.
  const steps = [
    { label: `Profit in the last ${offer.windowDays} days`, value: usd(offer.netProfit), note: `From ${usd(offer.revenue)} of sales, after costs and fees.` },
    { label: `${pct(policy.advanceShareOfProfit)} of that profit`, value: usd(Math.round(base * 100) / 100), note: "The most we lend against what you earned." },
    {
      label: "Lowered for disputes",
      value: offer.givenBack ? `minus ${pct(offer.disputeRate)}` : "No change",
      note: `${offer.givenBack} of your ${offer.orders} orders had to be given back after a customer disputed them.`,
    },
    { label: "Your offer, rounded down to the nearest 10", value: usd(offer.amount), strong: true },
  ];

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Cash for your shop"
        title="Advance"
        sub="Money up front, based on what your shop really sold. You pay it back bit by bit from new sales, automatically, so there are no monthly bills. Every number here comes from your own sales records."
      />

      <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
        <div className="space-y-5 rounded-lg border border-border bg-panel p-5 sm:p-6">
          <div className="space-y-1">
            <p className="text-sm text-muted">You can get today</p>
            <p className="text-4xl font-bold tracking-tight tabular-nums sm:text-5xl">{money(offer.amount)}<span className="ml-2 text-xl font-semibold text-muted">USD</span></p>
            {offer.amount <= 0 ? (
              <p className="pt-1 text-sm text-muted">
                {offer.outstanding > 0
                  ? `You're still paying back an advance (${usd(offer.outstanding)} left). A new offer appears once it's paid off.`
                  : `No offer yet. It grows with your shop's profit from the last ${offer.windowDays} days, so make a few sales and check back.`}
              </p>
            ) : null}
          </div>

          {offer.outstanding <= 0 ? (
            <div className="space-y-2 border-t border-border pt-4">
              <h2 className="text-sm font-semibold">How we got this number</h2>
              <dl className="divide-y divide-border/60 text-sm">
                {steps.map((s, i) => (
                  <div key={s.label} className={`grid grid-cols-[1.5rem_1fr_auto] gap-x-3 py-2.5 ${s.strong ? "font-semibold" : ""}`}>
                    <span aria-hidden className="font-mono text-xs text-muted">{i + 1}</span>
                    <dt>
                      {s.label}
                      {s.note ? <span className="block text-xs font-normal text-muted">{s.note}</span> : null}
                    </dt>
                    <dd className="text-right tabular-nums">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ) : null}

          {offer.amount > 0 ? (
            <div className="space-y-4 border-t border-border pt-4">
              <h2 className="text-sm font-semibold">What it costs you</h2>
              <div className="rounded-md border border-border bg-bg px-4 py-2">
                <Facts
                  rows={[
                    { label: "You get now", value: usd(offer.amount) },
                    { label: `One-time fee (${pct(policy.advanceFee)})`, value: usd(offer.fee) },
                    { label: "You pay back in total", value: usd(offer.repayTotal), strong: true },
                    { label: "How you pay it back", value: `${Math.round(offer.repaymentShare * 100)}% of each new sale` },
                  ]}
                />
              </div>
              <div className="max-w-sm space-y-2">
                <ActionForm action={acceptAdvanceAction} fields={{ amount: offer.amount }} label={`Get ${money(offer.amount)} USD now`} pendingLabel="Sending the money..." wide />
                <p className="text-xs text-muted">The money goes to your Airwallex account. Repayments come out of new sales before your profit is sent to you.</p>
              </div>
            </div>
          ) : null}
        </div>

        <div className="space-y-3">
          <SectionHead title="Your advances" />
          {taken.length ? (
            <div className="space-y-3">
              <ul className="divide-y divide-border/60 rounded-lg border border-border bg-panel text-sm">
                {taken.map((a) => (
                  <li key={a.ref} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">Advance on {when(a.at)}</span>
                      <span className="text-xs text-muted">Fee {usd(a.fee)} · <span className="font-mono">{a.ref}</span></span>
                    </span>
                    <span className="font-semibold tabular-nums">{usd(a.amount)}</span>
                  </li>
                ))}
              </ul>
              <div className="rounded-lg border border-border bg-panel px-4 py-2">
                <Facts
                  rows={[
                    { label: "Paid back so far", value: usd(repaid) },
                    { label: "Still to pay", value: usd(outstanding), strong: true },
                    ...(outstanding > 0 ? [{ label: "Paid at the next end-of-day close", value: <Badge tone={due > 0 ? "good" : "muted"}>{usd(due)}</Badge> }] : []),
                  ]}
                />
              </div>
            </div>
          ) : (
            <EmptyState title="You haven't taken an advance yet">
              <p>When you take one, it shows here with how much you've paid back and how much is left.</p>
              <p>So far: {offer.orders} {offer.orders === 1 ? "order" : "orders"} in the last {offer.windowDays} days, {offer.givenBack} given back after a dispute.</p>
            </EmptyState>
          )}
        </div>
      </div>

      <HowItWorks
        steps={[
          { title: "Your sales set the amount", text: "The offer comes from the profit your shop made, not from a credit score or paperwork." },
          { title: "You take it in one click", text: "The money goes to your Airwallex account right away." },
          { title: "It pays itself back", text: `At the end of each day the treasury agent sets aside ${Math.round(policy.advanceRepaymentShare * 100)}% of new sales until it's repaid.` },
        ]}
      />
    </section>
  );
}
