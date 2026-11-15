"use client";

import { useActionState, useState } from "react";
import { demoShops } from "@peaje-asa/policy";
import { tryItAction } from "@/app/(console)/try/actions";

const STEPS = [
  {
    title: "Get a shop",
    text: "A shop of your own, with products and an AI sales agent, ready in seconds.",
    icon: <path d="M3 9l1.5-5h15L21 9M4 9v11h16V9M3 9h18M9 20v-6h6v6" />,
  },
  {
    title: "Buy something",
    text: "Chat with your shop like a customer. The agent sends a payment link; pay with a test card.",
    icon: <path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1z" />,
  },
  {
    title: "See your books",
    text: "The sale, what the AI cost and your profit show up in your shop the moment it's paid.",
    icon: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  },
];

/** The judge's way in: what the product does in one line, one button, and what happens next. */
export function TryIt() {
  const [state, action, pending] = useActionState(tryItAction, null);
  const [kind, setKind] = useState(demoShops[0]!.kind);
  return (
    <div className="min-w-0 flex-1">
      <p className="text-sm font-medium text-accent">Peaje ASA</p>
      <h1 className="mt-3 max-w-xl text-4xl leading-tight font-semibold sm:text-5xl">An AI agent that sells for your shop and keeps the books</h1>
      <p className="mt-4 max-w-lg text-lg text-muted">
        It answers your customers, sends them a payment link and records every sale with what it cost you. Pick a shop and try it, no sign up.
      </p>

      <form action={action} className="mt-8">
        <fieldset>
          <legend className="text-sm text-muted">What does your shop sell?</legend>
          <div className="mt-2 flex flex-wrap gap-2">
            {demoShops.map((k) => (
              <label key={k.kind} className={`cursor-pointer rounded-lg border px-4 py-2.5 text-sm transition-colors ${kind === k.kind ? "border-accent bg-panel font-semibold" : "border-border text-muted hover:text-text"}`}>
                <input type="radio" name="kind" value={k.kind} checked={kind === k.kind} onChange={() => setKind(k.kind)} className="sr-only" />
                {k.label}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="mt-5 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
        <button type="submit" disabled={pending} className="btn btn-primario h-12 px-7 text-base">
          {pending ? "Opening your shop..." : "Try it with a demo shop"}
        </button>
        <span className="text-sm text-muted">Free. Test money only, nothing real is charged.</span>
        </div>
      </form>
      {state?.error ? <p role="alert" className="mt-3 text-sm text-red-400">{state.error}</p> : null}

      <ol className="mt-12 grid gap-3 sm:grid-cols-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="rounded-xl border border-border bg-panel p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-bg text-accent">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="h-5 w-5">{s.icon}</svg>
              </span>
              <span className="text-sm text-muted">Step {i + 1}</span>
            </div>
            <h2 className="mt-4 font-semibold">{s.title}</h2>
            <p className="mt-1 text-sm text-muted">{s.text}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
