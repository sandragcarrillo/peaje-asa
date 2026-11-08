import { ActionForm } from "@/components/action-form";
import { Empty, PageHead, Status } from "@/components/page-head";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { usd, when } from "@/lib/format";
import { decideApprovalAction } from "../actions";

const KIND = { supplier: "Inventory payment", advance_repayment: "Advance repayment", owner_payout: "Profit to you", dispute_refund: "Dispute refund" } as const;

export default async function Approvals() {
  const { shop } = await requireOwner();
  const { treasury, policy } = deps(shop.id);
  const all = treasury.approvals();
  const pending = all.filter((a) => a.status === "pending");
  const done = all.filter((a) => a.status !== "pending").reverse();

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Treasury agent"
        title="Approvals"
        sub={`Above ${usd(policy.approvalThreshold)} nothing moves without you. Each approval is bound to the exact amount, currency, payee and reference, and works once.`}
      />
      {pending.length ? (
        <ul className="space-y-3">
          {pending.map((a) => (
            <li key={a.id} className="space-y-4 border border-accent bg-panel p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <p className="text-sm font-semibold">{KIND[a.terms.kind]}</p>
                <p className="text-2xl font-bold tabular-nums">{usd(a.terms.amount)}</p>
              </div>
              <p className="text-sm text-muted">{a.reason}</p>
              <dl className="grid gap-2 font-mono text-xs sm:grid-cols-3">
                <div><dt className="text-muted">{a.terms.kind === "dispute_refund" ? "Dispute" : "Payee"}</dt><dd className="break-all">{a.terms.counterparty}</dd></div>
                <div><dt className="text-muted">Reference</dt><dd>{a.terms.reference}</dd></div>
                <div><dt className="text-muted">Asked</dt><dd>{when(a.createdAt)} · {a.id}</dd></div>
              </dl>
              <div className="flex flex-wrap gap-3">
                <ActionForm action={decideApprovalAction} fields={{ id: a.id, decision: "approved" }} label="Approve" pendingLabel="Approving and paying..." small />
                <ActionForm action={decideApprovalAction} fields={{ id: a.id, decision: "rejected" }} label="Reject" small secondary />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <Empty>Nothing waiting for you. The close asks here when a payment is above the threshold.</Empty>
      )}

      {done.length ? (
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">History</h2>
          <ul className="divide-y divide-border/60 border border-border bg-panel text-sm">
            {done.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex flex-col">
                  <span>{KIND[a.terms.kind]} · {a.terms.reference}</span>
                  <span className="font-mono text-xs text-muted">{a.id} · {a.decidedBy ?? ""} {a.decidedAt ? when(a.decidedAt) : ""}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="font-mono tabular-nums">{usd(a.terms.amount)}</span>
                  <Status tone={a.status === "rejected" ? "alert" : "accent"}>{a.status}</Status>
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
