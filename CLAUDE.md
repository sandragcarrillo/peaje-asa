# Peaje ASA, notes for coding agents

- Airwallex sandbox only. Amounts are MAJOR units (100 = one hundred). New UUID `request_id` per operation; reuse only to retry the same one.
- MCP servers are in `.mcp.json` (docs needs no login; developer needs sandbox login). Use REST for FX, beneficiary validation and dispute challenges.
- Business rules (margins, limits, reserve, prices) live in `packages/policy`, never in prompts.
- Sandbox simulations live only inside `packages/airwallex` (`simulate.*`).
- Transfers fail into CANCELLED (read failure_type). Card declines end in FAILED. Treat CLEARING as accepted on cards.
- Airwallex sandbox can't receive stablecoins: move USDZ to our Metal address, store the hash, simulate a deposit with that hash as reference.
- Full builder guide: https://airwallexdev.com/guide (markdown: https://airwallexdev.com/agentic-banking-builder-guide.md)
- Business currency is USD for now; owner payouts go US/USD LOCAL. Colombia (COP) comes later.
- Beneficiary schema: `POST /beneficiary_api_schemas/generate` (the guide's `/beneficiaries/schema`). CO/COP LOCAL needs bank_code routing, ID number and email/phone.
- Mock providers sit in front of real Claude models: cheap = claude-haiku-5-5, mid = claude-sonnet-5-5, premium = claude-opus-5-5.
- Customers pay on the hosted payment link. The sandbox account has no native API access, so raw-card confirms fail.
- Settle simulated transfers with `simulate.settleTransfer` (a transition from SCHEDULED returns 500).
- Never commit `.env`.
