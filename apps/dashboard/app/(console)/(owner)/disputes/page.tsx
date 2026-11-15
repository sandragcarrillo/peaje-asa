import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PageHead } from "@/components/page-head";
import { Badge, EmptyState, type Tone } from "@/components/plain";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { usd, when } from "@/lib/format";
import { reviewDisputesAction } from "../actions";

const STATUS: Record<string, { label: string; tone: Tone; next: string }> = {
  open: { label: "New", tone: "alert", next: "Not answered yet. Use Check now to have the agent answer it." },
  escalated: { label: "Waiting for you", tone: "alert", next: "The agent wants you to decide whether to refund." },
  challenged: { label: "Fighting it", tone: "info", next: "The agent sent the bank its proof. Now the bank decides." },
  accepted: { label: "Refunded", tone: "muted", next: "The agent gave the money back to the customer. The reason is below." },
  won: { label: "Won", tone: "good", next: "The bank sided with you. You keep the money." },
  lost: { label: "Lost", tone: "alert", next: "The bank sided with the customer, so the money went back to them." },
};

const STAGE: Record<string, string> = { RFI: "The bank asked for information", CHARGEBACK: "Chargeback: the bank pulled the payment back" };

export default async function Disputes() {
  const { shop } = await requireOwner();
  const { ledger, treasury, policy } = deps(shop.id);
  const disputes = ledger.disputes().slice().reverse();
  const refunds = treasury.approvals().filter((a) => a.terms.kind === "dispute_refund");
  const fee = usd(policy.disputeFee);
  const limit = usd(policy.approvalThreshold);

  const rules = [
    { title: "Fight it", text: "When the proof is strong (a signed order, a delivery, a clear chat), the agent sends it to the bank." },
    { title: "Give the money back", text: `When the amount is smaller than the ${fee} it costs to fight, or the proof is weak and the amount is small, it refunds and moves on.` },
    { title: "Ask you", text: `When a customer was left without an answer, or the proof is weak and the amount is above ${limit}, it asks you on Approvals.` },
  ];

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Your treasury agent"
        title="Disputes"
        sub="A dispute, also called a chargeback, is when a customer asks their bank to take back a card payment. Your treasury agent answers each one before the deadline, using fixed rules instead of guesses."
      />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-muted">What the agent does with each dispute</h2>
        <ul className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
          {rules.map((r) => (
            <li key={r.title} className="space-y-1 rounded-lg border border-border bg-panel p-4">
              <p className="text-sm font-semibold">{r.title}</p>
              <p className="text-sm text-muted">{r.text}</p>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <p className="font-semibold">Check for new disputes</p>
          <p className="text-sm text-muted">Asks Airwallex for disputes that still need a reply and answers each one now.</p>
        </div>
        <div className="sm:w-64">
          <ActionForm action={reviewDisputesAction} label="Check now" pendingLabel="Checking..." small wide />
        </div>
      </div>

      {disputes.length ? (
        <ul className="space-y-3">
          {disputes.map((d) => {
            const s = STATUS[d.status] ?? { label: d.status, tone: "muted" as const, next: "" };
            const approval = refunds.find((a) => a.terms.counterparty === d.disputeId);
            return (
              <li key={`${d.disputeId}-${d.at}`} className={`space-y-4 rounded-lg border bg-panel p-5 ${s.tone === "alert" ? "border-red-500/50" : "border-border"}`}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1.5">
                    <Badge tone={s.tone}>{s.label}</Badge>
                    <p className="font-semibold">{STAGE[d.stage] ?? d.stage}</p>
                    <p className="text-sm text-muted">{s.next}</p>
                  </div>
                  <div className="text-left sm:text-right">
                    <p className="text-xs text-muted">Amount in dispute</p>
                    <p className="text-2xl font-bold tabular-nums">{usd(d.amount)}</p>
                    <p className="text-xs text-muted">{when(d.at)}</p>
                  </div>
                </div>
                {d.note ? (
                  <p className="rounded-md border border-border bg-bg px-4 py-3 text-sm">
                    <span className="mb-1 block text-xs text-muted">{d.status === "open" ? "Reason the customer's bank gave" : "Why"}</span>
                    {d.note}
                  </p>
                ) : null}
                {approval ? (
                  <p className="text-sm text-muted">
                    {approval.status === "pending" ? (
                      <>The refund is waiting for your decision. <Link href="/approvals" className="font-medium text-text underline underline-offset-4">Decide on Approvals</Link></>
                    ) : approval.status === "rejected" ? "You chose to fight it." : "You approved the refund."}
                  </p>
                ) : null}
                <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                  {d.defense ? (
                    <details className="w-full rounded-md border border-border bg-bg">
                      <summary className="cursor-pointer p-3 text-sm hover:text-text">Read the reply the agent sent to the bank</summary>
                      <p className="px-3 pb-3 text-sm whitespace-pre-wrap text-muted">{d.defense}</p>
                    </details>
                  ) : null}
                  {d.orderId ? (
                    <a href={`/disputes/${encodeURIComponent(d.disputeId)}/evidence`} className="text-sm underline underline-offset-4 hover:text-text">
                      Download the proof (PDF with the signed order, delivery and chat)
                    </a>
                  ) : null}
                  {d.orderId ? <span className="font-mono text-[11px] break-all text-faint">Order {d.orderId}</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <EmptyState title="No disputes, which is good news">
          <p>If a customer ever asks their bank to reverse a payment, it shows up here with what the agent did about it: fought it, refunded it, or asked you.</p>
        </EmptyState>
      )}
    </section>
  );
}
