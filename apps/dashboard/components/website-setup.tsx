"use client";

import { useState } from "react";

/** A box of text to paste somewhere else, with a copy button in its corner. */
function CopyBox({ label, text, tall = false }: { label: string; text: string; tall?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }
  return (
    <div className="relative rounded-lg border border-border bg-bg">
      <div className="flex items-center justify-between border-b border-border px-4 py-2">
        <span className="font-mono text-xs text-muted">{label}</span>
        <button type="button" onClick={copy} className="btn btn-secundario btn-chico">{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre className={`overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-xs leading-relaxed ${tall ? "max-h-80" : ""}`}><code>{text}</code></pre>
    </div>
  );
}

/** One numbered step, joined to the next by a line. */
function Step({ n, title, sub, last = false, children }: { n: number; title: string; sub?: React.ReactNode; last?: boolean; children?: React.ReactNode }) {
  return (
    <li className="relative grid grid-cols-[2.25rem_1fr] gap-4">
      {!last ? <span aria-hidden className="absolute top-10 bottom-0 left-[1.1rem] w-px bg-border" /> : null}
      <span aria-hidden className="relative grid h-9 w-9 place-items-center rounded-lg border border-border bg-panel font-mono text-sm text-muted">{n}</span>
      <div className="min-w-0 space-y-3 pb-10">
        <div className="space-y-1">
          <h3 className="font-semibold">{title}</h3>
          {sub ? <p className="text-sm text-muted">{sub}</p> : null}
        </div>
        {children}
      </div>
    </li>
  );
}

const COLORS = ["#008069", "#1a56c4", "#c2410c", "#7c3aed", "#111111"];

/**
 * Two ways to put the shop's chat on its website: by hand, step by step, or by pasting one prompt
 * into whatever builds the site (an AI website builder, a coding agent, or the person who runs it).
 */
export function WebsiteSetup({ shopId, origin, sites, sitesForm }: { shopId: string; origin: string; sites: string[]; sitesForm: React.ReactNode }) {
  const [tab, setTab] = useState<"steps" | "prompt">("steps");
  const [label, setLabel] = useState("Chat with us");
  const [color, setColor] = useState(COLORS[0]!);

  const extras = `${label && label !== "Chat with us" ? ` data-label="${label.replace(/"/g, "&quot;")}"` : ""}${color !== COLORS[0] ? ` data-color="${color}"` : ""}`;
  const snippet = `<script src="${origin}/widget.js" data-shop="${shopId}"${extras} async></script>`;
  const where = sites.length ? sites.join(", ") : "my website";
  const prompt = `Add my shop's chat button to ${where}.

Paste this line just before the closing </body> tag, on every page where customers should see the chat:

${snippet}

Then publish the site and open it. A round chat button should show in the bottom right corner; clicking it opens the shop's chat.

If no button shows, open the browser console and look for a message starting with "Peaje ASA". It means the site's address isn't on the shop's list of websites${sites.length ? ` (${sites.join(", ")})` : ""}: the address must match exactly, https included.

Don't change anything else on the site.`;

  const tabs = [
    { id: "steps", label: "Step by step" },
    { id: "prompt", label: "Setup prompt" },
  ] as const;

  return (
    <div className="space-y-8">
      <div role="tablist" className="inline-flex rounded-xl border border-border bg-panel p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            type="button"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`rounded-lg px-5 py-2 text-sm transition-colors ${tab === t.id ? "bg-text font-semibold text-bg shadow-sm" : "text-muted hover:text-text"}`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ol>
        <Step n={1} title="Tell us your website" sub="Only the websites you list here can show your chat. If someone copies the code onto another site, the button doesn't show up there.">
          {sitesForm}
        </Step>

        {tab === "steps" ? (
          <>
            <Step n={2} title="Pick how the button looks" sub="It sits in the bottom right corner of every page.">
              <div className="flex flex-wrap items-end gap-6">
                <label className="block text-sm">
                  Button text
                  <input value={label} maxLength={30} onChange={(e) => setLabel(e.target.value)} className="mt-1.5 block w-56 rounded-lg border border-border bg-bg px-3 py-2 text-base outline-none focus:border-accent sm:text-sm" />
                </label>
                <fieldset className="text-sm">
                  <legend>Color</legend>
                  <div className="mt-1.5 flex gap-2">
                    {COLORS.map((c) => (
                      <button key={c} type="button" aria-label={`Color ${c}`} aria-pressed={color === c} onClick={() => setColor(c)}
                        className={`h-9 w-9 rounded-full border-2 ${color === c ? "border-text" : "border-transparent"}`} style={{ background: c }} />
                    ))}
                  </div>
                </fieldset>
                <span className="inline-flex h-12 items-center gap-2 rounded-full px-5 text-[15px] font-semibold text-white shadow-lg" style={{ background: color }}>
                  <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" /></svg>
                  {label || "Chat with us"}
                </span>
              </div>
            </Step>
            <Step n={3} title="Copy the code" sub="Paste it where your website builder takes custom code. Wix, Shopify, WordPress and Squarespace all have a spot for it, usually called custom code or embed code. Not sure where? Use the setup prompt.">
              <CopyBox label="Your chat button" text={snippet} />
            </Step>
            <Step n={4} title="Open your website" sub="Publish your site and open it. The chat button shows in the corner; try asking it for something." last />
          </>
        ) : (
          <Step n={2} title="Copy the setup prompt" sub="Paste it into the AI that builds your site (Lovable, Wix, Shopify Magic, ChatGPT, Claude, Cursor) or send it to the person who runs your website." last>
            <CopyBox label="Setup prompt" text={prompt} tall />
          </Step>
        )}
      </ol>
    </div>
  );
}
