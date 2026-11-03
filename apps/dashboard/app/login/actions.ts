"use server";

import { redirect } from "next/navigation";
import { logIn, logOut, type LoginResult } from "@/lib/auth";

export async function logInAction(_prev: (LoginResult & { email?: string }) | null, form: FormData) {
  const email = String(form.get("email") ?? "");
  const result = await logIn(email, String(form.get("password") ?? ""));
  // The email comes back so the form keeps it after React resets the fields.
  if (result) return { ...result, email };
  redirect("/");
}

export async function logOutAction() {
  await logOut();
  redirect("/login");
}
