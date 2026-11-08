import { accountBalance, loadMandate, metalReady, pendingApproval } from "@peaje-asa/metal";
import { readAgentMandates, rebalanceHistory } from "@peaje-asa/treasury-agent";
import { MetalSetup, RebalancePanel } from "@/components/metal-owner";
import { Empty, PageHead, Status } from "@/components/page-head";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { errorText, when } from "@/lib/format";
import type { Approval } from "./actions";

const ROLE = {
  seller: "Pays model calls while it sells. May pay only the three providers.",
  disputes: "Pays model calls to write chargeback defenses. May pay only the three providers.",
  treasury: "Sweeps the unused float to Airwallex. May pay only the bridge.",
} as const;

const usdz = (n: number) => `${n.toFixed(2)} USDZ`;

const approvalOf = (p: Awaited<ReturnType<typeof pendingApproval>>): Approval | undefined =>
  p && { kind: p.kind, account: p.account, chainId: p.chainId, executionData: p.executionData, nonce: p.nonce, validUntil: p.validUntil, digest: p.digest, summary: p.summary };

export default async function Agents() {
  const { shop } = await requireOwner();
  const { policy, conversations, seller, metal } = deps(shop.id);
  const pending = approvalOf(await pendingApproval(metal));
  if (!metalReady(metal)) {
    return (
      <section className="space-y-8">
        <PageHead eyebrow="Metal testnet" title="Agents" sub="Three agents pay for their model calls from your shop's Metal account, each under a mandate your key signs: who it may pay, the most per payment, its budget. Metal enforces them on chain." />
        {process.env.METAL_RPC_URL ? (
          <div className="max-w-2xl space-y-3 border border-border bg-panel p-5">
            <h2 className="font-semibold">Set up your Metal account</h2>
            <MetalSetup shopId={shop.id} metalOwner={shop.metalOwner} pending={pending?.kind === "setup" ? pending : undefined} />
          </div>
        ) : (
          <Empty>Metal isn't configured on this server: set METAL_RPC_URL and run npm run metal:setup. Until then your agent can't pay for model calls.</Empty>
        )}
      </section>
    );
  }

  let error: string | undefined;
  const [mandates, balance, offers] = await Promise.all([
    readAgentMandates(metal).catch((e) => ((error = errorText(e)), [])),
    loadMandate(metal, "treasury").then((m) => accountBalance(m.principal)).catch(() => undefined),
    seller.currentOffers(),
  ]);
  const principal = mandates.length ? (await loadMandate(metal, "seller")).principal : undefined;
  const history = await rebalanceHistory(metal);
  const refusals = conversations.list().flatMap((c) => (c.mandateRefusals ?? []).map((r) => ({ ...r, conversation: c.id }))).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 5);
  const cheapest = Math.min(...Object.values(offers).map((o) => o.price));

  return (
    <section className="space-y-8">
      <PageHead
        eyebrow="Metal testnet"
        title="Agents"
        sub="Three agents pay from one Metal account, each under a mandate you signed: who it may pay, the most per payment, its budget. Metal enforces them on chain. When model prices rise, the treasury moves budget between agents, never above what you signed."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="border border-border bg-panel p-5">
          <p className="text-sm text-muted">Account balance</p>
          <p className="text-3xl font-bold tabular-nums">{balance === undefined ? "?" : usdz(balance)}</p>
          {principal ? <p className="mt-1 truncate font-mono text-xs text-muted">{principal}</p> : null}
        </div>
        <div className="border border-border bg-panel p-5">
          <p className="text-sm text-muted">Cheapest model call now</p>
          <p className="text-3xl font-bold tabular-nums">{Number.isFinite(cheapest) ? usdz(cheapest) : "?"}</p>
          <p className="mt-1 font-mono text-xs text-muted">{Object.entries(offers).map(([t, o]) => `${t} ${o.price}`).join(" · ")}</p>
        </div>
        <div className="border border-border bg-panel p-5">
          <p className="text-sm text-muted">Budget you signed for model calls</p>
          <p className="text-3xl font-bold tabular-nums">{usdz(policy.agentMandates.seller.budget + policy.agentMandates.disputes.budget)}</p>
          <p className="mt-1 font-mono text-xs text-muted">seller + disputes, moved between them, never raised</p>
        </div>
      </div>

      {error ? <p className="border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-300">Couldn't read the mandates from chain: {error}</p> : null}

      <div className="grid gap-4 lg:grid-cols-3">
        {mandates.map((m) => {
          const left = Math.max(0, m.budget - m.spent);
          const runway = m.agent === "treasury" ? undefined : Math.floor(left / cheapest + 1e-9);
          const need = m.agent === "treasury" ? undefined : policy.runwayCalls[m.agent];
          return (
            <div key={m.agent} className="space-y-3 border border-border bg-panel p-5">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold capitalize">{m.agent} agent</h2>
                {runway !== undefined && need !== undefined ? <Status tone={runway < need ? "alert" : "accent"}>{runway} calls left</Status> : null}
              </div>
              <p className="text-sm text-muted">{ROLE[m.agent]}</p>
              <dl className="grid grid-cols-2 gap-y-1 border-t border-border pt-3 text-sm">
                <dt className="text-muted">Most per payment</dt><dd className="text-right font-mono tabular-nums">{usdz(m.cap)}</dd>
                <dt className="text-muted">Budget</dt><dd className="text-right font-mono tabular-nums">{usdz(m.budget)}</dd>
                <dt className="text-muted">Spent</dt><dd className="text-right font-mono tabular-nums">{usdz(m.spent)} · {m.payments}</dd>
              </dl>
              <div className="h-1.5 bg-border"><div className="h-full bg-accent" style={{ width: `${Math.min(100, (m.spent / m.budget) * 100)}%` }} /></div>
              <p className="truncate font-mono text-[11px] text-faint">{m.reference}</p>
            </div>
          );
        })}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 border border-border bg-panel p-5">
          <h2 className="font-semibold">Rebalance</h2>
          <p className="text-sm text-muted">Reads every mandate's spend from chain and the providers' live prices. An agent that can't pay for {policy.runwayCalls.seller} calls (seller) or {policy.runwayCalls.disputes} (disputes) at the cheapest price gets spare budget from the other. Nothing changes until your key, in this browser, approves the replacement; the cut goes first.</p>
          <RebalancePanel shopId={shop.id} metalOwner={shop.metalOwner} pending={pending} />
        </div>
        <div className="space-y-3">
          <h2 className="text-sm font-semibold">History</h2>
          {history.length ? (
            <ul className="divide-y divide-border/60 border border-border bg-panel text-sm">
              {history.slice(0, 6).map((h) => (
                <li key={h.at} className="space-y-1 px-4 py-3">
                  <p className="text-muted">{when(h.at)}</p>
                  <p>{h.plan.why}</p>
                  {h.applied.map((a) => (
                    <p key={a.agent} className="font-mono text-xs">{a.agent} {usdz(a.from)} → {usdz(a.to)}{a.transaction ? ` · ${a.transaction.slice(0, 18)}…` : ""}</p>
                  ))}
                </li>
              ))}
            </ul>
          ) : (
            <Empty>No rebalance yet.</Empty>
          )}
          {refusals.length ? (
            <>
              <h2 className="pt-2 text-sm font-semibold">Refused on chain</h2>
              <ul className="divide-y divide-border/60 border border-border bg-panel text-sm">
                {refusals.map((r) => (
                  <li key={r.at} className="px-4 py-3"><span className="text-muted">{when(r.at)} · {r.conversation} · {r.tier}:</span> {r.reason}</li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </div>
    </section>
  );
}
