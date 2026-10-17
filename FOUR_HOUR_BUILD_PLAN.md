# Repeat — Four-Hour Marketplace Build Plan

This revised solo plan starts from the existing tested checkout/token and local tooling. The wallet marketplace is the current scope; the earlier contract-first sprint appears below as historical detail.

**Final output:** a seller signs in and publishes; a second wallet searches, signs and pays; an agent uses the same API; verified paid history changes effective pricing. See [MARKETPLACE.md](MARKETPLACE.md).

## 0:00–0:35 — Wallet identity

- [ ] Add injected wallet connect, local chain switch/add and EOA sign-in.
- [ ] Issue five-minute chain/domain-bound SIWE challenges; consume once and create a one-hour session.
- [ ] Clear UI sessions on wallet account or chain changes.
- [ ] Reject replay, wrong signer, expiry and wrong origin/chain.
- [ ] **Output:** two separate wallets can sign in; browsing remains public.

## 0:35–1:15 — Seller supply and discovery

- [ ] Create a deployment-scoped catalog with public metadata and private response fields.
- [ ] Build a seller form: title, description, category, price, prior-spend threshold, discount up to 20%, paid text/JSON response.
- [ ] Seller signs setOffer; server verifies the confirmed seller/SKU/policy before publication.
- [ ] Add search and category filters; expose eight labeled research fixture listings.
- [ ] **Output:** a newly created seller service appears in search without leaking its response.

## 1:15–2:05 — Buyer payment and delivery

- [ ] Add local authenticated faucet with persistent per-wallet caps; disable it on chain 97.
- [ ] Read personalized quotes directly from confirmed contract state.
- [ ] Buyer signs exact bounded allowance and checkout with order ID, maximum, version and deadline.
- [ ] Preserve pending identity and expose retrieval retry; no automatic replacement purchase.
- [ ] Deliver only to the signed-in wallet with matching confirmed seller/SKU/order.
- [ ] **Output:** actual wBSC buyer→seller transfer unlocks a previously private response.

## 2:05–2:45 — Agent access

- [ ] CLI offers discover, quote, wallet, faucet, publish, capped buy and delivery recovery.
- [ ] Keep the agent's key in its own environment; no server key custody.
- [ ] Persist intent/order/hash and refuse uncertain duplicate payments.
- [ ] Add a portable skill and HTTP reference, available through the local API.
- [ ] **Output:** a separately signed agent flow uses the same marketplace as the human UI.

## 2:45–3:15 — Loyalty and pitch

- [ ] Prove real purchases 0.05 + 0.05 meet a 0.10 threshold; next price is 0.04.
- [ ] Prepare the original Demo lab comparison: A 0.04 versus B 0.045 for the returning wallet.
- [ ] Reserve the judge wallet's next purchase; label warm-up history and fixture sellers.
- [ ] Reproduce the quote from an independent reader.
- [ ] **Output:** seller-funded loyalty is visible as a reason to choose a provider.

## 3:15–4:00 — Verification and rehearsal

- [ ] Run Forge, Vitest, server typecheck and production build.
- [ ] Exercise the full marketplace on local chain using fresh disposable seller/buyer wallets.
- [ ] Browser QA: no-wallet guidance, search, listing detail, publish form, errors and mobile layout.
- [ ] Manually rehearse extension signing in a wallet-enabled browser.
- [ ] Save public receipts and a screenshot; rehearse the three-minute sequence.
- [ ] **Output:** working marketplace, agent skill, documented limits and recoverable demo evidence.

Cut optional work first: external API execution, smart accounts, WalletConnect, payment adapters, escrow/refunds, public hosting and live-model enhancements. Do not cut wallet ownership, real payments or paid-response gating.

---

# Historical contract-first implementation plan

> For agentic workers: use `superpowers:executing-plans` for inline execution or `superpowers:subagent-driven-development` when a builder explicitly chooses delegated implementation. This document prepares the work; it does not start implementation.

**Goal:** demonstrate a budgeted AI buyer earning and redeeming a seller discount through real BSC-testnet payments, with an independent client reading the same eligibility.

