"use client";

import { useState } from "react";

/** A line of code to paste somewhere else, with a button that copies it. */
export function CopySnippet({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-stretch">
      <pre className="min-w-0 flex-1 overflow-x-auto border border-border bg-bg px-3 py-2.5 font-mono text-xs leading-relaxed"><code>{code}</code></pre>
      <button type="button" onClick={copy} className="btn btn-secundario btn-chico shrink-0 self-start sm:self-auto">{copied ? "Copied" : "Copy"}</button>
    </div>
  );
}
