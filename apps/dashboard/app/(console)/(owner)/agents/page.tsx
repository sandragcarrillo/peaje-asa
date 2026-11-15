import Link from "next/link";
import { accountBalance, loadMandate, metalReady, pendingApproval } from "@peaje-asa/metal";
import { readAgentMandates, rebalanceHistory } from "@peaje-asa/treasury-agent";
import { MetalSetup, RebalancePanel } from "@/components/metal-owner";
import { PageHead } from "@/components/page-head";
import { Badge, EmptyState, Facts, SectionHead, Stat, TIER } from "@/components/plain";
import { deps } from "@/lib/deps";
import { requireOwner } from "@/lib/auth";
import { errorText, when } from "@/lib/format";
import type { Approval } from "./actions";

const AGENT = {
  seller: { name: "Sales agent", role: "Chats with customers and sells. It pays for each AI reply it writes, and can only pay the AI service." },
  disputes: { name: "Disputes agent", role: "Writes the replies to banks when a customer disputes a payment. It can only pay the AI service." },
  treasury: { name: "Treasury agent", role: "Sends spare money from this wallet back to your Airwallex account. It can only pay into that bridge." },
} as const;

const usdz = (n: number) => `${n.toFixed(2)} USDZ`;

const approvalOf = (p: Awaited<ReturnType<typeof pendingApproval>>): Approval | undefined =>
  p && { kind: p.kind, account: p.account, chainId: p.chainId, executionData: p.executionData, nonce: p.nonce, validUntil: p.validUntil, digest: p.digest, summary: p.summary };

const INTRO = "Your shop runs three AI agents. They share one wallet on Alta, and each one can only spend inside limits you approved: who it may pay, the most per payment and a total budget. Alta checks every payment, so no agent can go over, even by mistake.";

