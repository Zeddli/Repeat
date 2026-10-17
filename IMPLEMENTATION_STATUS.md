# Current implementation status — 17 October 2026

## Loyalty bug: fixed and upgraded locally
The old contract keyed paid history by buyer and seller. The corrected key is buyer + seller + service SKU. Only repeated payments for that service count. A service's current payment contributes to its next quote, not its own eligibility.

The running local checkout is 0x4ed7c70F96B99c776995fB64377f0d4aB3B0e1C1 on chain 31337. It preserves the same mock wBSC token. The upgrade carried 18 verified old payments into 11 separate service ledgers, retained the public/private catalog, and preserved old order delivery. It did not replay payments or reset balances. See evidence/service-loyalty-upgrade.json.

A discount previously inherited from another service is correctly removed. For example, the prepared judge wallet's bnb-budget history is only 0.08 wBSC / two purchases, so it currently pays A's full 0.05 price until that service reaches 0.15. The old 0.23 total across all A services no longer qualifies it. Fresh setup seeds the same bnb-budget service three times for a focused demo.

Refresh the browser and reconnect after the upgrade. A new checkout requires its own bounded allowance approval.

## BNB Agent Studio SDK: not integrated
The application uses viem, custom Solidity contracts and its own CLI/controller. Neither @bnbagent/sdk nor the Studio runtime is integrated. Do not claim Studio/ERC-8004/ERC-8183 compatibility. This remains a hackathon integration gap. Official reference: https://github.com/bnb-chain/bnbagent-sdk.

## Which actions are on-chain
Verified on the local Anvil EVM, chain 31337:
- Seller offer price, spend threshold, discount and enabled/version state.
- Mock token minting, balances, allowances and transfers.
- Signed checkout, actual paid amount, per-service purchase history and paid-order entitlement.
- Verified legacy-order history imports for the service-scoped upgrade.

Off-chain:
- SIWE sign-in message and session. The signature proves wallet ownership without a chain transaction.
- Service title, description, category, private response and search/catalog indexing.
- Delivered text/JSON, HTTP authentication and orchestration.

Quotes and entitlement checks read on-chain state but do not themselves send transactions. This is not a public BSC deployment. Chain 97 configuration still needs native tBNB and deployment verification.

## Agent skill and actual workflow
The portable skill is skills/repeat-marketplace/SKILL.md. Download /api/market/client as repeat-agent.mjs, then run it with Node22.12+ from any folder. No checkout, tsx or npm install is needed. The earlier npx tsx scripts/market-agent.ts instructions failed outside the repository because they did not download the script. The executable client can create/publish, discover/search, quote, buy and deliver services using an agent-owned wallet. It requires an explicit spend cap for purchases; signing in alone never grants spending permission. Downloaded clients retain recovery data in .repeat-agent; MARKET_AGENT_DATA_DIR can select a fixed private location.

Run against the local API:
```bash
npm --prefix app run check:agent:standalone
```

Actual downloaded-client subprocess test from an empty temporary folder without node_modules, using separate fresh seller and buyer wallets:
- Published two services under the same seller.
- Discovered both without a key and read wallet-specific quotes.
- Rejected an over-budget purchase before any transaction.
- Bought service A for 0.05, 0.05, then 0.04 wBSC.
- Service B stayed 0.05 with zero history despite A's earned discount.
- Bought B for 0.05; A stayed at three purchases / 0.14 paid and B at one purchase / 0.05 paid.
- Retrieved paid responses and recovered the same intent without another transaction.

Evidence: evidence/marketplace-cli-standalone.json includes the download hash, temporary working directory and transaction receipts. The source CLI also passed in evidence/marketplace-cli.json. The skill frontmatter validates. This tests its documented CLI workflow; a separate LLM runtime automatically installing/loading the skill was not tested. Browser-extension prompts also remain a manual rehearsal.

## Checks
25 contract tests and 73 app tests pass; server typecheck and production frontend build pass. Includes service isolation, verified/idempotent migration, old-order entitlement/replay, old-deployment browser recovery, dependency-free download, and portable journal-path tests. The Vite bundle-size advisory is unchanged.
