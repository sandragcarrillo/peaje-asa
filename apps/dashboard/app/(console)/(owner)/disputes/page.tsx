import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { Empty, PageHead, Status } from "@/components/page-head";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { usd, when } from "@/lib/format";
import { reviewDisputesAction } from "../actions";

const TONE = { open: "alert", escalated: "alert", challenged: "muted", accepted: "muted", won: "accent", lost: "alert" } as const;

export default async function Disputes() {
  const { shop } = await requireOwner();
  const { ledger, treasury, policy } = deps(shop.id);
  const disputes = ledger.disputes().slice().reverse();
  const refunds = treasury.approvals().filter((a) => a.terms.kind === "dispute_refund");

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Treasury agent"
        title="Disputes"
        sub={`Each chargeback is decided by rules, not by the model: defend with the signed order when the evidence is strong, accept when it's cheaper than the ${usd(policy.disputeFee)} fee, ask you when a customer was left unanswered.`}
      />
      <div className="max-w-xs">
        <ActionForm action={reviewDisputesAction} label="Review disputes" pendingLabel="Reviewing..." small />
      </div>
      {disputes.length ? (
        <ul className="space-y-3">
          {disputes.map((d) => {
            const approval = refunds.find((a) => a.terms.counterparty === d.disputeId);
            return (
              <li key={d.disputeId} className="space-y-3 border border-border bg-panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="flex flex-col">
                    <span className="font-mono text-xs">{d.disputeId}</span>
                    <span className="text-sm text-muted">Order {d.orderId ?? "unknown"} · {d.stage} · {when(d.at)}</span>
                  </span>
                  <span className="flex items-center gap-4">
                    <span className="font-mono tabular-nums">{usd(d.amount)}</span>
                    <Status tone={TONE[d.status]}>{d.status}</Status>
                  </span>
                </div>
                {d.note ? <p className="text-sm">{d.note}</p> : null}
                {approval ? (
                  <p className="text-sm text-muted">
                    Refund approval {approval.id}: {approval.status}.{" "}
                    {approval.status === "pending" ? <Link href="/approvals" className="underline underline-offset-4 hover:text-text">Decide it</Link> : null}
                  </p>
                ) : null}
                {d.defense ? (
                  <details className="border border-border bg-bg">
                    <summary className="cursor-pointer p-3 text-sm text-muted hover:text-text">Defense sent to the issuer</summary>
                    <p className="px-3 pb-3 text-sm whitespace-pre-wrap">{d.defense}</p>
                  </details>
                ) : null}
                {d.orderId ? (
                  <a href={`/disputes/${encodeURIComponent(d.disputeId)}/evidence`} className="inline-block font-mono text-xs text-muted underline underline-offset-4 hover:text-text">
                    Evidence PDF (signed order, shipment, chat) ↓
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <Empty>No disputes. When a customer's bank opens a chargeback, Review disputes picks it up.</Empty>
      )}
    </section>
  );
}
