"use client";

import Link from "next/link";
import { useActionState } from "react";
import { TryIt } from "@/components/try-it";
import { logInAction } from "./actions";

const input = "mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm";

export default function Login() {
  const [state, action, pending] = useActionState(logInAction, null);
  return (
    <main className="mx-auto max-w-6xl px-6 pt-16 pb-20 sm:pt-20">
      <div className="flex flex-col gap-12 lg:flex-row lg:items-start lg:gap-16">
        <TryIt />
        <aside className="w-full rounded-xl border border-border bg-panel p-6 lg:mt-2 lg:w-80 lg:shrink-0">
          <h2 className="font-semibold">Already have a shop?</h2>
          <p className="mt-1 text-sm text-muted">Sign in to see your sales and your agent.</p>
          <form action={action} className="mt-5 space-y-4">
            <label className="block text-sm">
              Email
              <input name="email" type="email" autoComplete="username" required defaultValue={state?.email} key={state?.email} className={input} />
            </label>
            <label className="block text-sm">
              Password
              <input name="password" type="password" autoComplete="current-password" required className={input} />
            </label>
            {state?.error ? <p role="alert" className="text-sm text-red-400">{state.error}</p> : null}
            <button type="submit" disabled={pending} className="btn btn-secundario btn-ancho">
              {pending ? "Signing in..." : "Sign in"}
            </button>
            <p className="text-center text-sm text-muted">New here? <Link href="/signup" className="underline">Open your real shop</Link></p>
          </form>
        </aside>
      </div>
    </main>
  );
}
