# Milestones (deadline: Fri Nov 13, 1:29 PM Bogotá)

Submission: working demo, video under 5 min, repo with setup instructions.

- [x] M0 Setup (Tue Nov 3): deps install, `tsc -b` passes, `npm run check:airwallex` logs in, funds the sandbox, shows balances and confirms the US/USD LOCAL corridor
- [x] M1 Money rails (Wed Nov 4 - Thu Nov 5): card payment through the hosted payment link (test card), signed order saved, US/USD beneficiary + transfer simulated to PAID, mock providers paid via the inference payer
- [x] M2 Seller agent (Fri Nov 6 - Sun Nov 8): chat UI talking to the Claude tool loop, margin-aware model tier choice, discount validation, escalation when AI spend exceeds the deal's budget
- [x] M3 Treasury (Sun Nov 8 - Mon Nov 9): planClose with reserve and approvals, Metal to Airwallex bridge, supplier payment, owner payout, dispute defense with signed order (Kit 4 flow)
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

### M2 (done Nov 2)
- `SellerAgent` (`packages/seller-agent`): manual tool loop over paid providers. Before every model call it reads all three providers' offers and `chooseTier` picks the best tier the deal can afford; a price that moves between the quote and the payment is re-planned, a paid call that fails is still booked as cost. When nothing fits, the conversation escalates with the active quote's terms bound.
- Tools: `search_catalog` (never returns cost), `quote`, `propose_discount` (refusals return the lowest price the agent may offer), `create_payment_link` (one link per quote, amount from the quote), `escalate_to_owner`.
- `checkPayment` reads the link, verifies the intent with Airwallex (status, amount, currency), signs the order and books the sale with COGS. The model learns about the payment on the next turn through a system note.
- `apps/chat`: Next.js 16 WhatsApp-style chat. URL keeps the conversation id (`?c=`); polls Airwallex every 3 s while a link is out. Agent bubbles show tier and call cost.
- Tests with a scripted payer and fake Airwallex: discount rules, discovery on cheap then mid for 2x Huila, link amount from the quote, signed order on payment, premium for the 480 machine, price rise reroutes to mid then escalates.
- Real run with Claude (Nov 2), sandbox payment links:
  - 2x Huila in Spanish: cheap for search and quote, mid once the 16 USD margin is known, link for 28 USD. 5 calls, 0.08 USD of AI.
  - Home espresso machine: asked 400, refused by policy, agent offers 440 (the floor) on premium.
  - Premium raises to 0.50 and slows to 6 s mid-conversation: the next reply comes from mid, and the 440 link goes out on mid.
  - All providers at 0.50: the grinder conversation escalates as unprofitable before any model call, with a fixed reply in the customer's language.
  - 30 machines at 300 and the customer asks for the owner: escalated with the terms bound (30 x 300 = 9,000 USD).
- Fixes from the run: fixed replies follow the customer's language; the agent may always escalate (it used to refuse below the floor even when asked for the owner); plain text, no Markdown or SKUs.
- Live payment: the 28 USD Huila link paid with a sandbox test card; `checkPayment` verified intent `int_sgpvb7qw4hnt0gshhg5` with Airwallex, signed `ord_smoke-huila_q1` (signature verifies) and booked revenue 28, COGS 12.

### M3 (done Nov 2)
- Cash comes from the ledger: sales minus refunds, dispute fees, supplier payments and owner payouts, plus USDZ swept in from Metal. AI is paid from the Metal float, so it isn't Airwallex cash until it's swept back.
- `planClose` pays suppliers before profit (if inventory can't be paid, the owner waits), sizes the owner's payout to what's left above the reserve, and keeps cash set aside for anything waiting on approval, so approving later can't break the reserve.
- Approvals (`TreasuryStore`, shared SQLite) are bound to kind, amount, currency, counterparty and reference by a hash, used once with a compare-and-set. A different amount or payee never matches.
- Payouts save their `request_id` before the transfer is created; an interrupted close is resumed by looking the transfer up, never by creating it again. The ledger books a payout only at PAID.
- Disputes (Kit 4): `decideDispute` in policy. The fee (15 USD, policy, since the sandbox doesn't deduct it) is avoidable at RFI and sunk at CHARGEBACK, so a case at or under the fee is accepted at RFI, a strong case is defended, and once the fee is sunk any strong case is defended. "Strong" means a signed order that matches the charge plus the customer agreeing in the chat or a signed delivery. A customer who wrote after asking for the owner and got no answer goes to the owner. A dispute on a payment the agent didn't sell is ignored.
- Evidence: a dependency-free PDF (Courier, Latin-1) with the defense, the signed order, its Ed25519 signature and public key, the shipment and the chat; uploaded to the files host. The defense text is written by Claude through the paid providers (budget: 2% of the disputed amount, one call), with a template fallback.
- Float sweep: keep 5 USDZ on Metal, credit the rest to Airwallex as a simulated deposit referencing the transaction hash (`FakeMetalBridge` until M5).
- `npm run m3` passes on the sandbox (Nov 2), own book in `data/m3.db`:
  - 4 sales paid by hand on hosted links (440, 14, 220, 3,200 USD), each signed and booked.
  - Small not-received claim (14) accepted as low value; credit-not-processed (220) escalated because the customer wrote twice unanswered, the owner approved, accepted with refund; fraud claim (440) challenged with the PDF, the issuer rejected it (escalated to CHARGEBACK, fee booked), challenged again, resolved in our favor.
  - 14.85 USDZ swept from the float (20 funded - 0.15 AI - 5 kept).
  - Close on 3,639.85 cash: supplier 2,786 and owner 353.85 both above the 300 threshold, held until approved, then paid and settled to PAID. Cash ends at exactly the 500 reserve.

Sandbox findings:
- The dispute simulator works on link-paid intents. Body: `payment_intent_id`, `stage`, `reason_code`, `due_at` (`2026-11-13T04:09:48+0000`). Escalate needs `due_at`; resolve needs `in_favor_of` (`MERCHANT` is valid).
- A dispute's `merchant_order_id` is the payment link's title, not our order id: match disputes to orders by `payment_intent_id`.
- A challenge at CHARGEBACK requires `product_type` (`PHYSICAL_GOODS`, ...). The simulator emails the account owner for every dispute event.
- Simulated deposits take a `reference` field; the old client put it in `payer_name`.
