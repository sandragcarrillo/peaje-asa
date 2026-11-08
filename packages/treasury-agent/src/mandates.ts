/**
 * Kit 11: three agents paying from one Metal account, each under its own mandate. When model prices
 * rise, the treasury reads every mandate's spend from chain and `planRebalance` (policy) decides. The
 * new mandates wait for the owner: the owner's key, in their browser, signs one batch that replaces
 * them, cuts first, so the total the owner signed is never exceeded. Spend carries over a
 * replacement, so a replaced mandate can't be used to spend twice.
 */
import { appendFile, readFile, rename, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { dropPending, ingest, issueCredential, loadMandate, mandateSpent, prepareOwnerCall, submitPending, type AgentSetup, type InferencePayer, type InferenceProvider, type PreparedOwnerCall } from "@peaje-asa/metal";
import { replaceCall, type MandateCall } from "@metalntwx/metal-pay/mandates";
import { planRebalance, type AiAgent, type MandateState, type MandatedAgent, type ModelTier, type OwnerPolicy, type RebalancePlan } from "@peaje-asa/policy";
import type { Address, Hex } from "viem";

export interface AgentMandateView { agent: MandatedAgent; reference: string; cap: number; budget: number; spent: number; payments: number }

export interface RebalanceRecord { at: string; plan: RebalancePlan; applied: { agent: AiAgent; from: number; to: number; transaction?: string }[] }

export async function readAgentMandates(dir: string): Promise<AgentMandateView[]> {
  return Promise.all((["seller", "disputes", "treasury"] as const).map(async (agent) => {
    const m = await loadMandate(dir, agent);
    const { spent, payments } = await mandateSpent(m);
    return { agent, reference: m.reference, cap: m.cap, budget: m.budget, spent, payments };
  }));
}

export interface RebalanceDeps {
  dir: string;
  policy: OwnerPolicy;
  /** Reads the providers' current 402 offers. */
  payer: InferencePayer;
  providers: Record<ModelTier, InferenceProvider>;
}

type Change = RebalancePlan["changes"][number];

/**
 * Plans from chain and live prices. When something must change it writes the new credentials and
 * returns the batch for the owner to sign; nothing changes on chain until they do.
 */
export async function prepareRebalance(deps: RebalanceDeps): Promise<{ plan: RebalancePlan; prepared?: PreparedOwnerCall }> {
  const { dir, policy } = deps;
  const views = await readAgentMandates(dir);
  const prices = await Promise.all(Object.values(deps.providers).map((p) => deps.payer.quote(p).then((o) => o.price, () => Infinity)));
  const cheapest = Math.min(...prices);
  if (!Number.isFinite(cheapest)) throw new Error("no provider answered with a price");
  const states: MandateState[] = views.filter((v): v is AgentMandateView & { agent: AiAgent } => v.agent !== "treasury")
    .map((v) => ({ agent: v.agent, budget: v.budget, spent: v.spent }));
  // Both AI agents may buy from every provider, so the cheapest offer is each one's floor.
  const plan = planRebalance(states, { seller: cheapest, disputes: cheapest }, policy);
  if (!plan.changes.length) {
    if (plan.shortfall > 0) await record(dir, { at: new Date().toISOString(), plan, applied: [] });
    return { plan };
  }

  const setup = JSON.parse(await readFile(join(dir, "agents.json"), "utf8")) as { principal: Address; agents: Record<MandatedAgent, AgentSetup> };
  await dropPending(dir);
  const calls: MandateCall[] = [];
  for (const c of plan.changes) {
    const current = await loadMandate(dir, c.agent);
    const next = join(dir, `${c.agent}.next.json`);
    if (existsSync(next)) await rename(next, join(dir, `${c.agent}.abandoned-${Date.now()}.json`));
    await issueCredential(dir, { principal: setup.principal, agent: c.agent, cap: policy.agentMandates[c.agent].cap, budget: c.to, setup: setup.agents[c.agent], out: next, mandateKey: join(dir, `${c.agent}.key.json`) });
    calls.push(replaceCall(current.reference as Hex, await ingest(dir, next, setup.principal)));
  }
  const summary = plan.changes.map((c) => `${c.agent} agent budget: ${c.from.toFixed(2)} → ${c.to.toFixed(2)} USDZ (same payees, same most per payment).`);
  const prepared = await prepareOwnerCall(calls, "rebalance", [plan.why, ...summary], { plan });
  await writeFile(join(dir, "pending.json"), `${JSON.stringify(prepared, null, 2)}\n`);
  return { plan, prepared };
}

/** Sends the replacement the owner signed, then moves the new credentials into place. */
export async function finishRebalance(o: { dir: string; platformDir: string; owner: Address; signature: Hex; digest: Hex }): Promise<RebalanceRecord> {
  const { prepared, transaction } = await submitPending({ ...o, kind: "rebalance" });
  const { plan } = prepared.meta as { plan: RebalancePlan };
  const applied: RebalanceRecord["applied"] = [];
  for (const c of plan.changes as Change[]) {
    const current = join(o.dir, `${c.agent}.json`);
    // Keep the replaced credential for audit; the agent's payer picks up the new one by its mtime.
    await rename(current, join(o.dir, `${c.agent}.replaced-${Date.now()}.json`));
    await rename(join(o.dir, `${c.agent}.next.json`), current);
    applied.push({ ...c, transaction });
  }
  const r = { at: new Date().toISOString(), plan, applied };
  await record(o.dir, r);
  return r;
}

async function record(dir: string, r: RebalanceRecord) {
  await appendFile(join(dir, "rebalances.jsonl"), `${JSON.stringify(r)}\n`);
}

export async function rebalanceHistory(dir: string): Promise<RebalanceRecord[]> {
  const file = join(dir, "rebalances.jsonl");
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse();
}
