"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * A "Try it" shop's own chat beside its back office: the judge buys there and the books follow.
 * On very wide screens it stays docked on the right; on anything narrower it slides in from a button,
 * so the back office keeps its full width. One frame either way, so the conversation never reloads.
 * The chat tells this page when its conversation changes and the page reloads its server data.
 */
export function DemoChat({ shopId, ready }: { shopId: string; ready: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.data?.type !== "asa-chat-update") return;
      clearTimeout(timer);
      timer = setTimeout(() => router.refresh(), 400);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("message", onMessage);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("message", onMessage); window.removeEventListener("keydown", onKey); clearTimeout(timer); };
  }, [router]);

  return (
    <>
      {open ? <button type="button" aria-label="Close the chat" onClick={() => setOpen(false)} className="fixed inset-0 z-40 bg-black/40 2xl:hidden" /> : null}
      <aside
        aria-label="Your shop's chat"
        className={`fixed inset-y-0 right-0 z-50 flex w-[min(400px,100vw)] flex-col border-l border-border bg-panel shadow-2xl transition-transform duration-200 2xl:sticky 2xl:top-0 2xl:z-auto 2xl:h-dvh 2xl:w-[380px] 2xl:shrink-0 2xl:translate-x-0 2xl:shadow-none ${open ? "translate-x-0" : "translate-x-full"}`}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <p className="text-xs text-muted">Your shop as a customer sees it. Buy something and watch the back office.</p>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-secundario btn-chico 2xl:hidden">Close</button>
        </div>
        <iframe key={ready ? "open" : "setup"} src={`/embed/${shopId}`} title="Your shop's chat" className="w-full flex-1 border-0" />
      </aside>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`fixed right-5 bottom-5 z-30 inline-flex h-14 items-center gap-2 rounded-full bg-[#008069] px-5 text-[15px] font-semibold text-white shadow-lg 2xl:hidden ${open ? "hidden" : ""}`}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className="h-5 w-5"><path d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z" /></svg>
        Try your shop&apos;s chat
      </button>
    </>
  );
}
