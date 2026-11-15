# Peaje ASA: Autonomous Seller Agents

**Seller agents that close sales, run their own books, and pay the business.**

Live (sandbox and testnet): https://asa.usepeaje.com

Alta was called Metal until November 2026; its SDK and CLI still use the metal name.

A small business usually sells over chat, checks payment screenshots by hand and finds out at the end of the month whether it made money. Peaje ASA gives it a team of AI agents that do that work inside rules the owner sets:

1. **Sell.** A seller agent answers buyers in a chat, quotes, negotiates discounts without going below the owner's margin and sends a card payment link.
2. **Verify payments.** Every payment is checked with Airwallex, never by a screenshot, and every sale gets a signed order.
3. **Sell to other agents.** A buyer's AI assistant can't type a card number. It pays the shop in USDZ over x402 on Alta for a signed order, within a mandate its own owner signed.
4. **Pay for their own AI, within the owner's limits.** The platform charges the shop per AI reply, like any service that bills AI by use. The difference: the agent pays each reply from the shop's Alta wallet, and the limits the owner signed hold on chain.
5. **Run the books and pay the business.** A treasury agent pays the supplier, keeps a cash reserve, sends the profit to the owner and asks before any large payment.
6. **Defend chargebacks** with the signed order and the chat as evidence.
7. **Back an advance.** Because the agents see every sale, they can offer the shop an advance against future revenue and collect it from new sales.

