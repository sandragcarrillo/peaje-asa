/**
 * Opens a shop's Airwallex connected account (Kit 5) and its two payees. Used by the owner's button
 * on Overview and, for a "Try it" shop, in the background right after it's made. Safe to repeat.
 */
import "./env";
import { join } from "node:path";
import { demoShops } from "@peaje-asa/policy";
import { openAccount, sandboxKyc, sandboxPayee } from "@peaje-asa/treasury-agent";
import { deps } from "./deps";
import { root } from "./env";
import { getShop, shops } from "./shops";

export async function openShopAccount(shopId: string) {
  const shop = getShop(shopId);
  if (!shop) throw new Error(`No shop ${shopId}`);
  if (shop.airwallexAccountId && shop.payTo) return { accountId: shop.airwallexAccountId, payTo: shop.payTo, opened: false };
  const { awx } = deps(shop.id);
  const file = join(root, "data/airwallex/sandbox-payees.json");
  const accountId = shop.airwallexAccountId ?? (await openAccount(awx, sandboxKyc(shop.name, shop.ownerEmail, shop.about || `Products sold online by ${shop.name}`))).accountId;
  shops().update(shop.id, { airwallexAccountId: accountId });
  // A demo shop gets the supplier that fits what it sells; every other shop keeps the sample one.
  const kind = shop.demo ? demoShops.find((k) => k.name === shop.name) : undefined;
  const supplier = kind && kind.kind !== "coffee"
    ? await sandboxPayee(awx, file, `supplier:${kind.kind}`, kind.supplier.name, kind.supplier.description)
    : await sandboxPayee(awx, file, "supplier", "Andes Green Coffee Imports", "Green coffee imports sold to roasters");
  const owner = await sandboxPayee(awx, file, `owner:${shop.id}`, `${shop.name} owner`, "The shop owner's own account");
  shops().update(shop.id, { payTo: { supplier, owner } });
  return { accountId, payTo: { supplier, owner }, opened: true };
}
