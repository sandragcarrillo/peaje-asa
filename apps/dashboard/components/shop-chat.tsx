"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface Line { from: "customer" | "agent" | "owner" | "system"; text: string; at: string; tier?: "cheap" | "mid" | "premium"; cost?: number }
interface View { id: string; status: string; transcript: Line[]; aiSpent: number; calls: number; error?: string }

function newId() {
  return `c-${crypto.randomUUID().slice(0, 8)}`;
}

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

/** The customer side of a shop: a chat with its seller agent. The conversation id lives in the URL (?c=). */
export function ShopChat({ shop }: { shop: { id: string; name: string; about: string } }) {
  const base = `/api/s/${encodeURIComponent(shop.id)}`;
  const [id, setId] = useState<string>();
  const [conv, setConv] = useState<View>();
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<Line>();
  const [error, setError] = useState<string>();
  const feed = useRef<HTMLDivElement>(null);

  // The conversation id lives in the URL (?c=) so a chat can be reopened or shown on the dashboard.
  useEffect(() => {
    const url = new URL(window.location.href);
    let c = url.searchParams.get("c");
    if (!c) {
      c = newId();
      url.searchParams.set("c", c);
      window.history.replaceState(null, "", url);
    }
    setId(c);
  }, []);

  const refresh = useCallback(async () => {
    if (!id) return;
    const res = await fetch(`${base}/conversation/${id}`);
    const body = (await res.json()) as View;
    if (res.ok) setConv(body);
  }, [id, base]);

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
    if (!text || !id || busy) return;
    setDraft("");
    setError(undefined);
    setPending({ from: "customer", text, at: new Date().toISOString() });
    setBusy(true);
    try {
      const res = await fetch(`${base}/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id, text }) });
      const body = (await res.json()) as View;
      if (!res.ok) throw new Error(body.error ?? res.statusText);
      setConv(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      await refresh();
    } finally {
      setPending(undefined);
      setBusy(false);
    }
  }

  function restart() {
    const c = newId();
    const url = new URL(window.location.href);
    url.searchParams.set("c", c);
    window.history.replaceState(null, "", url);
    setConv(undefined);
    setError(undefined);
    setId(c);
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
                  {l.tier && <span className={`chip ${l.tier}`}>{l.tier}{l.cost !== undefined ? ` · $${l.cost.toFixed(2)}` : ""}</span>}
                  <span>{time(l.at)}</span>
                </div>
              </div>
            </div>
          ),
        )}
        {error && <div className="system error">{error}</div>}
      </div>

      <div className="stats">
        <span>conv {id ?? "..."}</span>
        <span>{conv ? `${conv.calls} calls · AI $${conv.aiSpent.toFixed(2)} · ${conv.status}` : ""}</span>
      </div>

      <form className="composer" onSubmit={send}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Type a message" autoFocus />
        <button type="submit" disabled={busy || !draft.trim()} aria-label="Send">➤</button>
      </form>
    </main></div>
  );
}
