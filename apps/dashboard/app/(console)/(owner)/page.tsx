import Link from "next/link";
import { ActionForm } from "@/components/action-form";
import { PageHead, Status } from "@/components/page-head";
import { SetupSteps } from "@/components/setup-steps";
import { aiSpendByTier, deps, metalFloat } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { money, usd, when } from "@/lib/format";
import { setupOf } from "@/lib/shops";
import { reviewDisputesAction, runCloseAction, sweepFloatAction } from "./actions";

const KIND = { supplier: "Supplier bill", advance_repayment: "Advance repayment", owner_payout: "Profit to owner" } as const;

export default async function Overview() {
  const { shop } = await requireOwner();
  const setup = setupOf(shop);
  // Until buyers can chat with the shop, the steps to get there are the whole page.
  if (!setup.canSell) {
    return (
      <section className="max-w-3xl space-y-8">
        <PageHead eyebrow={`${shop.name} · USD`} title="Welcome" sub="Your shop sells through a chat: an agent answers buyers, quotes within your rules and sends a payment link. A few steps and it's open." />
        <SetupSteps shop={shop} />
      </section>
    );
  }
  const { ledger, treasury, policy } = deps(shop.id);
  const pnl = ledger.pnl();
  const cash = ledger.cash();
  const float = metalFloat(shop.id);
  const tiers = aiSpendByTier(shop.id);
  const maxTier = Math.max(0.01, ...Object.values(tiers).map((t) => t.amount));
  const pending = treasury.approvals("pending");
  const payouts = treasury.payouts().slice(-6).reverse();
  const advances = ledger.advances();
  const settlements = treasury.settlements();
  const owedByPlatform = settlements.filter((x) => x.kind === "sale" && x.status !== "done").length;

  const stats = [
    { valor: money(cash), texto: `Cash per the books (your Airwallex account once sales settle). The close never goes below the ${money(policy.reserveFloor)} reserve.` },
    { valor: money(pnl.netProfit), texto: `Net profit after the cost of the products sold, refunds, the platform fee, dispute fees, model calls and financing.` },
    { valor: money(pnl.paidToOwner), texto: "Already paid out to you." },
    { valor: `${money(float)}`, texto: `USDZ on Alta for model calls. Above ${policy.aiFloatTarget}, it's swept back to Airwallex.` },
  ];
  const rows: [string, number, boolean?][] = [
    ["Sales", pnl.revenue],
    ["Cost of the products sold", -pnl.cogs],
    ["Gross profit", pnl.grossProfit, true],
    ["Platform fee (10%, card fees included)", -pnl.platformFees],
    ["Model calls (paid from Alta)", -pnl.aiCosts],
    ["Refunds", -pnl.refunds],
    ["Dispute fees", -pnl.disputeFees],
    ["Advance fees", -pnl.financingCosts],
    ["Net profit", pnl.netProfit, true],
  ];

  return (
    <section className="space-y-8">
      <PageHead eyebrow={`${shop.name} · USD`} title="Overview" sub="What the seller agent sold, what the treasury agent kept and paid, and what's waiting for you." />

      {pending.length ? (
        <div className="flex flex-col justify-between gap-4 border border-accent bg-panel p-5 sm:flex-row sm:items-center">
          <div className="space-y-1.5">
            <p className="text-sm font-semibold">{pending.length} {pending.length === 1 ? "payment needs" : "payments need"} your approval</p>
            <p className="text-sm text-muted">Above {usd(policy.approvalThreshold)} the treasury asks before moving money. Each approval covers those exact terms, once.</p>
          </div>
          <Link href="/approvals" className="btn btn-primario btn-chico shrink-0 self-start sm:self-center">Review approvals</Link>
        </div>
      ) : null}

      {setup.account && shop.payTo ? (
        <div className="flex flex-col gap-1.5 border border-border bg-panel p-5 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>Airwallex account <span className="font-mono text-xs">{shop.airwallexAccountId}</span>{owedByPlatform ? <span className="text-muted"> · {owedByPlatform} sales move there at the next close</span> : null}</span>
          <span className="text-muted">Supplier bills to {shop.payTo.supplier.accountName} · profit to {shop.payTo.owner.accountName}</span>
        </div>
      ) : (
        <SetupSteps shop={shop} />
      )}

      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        {stats.map((s) => (
          <div key={s.texto} className="border border-border bg-panel p-5">
            <p className="text-2xl font-bold tabular-nums">{s.valor}</p>
            <p className="mt-1 text-sm text-muted">{s.texto}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 [grid-template-columns:repeat(auto-fit,minmax(18rem,1fr))]">
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Profit and loss</h2>
          <table className="w-full border border-border bg-panel text-sm">
            <tbody className="divide-y divide-border/60">
              {rows.map(([label, value, strong]) => (
                <tr key={label} className={strong ? "font-semibold" : ""}>
                  <td className="px-4 py-2.5">{label}</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{money(value)}</td>
                </tr>
              ))}
              <tr className="text-muted">
                <td className="px-4 py-2.5">Paid to suppliers · paid to you</td>
                <td className="px-4 py-2.5 text-right font-mono tabular-nums">{money(pnl.paidToSuppliers)} · {money(pnl.paidToOwner)}</td>
              </tr>
              {advances.outstanding > 0 ? (
                <tr className="text-muted">
                  <td className="px-4 py-2.5">Advance still owed</td>
                  <td className="px-4 py-2.5 text-right font-mono tabular-nums">{money(advances.outstanding)}</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <div className="space-y-3">
          <h2 className="text-sm font-semibold">Model spend by tier</h2>
          <ul className="space-y-3 border border-border bg-panel p-5">
            {Object.entries(tiers).map(([tier, t]) => (
              <li key={tier} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span className="capitalize">{tier}</span>
                  <span className="font-mono text-xs text-muted">{t.calls} calls · {money(t.amount)}</span>
                </div>
                <div className="h-1.5 w-full bg-border">
                  <div className="h-full bg-accent" style={{ width: `${Math.round((t.amount / maxTier) * 100)}%` }} />
                </div>
              </li>
            ))}
            <li className="border-t border-border pt-3 text-xs text-muted">
              Each reply is paid to the platform from your agents' Alta wallet, capped per conversation at {Math.round(policy.maxAiSpendShare * 100)}% of the deal.
            </li>
          </ul>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Treasury</h2>
        <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(14rem,1fr))]">
          <div className="flex flex-col gap-3 border border-border bg-panel p-5">
            <h3 className="font-semibold">Close the day</h3>
            <p className="flex-1 text-sm text-muted">Pays the supplier bills that are due, then the advance, then your profit. Never goes below the reserve and asks you above the threshold.</p>
            <ActionForm action={runCloseAction} label="Run close" pendingLabel="Closing..." small />
          </div>
          <div className="flex flex-col gap-3 border border-border bg-panel p-5">
            <h3 className="font-semibold">Chargebacks</h3>
            <p className="flex-1 text-sm text-muted">Answers each one before its deadline: accepts it, defends it with the signed order, or asks you.</p>
            <ActionForm action={reviewDisputesAction} label="Review disputes" pendingLabel="Reviewing..." small secondary />
          </div>
          <div className="flex flex-col gap-3 border border-border bg-panel p-5">
            <h3 className="font-semibold">Spare AI money</h3>
            <p className="flex-1 text-sm text-muted">Moves what your agents won&apos;t need for AI from Alta back to your Airwallex account.</p>
            <ActionForm action={sweepFloatAction} label="Move it back" pendingLabel="Moving..." small secondary />
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="text-sm font-semibold">Latest payouts</h2>
        {payouts.length ? (
          <ul className="divide-y divide-border/60 border border-border bg-panel text-sm">
            {payouts.map((p) => (
              <li key={p.requestId} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <span className="flex min-w-0 flex-col">
                  <span>{KIND[p.kind]} · {p.reference}</span>
                  <span className="font-mono text-xs text-muted">{p.transferId ?? p.requestId} · {when(p.createdAt)}</span>
                </span>
                <span className="flex items-center gap-4">
                  <span className="font-mono tabular-nums">{money(p.amount)}</span>
                  <Status tone={p.status === "paid" ? "accent" : p.status === "failed" ? "alert" : "muted"}>{p.reported ? `Airwallex: ${p.reported}` : p.status.replace("_", " ")}</Status>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No payouts yet. Run the close once there are sales.</p>
        )}
      </div>
    </section>
  );
}
