/**
 * Ready demo shops, so "Try it" opens a shop that already has a story. The server builds each one the
 * way a judge's own shop gets built: its Airwallex account opens, a buyer agent buys from it on Alta,
 * ten customers chat with its agent and the day's close runs. Nothing is copied or seeded; it just
 * happens before anyone clicks. A click hands over the oldest ready shop of that kind and the server
 * starts the next one.
 *
 * The one difference: nobody's browser is there to make the owner key, so the server makes it and
 * signs the agents' mandates with it. A judge's shop never needs that key again unless they rebalance.
 */
import "./env";
import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Shop } from "@peaje-asa/ledger";
import { finishShopSetup, ownerTypedData, prepareShopSetup } from "@peaje-asa/metal";
import { defaultPolicy, demoShops, type DemoShopKind } from "@peaje-asa/policy";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { hashPassword } from "./auth";
import { deps } from "./deps";
import { runDemo, startDemoChats } from "./demo-history";
import { root } from "./env";
import { metalDirFor, platformMetalDir, policyOf, shops } from "./shops";
import { syncCatalog } from "./storefront";

/** A new demo shop of this kind: its catalog, rules and the supplier bills a real owner would add. */
export async function newDemoShop(kind: DemoShopKind, pool?: Shop["pool"]): Promise<Shop> {
  const id = `demo-${randomBytes(3).toString("hex")}`;
  const shop = shops().create({
    id,
    name: kind.name,
    about: kind.about,
    ownerEmail: `${id}@demo.asa.usepeaje.com`,
    passwordHash: await hashPassword(randomBytes(24).toString("base64url")),
    // A small reserve and approval limit, so the first close moves money and asks the owner about the bigger payments.
    policy: { ...defaultPolicy, catalog: kind.catalog, reserveFloor: 20, approvalThreshold: 30 },
    // One bill due today, one later.
    bills: kind.bills.map((b, i) => ({ id: `${id.slice(5)}${i}`, supplier: kind.supplier.name, amount: b.amount, note: b.note, dueDate: new Date(Date.now() + b.inDays * 86_400_000).toISOString().slice(0, 10), createdAt: new Date().toISOString() })),
    demo: true,
    ...(pool && { pool }),
  });
  syncCatalog(id);
  return shop;
}

/** The server's own owner key for a pooled shop: makes the shop's Alta account and signs its agents' mandates. */
async function serverWallet(shopId: string) {
  const key = generatePrivateKey();
  const owner = privateKeyToAccount(key);
  const file = join(root, "data/shops", shopId, "owner-key.json");
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  writeFileSync(file, `${JSON.stringify({ address: owner.address, privateKey: key })}\n`, { mode: 0o600 });
  shops().update(shopId, { metalOwner: owner.address });
  const shop = shops().get(shopId)!;
  const o = { dir: metalDirFor(shopId), platformDir: platformMetalDir(), owner: owner.address };
  const r = await prepareShopSetup({ ...o, policy: policyOf(shop) });
  if (r.done) return;
  const signature = await owner.signTypedData(ownerTypedData({ ...r.prepared, nonce: BigInt(r.prepared.nonce), validUntil: BigInt(r.prepared.validUntil) }) as any);
  await finishShopSetup({ ...o, signature, digest: r.prepared.digest });
}

/** Builds one pooled shop to the end. Ready only if it has sales and chats to show. */
async function build(kind: DemoShopKind, origin: string) {
  const shop = await newDemoShop(kind, "preparing");
  try {
    await Promise.all([
      runDemo(shop.id, origin, kind.buys),
      serverWallet(shop.id).then(() => startDemoChats(shop.id)),
    ]);
  } catch (e) {
    console.error(`demo pool: ${shop.id}:`, e);
  }
  const { ledger, conversations } = deps(shop.id);
  const ok = ledger.orders().length > 0 && conversations.list().length > 0;
  if (shops().get(shop.id)?.pool === "preparing") shops().update(shop.id, { pool: ok ? "ready" : "failed" });
  console.log(`demo pool: ${shop.id} (${kind.kind}) ${ok ? "ready" : "failed"}`);
}

const perKind = () => Number(process.env.DEMO_POOL_PER_KIND ?? 1);
const g = globalThis as unknown as { asaDemoPool?: Promise<void> };

/** Tops each kind up to DEMO_POOL_PER_KIND ready shops, one shop at a time. Safe to call often. */
export function ensurePool(origin: string) {
  if (!process.env.METAL_RPC_URL || perKind() <= 0) return;
  if (g.asaDemoPool) return;
  g.asaDemoPool = (async () => {
    try {
      for (let round = 0; round < perKind(); round++) {
        for (const kind of demoShops) {
          const since = new Date(Date.now() - 86_400_000).toISOString();
          const all = shops().list();
          if (all.filter((s) => s.demo && s.createdAt > since).length >= Number(process.env.DEMO_SHOPS_PER_DAY ?? 40)) return;
          // A shop left "preparing" by a restart never finishes: it doesn't count.
          const waiting = all.filter((s) => s.name === kind.name && s.pool === "ready").length;
          if (waiting < perKind()) await build(kind, origin);
        }
      }
    } catch (e) {
      console.error("demo pool:", e);
    } finally {
      g.asaDemoPool = undefined;
    }
  })();
}

/**
 * The shop "Try it" opens for this kind: the oldest ready one, taken out of the pool, or when the pool
 * is empty the newest finished demo shop of that kind, shared. Never one still being built.
 */
export function demoShopFor(kind: DemoShopKind): Shop | undefined {
  const mine = shops().list().filter((s) => s.demo && s.name === kind.name);
  const ready = mine.find((s) => s.pool === "ready");
  if (ready) return shops().update(ready.id, { pool: undefined });
  return mine
    .filter((s) => !s.pool && s.bills?.length)
    .filter((s) => { const { ledger, conversations } = deps(s.id); return ledger.orders().length > 0 && conversations.list().length > 0; })
    .at(-1);
}

/** Where this server answers itself: INTERNAL_URL, its own port (Railway sets PORT), or the dev port. */
export const serverOrigin = () =>
  process.env.INTERNAL_URL?.replace(/\/+$/, "") ?? `http://127.0.0.1:${process.env.PORT ?? 3001}`;
