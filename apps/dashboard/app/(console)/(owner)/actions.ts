"use server";

/**
 * Everything the owner can do from the dashboard. Each action checks the session first, then calls
 * the agents; money rules stay in the treasury and policy packages, never here.
 */
import { revalidatePath } from "next/cache";
import { join } from "node:path";
import { acceptAdvance, openAccount, reviewDisputes, runClose, runMove, sandboxKyc, sandboxPayee, sweepFloat, syncDisputeOutcomes, type CloseResult, type DisputeReview } from "@peaje-asa/treasury-agent";
import type { ActionResult } from "@/components/action-form";
import { requireOwner } from "@/lib/auth";
import { closeDeps, deps, metalBridge, NoAccount, railsFor } from "@/lib/deps";
import { root } from "@/lib/env";
import { shops } from "@/lib/shops";
import { metalReady } from "@peaje-asa/metal";
import { errorText, usd } from "@/lib/format";

const LABEL = { supplier: "Inventory", advance_repayment: "Advance repayment", owner_payout: "Profit to owner" } as const;

type Owner = Awaited<ReturnType<typeof requireOwner>>;

async function guarded(fn: (owner: Owner) => Promise<ActionResult>): Promise<ActionResult> {
  const owner = await requireOwner();
  try {
    return await fn(owner);
  } catch (e) {
    console.error(e);
    return { ok: false, message: errorText(e) };
  } finally {
    revalidatePath("/", "layout");
  }
}

function closeLines(r: CloseResult) {
  const sales = r.settled.filter((s) => s.kind === "sale");
  const back = r.settled.filter((s) => s.kind === "recovery");
  const sum = (xs: typeof sales) => xs.reduce((t, s) => t + s.amount, 0);
  return [
    ...(sales.length ? [`Sales the platform moved to your account: ${sales.length}, ${usd(sum(sales))} (${sales.map((s) => s.reported ?? s.status).join(", ")})`] : []),
    ...(back.length ? [`Refunds and dispute fees taken back by the platform: ${back.length}, ${usd(sum(back))} (${back.map((s) => s.reported ?? s.status).join(", ")})`] : []),
    ...r.settled.filter((s) => s.failure && s.status !== "done").map((s) => `Not moved yet: ${s.reference} (${s.failure})`),
    `Your Airwallex account had ${usd(r.available)} available to plan with.`,
    ...r.resumed.map((p) => `Resumed ${LABEL[p.kind]} ${usd(p.amount)}: ${p.status}`),
    ...r.paid.map((p) => `${LABEL[p.kind]} ${usd(p.amount)} -> ${p.transferId ?? "no transfer"}: Airwallex says ${p.reported ?? p.status}${p.failure ? ` (${p.failure})` : ""}`),
    ...r.awaiting.map((a) => `Waiting for you: ${LABEL[a.terms.kind as keyof typeof LABEL] ?? a.terms.kind} ${usd(a.terms.amount)}`),
    ...r.plan.defer.map((d) => `Deferred ${LABEL[d.obligation.kind]}: ${d.why}`),
  ];
}

async function close({ shop }: Owner): Promise<ActionResult> {
  const r = await runClose(closeDeps(shop.id));
  const sent = r.paid.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount, 0);
  return {
    ok: true,
    message: `Close on ${usd(r.plan.cash)} of cash: ${usd(sent)} paid out, ${r.awaiting.length} waiting for approval. ${usd(r.plan.reserveAfter)} stays as reserve.`,
    lines: closeLines(r),
  };
}

const reviewLines = (rs: DisputeReview[]) =>
  rs.map((r) => `${r.dispute.id} ${r.dispute.stage} ${usd(r.dispute.amount)}: ${r.decision.action}. ${r.decision.why}`);

async function review({ shop }: Owner): Promise<ActionResult> {
  const { disputes } = deps(shop.id);
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
  return guarded(async ({ shop }) => {
    const { awx, ledger, policy, metal } = deps(shop.id);
    if (!shop.airwallexAccountId) throw new NoAccount();
    const ga = (((await awx.globalAccountsOf(shop.airwallexAccountId)) as any).items ?? []).find((g: any) => g.status === "ACTIVE")?.id;
    if (!ga) throw new Error("The shop's Airwallex account has no active global account yet.");
    // The guide's Metal-to-Airwallex path: Airwallex can't receive USDZ, so the deposit into the shop's account is simulated with the Metal hash.
    const r = await sweepFloat(metalBridge(shop.id), ledger, policy, (amount, txHash) => awx.simulate.deposit(ga, amount, txHash, "Peaje ASA Metal float", shop.airwallexAccountId));
    if (!r.swept) return { ok: true, message: `Nothing to sweep: ${r.balance} USDZ on Metal, the agents keep ${policy.aiFloatTarget} for model calls.` };
    return { ok: true, message: `Swept ${r.swept} USDZ from Metal to Airwallex. ${r.balance} USDZ stays for model calls.`, lines: [metalReady(metal) ? `Pulled on Metal testnet under the treasury mandate: ${r.txHash}. Airwallex can't receive USDZ, so the deposit on its side is simulated with this hash.` : `Bridge tx ${r.txHash} (fake bridge: Metal isn't set up)`] };
  });
}

