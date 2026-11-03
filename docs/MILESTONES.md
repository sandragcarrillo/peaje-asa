# Milestones (deadline: Fri Nov 13, 1:29 PM Bogotá)

Submission: working demo, video under 5 min, repo with setup instructions.

- [ ] M0 Setup (Tue Nov 3): deps install, `tsc -b` passes, `npm run check:airwallex` logs in, funds the sandbox, shows balances and confirms the US/USD LOCAL corridor
- [ ] M1 Money rails (Wed Nov 4 - Thu Nov 5): payment intent + confirm with test card, signed order saved, US/USD beneficiary + transfer simulated to PAID, mock providers paid via the inference payer
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