Built on [Peaje](https://github.com/sandragcarrillo/peaje), Airwallex and Alta for the Airwallex Agentic Banking Hackathon. Sandbox and testnet only: no real money moves.

## Try it

Open https://asa.usepeaje.com, pick what the shop sells (coffee, skincare or running gear) and press **Try it with a demo shop**. You land in a shop of your own, signed in, with no sign up, that already has its first day behind it. The server builds a few of these ahead of time (`lib/demo-pool.ts`), the same way any shop gets built, and starts the next one when you take yours. Nothing in it is staged:

- Its Airwallex sandbox account opened.
- The shop's Alta account was made and the agents' spending limits were signed. In a shop built ahead of time the server holds the owner key; in one built while you watch, your browser makes it.
- A buyer agent bought ten items over x402, paying USDZ on Alta. Each sale settled on chain and is booked with its transaction hash.
- Ten customers wrote to the shop's chat. The seller agent answered, quoted, sent real sandbox payment links (one link for several products) and handed the owner the deal outside its rules. It paid for every AI reply from the shop's Alta wallet.
- The day's close ran: the sales moved to the shop's Airwallex account, and the supplier bill due today and the owner's profit wait in Approvals because they're above the 30 USD limit. Approve them and the transfers go out.
- Then it's your turn: buy something in the chat beside the back office and pay with Airwallex's test card `4035 5010 0000 0008`. The agent confirms the payment in the chat. A minute later that customer opens a chargeback in the sandbox and the disputes agent answers it with the signed order, the chat and the delivery.

Card payments are the one thing the demo can't make for you: the sandbox confirms a card only on Airwallex's hosted payment page, so the card sale is yours to make. When no ready shop of your kind is left, a new one is built while you watch (about five minutes). Limits: three demo shops per visitor an hour, `DEMO_SHOPS_PER_DAY` (default 40) in all, `DEMO_POOL_PER_KIND` (default 1) ready shops per kind, `DEMO_POOL=off` to stop building them.

## Who uses it

**The shop owner** signs up and gets four steps: put products on sale (price and what each one costs them), give the agent a wallet (the key is made in their browser and never leaves it), try the shop's chat, and open the shop's Airwallex account. After that, the back office shows profit and loss, conversations, approvals, supplier bills (who they owe and when; the treasury agent pays each on its due date), disputes, catalog and rules, agents and the advance offer.

**A buyer** opens the shop's chat at `/s/<shop>`, or the chat button on the shop's own website (one script line, only on websites the owner listed), asks for something, gets a quote and a payment link, and pays by card. The sale is booked when Airwallex confirms the payment, even if the buyer closed the chat.

**A buyer's agent** can shop too, in two ways: through the platform's catalogue on Airwallex Agentic Commerce (Airwallex's merchant MCP), or by paying in USDZ over x402 on Alta under its own spending mandate.

## Design principles

- **Rules live in code, not in the prompt.** Margin floor, auto-discount limit, approval threshold, cash reserve and prices are in `packages/policy`. The model can't talk its way around them.
- **Amounts never come from the model.** A payment link takes a quote id; the quote's price comes from the catalog or a discount the rules accepted.
- **The owner holds the keys.** Each shop's Alta account is controlled by a key generated in the owner's browser. The server only holds agent keys that can't spend outside their mandates.
- **Nothing is forced.** Each money move ends when Airwallex reports it. The sandbox simulator is used only for what someone else does in production: Airwallex's KYC review, a cardholder opening a chargeback, and the Alta-to-Airwallex deposit.
- **Spend follows value.** Before each reply the seller agent reads the platform's live price for each model and picks the best one the deal can afford. If nothing fits and the customer already has a quote the agent may give, it sends the payment link without another AI call; otherwise it hands the conversation to the owner.

## How it works

| Piece | What it does | Airwallex / Alta |
|---|---|---|
| Seller agent | Quotes and negotiates within the owner's margin floor, spends more AI only on deals worth it, escalates unprofitable conversations | Each AI reply paid to the platform on Alta, under the owner's mandate (Kit 12) |
| Trust layer | Verified card payment and a signed order per sale | Payment intents |
| Treasury agent | Pays agent costs, keeps a reserve, pays suppliers, sends profit to the owner, asks for approval on big payments | Connected account per shop (Kit 5), Airwallex Pay transfers, charges (Kits 1, 5, 11) |
| Disputes | Defends chargebacks with the signed order | Payment disputes (Kit 4) |
| Agent credit | Advance offer computed from the agent's own sales data | Platform-to-shop transfer, repaid with charges (Kit 5) |
| Buyer agents | Shops' products in the platform's catalogue; per-item x402 route with a signed order, checked against the buyer's mandate | Agentic Commerce (Kit 10), Alta mandates |

### Alta: agents that pay and get paid

- **Buyer agents pay the shop.** Each product has an x402 route. The buyer's agent gets a signed order, pays it in USDZ under its own mandate, and the sale is booked like a card sale.
- **The shop's agents pay for their AI.** The platform sells replies at three model levels: cheap (Haiku), mid (Sonnet), premium (Opus). An unpaid request gets a 402 with the current price, which goes up while a model is busy and comes back down after. Once Alta settles the payment, the platform calls Claude.
- **Why not a monthly bill:** the owner signs one mandate per agent (seller, disputes, treasury): who it may pay, the most per payment, the total budget. Alta enforces them on chain, so an agent can't overspend even if the platform's server gets it wrong.
- When prices rise, the treasury can move budget between agents, never above the total the owner signed, and the owner approves the change with their key.
- Unused float is swept back to Airwallex.

### Close, disputes and advance

- **Close:** each sale moves from the platform to the shop's account minus the platform fee. Then the supplier bills the owner entered that are due (in full), then the advance repayment, then the owner's profit, never below the reserve. Sales never create a supplier payment on their own: the stock is already the owner's, so only bills on the Suppliers page get paid. Above the threshold it asks; each approval binds the exact terms and is used once.
- **Disputes:** accepted when the amount is under the fee, defended when the case is strong (matching signed order, customer agreement in the chat, signed delivery), sent to the owner when the customer wrote and got no answer. The model only writes the defense.
- **Advance:** 50% of 30-day net profit, reduced by the share of orders given back after a dispute, 6% fee, repaid with 10% of each new sale before the owner's profit.

## Pricing

- **10% of every sale the agents handle**, at least 1 USD per sale: the shop's chat, its website widget and buyer agents alike. Card processing is included: the platform owns the card payments and pays Airwallex's fee out of the 10%. A refund doesn't return it, as with card fees.
- **AI replies** at the platform's price per reply, paid from the shop's Alta wallet within the owner's limits.
- **6% on an advance.**

No monthly fee: a shop that doesn't sell pays nothing but the replies it used.

## Repo layout

```
apps/dashboard        owner back office, shop chat (/s/<shop>), signup, webhooks
packages/policy       margins, limits, reserve, prices (rules in code)
packages/ledger       sales, signed orders, costs, payouts, advance offer
packages/airwallex    sandbox client, simulations isolated
packages/treasury-agent/src/rails.ts   MoneyRails: where money moves (Airwallex is one adapter)
packages/metal        AI payments and mandates on Alta testnet
packages/seller-agent
packages/treasury-agent
providers/            the platform's AI service: three model levels that answer with a 402, then call Claude
```

## Setup

1. Node 22.13+ (the ledger uses `node:sqlite`). `npm install`
2. `cp .env.example .env` and fill in your Airwallex sandbox keys (Account > Developer > API keys) and Alta testnet key/RPC.
3. In the Airwallex sandbox web app, open **Payments** and finish the setup so card payments are active. Without it every payment call returns `configuration_error`. A sandbox business registered in Colombia can't activate Payments, so register it in another country.
4. Create the order signing key: `npm run keys:order` (appends `ORDER_SIGNING_KEY` to `.env`).
5. Smoke test Airwallex: `npm run check:airwallex`
6. Money rails end to end (AI cost, card payment, signed order, owner payout): `npm run m1 -- --wait-link`, then pay the printed link with test card `4035 5010 0000 0008`, any future expiry and CVC.
7. Add `ANTHROPIC_API_KEY` to `.env` (the AI service calls Claude once a call is paid), then start them: `npm run dev:providers`
8. Alta (optional, every agent runs on a fake payer without it): put your testnet endpoint in `METAL_RPC_URL`, then `npm run metal:setup`. It writes the platform's side only: the providers' and the bridge's addresses, and a gas sponsor funded from the faucet. Restart the providers: they now sell over x402 on Alta.
9. Owner login for the demo shop: `npm run keys:owner -- you@example.com` (asks for a password, writes `OWNER_EMAIL`, `OWNER_PASSWORD_HASH` and `SESSION_SECRET` to `.env`). Then `npm run dev:dashboard` and open http://localhost:3001. Anyone can open another shop at `/signup`; each shop has its own book, catalog, rules and chats. A shop's customer chat is `/s/<shop>` (the demo shop: http://localhost:3001/s/tostadero-andino). Each agent bubble shows the tier that answered and what the call cost. Everything goes to `data/peaje-asa.db` (override with `DB_PATH`).
9b. Each shop's Alta account, from its Agents page: **Create my owner key** makes the owner's key in the browser (IndexedDB) and saves a backup file. The server never holds it. The sponsor creates the account, the faucet funds it with test USDZ, and the owner's key approves one mandate per agent (seller, disputes, treasury) with the caps and budgets in the shop's rules. The browser checks every batch is for its own account and recomputes the digest before signing; the server checks the signature is the owner's before the sponsor sends it. A rebalance works the same way: the treasury plans it, the owner's key approves the replacement. The server keeps the agents' mandate keys (they only pay within their mandate) and the key that signs the mandate credentials, which binds nothing without the owner's signature.
10. The demo: with the providers and the app running, `npm run demo -- --fresh`. Three customers chat with the real agent; AI prices follow demand, so the premium model gets dearer as the agent uses it. Approve the café in Conversations, pay the printed links with the test card, then in the dashboard: open the shop's Airwallex account (Overview, once), Review disputes, Run close, approve, Sweep float, Advance. `--fresh` moves the old book to `data/backup-<time>/`.
11. Treasury end to end (disputes, float sweep, close with approvals): `npm run m3`. Pay the four printed links with the test card; the script waits, then works the chargebacks, sweeps the AI float and runs the close. Its book is `data/m3.db`; rerunning resumes where it stopped.
12. Tests (no keys needed): `npm test`

Buyer agents (Kit 10): every shop's products go into the platform's Airwallex Agentic Commerce catalogue, and a buyer's Claude shops them through the platform's merchant MCP. Airwallex calls `/api/agentic/checkout` (HMAC-signed) and the buyer signs in through the app's OAuth server, so both need a public https origin in `PUBLIC_URL`. Then `npm run kit10 -- setup` and `npm run kit10 -- products`.

Buyer agents on Alta: `POST /api/s/<shop>/metal/<sku>` sells one item over x402 in USDZ. Its 402 asks for the agent's signed order, the payment is checked against the agent's mandate before Alta settles it, the settlement is verified on chain (`verifyMandatePayment`) and only then is the sale booked. To try it: `npm run metal:buyer -- setup <item url>` (an account, test USDZ, a mandate capped at 50 USDZ a payment) and `npm run metal:buyer -- buy <item url>`. Above the cap, Alta refuses and nothing moves.

Sandbox only. No real money.

## Team

Sandra Carrillo, Carla Martínez.

## How money moves (Airwallex)

The platform owns the card payments (hosted payment links on its account). Each shop gets its own Airwallex connected account, opened from Overview:

| Move | API | Ends when Airwallex reports |
|---|---|---|
| Sale, platform to shop (at the close) | `connected_account_transfers` | SETTLED |
| Refund or dispute fee, shop back to platform | `charges` | SETTLED |
| Supplier bills to the supplier, profit to the owner | `transfers` to an Airwallex account (Airwallex Pay, `DIGITAL_WALLET`) | PAID |
| Advance, platform to shop | `connected_account_transfers` | SETTLED |
| Advance repayment, shop to platform | `charges` | SETTLED |

Nothing in the app forces a status. What stays on the sandbox simulator is what someone else does in production: Airwallex's KYC review of the new account, the cardholder opening a chargeback, and the Alta-to-Airwallex deposit (the sandbox can't receive stablecoins). In the sandbox the KYC details are a sample, and the supplier's and owner's payout accounts are sandbox accounts standing in for theirs (`data/airwallex/sandbox-payees.json`).

AI prices: each model level serves a capacity of paid calls per 10 minutes at its base price; every paid call above that adds half the base, and the price falls back as calls age out (`PROVIDER_DEMAND_WINDOW_MS`). Quotes (402s) don't count.
