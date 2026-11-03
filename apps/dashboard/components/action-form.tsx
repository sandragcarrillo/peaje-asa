"use client";

import { useActionState } from "react";

export type ActionResult = { ok: boolean; message: string; lines?: string[] } | null;

/**
 * A form that runs one server action and shows what happened under the button.
 * Hidden fields carry what the owner saw (an id, an amount), so the server can check it didn't change.
 */
export function ActionForm({
  action, label, pendingLabel = "Working...", fields, secondary, small, wide, children,
}: {
  action: (prev: ActionResult, form: FormData) => Promise<ActionResult>;
  label: string;
  pendingLabel?: string;
  fields?: Record<string, string | number>;
  secondary?: boolean;
  small?: boolean;
  wide?: boolean;
  children?: React.ReactNode;
}) {
  const [state, run, pending] = useActionState(action, null);
  return (
    <form action={run} className="space-y-3">
      {Object.entries(fields ?? {}).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      {children}
      <button type="submit" disabled={pending} className={`btn ${secondary ? "btn-secundario" : "btn-primario"} ${small ? "btn-chico" : ""} ${wide ? "btn-ancho" : ""}`}>
        {pending ? pendingLabel : label}
      </button>
      {state ? (
        <div role="status" className={`border p-3 text-sm ${state.ok ? "border-border bg-bg" : "border-red-500/50 bg-red-500/10 text-red-300"}`}>
          <p>{state.message}</p>
          {state.lines?.length ? (
            <ul className="mt-2 space-y-1 font-mono text-xs text-muted">
              {state.lines.map((l, i) => <li key={i}>{l}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}
    </form>
  );
}
