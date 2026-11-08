"use client";

import Link from "next/link";
import { useActionState } from "react";
import { Etiqueta } from "@/components/etiqueta";
import { signUpAction } from "./actions";

const input = "mt-1.5 w-full rounded-lg border border-border bg-panel px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm";

export default function Signup() {
  const [state, action, pending] = useActionState(signUpAction, null);
  const v = state?.values;
  return (
    <main className="mx-auto max-w-5xl px-6 pt-10 pb-20">
      <div className="flex min-h-[65vh] items-center justify-center">
        <div className="w-full max-w-md border border-border bg-panel p-6 sm:p-8">
          <Etiqueta dot>New shop</Etiqueta>
          <h1 className="mt-3 text-2xl font-semibold">Open your shop</h1>
          <p className="mt-2 text-sm text-muted">An agent sells for you in chat, pays its own model calls and reports to you. You set the prices and the rules; it never goes past them.</p>
          <form action={action} className="mt-6 space-y-4">
            <label className="block text-sm">
              Shop name
              <input name="name" required maxLength={60} defaultValue={v?.name} key={`n${v?.name}`} placeholder="Tostadero Andino" className={input} />
            </label>
            <label className="block text-sm">
              What you sell and where
              <input name="about" required maxLength={200} defaultValue={v?.about} key={`a${v?.about}`} placeholder="a specialty coffee shop in Bogotá that sells beans and coffee equipment" className={input} />
            </label>
            <label className="block text-sm">
              Email
              <input name="email" type="email" autoComplete="username" required defaultValue={v?.email} key={`e${v?.email}`} className={input} />
            </label>
            <label className="block text-sm">
              Password
              <input name="password" type="password" autoComplete="new-password" required minLength={12} placeholder="12 characters or more" className={input} />
            </label>
            <label className="flex items-start gap-2 text-sm text-muted">
              <input name="sample" type="checkbox" defaultChecked className="mt-1" />
              <span>Start with a sample coffee catalog. Leave it off to add your own products first.</span>
            </label>
            {state?.error ? <p role="alert" className="text-sm text-red-400">{state.error}</p> : null}
            <button type="submit" disabled={pending} className="btn btn-primario btn-ancho">
              {pending ? "Opening..." : "Open the shop"}
            </button>
            <p className="text-center text-sm text-muted">Already have one? <Link href="/login" className="underline">Sign in</Link></p>
          </form>
        </div>
      </div>
    </main>
  );
}
