# Peaje ASA: Autonomous Seller Agents

**Seller agents that close sales, run their own books, and pay the business.**

Live (sandbox and testnet): https://asa.usepeaje.com

A small business usually sells over chat, checks payment screenshots by hand and finds out at the end of the month whether it made money. Peaje ASA gives it a team of AI agents that do that work inside rules the owner sets:

1. **Sell.** A seller agent answers buyers in a chat, quotes, negotiates discounts without going below the owner's margin and sends a card payment link.
2. **Verify payments.** Every payment is checked with Airwallex, never by a screenshot, and every sale gets a signed order.
3. **Pay for themselves.** Each reply costs a few cents of model time. The agent pays it from its own Metal wallet, under a mandate the owner signed.
4. **Run the books and pay the business.** A treasury agent pays the supplier, keeps a cash reserve, sends the profit to the owner and asks before any large payment.
5. **Defend chargebacks** with the signed order and the chat as evidence.
6. **Back an advance.** Because the agents see every sale, they can offer the shop an advance against future revenue and collect it from new sales.

Built on [Peaje](https://github.com/sandragcarrillo/peaje), Airwallex and Metal for the Airwallex Agentic Banking Hackathon. Sandbox and testnet only: no real money moves.

## Who uses it

**The shop owner** signs up and gets four steps: put products on sale (price and what each one costs them), give the agent a wallet (the key is made in their browser and never leaves it), try the shop's chat, and open the shop's Airwallex account. After that, the back office shows profit and loss, conversations, approvals, disputes, catalog and rules, agents and the advance offer.

**A buyer** opens the shop's chat at `/s/<shop>`, or the chat button on the shop's own website (one script line, only on websites the owner listed), asks for something, gets a quote and a payment link, and pays by card. The sale is booked when Airwallex confirms the payment, even if the buyer closed the chat.

**A buyer's agent** can shop too, in two ways: through the platform's catalogue on Airwallex Agentic Commerce (Airwallex's merchant MCP), or by paying in USDZ over x402 on Metal under its own spending mandate.

## Design principles

- **Rules live in code, not in the prompt.** Margin floor, auto-discount limit, approval threshold, cash reserve and prices are in `packages/policy`. The model can't talk its way around them.
- **Amounts never come from the model.** A payment link takes a quote id; the quote's price comes from the catalog or a discount the rules accepted.
- **The owner holds the keys.** Each shop's Metal account is controlled by a key generated in the owner's browser. The server only holds agent keys that can't spend outside their mandates.
- **Nothing is forced.** Each money move ends when Airwallex reports it. The sandbox simulator is used only for what someone else does in production: Airwallex's KYC review, a cardholder opening a chargeback, and the Metal-to-Airwallex deposit.
- **Spend follows value.** Before each model call the seller agent reads live prices from three providers and picks the best model the deal can afford. If nothing fits, it hands the conversation to the owner.

## How it works

| Piece | What it does | Airwallex / Metal |
|---|---|---|
| Seller agent | Quotes and negotiates within the owner's margin floor, spends more AI only on deals worth it, escalates unprofitable conversations | Inference bought by live price on Metal (Kit 12) |
| Trust layer | Verified card payment and a signed order per sale | Payment intents |
| Treasury agent | Pays agent costs, keeps a reserve, pays suppliers, sends profit to the owner, asks for approval on big payments | Connected account per shop (Kit 5), Airwallex Pay transfers, charges (Kits 1, 5, 11) |
| Disputes | Defends chargebacks with the signed order | Payment disputes (Kit 4) |
| Agent credit | Advance offer computed from the agent's own sales data | Platform-to-shop transfer, repaid with charges (Kit 5) |
| Buyer agents | Shops' products in the platform's catalogue; per-item x402 route with a signed order, checked against the buyer's mandate | Agentic Commerce (Kit 10), Metal mandates |

### AI costs on Metal

- Three providers sell calls to real Claude models: cheap (Haiku), mid (Sonnet), premium (Opus). Each answers an unpaid request with a 402 offer whose price rises with demand.
- The owner signs one mandate per agent (seller, disputes, treasury): who it may pay, the most per payment, the total budget. Metal enforces them on chain.
- When prices rise, the treasury can move budget between agents, never above the total the owner signed, and the owner approves the change with their key.
- Unused float is swept back to Airwallex.

### Close, disputes and advance

- **Close:** inventory first, then the advance repayment, then the owner's profit, never below the reserve. Above the threshold it asks; each approval binds the exact terms and is used once.
- **Disputes:** accepted when the amount is under the fee, defended when the case is strong (matching signed order, customer agreement in the chat, signed delivery), sent to the owner when the customer wrote and got no answer. The model only writes the defense.
- **Advance:** 50% of 30-day net profit, reduced by the share of orders given back after a dispute, 6% fee, repaid with 10% of each new sale before the owner's profit.

## Repo layout

```
apps/dashboard        owner back office, shop chat (/s/<shop>), signup, webhooks
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
