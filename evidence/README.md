# Verification evidence

Verified 17 October 2026. This is an actual **local EVM** implementation (chain31337), not a public BSC deployment. The mintable asset is **Mock BSC / wBSC**, six decimals, with no backing or monetary value.

## Checks observed

- Native Forge: **19 passed,0failed**. Covers token identity/mint restrictions, fourth-purchase pricing, net paid spend, seller/buyer isolation, replay, quote guards and transfer rollback.
- Vitest: **69 passed,0failed**. Covers policy, model-plan validation, signed delivery, run recovery/idempotency/stop behavior, whole-mission gas and deployment safety.
- Server TypeScript check and production Vite/React build passed.
- Actual wBSC contract name,symbol and decimals verified via RPC.
- All six prior paid records (three for rehearsal,three for judge) served through their signed HTTP entitlements.
- Local paid mission: **40000 base units (0.04wBSC)** transferred to Seller A; approved cap60000 leaves20000. Real successful receipt and matching seller balance delta observed.
- Duplicate order rejected; repeated API idempotency key returns the existing mission; conflicting request body rejected.
- Unaffordable work spends zero; unexpected browser origin rejected.
- Independent reader verified while the API was stopped and with no usable signing key. Returning price0.04; fresh A0.05/B0.045.
- Simulated missing seed metadata recovered from the actual OrderPaid logs, without another purchase.
- Desktop1280px and mobile390px checks; no horizontal overflow. Fresh preview, returning purchase, payment result and served record checked in the browser.

## Public artifacts

- [transactions.json](transactions.json): contract addresses, six setup receipts and completed rehearsal receipts.
- [independent-quotes.json](independent-quotes.json): actual API-independent RPC output.
- [rehearsal.jpg](rehearsal.jpg): completed browser rehearsal. Multiple intentional tests increase rehearsal history; that screenshot is not the untouched judge wallet.

The current judge role has five prior A payments totaling 230000 and 770000 token units held, with a next A price of 40000. Its latest stored mission predates the marketplace checks. See [demo-lab-current.json](demo-lab-current.json). Marketplace checks used separate disposable seller/buyer wallets. No chain history was reset.

## Explicit remaining items

Live Anthropic planning requires ANTHROPIC_API_KEY plus LLM_MODEL. Until configured,the UI explicitly labels deterministic planning. Public BSC97 deployment requires native tBNB gas even with a mock payment token. Neither external integration was claimed as verified. Native Studio integration, escrow/refunds and a two-minute video recording remain outside the completed local core.

## Wallet marketplace verification

- 19 Forge and 69 app tests pass; server TypeScript and production Vite build pass. Vite emits a 576 kB bundle-size advisory.
- [marketplace-e2e.json](marketplace-e2e.json): separate real local seller/buyer signatures, offer publication and search, payments 50000/50000/40000, seller delta 140000, private response delivery and wrong-wallet rejection.
- [marketplace-cli.json](marketplace-cli.json): actual agent CLI sign-in, publish, quote, budget rejection, buy, repeated intent recovery without another payment, delivery and earned discount.
- Regression: disabled listings do not block historical paid-order recovery in the CLI or browser saved-orders view. Spawned CLI test asserts zero replacement payment submissions.
- Public browser QA: desktop 1280 and mobile 390; discovery, search, category/empty states, publishing form, no-extension guidance and agent instructions. No horizontal overflow in checked mobile views.
- Browser-extension sign-in/publish/payment remains unverified in this browser; no injected wallet is available. EOA signing protocol is verified by real-chain clients. Smart-account/ERC-1271 authentication is not implemented.
- Local faucet lifetime caps: 1 wBSC and 0.05 ETH per wallet. It reserves a grant before broadcast; interrupted funding can leave a partial grant requiring inspection and a fresh disposable local wallet. It never automatically duplicates grants.

- [marketplace.jpg](marketplace.jpg): public marketplace preview showing a newly published seller service; no extension signature is implied by this image.

## Service-specific loyalty correction

Current verification: **25 Forge + 70 app tests**, server typecheck and production build pass. [service-loyalty-upgrade.json](service-loyalty-upgrade.json) records the local corrected checkout and verified old-order import. The same token/catalog are retained. [marketplace-cli.json](marketplace-cli.json) was refreshed after the fix: two services at one seller, A payments0.05/0.05/0.04, B still full-price0.05, independent paid spend/count and recovery without another transaction. Older screenshots and marketplace-e2e.json describe the earlier checkout and should be read as historical evidence. See [current status](../IMPLEMENTATION_STATUS.md).

## Standalone agent client verification

Current checks: **25 Forge + 73 app tests**, server TypeScript check and production frontend build passed. Skill validation passed. The existing Vite chunk-size advisory remains.

[marketplace-cli-standalone.json](marketplace-cli-standalone.json) records an actual HTTP download of /api/market/client into an empty /tmp folder with no node_modules, followed by Node subprocesses using fresh local seller/buyer wallets. It includes the file SHA-256, both seller publication receipts, four buyer payments, isolated service histories, paid delivery and same-intent recovery without another transaction. This directly covers the user's unrelated-folder failure; tsx does not install project scripts.

The standalone file bundles all npm dependencies and keeps recovery data in the working folder's .repeat-agent directory. The source CLI retains app/data. See the current [skill](../skills/repeat-marketplace/SKILL.md) for download, wallet and budget setup. This verifies the executable skill workflow, not a separate LLM loader or a public deployment.