**Architecture:** a custom atomic checkout owns payment-derived loyalty state; a local TypeScript controller compares contract quotes and purchases allowed data records. The model plans tasks, while deterministic code controls spending.

**Tech stack:** Solidity/Foundry/OpenZeppelin, BSC97, viem, Node/Express/TypeScript/Zod, Anthropic SDK, React/Vite/plain CSS, Vitest.

**Spec:** [HACKATHON_PACK.md](HACKATHON_PACK.md). Resources: [DEV_RESOURCES.md](DEV_RESOURCES.md).

**Budget:** exactly 240 minutes for one builder. Example: 10am–2pm MYT on 17 October; submit before the event's 5pm target. Setup is included unless explicitly completed beforehand under organizer rules.

## Global constraints

- BSC testnet only, chain ID 97. No production funds or public unauthenticated signing API.
- wBSC is a six-decimal demo token; gas is separately denominated in tBNB.
- A base=50000, per-service prior-paid threshold=150000, discount=2000bps. B starts55000, then45000, optionally35000. Application ceiling=300000; final judge mission cap=60000 token base units.
- Four corpus record IDs, one SKU per record; `sku=keccak256(UTF8(recordId))`.
- At most four planned tasks; the final judge mission requests only `bnb-budget`. An optional fifth purchase needs a new explicitly requested mission and its own sufficient approved budget.
- Eligibility uses prior net paid spend for the same buyer/merchant/service SKU. Third A purchase full price; fourth discounted.
- Private keys server-side; LLM cannot choose transaction targets, calldata, keys or budget.
- Custom checkout is not described as native Studio/ERC-8183/B402. Check organizer eligibility before choosing this route.

## Review focus

1. Offer changes between preview and mining must reject the old version without charging (Task 2).
2. Duplicate HTTP requests and uncertain transactions must resolve the existing order before another payment (Tasks 4 and 7).
3. Model output with unknown/duplicate records or more than four tasks must not trigger spending (Task 4).
4. Invalid token allowance or transfer failure must not increase paid spend or count (Task 2).
5. Another wallet or a signature for another record must not reuse a paid entitlement (Task 4).

## Task 1 — Readiness and route freeze | 00:00–00:15

**Files:** create app/contract skeleton from DEV_RESOURCES; `app/.env.example`, `app/.gitignore`, root README notes. Do not overwrite an existing project without inspecting it.

**Consumes:** organizer requirements, test wallets, funded API credential.

**Produces:** confirmed route, tool versions, working RPC and a feasible model request.

- [ ] Record minimum Studio usage, prebuilt-code rules, submission link and demo length with a mentor.
- [ ] Check Node >=22.12, Forge, RPC chain97, test-wallet tBNB, model access.
- [ ] Scaffold `contracts/` and React TS `app/`, install core dependencies and create the server script/typecheck configuration from DEV_RESOURCES.
- [ ] Add ignored secret/journal files and `.env.example`. Put public addresses in `deployments/97.json` only after deployment.
- [ ] Request a minimal supported model response before committing to provider integration; cap provider setup at ten minutes.

**Ideal output:** clean build skeleton and an explicit go/no-go on the custom route.

**Cutoff:** if Studio is mandatory, switch immediately to spec section7's smaller Studio-native route. Do not attempt both architectures. If funding is unavailable, use local Anvil for development while seeking tBNB; label local evidence and keep a real-testnet transaction as the target.

## Task 2 — Payment and eligibility contracts | 00:15–01:05

**Files:** `contracts/src/MockWBSC.sol`, `contracts/src/LoyaltyCheckout.sol`, `contracts/test/LoyaltyCheckout.t.sol`, `contracts/foundry.toml`.

**Consumes:** exact custom Solidity interfaces and event in spec section5B.

**Produces:** compiled contracts and meaningful passing payment tests.

