const fmt = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const money = (n: number) => fmt.format(n);
export const usd = (n: number) => `${fmt.format(n)} USD`;
export const when = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
