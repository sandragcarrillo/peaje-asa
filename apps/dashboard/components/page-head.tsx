import { Etiqueta } from "./etiqueta";

export function PageHead({ eyebrow, title, sub }: { eyebrow: string; title: string; sub?: string }) {
  return (
    <div className="space-y-2">
      <Etiqueta dot>{eyebrow}</Etiqueta>
      <h1 className="text-3xl font-bold tracking-tight break-words">{title}</h1>
      {sub ? <p className="max-w-2xl text-sm text-muted">{sub}</p> : null}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="border border-dashed border-border p-6 text-sm text-muted">{children}</p>;
}

/** Status as a mono label with a dot: accent when it's good news, red when it needs the owner. */
export function Status({ children, tone = "muted" }: { children: React.ReactNode; tone?: "accent" | "muted" | "alert" }) {
  const dot = tone === "accent" ? "bg-accent" : tone === "alert" ? "bg-red-500" : "bg-faint";
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap">
      <span aria-hidden className={`h-1.5 w-1.5 ${dot}`} />
      {children}
    </span>
  );
}
