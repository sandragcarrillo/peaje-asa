# Peaje ASA: Autonomous Seller Agents

**Seller agents that close sales, run their own books, and pay the business.**

Peaje ASA gives a small business a team of AI agents that sell for it, know the cost and margin of every deal, verify payments instantly (no more payment screenshots), pay their own costs, and send the profit to the owner. Because the agents see every sale, they can also back an advance against future revenue.

Built on [Peaje](https://github.com/sandragcarrillo/peaje), Airwallex and Metal for the Airwallex Agentic Banking Hackathon.

## What's new vs. Peaje

Peaje is our existing toolkit for making businesses discoverable by AI agents and getting paid (agent-readiness score, one-prompt Agent Kit, paid routes over x402 and MPP). Everything in this repo was built during the hackathon: the margin-aware seller agent, the treasury agent, the Airwallex banking layer, dispute defense from signed orders, and agent-based credit.

## How it works

| Piece | What it does | Airwallex / Metal |
|---|---|---|
| Seller agent | Quotes and negotiates within the owner's margin floor, spends more AI only on deals worth it, escalates unprofitable conversations | Inference bought by live price on Metal (Kit 12) |
| Trust layer | Verified card payment and a signed order per sale | Payment intents |
| Treasury agent | Pays agent costs, keeps a reserve, pays suppliers, sends profit to the owner, asks for approval on big payments | Connected account per shop (Kit 5), Airwallex Pay transfers, charges (Kits 1, 5, 11) |
| Disputes | Defends chargebacks with the signed order | Payment disputes (Kit 4) |
| Agent credit | Advance offer computed from the agent's own sales data | Platform-to-shop transfer, repaid with charges (Kit 5) |

## Repo layout

```
apps/dashboard        owner P&L, approvals, advance offer
packages/policy       margins, limits, reserve, prices (rules in code)
packages/ledger       sales, signed orders, costs, payouts, advance offer
packages/airwallex    sandbox client, simulations isolated
packages/treasury-agent/src/rails.ts   MoneyRails: where money moves (Airwallex is one adapter)
packages/metal        inference payments and mandates on Metal testnet
packages/seller-agent
packages/treasury-agent
providers/            three mock inference providers that answer with 402
```

## Setup

1. Node 22.13+ (the ledger uses `node:sqlite`). `npm install`
2. `cp .env.example .env` and fill in your Airwallex sandbox keys (Account > Developer > API keys) and Metal testnet key/RPC.
3. In the Airwallex sandbox web app, open **Payments** and finish the setup so card payments are active. Without it every payment call returns `configuration_error`. A sandbox business registered in Colombia can't activate Payments, so register it in another country.
4. Create the order signing key: `npm run keys:order` (appends `ORDER_SIGNING_KEY` to `.env`).
5. Smoke test Airwallex: `npm run check:airwallex`
6. Money rails end to end (AI cost, card payment, signed order, owner payout): `npm run m1 -- --wait-link`, then pay the printed link with test card `4035 5010 0000 0008`, any future expiry and CVC.
7. Add `ANTHROPIC_API_KEY` to `.env` (the mock providers forward paid calls to Claude), then start them: `npm run dev:providers`
8. Metal (optional, every agent runs on a fake payer without it): put your testnet endpoint in `METAL_RPC_URL`, then `npm run metal:setup`. It writes the platform's side only: the providers' and the bridge's addresses, and a gas sponsor funded from the faucet. Restart the providers: they now sell over x402 on Metal.
9. Owner login for the demo shop: `npm run keys:owner -- you@example.com` (asks for a password, writes `OWNER_EMAIL`, `OWNER_PASSWORD_HASH` and `SESSION_SECRET` to `.env`). Then `npm run dev:dashboard` and open http://localhost:3001. Anyone can open another shop at `/signup`; each shop has its own book, catalog, rules and chats. A shop's customer chat is `/s/<shop>` (the demo shop: http://localhost:3001/s/tostadero-andino). Each agent bubble shows the tier that answered and what the call cost. Everything goes to `data/peaje-asa.db` (override with `DB_PATH`).
9b. Each shop's Metal account, from its Agents page: **Create my owner key** makes the owner's key in the browser (IndexedDB) and saves a backup file. The server never holds it. The sponsor creates the account, the faucet funds it with test USDZ, and the owner's key approves one mandate per agent (seller, disputes, treasury) with the caps and budgets in the shop's rules. The browser checks every batch is for its own account and recomputes the digest before signing; the server checks the signature is the owner's before the sponsor sends it. A rebalance works the same way: the treasury plans it, the owner's key approves the replacement. The server keeps the agents' mandate keys (they only pay within their mandate) and the key that signs the mandate credentials, which binds nothing without the owner's signature.
10. The demo: with the providers and the app running, `npm run demo -- --fresh`. Three customers chat with the real agent; provider prices follow demand, so the scarce premium model gets dearer as the agent uses it. Approve the café in Conversations, pay the printed links with the test card, then in the dashboard: open the shop's Airwallex account (Overview, once), Review disputes, Run close, approve, Sweep float, Advance. `--fresh` moves the old book to `data/backup-<time>/`.
11. Treasury end to end (disputes, float sweep, close with approvals): `npm run m3`. Pay the four printed links with the test card; the script waits, then works the chargebacks, sweeps the AI float and runs the close. Its book is `data/m3.db`; rerunning resumes where it stopped.
12. Tests (no keys needed): `npm test`

Buyer agents (Kit 10): every shop's products go into the platform's Airwallex Agentic Commerce catalogue, and a buyer's Claude shops them through the platform's merchant MCP. Airwallex calls `/api/agentic/checkout` (HMAC-signed) and the buyer signs in through the app's OAuth server, so both need a public https origin in `PUBLIC_URL`. Then `npm run kit10 -- setup` and `npm run kit10 -- products`.

Buyer agents on Metal: `POST /api/s/<shop>/metal/<sku>` sells one item over x402 in USDZ. Its 402 asks for the agent's signed order, the payment is checked against the agent's mandate before Metal settles it, the settlement is verified on chain (`verifyMandatePayment`) and only then is the sale booked. To try it: `npm run metal:buyer -- setup <item url>` (an account, test USDZ, a mandate capped at 50 USDZ a payment) and `npm run metal:buyer -- buy <item url>`. Above the cap, Metal refuses and nothing moves.

Sandbox only. No real money.

## Team

Sandra Carrillo, Carla Martínez.

## How money moves (Airwallex)

The platform owns the card payments (hosted payment links on its account). Each shop gets its own Airwallex connected account, opened from Overview:

| Move | API | Ends when Airwallex reports |
|---|---|---|
| Sale, platform to shop (at the close) | `connected_account_transfers` | SETTLED |
| Refund or dispute fee, shop back to platform | `charges` | SETTLED |
| Inventory to the supplier, profit to the owner | `transfers` to an Airwallex account (Airwallex Pay, `DIGITAL_WALLET`) | PAID |
| Advance, platform to shop | `connected_account_transfers` | SETTLED |
| Advance repayment, shop to platform | `charges` | SETTLED |

Nothing in the app forces a status. What stays on the sandbox simulator is what someone else does in production: Airwallex's KYC review of the new account, the cardholder opening a chargeback, and the Metal-to-Airwallex deposit (the sandbox can't receive stablecoins). In the sandbox the KYC details are a sample, and the supplier's and owner's payout accounts are sandbox accounts standing in for theirs (`data/airwallex/sandbox-payees.json`).

Provider prices: each provider serves a capacity of paid calls per 10 minutes at its base price; every paid call above that adds half the base, and the price falls back as calls age out (`PROVIDER_DEMAND_WINDOW_MS`). Quotes (402s) don't count.
