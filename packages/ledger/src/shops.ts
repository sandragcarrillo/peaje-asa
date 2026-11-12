/**
 * Shops: anyone can open one. Each has its owner's login, what it sells and its rules (the
 * policy, catalog included), in the same SQLite file as the books. Every other table carries
 * the shop's id, so one shop never reads another's book, chats or approvals.
 */
import type { OwnerPolicy } from "@peaje-asa/policy";
import { defaultDbPath, openDatabase } from "./index.js";

export interface Shop {
  /** Slug used in URLs: /s/<id> is the shop's chat. */
  id: string;
  name: string;
  /** One line the agent uses to introduce the shop: what it sells and where. */
  about: string;
  ownerEmail: string;
  /** scrypt.<salt>.<hash>, base64url. */
  passwordHash: string;
  policy: OwnerPolicy;
  createdAt: string;
  /** A judge's throwaway shop from "Try it". */
  demo?: boolean;
  /** The address of the owner key made in the owner's browser. Set once: it owns the shop's Metal account. */
  metalOwner?: string;
  /** The shop's Airwallex connected account, once the platform opened one. Its money lives there. */
  airwallexAccountId?: string;
  /** Airwallex accounts the shop pays by Airwallex Pay: inventory to the supplier, profit to the owner. */
  payTo?: { supplier: { accountNumber: string; accountName: string }; owner: { accountNumber: string; accountName: string } };
}

export const slugify = (name: string) =>
  name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "shop";

export class ShopStore {
  private db;

  constructor(path = defaultDbPath()) {
    this.db = openDatabase(path);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS shops (id TEXT PRIMARY KEY, owner_email TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, body TEXT NOT NULL);
    `);
  }

  get(id: string): Shop | undefined {
    const row = this.db.prepare("SELECT body FROM shops WHERE id = ?").get(id) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  byEmail(email: string): Shop | undefined {
    const row = this.db.prepare("SELECT body FROM shops WHERE owner_email = ?").get(email.trim().toLowerCase()) as { body: string } | undefined;
    return row ? JSON.parse(row.body) : undefined;
  }

  list(): Shop[] {
    return (this.db.prepare("SELECT body FROM shops ORDER BY created_at").all() as { body: string }[]).map((r) => JSON.parse(r.body));
  }

  /** A free id for this name: the slug, or the slug with a number. */
  freeId(name: string) {
    const base = slugify(name);
    for (let n = 1; ; n++) {
      const id = n === 1 ? base : `${base}-${n}`;
      if (!this.get(id)) return id;
    }
  }

  /** Refuses a taken id or an email that already owns a shop. */
  create(s: Omit<Shop, "createdAt"> & { createdAt?: string }): Shop {
    const shop: Shop = { ...s, ownerEmail: s.ownerEmail.trim().toLowerCase(), createdAt: s.createdAt ?? new Date().toISOString() };
    this.db.prepare("INSERT INTO shops (id, owner_email, created_at, body) VALUES (?, ?, ?, ?)").run(shop.id, shop.ownerEmail, shop.createdAt, JSON.stringify(shop));
    return shop;
  }

  /** Name, about, rules and catalog can change; the id and the owner's email can't. */
  update(id: string, patch: Partial<Pick<Shop, "name" | "about" | "policy" | "airwallexAccountId" | "payTo" | "passwordHash" | "metalOwner">>): Shop {
    const s = this.get(id);
    if (!s) throw new Error(`No shop ${id}`);
    const next = { ...s, ...patch };
    this.db.prepare("UPDATE shops SET body = ? WHERE id = ?").run(JSON.stringify(next), id);
    return next;
  }
}
