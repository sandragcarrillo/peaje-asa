/**
 * Small building blocks for owner pages written for anyone: a status pill in plain words,
 * an empty state that says what will show up and why, labelled numbers and short explainers.
 */

export type Tone = "alert" | "good" | "info" | "muted";

const PILL: Record<Tone, string> = {
  alert: "border-red-500/40 bg-red-500/10 text-red-300",
  good: "border-accent/40 bg-accent/10 text-accent",
  info: "border-border bg-panel-2 text-text",
  muted: "border-border bg-transparent text-muted",
};
const DOT: Record<Tone, string> = { alert: "bg-red-400", good: "bg-accent", info: "bg-text", muted: "bg-faint" };

/** A status in plain words, as a rounded pill with a colored dot. */
export function Badge({ tone = "muted", children }: { tone?: Tone; children: React.ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium whitespace-nowrap ${PILL[tone]}`}>
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} />
      {children}
    </span>
  );
}

/** What this list will hold once there's something in it, and what makes it appear. */
export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="space-y-2 rounded-lg border border-dashed border-border p-6">
      <p className="font-semibold">{title}</p>
      {children ? <div className="max-w-2xl space-y-2 text-sm text-muted">{children}</div> : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  );
}

/** A number with a label above it and one line saying what it means. */
export function Stat({ label, value, hint, strong }: { label: string; value: React.ReactNode; hint?: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`min-w-0 rounded-lg border bg-panel p-5 ${strong ? "border-accent" : "border-border"}`}>
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-2xl font-bold tabular-nums break-words">{value}</p>
      {hint ? <p className="mt-1.5 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/** A heading for a block of the page, with an optional one-line explanation. */
export function SectionHead({ title, sub, right }: { title: string; sub?: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="space-y-1">
        <h2 className="font-semibold">{title}</h2>
        {sub ? <p className="max-w-2xl text-sm text-muted">{sub}</p> : null}
      </div>
      {right}
    </div>
  );
}

/** "How it works" in a few numbered cards. */
export function HowItWorks({ title = "How it works", steps }: { title?: string; steps: { title: string; text: React.ReactNode }[] }) {
  return (
    <div className="space-y-3">
      <h2 className="text-sm font-semibold text-muted">{title}</h2>
      <ol className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(13rem,1fr))]">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-3 rounded-lg border border-border bg-panel p-4">
            <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-border bg-bg font-mono text-xs text-muted">{i + 1}</span>
            <span className="min-w-0 space-y-1">
              <span className="block text-sm font-semibold">{s.title}</span>
              <span className="block text-sm text-muted">{s.text}</span>
            </span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** Label and value rows, the value on the right. */
export function Facts({ rows }: { rows: { label: React.ReactNode; value: React.ReactNode; strong?: boolean }[] }) {
  return (
    <dl className="divide-y divide-border/60 text-sm">
      {rows.map((r, i) => (
        <div key={i} className={`flex items-baseline justify-between gap-4 py-2 ${r.strong ? "font-semibold" : ""}`}>
          <dt className={r.strong ? "" : "text-muted"}>{r.label}</dt>
          <dd className="text-right tabular-nums break-words">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Money with two decimals, or more when it's a fraction of a cent (an AI reply costs that little). */
export function tiny(n: number) {
  if (n > 0 && n < 0.01) return `${n.toLocaleString("en-US", { maximumSignificantDigits: 2 })} USD`;
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
}

/** "5 min ago", "3 h ago", or the date for anything older than a day. */
export function ago(iso: string, nowMs = Date.now()) {
  const s = Math.max(0, Math.round((nowMs - Date.parse(iso)) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** The three AI sizes the agent can pick for a reply, in words. */
export const TIER: Record<string, string> = { cheap: "Small AI", mid: "Standard AI", premium: "Advanced AI" };
