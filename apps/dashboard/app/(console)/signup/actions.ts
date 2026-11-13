"use server";

import { redirect } from "next/navigation";
import { defaultPolicy, sampleCatalog } from "@peaje-asa/policy";
import { signUp, type LoginResult } from "@/lib/auth";
import { shops } from "@/lib/shops";
import { syncCatalog } from "@/lib/storefront";

export type SignupState = (LoginResult & { values?: Record<string, string> }) | null;

/** Opens a shop with the default rules. Its catalog is the sample (to try it) or empty (to add products first). */
export async function signUpAction(_prev: SignupState, form: FormData): Promise<SignupState> {
  const values = { name: String(form.get("name") ?? "").trim(), about: String(form.get("about") ?? "").trim(), email: String(form.get("email") ?? "").trim() };
  const sample = form.get("sample") === "on";
  if (values.name.length < 2 || values.name.length > 60) return { error: "Give the shop a name (2 to 60 characters).", values };
  if (values.about.length < 10 || values.about.length > 200) return { error: "Say in one line what the shop sells and where (10 to 200 characters).", values };
  const result = await signUp({
    email: values.email,
    password: String(form.get("password") ?? ""),
    create: (passwordHash) => {
      const store = shops();
      return store.create({
        id: store.freeId(values.name), name: values.name, about: values.about, ownerEmail: values.email, passwordHash,
        policy: { ...defaultPolicy, catalog: sample ? sampleCatalog : [] },
      });
    },
  });
  if (result) return { ...result, values };
  const created = shops().byEmail(values.email.toLowerCase());
  if (created) syncCatalog(created.id);
  redirect(sample ? "/" : "/catalog");
}
