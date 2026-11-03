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
| Treasury agent | Pays agent costs, keeps a reserve, pays suppliers, sends profit to the owner, asks for approval on big payments | FX, beneficiaries, transfers (Kits 1, 11) |
| Disputes | Defends chargebacks with the signed order | Payment disputes (Kit 4) |
| Agent credit | Advance offer computed from the agent's own sales data | Ledger + simulated disbursal |

## Repo layout

```
apps/dashboard        owner P&L, approvals, advance offer
apps/chat             WhatsApp-style customer chat
packages/policy       margins, limits, reserve, prices (rules in code)
packages/ledger       sales, signed orders, costs, payouts, advance offer
packages/airwallex    sandbox client, simulations isolated
packages/metal        inference payments and mandates on Metal testnet
packages/seller-agent
packages/treasury-agent
providers/            three mock inference providers that answer with 402
```

## Setup

1. Node 20+. `npm install`
2. `cp .env.example .env` and fill in your Airwallex sandbox keys (Account > Developer > API keys) and Metal testnet key/RPC.
3. Smoke test Airwallex: `npm run check:airwallex`
4. Start the mock providers: `npm run dev:providers`

Sandbox only. No real money.

## Team

Sandra Carrillo, Carla Martínez.
