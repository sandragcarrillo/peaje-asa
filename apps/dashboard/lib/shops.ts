/**
 * The shops this app serves, from the shared SQLite file. The demo shop (Tostadero Andino) is seeded
 * once from OWNER_EMAIL and OWNER_PASSWORD_HASH so the existing login and book keep working; every
 * other shop comes from the signup page.
 */
import "./env";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DEFAULT_SHOP, ShopStore, type Shop } from "@peaje-asa/ledger";
import { metalDir } from "@peaje-asa/metal";
import { defaultPolicy, type OwnerPolicy } from "@peaje-asa/policy";
import { SAMPLE_ABOUT } from "@peaje-asa/seller-agent";
import { root } from "./env";

const g = globalThis as unknown as { asaShops?: ShopStore };

export function shops(): ShopStore {
  if (g.asaShops) return g.asaShops;
  const s = new ShopStore();
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const hash = process.env.OWNER_PASSWORD_HASH;
  if (!s.get(DEFAULT_SHOP) && email && hash && !s.byEmail(email)) {
    // A fresh book (npm run demo -- --fresh) drops the shops table but not the shop's Metal files: keep its owner.
    const agents = join(metalDirFor(DEFAULT_SHOP), "agents.json");
    const metalOwner = existsSync(agents) ? (JSON.parse(readFileSync(agents, "utf8")) as { owner?: string }).owner : undefined;
    s.create({ id: DEFAULT_SHOP, name: "Tostadero Andino", about: SAMPLE_ABOUT, ownerEmail: email, passwordHash: hash, policy: defaultPolicy, ...(metalOwner && { metalOwner }) });
  }
  return (g.asaShops = s);
}

export const getShop = (id: string): Shop | undefined => shops().get(id);

/** The shop's rules over the current defaults, so a rule added later has a value for shops made before it. */
export const policyOf = (s: Shop): OwnerPolicy => ({ ...defaultPolicy, ...s.policy });

/** The platform's Metal files: the providers' and bridge's addresses and the gas sponsor. No owner key. */
export const platformMetalDir = () => metalDir(root);

/** Where the shop's agent keys and mandates live. The owner's key is never here: it stays in their browser. */
export const metalDirFor = (shopId: string) => join(root, "data/shops", shopId, "metal");
