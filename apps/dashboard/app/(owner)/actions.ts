"use server";

/**
 * Everything the owner can do from the dashboard. Each action checks the session first, then calls
 * the agents; money rules stay in the treasury and policy packages, never here.
 */
import { revalidatePath } from "next/cache";
import { acceptAdvance, ensurePayees, rebalanceAgents, reviewDisputes, runClose, sweepFloat, syncDisputeOutcomes, usdGlobalAccount, type CloseResult, type DisputeReview } from "@peaje-asa/treasury-agent";
import type { ActionResult } from "@/components/action-form";
import { requireOwner } from "@/lib/auth";
import { closeDeps, deps, METAL, metalBridge } from "@/lib/deps";
import { metalReady, payerFor } from "@peaje-asa/metal";
import { errorText, usd } from "@/lib/format";

const LABEL = { supplier: "Inventory", advance_repayment: "Advance repayment", owner_payout: "Profit to owner" } as const;

async function guarded(fn: () => Promise<ActionResult>): Promise<ActionResult> {
  await requireOwner();
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return { ok: false, message: errorText(e) };
  } finally {
    revalidatePath("/", "layout");
  }
}

function closeLines(r: CloseResult) {
  return [
    ...r.resumed.map((p) => `Resumed ${LABEL[p.kind]} ${usd(p.amount)}: ${p.status}`),
    ...r.paid.map((p) => `${LABEL[p.kind]} ${usd(p.amount)} -> ${p.transferId ?? "no transfer"} ${p.status}${p.failure ? ` (${p.failure})` : ""}`),
    ...r.awaiting.map((a) => `Waiting for you: ${LABEL[a.terms.kind as keyof typeof LABEL] ?? a.terms.kind} ${usd(a.terms.amount)}`),
    ...r.plan.defer.map((d) => `Deferred ${LABEL[d.obligation.kind]}: ${d.why}`),
  ];
}

async function close(): Promise<ActionResult> {
  const r = await runClose(await closeDeps());
  const sent = r.paid.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  return {
    ok: true,
    message: `Close on ${usd(r.plan.cash)} of cash: ${usd(sent)} paid out, ${r.awaiting.length} waiting for approval. ${usd(r.plan.reserveAfter)} stays as reserve.`,
    lines: closeLines(r),
  };
}

const reviewLines = (rs: DisputeReview[]) =>
  rs.map((r) => `${r.dispute.id} ${r.dispute.stage} ${usd(r.dispute.amount)}: ${r.decision.action}. ${r.decision.why}`);

async function review(): Promise<ActionResult> {
  const { disputes } = deps();
  const rs = await reviewDisputes(disputes);
  const outcomes = await syncDisputeOutcomes(disputes);
  const acted = rs.filter((r) => r.decision.action !== "ignore" && r.decision.action !== "wait");
  return { ok: true, message: `${rs.length} disputes reviewed, ${acted.length} answered.`, lines: [...reviewLines(rs), ...outcomes.map((o) => `${o.disputeId}: ${o.status}`)] };
}

export async function runCloseAction(): Promise<ActionResult> {
  return guarded(close);
}

export async function reviewDisputesAction(): Promise<ActionResult> {
  return guarded(review);
}

export async function sweepFloatAction(): Promise<ActionResult> {
  return guarded(async () => {
    const { awx, ledger, policy } = deps();
    const ga = await usdGlobalAccount(awx);
    const r = await sweepFloat(metalBridge(), ledger, policy, (amount, txHash) => awx.simulate.deposit(ga, amount, txHash, "Peaje ASA Metal float"));
    if (!r.swept) return { ok: true, message: `Nothing to sweep: ${r.balance} USDZ on Metal, the agents keep ${policy.aiFloatTarget} for model calls.` };
    return { ok: true, message: `Swept ${r.swept} USDZ from Metal to Airwallex. ${r.balance} USDZ stays for model calls.`, lines: [metalReady(METAL) ? `Pulled on Metal testnet under the treasury mandate: ${r.txHash}. Airwallex can't receive USDZ, so the deposit on its side is simulated with this hash.` : `Bridge tx ${r.txHash} (fake bridge: Metal isn't set up)`] };
  });
}

/** Approving a payout runs the close so the money moves; approving a dispute refund reviews the queue so it's accepted. */
export async function decideApprovalAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const by = await requireOwner();
    const id = String(form.get("id"));
    const decision = form.get("decision") === "approved" ? "approved" : "rejected";
    const a = deps().treasury.decide(id, decision, by);
    const what = `${LABEL[a.terms.kind as keyof typeof LABEL] ?? "Dispute refund"} of ${usd(a.terms.amount)}`;
    if (a.terms.kind === "dispute_refund") {
      const r = await review();
      return { ok: true, message: `${what} ${decision}. ${decision === "approved" ? "The treasury accepts the dispute." : "The treasury defends it with the signed order."}`, lines: r?.lines };
    }
    if (decision === "rejected") return { ok: true, message: `${what} rejected. It stays unpaid until the next close asks again.` };
    const r = await close();
    return { ok: true, message: `${what} approved. ${r?.message ?? ""}`, lines: r?.lines };
  });
}

export async function resolveEscalationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const by = await requireOwner();
    const id = String(form.get("id"));
    const decision = form.get("decision") === "approved" ? "approved" : "declined";
    const message = String(form.get("message") ?? "").trim() || undefined;
    const c = await deps().seller.resolveEscalation(id, decision, by, message);
    return decision === "approved" && c.payment
      ? { ok: true, message: `Approved. The customer got a payment link for ${usd(c.quotes.find((q) => q.id === c.payment!.quoteId)?.total ?? 0)}.` }
      : { ok: true, message: decision === "approved" ? "Approved. The agent continues the conversation." : "Declined. The agent tells the customer and keeps selling." };
  });
}

export async function ownerReplyAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    await requireOwner();
    const text = String(form.get("text") ?? "").trim();
    if (!text) return { ok: false, message: "Write a message first." };
    await deps().seller.ownerReply(String(form.get("id")), text);
    return { ok: true, message: "Sent. The customer sees it in the chat." };
  });
}

/** The owner accepts the amount they saw; acceptAdvance recomputes it and refuses if it changed. */
export async function acceptAdvanceAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async () => {
    const { awx, ledger, policy } = deps();
    const shown = Number(form.get("amount"));
    const ga = await usdGlobalAccount(awx);
    await ensurePayees(awx, true);
    const r = await acceptAdvance(ledger, policy, shown, (amount, ref) => awx.simulate.deposit(ga, amount, ref, "Peaje Capital"));
    return { ok: true, message: `${usd(r.amount)} is in your Airwallex wallet (${r.ref}). The close repays ${usd(r.repayTotal)} with ${Math.round(r.repaymentShare * 100)}% of each new sale.` };
  });
}

export async function rebalanceAction(): Promise<ActionResult> {
  return guarded(async () => {
    const { policy, providers } = deps();
    const r = await rebalanceAgents({ dir: METAL, policy, payer: payerFor("seller", METAL), providers });
    return {
      ok: r.plan.shortfall === 0,
      message: r.plan.why,
      lines: r.applied.map((a) => `${a.agent}: ${a.from} → ${a.to} USDZ${a.transaction ? ` (${a.transaction})` : ""}`),
    };
  });
}
