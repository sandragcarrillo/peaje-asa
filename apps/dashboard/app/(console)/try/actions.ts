"use server";

import { after } from "next/server";
import { redirect } from "next/navigation";
import type { Shop } from "@peaje-asa/ledger";
import { demoShops } from "@peaje-asa/policy";
import { runDemo } from "@/lib/demo-history";
import { demoShopFor, ensurePool, newDemoShop, serverOrigin } from "@/lib/demo-pool";
import { enterDemo, startDemo, type LoginResult } from "@/lib/auth";

/**
 * "Try it": opens a demo shop of the kind the judge picked (coffee, skincare or running gear) that the
 * server already built (lib/demo-pool.ts), with its sales, chats and the day's close. Only when no shop
 * of that kind was ever finished (a brand new server) is one built while the judge watches.
 * Nothing in either is staged: the wallet, the chat, the card payment and the money moves are real.
 */
export async function tryItAction(_prev: LoginResult, form: FormData): Promise<LoginResult> {
  const kind = demoShops.find((k) => k.kind === form.get("kind")) ?? demoShops[0]!;
  const origin = serverOrigin();
  // Build the next one for whoever clicks after.
  after(() => ensurePool(origin));
  const ready = demoShopFor(kind);
  if (ready) {
    const result = await enterDemo(ready);
    if (result) return result;
    redirect("/");
  }
  let fresh: Shop | undefined;
  const result = await startDemo(async () => (fresh = await newDemoShop(kind)));
  if (result) return result;
  const id = fresh!.id;
  after(() => runDemo(id, origin, kind.buys));
  redirect("/");
}
