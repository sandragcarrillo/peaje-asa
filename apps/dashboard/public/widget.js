/**
 * Peaje ASA chat widget. A shop pastes one line on its website:
 *
 *   <script src="https://asa.usepeaje.com/widget.js" data-shop="your-shop" async></script>
 *
 * It adds a chat button in the corner; the button opens the shop's chat (/embed/<shop>) in a frame.
 * Optional: data-label (button text, default "Chat with us"), data-color (button color, default #008069).
 * The chat only loads on websites the shop listed in its back office (frame-ancestors).
 * Payments happen on Airwallex's page and are confirmed by Airwallex, never by anything shown in the chat.
 */
(() => {
  const script = document.currentScript;
  const shop = script && script.dataset.shop;
  if (!shop || document.querySelector("[data-asa-widget]")) return;
  const origin = new URL(script.src).origin;
  const label = script.dataset.label || "Chat with us";
  const color = /^#[0-9a-f]{3,8}$/i.test(script.dataset.color || "") ? script.dataset.color : "#008069";

  // Draw nothing on a website the shop hasn't listed: its chat wouldn't load there anyway.
  fetch(`${origin}/api/s/${encodeURIComponent(shop)}/widget`)
    .then((r) => r.json())
    .then(({ allowed }) => allowed ? mount() : console.warn(`Peaje ASA: ${location.origin} isn't on the websites for "${shop}". Add it in the back office, Plugin.`))
    .catch(() => {});

  function mount() {
    const host = document.createElement("div");
    host.setAttribute("data-asa-widget", shop);
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { position: fixed; right: 20px; bottom: 92px; z-index: 2147483646; width: min(380px, calc(100vw - 24px)); height: min(600px, calc(100dvh - 116px));
          border-radius: 14px; overflow: hidden; box-shadow: 0 12px 40px rgb(0 0 0 / 0.25); background: #efeae2; display: none; }
        .panel.open { display: block; }
        iframe { width: 100%; height: 100%; border: 0; display: block; }
        button { position: fixed; right: 20px; bottom: 20px; z-index: 2147483647; height: 56px; min-width: 56px; padding: 0 20px 0 16px; border: 0; border-radius: 28px;
          background: ${color}; color: #fff; font: 600 15px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
          display: flex; align-items: center; gap: 8px; cursor: pointer; box-shadow: 0 6px 20px rgb(0 0 0 / 0.2); }
        button:focus-visible { outline: 3px solid #fff; outline-offset: 2px; box-shadow: 0 0 0 6px ${color}; }
        button svg { width: 24px; height: 24px; flex: none; }
        button.open { padding: 0; width: 56px; justify-content: center; }
        button.open .text { display: none; }
        @media (max-width: 480px) {
          .panel { right: 8px; bottom: 84px; width: calc(100vw - 16px); height: calc(100dvh - 100px); }
          button { right: 12px; bottom: 16px; }
        }
        @media (prefers-reduced-motion: no-preference) { .panel.open { animation: up 160ms ease-out; } @keyframes up { from { opacity: 0; transform: translateY(8px); } } }
      </style>
      <div class="panel" role="dialog" aria-label="Chat"></div>
      <button type="button" aria-expanded="false" aria-label="${label.replace(/"/g, "&quot;")}">
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path class="icon" d="M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z"/></svg>
        <span class="text"></span>
      </button>`;
    root.querySelector(".text").textContent = label;

    const panel = root.querySelector(".panel");
    const button = root.querySelector("button");
    const icon = root.querySelector(".icon");
    const CHAT = "M4 4h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2z";
    const CLOSE = "M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6l5.6-5.6L5 6.4z";

    function set(open) {
      // The chat loads on first open, so a page that never opens it never loads it.
      if (open && !panel.firstChild) {
        const frame = document.createElement("iframe");
        frame.src = `${origin}/embed/${encodeURIComponent(shop)}`;
        frame.title = "Chat";
        frame.allow = "clipboard-write";
        panel.appendChild(frame);
      }
      panel.classList.toggle("open", open);
      button.classList.toggle("open", open);
      button.setAttribute("aria-expanded", String(open));
      button.setAttribute("aria-label", open ? "Close chat" : label);
      icon.setAttribute("d", open ? CLOSE : CHAT);
    }

    button.addEventListener("click", () => set(!panel.classList.contains("open")));
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && panel.classList.contains("open")) { set(false); button.focus(); } });
    (document.body || document.documentElement).appendChild(host);
  }
})();
