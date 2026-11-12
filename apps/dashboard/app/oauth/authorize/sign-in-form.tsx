"use client";

import { useActionState } from "react";
import { approveAction } from "./actions";

const input = "mt-1.5 w-full rounded-lg border border-border bg-panel px-3 py-2.5 text-base outline-none focus:border-accent sm:text-sm";

export function SignInForm({ fields }: { fields: Record<string, string> }) {
  const [state, action, pending] = useActionState(approveAction, null);
  return (
    <form action={action} className="mt-6 space-y-4">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <label className="block text-sm">
        Your email, for the receipt
        <input name="email" type="email" autoComplete="email" required className={input} />
      </label>
      {state?.error ? <p role="alert" className="text-sm text-red-400">{state.error}</p> : null}
      <button type="submit" disabled={pending} className="btn btn-primario btn-ancho">
        {pending ? "Connecting..." : "Continue"}
      </button>
    </form>
  );
}
