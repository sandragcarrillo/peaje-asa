"use server";

/**
 * The owner edits what the shop sells and the rules the agents obey. These are money rules, so they
 * are validated here and stored with the shop; the agents pick them up on their next request.
 */
import { revalidatePath } from "next/cache";
import type { Product } from "@peaje-asa/policy";
import type { ActionResult } from "@/components/action-form";
import { requireOwner } from "@/lib/auth";
import { policyOf, shops } from "@/lib/shops";

const MAX_PRODUCTS = 200;
const num = (form: FormData, k: string) => Number(String(form.get(k) ?? "").replace(",", "."));
const round2 = (n: number) => Math.round(n * 100) / 100;

function skuFor(name: string, taken: Set<string>) {
  const base = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 24) || "ITEM";
  for (let n = 1; ; n++) {
    const sku = n === 1 ? base : `${base}-${n}`;
    if (!taken.has(sku)) return sku;
  }
}

async function edit(fn: (catalog: Product[], shopId: string) => ActionResult | Product[]): Promise<ActionResult> {
  const { shop } = await requireOwner();
  const policy = policyOf(shop);
  const out = fn([...policy.catalog], shop.id);
  if (!Array.isArray(out)) return out;
  shops().update(shop.id, { policy: { ...policy, catalog: out } });
  revalidatePath("/", "layout");
  return null;
}

export async function addProductAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const name = String(form.get("name") ?? "").trim();
  const category = String(form.get("category") ?? "").trim().toLowerCase() || "general";
  const listPrice = round2(num(form, "listPrice"));
  const unitCost = round2(num(form, "unitCost"));
  if (name.length < 2 || name.length > 80) return { ok: false, message: "Name it in 2 to 80 characters." };
  if (!(listPrice > 0) || listPrice > 1_000_000) return { ok: false, message: "The price has to be above 0." };
  if (!(unitCost >= 0) || unitCost >= listPrice) return { ok: false, message: "What it costs you has to be below its price, or the agent could only sell it at a loss." };
  let added = "";
  const r = await edit((catalog) => {
    if (catalog.filter((p) => !p.archived).length >= MAX_PRODUCTS) return { ok: false, message: `A shop can list up to ${MAX_PRODUCTS} products.` };
    const sku = skuFor(name, new Set(catalog.map((p) => p.sku)));
    added = name;
    return [...catalog, { sku, name, category, listPrice, unitCost }];
  });
  return r ?? { ok: true, message: `${added} is on sale. The agent can quote it from the next message.` };
}

export async function archiveProductAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const sku = String(form.get("sku") ?? "");
  const r = await edit((catalog) => {
    const i = catalog.findIndex((p) => p.sku === sku);
    if (i < 0) return { ok: false, message: "That product isn't in the catalog." };
    catalog[i] = { ...catalog[i], archived: true };
    return catalog;
  });
  return r ?? { ok: true, message: "Taken off sale. Orders that already name it keep it." };
}

export async function updateRulesAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { shop } = await requireOwner();
  const policy = policyOf(shop);
  const about = String(form.get("about") ?? "").trim();
  const marginFloor = num(form, "marginFloor") / 100;
  const maxAutoDiscount = num(form, "maxAutoDiscount") / 100;
  const approvalThreshold = round2(num(form, "approvalThreshold"));
  const reserveFloor = round2(num(form, "reserveFloor"));
  if (about.length < 10 || about.length > 200) return { ok: false, message: "Say in one line what the shop sells and where (10 to 200 characters)." };
  if (!(marginFloor >= 0 && marginFloor < 0.95)) return { ok: false, message: "The lowest margin goes from 0% to 95%." };
  if (!(maxAutoDiscount >= 0 && maxAutoDiscount <= 0.5)) return { ok: false, message: "The agent's own discount goes from 0% to 50%." };
  if (!(approvalThreshold > 0)) return { ok: false, message: "Payments above some amount must wait for you: set it above 0." };
  if (!(reserveFloor >= 0)) return { ok: false, message: "The reserve can't be negative." };
  shops().update(shop.id, { about, policy: { ...policy, marginFloor, maxAutoDiscount, approvalThreshold, reserveFloor } });
  revalidatePath("/", "layout");
  return { ok: true, message: "Saved. The agents follow the new rules from their next step." };
}
