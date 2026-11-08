"use server";

/**
 * The shop's Metal account, approved from the owner's browser. The server prepares each batch the
 * account must run (binding the agents' mandates, replacing them in a rebalance) and the sponsor
 * sends it, but only after the owner's key, which never leaves their browser, signed it.
 */
import { revalidatePath } from "next/cache";
import { finishShopSetup, payerFor, prepareShopSetup, type PreparedOwnerCall } from "@peaje-asa/metal";
import { finishRebalance, prepareRebalance } from "@peaje-asa/treasury-agent";
import { getAddress, isAddress, isAddressEqual, isHex, type Hex } from "viem";
import { requireOwner } from "@/lib/auth";
import { deps } from "@/lib/deps";
import { errorText } from "@/lib/format";
import { metalDirFor, platformMetalDir, policyOf, shops } from "@/lib/shops";

/** What the browser needs to check and sign a batch. No bigints: it crosses to the client. */
export type Approval = Pick<PreparedOwnerCall, "kind" | "account" | "chainId" | "executionData" | "nonce" | "validUntil" | "digest" | "summary">;
export type MetalStep = { ok: boolean; message: string; lines?: string[]; approval?: Approval; account?: string };

const approvalOf = (p: PreparedOwnerCall): Approval => ({ kind: p.kind, account: p.account, chainId: p.chainId, executionData: p.executionData, nonce: p.nonce, validUntil: p.validUntil, digest: p.digest, summary: p.summary });

async function step(fn: () => Promise<MetalStep>): Promise<MetalStep> {
  if (!process.env.METAL_RPC_URL) return { ok: false, message: "Metal isn't configured on this server: METAL_RPC_URL is missing." };
  try {
    return await fn();
  } catch (e) {
    console.error(e);
    return { ok: false, message: errorText(e) };
  } finally {
    revalidatePath("/", "layout");
  }
}

/**
 * Claims the shop's account for this owner address (once) and does everything up to the owner's
 * signature. Repeating it continues where it stopped.
 */
export async function startMetalSetupAction(owner: string): Promise<MetalStep> {
  const { shop } = await requireOwner();
  if (!isAddress(owner)) return { ok: false, message: "That isn't an owner address." };
  if (shop.metalOwner && !isAddressEqual(getAddress(shop.metalOwner), owner)) {
    return { ok: false, message: "This shop already has an owner key, and it isn't the one in this browser. Restore it from the backup file you saved." };
  }
  if (!shop.metalOwner) shops().update(shop.id, { metalOwner: getAddress(owner) });
  return step(async () => {
    const r = await prepareShopSetup({ dir: metalDirFor(shop.id), platformDir: platformMetalDir(), owner: getAddress(owner), policy: policyOf(shop) });
    if (r.done) return { ok: true, message: "Your account and your agents' mandates are ready.", lines: r.notes, account: r.account };
    return { ok: true, message: "Approve the mandates with your key to finish.", lines: r.notes, approval: approvalOf(r.prepared), account: r.account };
  });
}

/** Plans a rebalance. When budgets must move, returns the replacement for the owner to sign. */
export async function prepareRebalanceAction(): Promise<MetalStep> {
  const { shop } = await requireOwner();
  return step(async () => {
    const { policy, providers, metal } = deps(shop.id);
    const { plan, prepared } = await prepareRebalance({ dir: metal, policy, payer: payerFor("seller", metal), providers });
    if (!prepared) return { ok: plan.shortfall === 0, message: plan.why };
    return { ok: true, message: "The treasury wants to move budget. Nothing changes until you approve.", approval: approvalOf(prepared) };
  });
}

/** Sends a batch the owner signed in their browser. The server checks the signature is the shop owner's first. */
export async function approveAction(kind: string, digest: string, signature: string): Promise<MetalStep> {
  const { shop } = await requireOwner();
  if (!shop.metalOwner) return { ok: false, message: "This shop has no owner key yet." };
  if (!isHex(digest) || !isHex(signature)) return { ok: false, message: "That signature can't be read." };
  const o = { dir: metalDirFor(shop.id), platformDir: platformMetalDir(), owner: getAddress(shop.metalOwner), signature: signature as Hex, digest: digest as Hex };
  return step(async () => {
    if (kind === "setup") {
      const r = await finishShopSetup(o);
      return { ok: true, message: "Done. Your agents can pay for their model calls now, each within the mandate you signed.", lines: [`Transaction ${r.transaction}`], account: r.account };
    }
    if (kind === "rebalance") {
      const r = await finishRebalance(o);
      return { ok: true, message: r.plan.why, lines: r.applied.map((a) => `${a.agent}: ${a.from} → ${a.to} USDZ (${a.transaction})`) };
    }
    return { ok: false, message: "Unknown approval." };
  });
}
