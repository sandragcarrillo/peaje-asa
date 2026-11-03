"use client";

import { useActionState } from "react";
import { Etiqueta } from "@/components/etiqueta";
import { logInAction } from "./actions";

const input = "mt-1.5 w-full rounded-lg border border-border bg-panel px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm";

export default function Login() {
  const [state, action, pending] = useActionState(logInAction, null);
  return (
    <main className="mx-auto max-w-5xl px-6 pt-10 pb-20">
      <div className="flex min-h-[65vh] items-center justify-center">
        <div className="w-full max-w-sm border border-border bg-panel p-6 sm:p-8">
          <Etiqueta dot>Owner access</Etiqueta>
          <h1 className="mt-3 text-2xl font-semibold">Sign in to your shop</h1>
          <p className="mt-2 text-sm text-muted">Approvals, payouts, disputes and the advance. Customers never see this page.</p>
          <form action={action} className="mt-6 space-y-4">
            <label className="block text-sm">
              Email
              <input name="email" type="email" autoComplete="username" required defaultValue={state?.email} key={state?.email} className={input} />
            </label>
            <label className="block text-sm">
              Password
              <input name="password" type="password" autoComplete="current-password" required className={input} />
            </label>
            {state?.error ? <p role="alert" className="text-sm text-red-400">{state.error}</p> : null}
            <button type="submit" disabled={pending} className="btn btn-primario btn-ancho">
              {pending ? "Signing in..." : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
