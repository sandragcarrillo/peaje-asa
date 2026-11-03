/** Peaje's gate mark (base, post and striped arm), with the product name next to it. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 96" fill="none" aria-hidden="true" className={className}>
      <line x1="24" y1="84" x2="52" y2="84" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
      <line x1="38" y1="84" x2="38" y2="56" stroke="currentColor" strokeWidth="11" strokeLinecap="round" />
      <line x1="38" y1="56" x2="72" y2="11" stroke="currentColor" strokeWidth="12" strokeLinecap="round" />
      <line x1="44.5" y1="35" x2="53.5" y2="42" stroke="#17161a" strokeWidth="5" />
      <line x1="53" y1="24" x2="62" y2="31" stroke="#17161a" strokeWidth="5" />
      <line x1="61.5" y1="13.5" x2="70.5" y2="20.5" stroke="#17161a" strokeWidth="5" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="inline-flex items-end gap-1">
      <LogoMark className="h-4 w-4 text-accent" />
      <span className="font-mono text-sm tracking-tight text-text">peaje asa</span>
    </span>
  );
}