- [ ] Write threshold/payment tests before implementing checkout. Use the exact expectations below; run `forge test --root contracts -vv` and confirm relevant tests initially fail for missing behavior.
- [ ] Implement six-decimal restricted-mint MockWBSC; set compiler0.8.28 and conservative Paris EVM target, resolving dependency compatibility now.
- [ ] Implement offer publication/versioning keyed by `msg.sender`, Stats, PaidOrder, preview and checkout. Cap discount at2000bps, require positive base/threshold, reject disabled offers.
- [ ] Use prior spend, integer arithmetic, `SafeERC20`, reentrancy guard, buyer-scoped global order deduplication and atomic state/payment updates.
- [ ] Run Forge tests and fix the behavior each failed test identifies. Record compiler and dependency versions.

**Exact test assertions:**

```text
threshold_applies_to_next_purchase:
  previews before A purchases1,2,3 each=50000
  after third: paid=150000, count=3, next preview=40000
  after fourth: paid=190000, count=4, seller received190000
  gross list-price discount across four=10000

isolation:
  a fresh buyer preview at A=50000
  returning buyer's A history does not discount B
  merchant A cannot edit B's offer bucket

rollback_and_replay:
  no allowance => revert, paid/count unchanged, order unused
  same buyer/orderId twice => second call reverts, no second transfer
  same buyer/orderId at another merchant => also rejected

quote_guards:
  updated version, expired deadline, disabled offer, or maxAmount<price
  => revert with balances/history unchanged
  discount>2000, zero price, zero threshold => configuration rejected
```

**Ideal output:** `forge test` passes all these cases by minute65.

**Cutoff:** simplify decorative UI and future integrations before reducing contract checks. If the multi-merchant implementation is failing at minute65, ship one merchant and stop claiming a live two-provider decision; document the smaller scope.

## Task 3 — Testnet deployment and genuine history | 01:05–01:30

**Files:** `contracts/script/Deploy.s.sol`, `app/scripts/seed.ts`, `app/shared/abi.ts`, `app/deployments/97.json`, `app/data/corpus.json`, `evidence/transactions.json`.

**Consumes:** compiled ABI/bytecode, disposable deployer/buyer/merchant signers.

**Produces:** public deployment metadata, configured offers, real warm-up receipts.

- [ ] Define four corpus records with IDs `bnb-agents`, `bnb-identity`, `bnb-commerce`, `bnb-budget`; include source URL, capture date and facts. Label fixture data.
- [ ] Deploy token+checkout on chain97 and record deployment block, addresses, source versions and hashes. Dry-run before broadcasting.
- [ ] Configure identical A policies across all four SKUs; configure B at55000 with no discount, using each merchant's own signer.
- [ ] Prepare separate rehearsal and reserved judge buyer wallets, mint1wBSC to each, and approve only bounded allowances. Fund gas separately. Record public addresses; keep keys local.
- [ ] Make three genuine purchases of the same A service for each wallet, with distinct order IDs; B initially costs55000, so A is the rational choice. Record order IDs, six total transaction hashes, and paid spend150000 for each. Reserve the judge wallet's fourth purchase for presentation.
- [ ] Read `preview` directly: returning A=40000, fresh A=50000. Wait for successful confirmations; do not treat a pending hash as settled history.

**Ideal output:** the next purchase is demonstrably discounted on BSC testnet.

**Cutoff:** no cloud deploy, real stablecoin sourcing, explorer verification UI or identity registration until this works. If testnet is still blocked by minute90, preserve a functioning local-chain demo and a transparent infrastructure limitation; never label it BSC evidence.

## Task 4 — AI plan, buyer, payment-gated service | 01:30–02:10

**Files:** `app/shared/types.ts`, `app/server/{index,planner,policy,runner,service,journal}.ts`, `app/tests/{policy,runner}.test.ts`.

**Interfaces:**

```typescript
type Quote = {
  buyer: `0x${string}`; merchant: `0x${string}`; sku: `0x${string}`;
  amount: bigint; appliedBps: number; priorPaid: bigint;
  offerVersion: bigint; blockNumber: bigint;
};
type TaskPlan = { mission: string; recordIds: string[] };
planMission(mission: string): Promise<TaskPlan>;
chooseQuote(quotes: Quote[], remainingBudget: bigint): Quote | null;
executeTask(runId: string, recordId: string): Promise<void>;
recoverOrder(buyer: `0x${string}`, orderId: `0x${string}`): Promise<
  'confirmed' | 'pending' | 'not-submitted' | 'failed'>;
```

