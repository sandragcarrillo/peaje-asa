"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Line { from: "customer" | "agent" | "owner" | "system"; text: string; at: string }
interface View { id: string; status: string; transcript: Line[]; error?: string }

function time(at: string) {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/** Turns URLs in a message into links. */
function Linkified({ text }: { text: string }) {
  return (
    <>
      {text.split(/(https?:\/\/\S+)/g).map((part, i) =>
        /^https?:\/\//.test(part) ? <a key={i} href={part} target="_blank" rel="noreferrer">{part}</a> : part,
      )}
    </>
  );
}

/** The customer side of a shop: a chat with its seller agent. The server makes the conversation id on the first message; it then lives in the URL (?c=). */
export function ShopChat({ shop }: { shop: { id: string; name: string; about: string } }) {
  const base = `/api/s/${encodeURIComponent(shop.id)}`;
  const [id, setId] = useState<string>();
  const [conv, setConv] = useState<View>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Line>();
  const [error, setError] = useState<string>();
  const feed = useRef<HTMLDivElement>(null);

  // The conversation id lives in the URL (?c=) so the customer can reopen the chat.
  useEffect(() => {
    setId(new URL(window.location.href).searchParams.get("c") ?? undefined);
  }, []);

  const remember = useCallback((c: string | undefined) => {
    const url = new URL(window.location.href);
    if (c) url.searchParams.set("c", c);
    else url.searchParams.delete("c");
    window.history.replaceState(null, "", url);
    setId(c);
  }, []);

  const refresh = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`${base}/conversation/${id}`);
    if (res.status === 404) return remember(undefined);
    const body = (await res.json()) as View;
    if (res.ok) setConv(body);
  }, [id, base, remember]);

  useEffect(() => { refresh(); }, [refresh]);

  // While a payment link is out, ask the server to check Airwallex every few seconds; while the owner has the chat, look for their reply.
  useEffect(() => {
    if (conv?.status !== "awaiting_payment" && conv?.status !== "escalated") return;
    const t = setInterval(refresh, 3000);
    return () => clearInterval(t);
  }, [conv?.status, refresh]);

  useEffect(() => {
    feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" });
  }, [conv?.transcript.length, pending, busy]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || busy) return;
    setDraft("");
    setError(undefined);
    setPending({ from: "customer", text, at: new Date().toISOString() });
    setBusy(true);
    try {
      const res = await fetch(`${base}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, text }) });
      const body = (await res.json()) as View;
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setConv(body);
      if (body.id !== id) remember(body.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
    } finally {
      setPending(undefined);
      setBusy(false);
    }
  }

  function restart() {
    remember(undefined);
    setConv(undefined);
    setError(undefined);
  }

  const lines = [...(conv?.transcript ?? []), ...(pending ? [pending] : [])];
  const status = busy ? "typing..." : conv?.status === "escalated" ? "the owner will reply" : "online";

  return (
    <div className="chat-app"><main className="phone">
      <header className="header">
        <div className="avatar">{shop.name.split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase()}</div>
        <div className="who">
          <b>{shop.name}</b>
          <span>{status}</span>
        </div>
        <button onClick={restart}>New chat</button>
      </header>

      <div className="feed" ref={feed}>
        <div className="system">{shop.about.charAt(0).toUpperCase() + shop.about.slice(1)}. Ask what you need.</div>
        {lines.map((l, i) =>
          l.from === "system" ? (
            <div key={i} className="system"><Linkified text={l.text} /></div>
          ) : (
            <div key={i} className={`row ${l.from}`}>
              <div className="bubble">
                <Linkified text={l.text} />
                <div className="meta">
                  {l.from === "owner" && <span className="chip owner">owner</span>}
                  <span>{time(l.at)}</span>
                </div>
              </div>
            </div>
          ),
        )}
        {error && <div className="system error">{error}</div>}
      </div>

      <form className="composer" onSubmit={send}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message" autoFocus />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">➤</button>
      </form>
    </main></div>
  );
}
