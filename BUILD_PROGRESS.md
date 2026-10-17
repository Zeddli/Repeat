# Repeat build progress — FOUR_HOUR_BUILD_PLAN.md

Current correction: loyalty is per buyer + seller + service SKU. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior, SDK/on-chain boundaries and agent test evidence.

Implementation authorized 17 October 2026; HACKATHON_PACK.md section9 is acceptance target.

## Decisions
- No existing Git repository or product code: implement in place.
- Parallel contract/backend/UI ownership; root handles tooling/deploy/integration.
- Ubuntu Node22.20 available; official npm Forge/Anvil installed locally.
- No task-specific Anthropic/BSC funded config present: first verify actual local EVM, label fallback AI accurately; leave BSC deployment configurable.
- Final mission60000, max300000; pay40000 leaves20000.

## Tasks
- [x] Tooling/scaffold
- [x] Contract tests and implementation — 19 Forge tests pass
- [x] Deploy and genuinely warm two local wallets — 6 confirmed setup receipts
- [x] Buyer/API/gated-service — 40 Vitest tests pass
- [x] UI/independent client — desktop/mobile browser checks; reader works with API stopped
- [x] Integration and review — payment/delivery, replay, API idempotency, origin/budget and seed recovery checked

## Tooling note
Windows apply_patch reported a UNC write error after partial creation; use native WSL writes to avoid inconsistent UNC filesystem semantics.

## Final decisions and evidence
- User selected real mintable Mock BSC/wBSC, six decimals; agent holds and spends it through actual signed EVM transactions. No static balances or fake receipts.
- Actual local chain31337 is verified. Public BSC97 still needs native test gas; a mock spending token cannot replace that gas.
- Review fixes: whole-mission approval+checkout gas accounting, safe restart only blocks unresolved intents, public development keys rejected for public deployment, distinct role addresses, durable/recoverable seed receipts, per-checkout journals, accurate native Forge exit propagation.
- API-independent reader verified while API stopped; records in evidence/independent-quotes.json.
- Current Demo lab judge role has five prior A purchases and 0.23 paid; recorded without resetting history in evidence/demo-lab-current.json.
- [ ] Live Anthropic model verification (requires user-configured key and model).
- [ ] Public BSC97 deployment (requires disposable wallets funded with native test gas).

## Wallet marketplace extension — 17 October 2026

- [x] Personal wallet connect and EOA SIWE authentication implemented; nonce, origin, chain and expiry tested.
- [x] Seller-signed dynamic offers and authenticated hosted response publication; public search and categories.
- [x] Buyer-owned bounded approvals/checkout and order-gated private delivery.
- [x] Local-only capped faucet, actual minting and gas funding.
- [x] Agent CLI and portable skill; skill validation passes.
- [x] Separate-wallet real-chain API and CLI end-to-end checks, including earned discount.
- [x] Disabled-offer recovery fixed and independently reviewed; no unresolved material findings.
- [x] Final 19 Forge + 69 app tests, typecheck and production build pass; desktop/mobile public UI checked.
- [ ] Manual extension-backed sign-in/publish/purchase rehearsal (current in-app browser has no injected wallet).

Current architecture, three-minute ideal demo and acceptance checklist: MARKETPLACE.md. Revised solo sprint: FOUR_HOUR_BUILD_PLAN.md.

## Per-service loyalty correction

- [x] Regression reproduced and ledger fixed to buyer/seller/SKU.
- [x] Local checkout upgraded; actual old payments imported per service, same token and all10 old catalog responses preserved.
- [x] Agent CLI retested live with two services at one seller: A0.05/0.05/0.04; B0.05 and independent history.
- [x] 25 contract +70 app tests, typecheck, build, skill validation and historical paid delivery pass.
- [ ] BNB Agent Studio SDK/runtime integration remains unimplemented; see IMPLEMENTATION_STATUS.md for exact on/off-chain boundaries.

## Human-friendly publishing

User confirmed ready-made reports/guides as the intended human seller flow. Renamed the paid field to Content buyers receive, made the description explicitly public, and added ordinary-text examples and no-JSON guidance. Payment/delivery protocol is unchanged.

## Portable agent client correction

- [x] Reproduced the unrelated-folder failure: npx installs tsx but cannot fetch scripts/market-agent.ts.
- [x] Added a dependency-bundled repeat-agent.mjs download at /api/market/client; no checkout or npm install needed by its user.
- [x] Changed the Agents page, served skill and API reference to download-first instructions.
- [x] Preserved source CLI journals; downloaded clients keep recovery state in .repeat-agent or MARKET_AGENT_DATA_DIR.
- [x] Downloaded the actual public file into an empty temporary folder and completed signed publish/discover/quote/buy/delivery/recovery with fresh local wallets.
- [x] Verified A prices0.05/0.05/0.04 while service B stayed0.05, and no new payment on same-intent recovery. Evidence: evidence/marketplace-cli-standalone.json.

- [x] Final verification: 25 Forge +73 app tests, server typecheck, frontend build and skill validation pass; browser Agents page shows the actual download and command sequence.
