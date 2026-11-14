"use client";

import { useState } from "react";
import { lowestAutoPrice, type OwnerPolicy } from "@peaje-asa/policy";

const box = "mt-1.5 flex items-center rounded-lg border border-border bg-bg focus-within:border-accent";
const bare = "w-full min-w-0 bg-transparent px-3 py-2 text-base outline-none sm:text-sm";
const num = (s: string) => Number(s.replace(",", "."));
const money = (n: number) => `${n.toFixed(2)} USD`;

/**
 * Price and cost for a new product, and what the agent would do with them as the owner types:
 * the margin, and the lowest price it would accept on its own under the shop's rules.
 */
export function PricePreview({ rules }: { rules: Pick<OwnerPolicy, "marginFloor" | "maxAutoDiscount"> }) {
  const [price, setPrice] = useState("");
  const [cost, setCost] = useState("");
  const p = num(price), c = num(cost);
  const ready = p > 0 && c >= 0 && price.trim() !== "" && cost.trim() !== "";
  const margin = ready ? (p - c) / p : 0;

  let preview: React.ReactNode = <span className="text-faint">Type a price and a cost to see what the agent would do.</span>;
  if (ready && c >= p) preview = <span className="text-red-300">It costs you as much as it sells for: the agent could only sell it at a loss.</span>;
  else if (ready) {
    const floor = lowestAutoPrice(p, c, { ...rules } as OwnerPolicy);
    const under = margin < rules.marginFloor;
    preview = (
      <span className="flex flex-wrap gap-x-5 gap-y-1">
        <span>Margin <b className={`font-mono ${under ? "text-amber-400" : "text-accent"}`}>{(margin * 100).toFixed(1)}%</b></span>
        {under
          ? <span className="text-amber-400">Below your lowest margin: the agent can't sell it on its own, every sale goes to you.</span>
          : <span>Agent sells down to <b className="font-mono">{money(floor)}</b></span>}
      </span>
    );
  }

  return (
    <>
      <label className="flex flex-col text-sm">
        Price
        <span className={box}>
          <input name="listPrice" required inputMode="decimal" placeholder="14.00" value={price} onChange={(e) => setPrice(e.target.value)} className={bare} />
          <span className="pr-3 font-mono text-xs text-faint">USD</span>
        </span>
      </label>
      <label className="flex flex-col text-sm">
        What it costs you
        <span className={box}>
          <input name="unitCost" required inputMode="decimal" placeholder="8.00" value={cost} onChange={(e) => setCost(e.target.value)} className={bare} />
          <span className="pr-3 font-mono text-xs text-faint">USD</span>
        </span>
      </label>
      <p aria-live="polite" className="text-sm sm:col-span-2 lg:col-span-4">{preview}</p>
    </>
  );
}