Functions are proposed local interfaces to implement. Shared types serialize bigint fields as strings at the JSON boundary. Runner exposes the API routes in spec section5D.

- [ ] Write policy tests: A40000 beats B45000; B35000 beats A40000; fresh A50000 loses to B45000; no affordable quote returns null; ties are deterministic.
- [ ] Pin the final-demo budget case: cap60000 minus payment40000 leaves20000; another35000 purchase in that mission is rejected. A new explicitly requested60000 mission selects B35000 over A40000 and leaves25000.
- [ ] Write planner-validation tests: unknown ID, duplicates and >4 records cause `INVALID_PLAN`, with zero signer calls.
- [ ] Implement the supported Anthropic SDK tool-schema request; Zod validates task IDs. Model receives no private key or payment tool.
- [ ] Implement same-block quote reads, allowlisted merchants, amount/gas caps, fixed deadline/version, simulation, sequential signing and receipt/event verification.
- [ ] Implement JSONL journal: persist order ID and intent before send, hash immediately after send, receipt/status after confirmation. Unknown outcomes pause for lookup, not another order.
- [ ] Implement delivery signature verification and chain-order lookup; a different wallet/record fails. Existing successful order can retry delivery without another payment.
- [ ] Retrieve setup-run records for both wallets through their existing paid orders and record returned results. Keep setup separate from the live `bnb-budget` mission; do not plan or charge those records again. Runner selects rehearsal/judge wallet from local `ACTIVE_BUYER_ROLE` at startup.
- [ ] Bind API to loopback, proxy through Vite, reject unexpected origins on write routes, disable parallel runs and implement stop.

**Meaningful runner assertions:** ambiguous transaction outcome leads to order lookup and zero second payment calls; HTTP delivery retry uses the same order; wrong-chain receipt/contract is rejected; wrong wallet, expired signature or wrong SKU gets no data.

**Ideal output:** command/API can plan one allowed request, select, pay and return the correct corpus record.

**Cutoff:** at minute130, a working deterministic buyer is preferable to an unfinished model agent. Preserve it and visibly label planning fallback; keep the real LLM success as an ideal criterion, not a false claim. Drop arbitrary chat inputs and use one mission preset if needed.

## Task 5 — Projector-readable console and second client | 02:10–02:50

**Files:** `app/src/App.tsx`, `app/src/styles.css`, `app/scripts/quote.ts`, `app/vite.config.ts`.

**Consumes:** quote/run APIs; public ABI and deployment metadata.

**Produces:** one-screen demo and an independent reader.

- [ ] Build mission header, spend cap, buyer address, provider prices, selected provider, spend-progress indicator, events and returned record.
- [ ] Show list/current price separately; show cumulative gross discount10000 after four A buys and gas in tBNB. Render bigint token units with six decimals.
- [ ] Add run/stop, fresh-wallet preview and B repricing controls; disable conflicting actions while a transaction is pending.
- [ ] Implement `quote.ts --buyer <address> --record <id>` reading chain state without importing server modules, journal or private keys.
- [ ] Make B45000/B35000 controls issue confirmed `setOffer` changes for the next record SKU. Display the confirmed offer version.
- [ ] Run `npm run build`, `npm run typecheck:server` and `npm test` from app; fix failures before visual polish.

**Ideal output:** a judge can understand the decision and verify the transaction without opening source code.

**Cutoff:** at minute170 stop adding components. If UI is incomplete, use quote CLI + a compact receipt/result panel. Keep four numbers visible: A price, B price, amount paid, remaining budget.

## Task 6 — End-to-end live rehearsal | 02:50–03:10

**Files:** update `evidence/transactions.json`, `evidence/README.md`; fix only integration bugs in existing files.

