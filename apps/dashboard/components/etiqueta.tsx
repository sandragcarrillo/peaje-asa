/** Small mono eyebrow, with the accent dot when it marks the page. */
export function Etiqueta({ children, dot }: { children: React.ReactNode; dot?: boolean }) {
  return (
    <p className="flex items-center gap-2 font-mono text-xs text-muted">
      {dot ? <span aria-hidden className="h-1.5 w-1.5 bg-accent" /> : null}
      {children}
    </p>
  );
}
