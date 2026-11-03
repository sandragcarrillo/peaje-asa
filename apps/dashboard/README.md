# Dashboard

The owner's view, on http://localhost:3001 (`npm run dev:dashboard`). Next.js 16 (App Router, server actions), Tailwind 4, Peaje's design system in its dark version.

- **Overview**: cash per the books, net profit, paid to the owner, the Metal float, P&L, model spend by tier, and the treasury buttons (Run close, Review disputes, Sweep float).
- **Conversations**: every chat; escalations wait at the top. Approve (the customer gets a payment link at exactly the escalated terms), decline, or reply as the owner.
- **Approvals**: payments above the threshold. Approving a payout runs the close; approving a dispute refund reviews the queue.
- **Disputes**: each chargeback with the decision, why, the defense that was sent and the evidence PDF.
- **Advance**: the offer with its calculation line by line, and Accept.

Login: email and password from `.env` (`npm run keys:owner -- you@example.com`). The session is a signed HttpOnly cookie that lasts 12 hours; five wrong attempts lock a client out for 15 minutes. Every page, action and route checks the session (`lib/auth.ts`); `proxy.ts` only redirects early.

It reads the same SQLite book as the chat (`data/peaje-asa.db`, or `DB_PATH`).