- [ ] Verify warm-up history150000/count3 and next A price40000 on chain97.
- [ ] Start backup recording with the rehearsal wallet. Confirm B45000 for `bnb-budget`. Use the final ideal-output script in HACKATHON_PACK section9: show fresh-wallet public quotes, reveal returning history, then run one live model plan with mission cap60000 and show A selection.
- [ ] Complete purchase four: A merchant delta40000, lifetime merchant paid190000, gross discount10000; live mission spent40000/remaining20000. Returned record matches paid SKU.
- [ ] Inspect event fields and actual token balances; separate ERC20 spend from tBNB gas.
- [ ] Preview fresh wallet: A50000/B45000. Optionally set B35000 and preview its selection for a new mission. The original mission has only20000 left; do not silently charge35000 or create unnecessary work.
- [ ] Refresh the page and independently read the chain; tier survives because the application is not its source of truth. Save this rehearsal as the backup recording; leave the judge wallet at three A purchases.

**Ideal output:** the entire narrative works once without manual state edits.

**Cutoff:** freeze economics and interfaces at minute190. Remove unstable extras rather than changing the story for rehearsal.

## Task 7 — Failure cases and portable history | 03:10–03:35

**Files:** focused fixes and regression assertions in existing tests; evidence notes.

- [ ] Replay the same order ID: revert/no extra paid spend. A simulated failure is enough during presentation; do not pay needless gas for theatrics.
- [ ] Validate stale offer and insufficient allowance failures leave state unchanged.
- [ ] Exercise duplicate run/HTTP retry and ambiguous receipt recovery; no automatic extra charge.
- [ ] Stop the API and run quote CLI using only public metadata. Compare returning/fresh prices with earlier chain reads.
- [ ] Exercise delivery timeout: payment remains confirmed, result reports failure and retry uses existing entitlement.
- [ ] Re-run Forge tests, `npm test`, server typecheck and frontend build after fixes.

**Ideal output:** fresh verification evidence and a concrete reason the shared ledger matters.

**Cutoff:** at minute215 no new features. If any money/state check fails, fix or disable that path and state the limit.

## Task 8 — Submission and two-minute performance | 03:35–04:00

**Files:** root README, `evidence/README.md`, `evidence/transactions.json`, `evidence/demo.mp4`.

- [ ] At minute215 freeze code and record current contract/token addresses and tested versions.
- [ ] Trim/export Task6's rehearsal recording as a two-minute backup with the real discounted purchase, source record, independent reader and clear testnet/fixture labels. Avoid another paid take on the reserved wallet.
- [ ] Restore and confirm B's `bnb-budget` offer45000, switch local configuration to `ACTIVE_BUYER_ROLE=judge`, restart the API and verify the reserved wallet has A paid150000/count3 and next price40000. Preview only; its live fourth purchase happens before the judges.
- [ ] Add exact setup/run commands, test results, architecture and limitations to README. State custom checkout versus any actual Studio integration precisely.
- [ ] Check tracked files, terminal/video frames and logs for secrets; include only public evidence.
- [ ] Rehearse thirty-second pitch, two-minute demo and answers to blockchain/AI/competitor/gas objections.
- [ ] Submit through the organizer's confirmed form, save the receipt/link and keep the laptop demo running.

**Ideal output:** a submitted prototype, reproducible proof and a fallback video, with time to spare before5pm.

## Success levels

- **Minimum credible:** one real BSC discounted payment after paid history, verified receipt, correct data result and visible bounded buyer logic.
- **Final ideal output:** the five-step two-minute demo and final-output checklist in [HACKATHON_PACK.md section9](HACKATHON_PACK.md#9-final-ideal-output): public quotes → genuine loyalty history → agent selects A0.04 → live payment and returned data → independent reader. Mission cap0.06 leaves0.02 after payment; B0.035 repricing is optional and separate.
- **Target:** two providers, live model plan, rational price choice, fresh-wallet case, independent reader and passing payment/controller checks.
- **Stretch only after target:** native Studio adapter, ERC-8004 binding, externally hosted read-only UI or an independently operated merchant. Do not spend target time on these.

Unchecked boxes describe intended output. They must stay unchecked until the corresponding command, transaction or manual check actually supplies evidence.
