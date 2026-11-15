"use server";

/**
 * The owner tells the treasury agent what the shop owes its suppliers and when. The close pays
 * each bill on its due date; nothing is paid to a supplier that isn't on this list.
 */
import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { billStatus } from "@peaje-asa/treasury-agent";
import type { ActionResult } from "@/components/action-form";
import { requireOwner } from "@/lib/auth";
import { deps } from "@/lib/deps";
import { shops } from "@/lib/shops";

const MAX_BILLS = 200;
const round2 = (n: number) => Math.round(n * 100) / 100;

export async function addBillAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { shop } = await requireOwner();
  const supplier = String(form.get("supplier") ?? "").trim().slice(0, 80);
  const note = String(form.get("note") ?? "").trim().slice(0, 80);
  const amount = round2(Number(String(form.get("amount") ?? "").replace(",", ".")));
  const dueDate = String(form.get("dueDate") ?? "");
  if (!supplier) return { ok: false, message: "Who is the supplier?" };
  if (!(amount >= 1) || amount > 100_000) return { ok: false, message: "The amount must be between 1 and 100,000 USD." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate) || Number.isNaN(Date.parse(dueDate))) return { ok: false, message: "Pick the day it's due." };
  const bills = shop.bills ?? [];
  if (bills.length >= MAX_BILLS) return { ok: false, message: `Up to ${MAX_BILLS} bills. Remove paid ones you don't need.` };
  const bill = { id: randomBytes(4).toString("hex"), supplier, amount, dueDate, ...(note && { note }), createdAt: new Date().toISOString() };
  shops().update(shop.id, { bills: [...bills, bill] });
  revalidatePath("/", "layout");
  return { ok: true, message: `Added: ${amount.toFixed(2)} USD to ${supplier}, due ${dueDate}.` };
}

export async function removeBillAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { shop } = await requireOwner();
  const id = String(form.get("id") ?? "");
  const bill = (shop.bills ?? []).find((b) => b.id === id);
  if (!bill) return { ok: false, message: "That bill is gone already." };
  const status = billStatus(bill, deps(shop.id).treasury);
  if (status === "paying" || status === "paid") return { ok: false, message: "It's already paid, so it stays in your books." };
  if (status === "waiting_approval") return { ok: false, message: "It's waiting for your approval: decline it in Approvals first." };
  shops().update(shop.id, { bills: (shop.bills ?? []).filter((b) => b.id !== id) });
  revalidatePath("/", "layout");
  return { ok: true, message: "Removed." };
}