export default async function Agents() {
  const { shop } = await requireOwner();
  const { policy, conversations, seller, metal } = deps(shop.id);
  const pending = approvalOf(await pendingApproval(metal));
  if (!metalReady(metal)) {
    return (
      <section className="space-y-8">
        <PageHead eyebrow="Alta test network" title="Agents" sub={INTRO} />
        {process.env.METAL_RPC_URL ? (
          <div className="max-w-2xl space-y-3 rounded-lg border border-border bg-panel p-5">
            <h2 className="font-semibold">Give your agents a wallet</h2>
            <p className="text-sm text-muted">Your agents pay for their own AI replies (a few cents at most each) from this wallet on Alta&apos;s test network, only within the limits you approve. USDZ is the test dollar they pay with.</p>
            <MetalSetup shopId={shop.id} metalOwner={shop.metalOwner} pending={pending?.kind === "setup" ? pending : undefined} auto={shop.demo} />
          </div>
        ) : (
          <EmptyState title="The agents' wallet isn't set up on this server">
            <p>Until it is, your agents can&apos;t pay for their AI replies, so the shop chat can&apos;t answer customers.</p>
            <p className="font-mono text-xs text-faint">For the developer: set METAL_RPC_URL and run npm run metal:setup.</p>
          </EmptyState>
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
  const agentName = (a: string) => AGENT[a as keyof typeof AGENT]?.name ?? a;

  return (
    <section className="space-y-8">
      <PageHead eyebrow="Alta test network" title="Agents" sub={INTRO} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Money in the agents' wallet"
          value={balance === undefined ? "Unavailable" : usdz(balance)}
          hint={<>USDZ is the test dollar on Alta.{principal ? <span className="mt-1 block truncate font-mono text-[11px] text-faint" title={principal}>Wallet {principal}</span> : null}</>}
        />
        <Stat
          label="Cheapest AI reply right now"
          value={Number.isFinite(cheapest) ? usdz(cheapest) : "Unavailable"}
          hint={Object.entries(offers).length ? `Prices move with demand. Now: ${Object.entries(offers).map(([t, o]) => `${TIER[t] ?? t} ${o.price}`).join(", ")}.` : "No AI service is answering right now."}
        />
        <Stat
          label="AI budget you approved"
          value={usdz(policy.agentMandates.seller.budget + policy.agentMandates.disputes.budget)}
          hint="For the sales and disputes agents together. It can move between them, but never goes up without you."
        />
      </div>

      {error ? <p className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 text-sm text-red-300">Couldn&apos;t read the agents&apos; limits from Alta right now: {error}</p> : null}

      <div className="space-y-3">
        <SectionHead title="Each agent and its limits" sub="The bar shows how much of its budget each agent has used." />
        <div className="grid gap-3 lg:grid-cols-3">
          {mandates.map((m) => {
            const left = Math.max(0, m.budget - m.spent);
            const runway = m.agent === "treasury" ? undefined : Math.floor(left / cheapest + 1e-9);
            const need = m.agent === "treasury" ? undefined : policy.runwayCalls[m.agent];
            const used = m.budget > 0 ? Math.min(100, (m.spent / m.budget) * 100) : 0;
            return (
              <div key={m.agent} className="flex flex-col gap-3 rounded-lg border border-border bg-panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="font-semibold">{AGENT[m.agent].name}</h3>
                  {runway !== undefined && need !== undefined && Number.isFinite(cheapest) ? (
                    <Badge tone={runway < need ? "alert" : "good"}>{runway < need ? `Running low: ${runway} replies left` : `${runway} replies left`}</Badge>
                  ) : null}
                </div>
                <p className="flex-1 text-sm text-muted">{AGENT[m.agent].role}</p>
                <div className="space-y-1.5">
                  <div className="h-2 overflow-hidden rounded-full bg-border"><div className="h-full rounded-full bg-accent" style={{ width: `${used}%` }} /></div>
                  <p className="text-xs text-muted">{Math.round(used)}% of its budget used</p>
                </div>
                <Facts
                  rows={[
                    { label: "Most it can pay at once", value: usdz(m.cap) },
                    { label: "Total budget", value: usdz(m.budget) },
                    { label: "Spent so far", value: `${usdz(m.spent)} in ${m.payments} ${m.payments === 1 ? "payment" : "payments"}` },
                    { label: "Left", value: usdz(left), strong: true },
                  ]}
                />
                <p className="truncate font-mono text-[11px] text-faint" title={m.reference}>Limit id {m.reference}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-3 rounded-lg border border-border bg-panel p-5">
          <h2 className="font-semibold">Move budget between agents</h2>
          <p className="text-sm text-muted">
            When AI prices go up, an agent can run low. This checks what each agent has spent and today&apos;s AI prices. If the sales agent can&apos;t afford {policy.runwayCalls.seller} more replies, or the disputes agent {policy.runwayCalls.disputes}, it moves spare budget to it from the other one.
          </p>
          <p className="text-sm text-muted">The total never goes up, and nothing changes until you approve it here with your key, which lives only in this browser.</p>
          <RebalancePanel shopId={shop.id} metalOwner={shop.metalOwner} pending={pending} />
        </div>
        <div className="space-y-6">
          <div className="space-y-3">
            <SectionHead title="Past budget moves" />
            {history.length ? (
              <ul className="divide-y divide-border/60 rounded-lg border border-border bg-panel text-sm">
                {history.slice(0, 6).map((h) => (
                  <li key={h.at} className="space-y-1.5 px-4 py-3">
                    <p className="text-xs text-muted">{when(h.at)}</p>
                    <p>{h.plan.why}</p>
                    {h.applied.map((a) => (
                      <p key={a.agent} className="text-xs">
                        <span className="font-medium">{agentName(a.agent)}</span>: budget {usdz(a.from)} → {usdz(a.to)}
                        {a.transaction ? <span className="ml-1 font-mono text-[11px] text-faint">{a.transaction.slice(0, 14)}…</span> : null}
                      </p>
                    ))}
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No budget moves yet">
                <p>When you approve a move, it shows here: which agent gave budget, which one got it, and why.</p>
              </EmptyState>
            )}
          </div>
          {refusals.length ? (
            <div className="space-y-3">
              <SectionHead title="Payments Alta blocked" sub="An agent tried to pay more than its limits allow and Alta said no. That's the safety net doing its job." />
              <ul className="divide-y divide-border/60 rounded-lg border border-border bg-panel text-sm">
                {refusals.map((r) => (
                  <li key={r.at} className="space-y-1 px-4 py-3">
                    <p className="text-xs text-muted">
                      {when(r.at)} · {TIER[r.tier] ?? r.tier} ·{" "}
                      <Link href={`/conversations/${encodeURIComponent(r.conversation)}`} className="underline underline-offset-4 hover:text-text">See the chat</Link>
                    </p>
                    <p>{r.reason}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}
