"use server";
import { redirect } from "next/navigation";
import { OAuthError, type AuthorizeRequest } from "@peaje-asa/storefront";
import { oauth } from "@/lib/storefront";

/** The shopper gave an email: send their Claude its code. */
export async function approveAction(_: unknown, form: FormData) {
  const req = Object.fromEntries(["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "scope"].map((k) => [k, String(form.get(k) ?? "") || undefined])) as unknown as AuthorizeRequest;
  let to: string;
  try {
    to = oauth().approve(req, String(form.get("email") ?? ""));
  } catch (e) {
    if (e instanceof OAuthError) return { error: e.description };
    throw e;
  }
  redirect(to);
}