/** Approving a payout runs the close so the money moves; approving a dispute refund reviews the queue so it's accepted. */
export async function decideApprovalAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async (owner) => {
    const by = owner.email;
    const id = String(form.get("id"));
    const decision = form.get("decision") === "approved" ? "approved" : "rejected";
    const a = deps(owner.shop.id).treasury.decide(id, decision, by);
    const what = `${LABEL[a.terms.kind as keyof typeof LABEL] ?? "Dispute refund"} of ${usd(a.terms.amount)}`;
    if (a.terms.kind === "dispute_refund") {
      const r = await review(owner);
      return { ok: true, message: `${what} ${decision}. ${decision === "approved" ? "The treasury accepts the dispute." : "The treasury defends it with the signed order."}`, lines: r?.lines };
    }
    if (decision === "rejected") return { ok: true, message: `${what} rejected. It stays unpaid until the next close asks again.` };
    const r = await close(owner);
    return { ok: true, message: `${what} approved. ${r?.message ?? ""}`, lines: r?.lines };
  });
}

export async function resolveEscalationAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async (owner) => {
    const by = owner.email;
    const id = String(form.get("id"));
    const decision = form.get("decision") === "approved" ? "approved" : "declined";
    const message = String(form.get("message") ?? "").trim() || undefined;
    const c = await deps(owner.shop.id).seller.resolveEscalation(id, decision, by, message);
    return decision === "approved" && c.payment
      ? { ok: true, message: `Approved. The customer got a payment link for ${usd(c.quotes.find((q) => q.id === c.payment!.quoteId)?.total ?? 0)}.` }
      : { ok: true, message: decision === "approved" ? "Approved. The agent continues the conversation." : "Declined. The agent tells the customer and keeps selling." };
  });
}

export async function ownerReplyAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async ({ shop }) => {
    const text = String(form.get("text") ?? "").trim();
    if (!text) return { ok: false, message: "Write a message first." };
    await deps(shop.id).seller.ownerReply(String(form.get("id")), text);
    return { ok: true, message: "Sent. The customer sees it in the chat." };
  });
}

/** The owner accepts the amount they saw; acceptAdvance recomputes it and refuses if it changed. */
export async function acceptAdvanceAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  return guarded(async ({ shop }) => {
    const { ledger, policy } = deps(shop.id);
    const rails = railsFor(shop.id);
    if (!rails) throw new NoAccount();
    const shown = Number(form.get("amount"));
    let moved = "";
    // The platform funds it from its own account; it's booked only once Airwallex reports it settled.
    const r = await acceptAdvance(ledger, policy, shown, async (amount, ref) => {
      const s = await runMove(rails, { kind: "advance", requestId: `adv_${shop.id}_${ref}`.slice(0, 64), amount, currency: policy.currency, reference: `Advance ${ref}` });
      if (s.state !== "done") throw new Error(`The advance transfer is ${s.reported}${s.failure ? ` (${s.failure})` : ""}. Nothing was booked; try again.`);
      moved = `${s.id}, ${s.reported}`;
    });
    return { ok: true, message: `${usd(r.amount)} is in your Airwallex account (${moved}). The close repays ${usd(r.repayTotal)} with ${Math.round(r.repaymentShare * 100)}% of each new sale.` };
  });
}

/**
 * Opens the shop's Airwallex account under the platform, plus (sandbox) the accounts standing in for
 * its supplier and its owner, which it pays by Airwallex Pay. Once only.
 */
export async function openAirwallexAccountAction(): Promise<ActionResult> {
  return guarded(async ({ shop }) => {
    if (shop.airwallexAccountId && shop.payTo) return { ok: true, message: `Your Airwallex account is already open (${shop.airwallexAccountId}).` };
    const { awx } = deps(shop.id);
    const file = join(root, "data/airwallex/sandbox-payees.json");
    const accountId = shop.airwallexAccountId ?? (await openAccount(awx, sandboxKyc(shop.name, shop.ownerEmail, shop.about || `Products sold online by ${shop.name}`))).accountId;
    shops().update(shop.id, { airwallexAccountId: accountId });
    const supplier = await sandboxPayee(awx, file, "supplier", "Andes Green Coffee Imports", "Green coffee imports sold to roasters");
    const owner = await sandboxPayee(awx, file, `owner:${shop.id}`, `${shop.name} owner`, "The shop owner's own account");
    shops().update(shop.id, { payTo: { supplier, owner } });
    return {
      ok: true,
      message: `Your Airwallex account is open and active (${accountId}). Sales move there at each close; inventory and profit go out of it.`,
      lines: [`Inventory goes to ${supplier.accountName} (${supplier.accountNumber})`, `Profit goes to ${owner.accountName} (${owner.accountNumber})`],
    };
  });
}
