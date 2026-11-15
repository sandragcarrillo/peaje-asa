import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PageHead } from "@/components/page-head";
import { Badge, EmptyState, Facts, HowItWorks, SectionHead } from "@/components/plain";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { usd, when } from "@/lib/format";
import { decideApprovalAction } from "../actions";

const KIND = {
  supplier: { title: "Pay a supplier bill", what: "A bill you added in Suppliers is due today. The agent pays bills before your profit." },
  advance_repayment: { title: "Repay your advance", what: "A share of your new sales goes back to the advance you took, before profit goes to you." },
  owner_payout: { title: "Send your profit to you", what: "What's left after supplier bills, fees and the reserve the agent always keeps." },
  dispute_refund: { title: "Refund a customer", what: "A customer asked their bank for their money back. Approving gives it back; saying no means the agent fights it with the signed order." },
} as const;

const DONE = { approved: { label: "Approved", tone: "good" }, used: { label: "Approved and done", tone: "good" }, rejected: { label: "You said no", tone: "muted" }, pending: { label: "Waiting for you", tone: "alert" } } as const;

export default async function Approvals() {
  const { shop } = await requireOwner();
  const { treasury, policy } = deps(shop.id);
  const all = treasury.approvals();
  const pending = all.filter((a) => a.status === "pending");
  const done = all.filter((a) => a.status !== "pending").reverse();
  const limit = usd(policy.approvalThreshold);
  const billOf = (reference: string) => (shop.bills ?? []).find((b) => `Bill ${b.id}` === reference);

  const payee = (kind: keyof typeof KIND, counterparty: string, reference = "") =>
    kind === "supplier" ? billOf(reference)?.supplier ?? shop.payTo?.supplier.accountName ?? counterparty
    : kind === "owner_payout" ? shop.payTo?.owner.accountName ?? "You"
    : kind === "advance_repayment" ? "Peaje ASA, to repay your advance"
    : "The customer, through their bank";

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Your treasury agent"
        title="Approvals"
        sub={`Your treasury agent pays your supplier bills, repays advances and sends you your profit on its own. Anything above ${limit} waits here for your yes first.`}
      />

      {pending.length ? (
        <div className="space-y-3">
          <SectionHead title={`${pending.length} ${pending.length === 1 ? "payment is" : "payments are"} waiting for you`} sub="Each approval covers this exact amount and recipient, one time. If anything changes, the agent asks again." />
          <ul className="space-y-3">
            {pending.map((a) => {
              const k = KIND[a.terms.kind];
              return (
                <li key={a.id} className="space-y-4 rounded-lg border border-red-500/50 bg-panel p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-1">
                      <Badge tone="alert">Waiting for you</Badge>
                      <h3 className="pt-1 text-lg font-semibold">{k.title}</h3>
                      <p className="max-w-xl text-sm text-muted">{a.terms.kind === "supplier" && billOf(a.terms.reference) ? `${billOf(a.terms.reference)!.note ?? "Supplier bill"}, due ${billOf(a.terms.reference)!.dueDate}. From your Suppliers list; the agent pays bills before your profit.` : k.what}</p>
                    </div>
                    <div className="text-left sm:text-right">
                      <p className="text-xs text-muted">Amount</p>
                      <p className="text-3xl font-bold tabular-nums">{usd(a.terms.amount)}</p>
                    </div>
                  </div>
                  <div className="rounded-md border border-border bg-bg px-4 py-2">
                    <Facts
                      rows={[
                        { label: "Goes to", value: payee(a.terms.kind, a.terms.counterparty, a.terms.reference) },
                        { label: "Why it's asking", value: <>You approve anything above {limit} (<Link href="/catalog" className="underline">change it</Link>)</> },
                        { label: "Payment note", value: <span className="font-mono text-xs break-all">{a.terms.reference}</span> },
                        { label: "Asked", value: when(a.createdAt) },
                      ]}
                    />
                  </div>
                  {a.terms.kind === "dispute_refund" ? (
                    <p className="text-sm text-muted">See the details on <Link href="/disputes" className="underline underline-offset-4 hover:text-text">Disputes</Link>.</p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <ActionForm action={decideApprovalAction} fields={{ id: a.id, decision: "approved" }} label={a.terms.kind === "dispute_refund" ? "Approve the refund" : `Approve and pay ${usd(a.terms.amount)}`} pendingLabel="Approving and paying..." small wide />
                      <p className="text-xs text-muted">{a.terms.kind === "dispute_refund" ? "The customer gets the money back." : "The money leaves your Airwallex account right away."}</p>
                    </div>
                    <div className="space-y-1.5">
                      <ActionForm action={decideApprovalAction} fields={{ id: a.id, decision: "rejected" }} label={a.terms.kind === "dispute_refund" ? "No, fight it" : "Not now"} small secondary wide />
                      <p className="text-xs text-muted">{a.terms.kind === "dispute_refund" ? "The agent sends the bank the signed order as proof." : "Nothing is paid. The agent asks again the next time it closes the day."}</p>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : (
        <EmptyState title="Nothing waiting for you">
          <p>At the end of the day your treasury agent pays what&apos;s due: the supplier bills that are due, any advance and your profit. When one of those payments, or a customer refund, is above {limit}, it stops and shows it here for you to approve.</p>
          <p>You can run the end of the day yourself from <Link href="/" className="underline underline-offset-4 hover:text-text">Overview</Link> with Run close.</p>
        </EmptyState>
      )}

      <HowItWorks
        title="How payments work"
        steps={[
          { title: "Sales come in", text: "Customers pay by card on Airwallex, or AI buyer agents pay on Alta." },
          { title: "The agent closes the day", text: "It pays the supplier bills that are due, then any advance, then sends you the profit. It always keeps a reserve." },
          { title: `Above ${limit}, you decide`, text: "Bigger payments wait here. Your yes covers that one exact payment." },
        ]}
      />

      {done.length ? (
        <div className="space-y-3">
          <SectionHead title="Already decided" />
          <ul className="divide-y divide-border/60 rounded-lg border border-border bg-panel text-sm">
            {done.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium">{KIND[a.terms.kind].title}</span>
                  <span className="text-xs text-muted">{a.decidedAt ? `Decided ${when(a.decidedAt)}` : `Asked ${when(a.createdAt)}`} · to {payee(a.terms.kind, a.terms.counterparty, a.terms.reference)}</span>
                </span>
                <span className="flex items-center gap-3">
                  <span className="font-semibold tabular-nums">{usd(a.terms.amount)}</span>
                  <Badge tone={DONE[a.status].tone}>{DONE[a.status].label}</Badge>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
