# Milestones (deadline: Fri Nov 13, 1:29 PM Bogotá)

Submission: working demo, video under 5 min, repo with setup instructions.

- [x] M0 Setup (Tue Nov 3): deps install, `tsc -b` passes, `npm run check:airwallex` logs in, funds the sandbox, shows balances and confirms the US/USD LOCAL corridor
- [x] M1 Money rails (Wed Nov 4 - Thu Nov 5): card payment through the hosted payment link (test card), signed order saved, US/USD beneficiary + transfer simulated to PAID, mock providers paid via the inference payer
- [ ] M2 Seller agent (Fri Nov 6 - Sun Nov 8): chat UI talking to the Claude tool loop, margin-aware model tier choice, discount validation, escalation when AI spend exceeds the deal's budget
- [ ] M3 Treasury (Sun Nov 8 - Mon Nov 9): planClose with reserve and approvals, Metal to Airwallex bridge, supplier payment, owner payout, dispute defense with signed order (Kit 4 flow)
- [ ] M4 Dashboard + end to end (Tue Nov 10 - Wed Nov 11): P&L, approvals UI, advance offer, scripted demo runner (`scripts/demo.ts`) incl. provider price rise mid-conversation
- [ ] M5 Real Metal (Thu Nov 12, if time allows): swap FakeInferencePayer for `@metalntwx/metal-pay` clearing on testnet; keep the fake as fallback
- [ ] M6 Polish + submit (Thu Nov 12 - Fri Nov 13 morning): README setup tested from a clean clone, architecture diagram, demo video script, video, submission

## Decisions

- Start on the corridors the builder guide guarantees: business currency USD, owner payout US/USD LOCAL. Collecting and paying out in Colombia (COP) comes after the core demo works.
- Policy is all USD. AI is paid in USDZ (1:1 with USD), so model prices compare directly with deal margins. Provider prices: 0.01 / 0.02 / 0.05 USD per call.
- Mock providers front real Claude models (cheap = Haiku 5.5, mid = Sonnet 5.5, premium = Opus 5.5), so the call the agent pays for over Metal is the call that answers (M2).

## Log

### M0
- Root `package.json` is `"type": "module"` (scripts use top-level await); `check:airwallex` loads `.env` via `tsx --env-file`.
- `rootDir`/`outDir` moved from `tsconfig.base.json` into each package (they resolved against the repo root, so `tsc -b` failed).
- `check:airwallex` reuses an ACTIVE USD global account and only deposits up to 25,000 USD, so reruns don't inflate the wallet.
- Beneficiary schema lives at `POST /beneficiary_api_schemas/generate` (the builder guide's `/beneficiaries/schema` is shorthand). CO/COP LOCAL goes over CENIT: bank code routing (Bancolombia `007`, 11 digits), Checking/Savings, plus beneficiary ID and email/phone. Colombian 4x1000 tax applies to the payout.
- `check:airwallex` passes (Nov 2): logs in, reuses USD global account `4a863cf7-…`, US/USD and CO/COP LOCAL schemas both return fields.
- The sandbox wallet comes prefunded with 10,000,000 in each of CNY, COP, EUR, GBP and USD, so no deposit was needed. Consequence for M3: the treasury must plan from the business's own cash in our ledger (collected sales minus what's been paid), not the raw wallet balance, or the reserve floor and approvals never bind.

### M1 (done Nov 2)
- `npm run m1 -- --wait-link` passes end to end on the sandbox: AI cost paid to the cheap provider (0.01), payment link paid by hand with the test card, intent verified SUCCEEDED 28 USD against Airwallex, order signed (tampered copy fails verification), owner payout 15.99 USD (28 - 12 COGS - 0.01 AI) simulated to PAID.
- Ed25519 signed orders (`packages/ledger/src/signing.ts`, canonical JSON), ledger COGS per quantity and a currency on every money entry, seeded 15-product catalog in `packages/policy`.
- Owner beneficiary is US/USD LOCAL, validated first, reused by bank details (the list doesn't return nicknames). Transfers are created at most once (`createTransferOnce` looks up the `request_id` before any retry).

Sandbox findings:
- An account registered in Colombia can't activate Payments. We use a second sandbox business; its wallet is prefunded in USD, EUR, GBP and CNY (no COP).
- The account has no "native API access", so confirming an intent with raw card data fails. Customers pay on the hosted payment link, which is the real product flow anyway. The scripted demo (M4) either pays the link live or needs native API access from devhelp@airwallex.com.
- New transfers start at SCHEDULED and a simulation transition from there returns 500. `simulate.settleTransfer` waits for PROCESSING, then moves SENT -> PAID (or FAILED with a failure_type).
- The sandbox accepts any transfer `reason` string; production validates it.
- Payment links take no `request_id`: store the link id per order and never create a second one.

### M2 (in progress)
- `SellerAgent` (`packages/seller-agent`): manual tool loop over paid providers. Before every model call it reads all three providers' offers and `chooseTier` picks the best tier the deal can afford; a price that moves between the quote and the payment is re-planned, a paid call that fails is still booked as cost. When nothing fits, the conversation escalates with the active quote's terms bound.
- Tools: `search_catalog` (never returns cost), `quote`, `propose_discount` (refusals return the lowest price the agent may offer), `create_payment_link` (one link per quote, amount from the quote), `escalate_to_owner`.
- `checkPayment` reads the link, verifies the intent with Airwallex (status, amount, currency), signs the order and books the sale with COGS. The model learns about the payment on the next turn through a system note.
- `apps/chat`: Next.js 16 WhatsApp-style chat. URL keeps the conversation id (`?c=`); polls Airwallex every 3 s while a link is out. Agent bubbles show tier and call cost.
- Tests with a scripted payer and fake Airwallex: discount rules, discovery on cheap then mid for 2x Huila, link amount from the quote, signed order on payment, premium for the 480 machine, price rise reroutes to mid then escalates.
- Smoke test in the browser: chat, API, offers from the three providers, tier choice and paid call all wired; stops at the provider because `ANTHROPIC_API_KEY` is empty. Pending: a real run with the key (small sale, big sale with discount, price rise, escalation).
