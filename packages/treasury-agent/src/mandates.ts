/**
 * Kit 11: three agents paying from one Metal account, each under its own mandate. When model prices
 * rise, the treasury reads every mandate's spend from chain, `planRebalance` (policy) decides, and the
 * owner's key replaces the mandates: cuts first, so the total the owner signed is never exceeded.
 * Spend carries over a replacement, so a replaced mandate can't be used to spend twice.
 */
import { appendFile, readFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { loadMandate, mandateSpent, metalCli, type InferencePayer, type InferenceProvider } from "@peaje-asa/metal";
import { planRebalance, type AiAgent, type MandateState, type MandatedAgent, type ModelTier, type OwnerPolicy, type RebalancePlan } from "@peaje-asa/policy";

/** What setup recorded about each agent: who it may pay and how its mandate is described. */
export interface AgentSetup { payees: string[]; description: string }

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

/** Plan from chain and live prices, then apply. Returns what changed; nothing when every agent has its runway. */
export async function rebalanceAgents(deps: RebalanceDeps): Promise<RebalanceRecord> {
  const { dir, policy } = deps;
  const views = await readAgentMandates(dir);
  const prices = await Promise.all(Object.values(deps.providers).map((p) => deps.payer.quote(p).then((o) => o.price, () => Infinity)));
  const cheapest = Math.min(...prices);
  if (!Number.isFinite(cheapest)) throw new Error("no provider answered with a price");
  const states: MandateState[] = views.filter((v): v is AgentMandateView & { agent: AiAgent } => v.agent !== "treasury")
    .map((v) => ({ agent: v.agent, budget: v.budget, spent: v.spent }));
  // Both AI agents may buy from every provider, so the cheapest offer is each one's floor.
  const plan = planRebalance(states, { seller: cheapest, disputes: cheapest }, policy);

  const setup = JSON.parse(await readFile(join(dir, "agents.json"), "utf8")) as { principal: string; agents: Record<MandatedAgent, AgentSetup> };
  const applied: RebalanceRecord["applied"] = [];
  for (const c of plan.changes) {
    const transaction = await replaceBudget(dir, c.agent, policy.agentMandates[c.agent].cap, c.to, setup.principal, setup.agents[c.agent]);
    applied.push({ ...c, transaction });
  }
  const record = { at: new Date().toISOString(), plan, applied };
  if (applied.length || plan.shortfall > 0) await appendFile(join(dir, "rebalances.jsonl"), `${JSON.stringify(record)}\n`);
  return record;
}

/** Issue a credential with the new budget for the same agent key, then replace on chain with the owner's key. */
async function replaceBudget(dir: string, agent: AiAgent, cap: number, budget: number, principal: string, a: AgentSetup) {
  const current = join(dir, `${agent}.json`);
  const next = join(dir, `${agent}.next.json`);
  if (existsSync(next)) await rename(next, join(dir, `${agent}.abandoned-${Date.now()}.json`));
  await metalCli([
    "mandate", "credential", "create",
    "--principal", principal,
    "--cap", cap.toFixed(2),
    "--budget", budget.toFixed(2),
    ...a.payees.flatMap((p) => ["--payee", p]),
    "--expires-in", String(30 * 24 * 3600),
    "--description", a.description,
    "--mandate-key-file", join(dir, `${agent}.key.json`),
    "--key", join(dir, "owner.json"),
    "--out", next,
  ]);
  const out = await metalCli(["mandate", "replace", "--credential", next, "--replaces", current, "--key", join(dir, "owner.json")]);
  // Keep the replaced credential for audit; the agent's payer picks up the new one by its mtime.
  await rename(current, join(dir, `${agent}.replaced-${Date.now()}.json`));
  await rename(next, current);
  return out.transaction;
}

export async function rebalanceHistory(dir: string): Promise<RebalanceRecord[]> {
  const file = join(dir, "rebalances.jsonl");
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8")).trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)).reverse();
}
