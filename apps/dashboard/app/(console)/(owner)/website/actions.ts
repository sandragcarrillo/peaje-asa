"use server";

import { revalidatePath } from "next/cache";
import type { ActionResult } from "@/components/action-form";
import { requireOwner } from "@/lib/auth";
import { shops } from "@/lib/shops";

const MAX_SITES = 10;

/** One website per line, kept as its origin. https only, except localhost for trying it out. */
function originOf(line: string): string | Error {
  let url: URL;
  try {
    url = new URL(/^[a-z]+:\/\//i.test(line) ? line : `${/^(localhost|127\.0\.0\.1)(:|$)/.test(line) ? "http" : "https"}://${line}`);
  } catch {
    return new Error(`"${line}" isn't a web address`);
  }
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) return new Error(`${url.origin}: use https`);
  return url.origin;
}

export async function saveEmbedOriginsAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const { shop } = await requireOwner();
  const lines = String(form.get("sites") ?? "").split(/[\s,]+/).map((l) => l.trim()).filter(Boolean);
  if (lines.length > MAX_SITES) return { ok: false, message: `Up to ${MAX_SITES} websites.` };
  const origins: string[] = [];
  for (const line of lines) {
    const o = originOf(line);
    if (o instanceof Error) return { ok: false, message: o.message };
    if (!origins.includes(o)) origins.push(o);
  }
  shops().update(shop.id, { embedOrigins: origins });
  revalidatePath("/", "layout");
  return { ok: true, message: origins.length ? `Saved. The chat can show on ${origins.join(", ")}.` : "Saved. The chat won't show on any website." };
}
