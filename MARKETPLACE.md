# Wallet marketplace — final ideal output

Current correction: loyalty is per buyer + seller + service SKU. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior, SDK/on-chain boundaries and agent test evidence.

Updated 17 October 2026 from the user's direction: users and agents must sign with their wallets; service creation, discovery and purchase are the core product.

## Pitch

“Repeat is a marketplace where people and AI agents sell services to each other. Both use their own wallets. Sellers can reward repeat buyers of each service with automatic discounts, and agents can read those earned prices before deciding where to spend.”

The marketplace is the product; verified loyalty is the differentiator. No real money is required on the local demo chain, and every wallet still proves ownership and signs transactions.

## Ideal three-minute demo

- **0:00–0:35 — Supply appears live.** Seller connects and signs in. Publishes a short paid research/JSON service: base 0.05 wBSC, threshold 0.10,20% discount. Show the actual seller-signed setOffer receipt and searchable listing.
- **0:35–1:15 — Another wallet becomes the customer.** Buyer connects, signs in, uses the local mock faucet, searches by title and buys. Show wallet approval/checkout, actual token movement and the previously hidden response.
- **1:15–1:50 — An agent uses the same marketplace.** Agent CLI/skill discovers the service and reads a wallet-specific quote. Run an explicitly authorized capped purchase, or recover an already-paid result from its saved order. The key stays with the agent.
- **1:50–2:35 — Loyalty changes the decision.** Switch to a prepared service with genuine earlier purchases of that same SKU. Show its 0.05 list price becoming 0.04 while another service at the same seller remains full price. Label the earlier purchases. The agent buys only the requested service within its 0.06 cap, leaving 0.02.
- **2:35–3:00 — Proof travels.** Independent reader reproduces the same tier directly from the contract. Finish: “Sellers set the benefit. Wallet history proves it. Agents decide whether to take it.”

For a short presentation, prepare the seller listing before stage and begin with buyer sign-in; preserve one live purchase and the independent quote proof.

## Acceptance criteria

- [ ] A browser wallet connects and signs a one-use, chain/domain-bound sign-in challenge.
- [x] A newly authenticated seller signs setOffer and publishes its own service.
- [x] Anonymous discovery can search listings without exposing paid responses.
- [x] A different authenticated buyer signs a bounded token approval and checkout.
- [x] Confirmed seller/SKU/order ownership unlocks the private service response.
- [x] An agent independently discovers, quotes and purchases through the documented wallet protocol.
- [x] Repeating useful purchases changes the effective quote at the configured spend threshold.
- [x] Wrong signer, replayed challenge, unpaid/wrong-wallet order and policy mismatch are rejected.
- [x] The UI clearly labels local chain, unbacked wBSC, fixture services and Demo lab custody.
- [x] Receipts and saved order IDs allow recovery without silently paying twice.

Current local protocol and CLI verification completed: 25 Forge tests, 73 app tests, server typecheck and production build pass. Separate seller/buyer EOA signatures, publication, token transfers, discount and private delivery are proven in [marketplace-cli-standalone.json](evidence/marketplace-cli-standalone.json) using the downloaded client from an empty folder. Older [marketplace-e2e.json](evidence/marketplace-e2e.json) describes the earlier checkout; [marketplace-cli.json](evidence/marketplace-cli.json) covers the corrected source CLI. Browser discovery, search, forms, no-wallet guidance and responsive layouts were checked. Extension-backed sign-in and transactions still need a manual rehearsal in a wallet-enabled browser.

The old Demo lab preparation bought different services. Those payments now remain separate and no longer unlock another service. Fresh setup prepares three actual purchases of bnb-budget for the focused loyalty demo. The local upgrade keeps existing history without adding demo purchases; current per-service totals are recorded in evidence/demo-lab-current.json.

Evidence must distinguish real local-chain checks from browser-extension interaction and public BSC deployment. A screenshot of discovery alone does not verify extension signing.

## Architecture and data flow

A React/Vite browser or the downloadable Node.js agent client (built from the TypeScript CLI) talks to Express for authentication, catalog and content. Signing happens in the browser's EIP-1193 provider or the agent's own local signer. Both submit directly to the configured chain through viem.

1. API issues a five-minute SIWE challenge containing wallet, chain, domain, URI and nonce.
2. Wallet signs the message; API verifies the exact issued message, consumes the nonce, and returns a one-hour opaque bearer session.
3. Seller signs setOffer(serviceSKU,basePrice,threshold,discount,true). After confirmation, API checks the same seller/SKU/policy before persisting metadata and private response.
4. Search returns public metadata. Quote reads offer and preview at a concrete chain block for the buyer address.
5. Buyer approves the exact maximum for checkout and signs checkout with service seller, SKU, random order ID, maximum amount, offer version and deadline.
6. Contract verifies constraints, computes tier from prior actual paid spend for this service and atomically transfers wBSC buyer→seller while updating purchase history.
7. Authenticated delivery reads the confirmed paid order for that buyer. Only matching seller/SKU/positive payment returns the stored response.
8. A second client needs only the same wallet address and contract to reproduce eligibility.

Metadata and paid responses use a deployment-scoped local JSON store. Price, policy, paid spend and order entitlement are contract state. Catalog content and discoverability remain centrally hosted in this prototype.

## Component stacks

- **Web:** React 19, TypeScript 5.9, Vite 7; existing ivory/ink/gold design; injected EIP-1193 wallet via viem 2 custom transport. No browser key storage.
- **Authentication:** Express 5, Zod 4, node:crypto random challenges/tokens, viem SIWE message creation and EOA signature recovery. In-memory expiring sessions, no browser token persistence.
- **Catalog:** deployment-scoped local JSON with atomic persistence; strict schemas; public/private fields separated. Immutable hosted listing payloads; new seller-controlled offers remain on-chain.
- **Payments:** Solidity 0.8.28 LoyaltyCheckout, OpenZeppelin SafeERC20/ReentrancyGuard/Math; seller versioning, max amount, deadline and replay guards.
- **Test asset:** MockWBSC ERC-20, six decimals, restricted minter. Local faucet tops wallets to capped test balances on31337 only.
- **Chain access:** viem public client for reads/simulation/receipts; browser or CLI wallet client for user transactions. Anvil 31337 locally; configurable BSC 97 with native tBNB gas.
- **Delivery:** authenticated Express endpoint; confirmed orders mapping checked against buyer, seller and SKU. Fixed response service today; external API/compute adapters are future work.
- **Agent:** downloadable dependency-bundled Node.js22.12+ client built with esbuild from the TypeScript CLI; source tsx CLI also available; environment-owned signer, explicit spend cap, durable intent/order/hash journal, portable SKILL.md and protocol reference.
- **Prepared demo:** bounded controller plus deterministic planner or configured Anthropic model, separate fixture wallets and existing corpus services.
- **Quality:** Forge contract tests, Vitest business/auth/client safeguards, TypeScript checks, Vite production build, independent local-chain integration script, desktop/mobile browser QA.

## Wallet ownership and discount economics

Signing in authorizes a session to manage a wallet's listings and retrieve its paid content. It grants no blanket spending permission. Token approval authorizes a bounded contract allowance; checkout authorizes a particular order. Agents still need their owner's task and budget.

The seller receives the discounted amount directly. For0.05 list and20% discount, buyer sends0.04 and seller receives0.04. The seller gives up0.01 of potential revenue. The platform does not fund the difference. Eligibility is based on previous actual payments for that exact seller and service SKU; the current order cannot qualify itself.

Local test gas is ETH on Anvil. BSC testnet gas is tBNB. The mock payment token is neither gas nor a redeemable wrapped asset.

## Development resources

- [SIWE standard, ERC-4361](https://eips.ethereum.org/EIPS/eip-4361)
- [viem wallet custom transport](https://viem.sh/docs/clients/transports/custom)
- [viem SIWE message creation](https://viem.sh/docs/siwe/utilities/createSiweMessage)
- [viem contract writes](https://viem.sh/docs/contract/writeContract)
- [OpenZeppelin ERC-20](https://docs.openzeppelin.com/contracts/5.x/erc20)
- [Anvil](https://getfoundry.sh/anvil/overview/)
- [Downloadable agent client](http://localhost:5173/api/market/client), [agent skill](skills/repeat-marketplace/SKILL.md) and [API reference](skills/repeat-marketplace/references/api.md)
- [Original research/resources](DEV_RESOURCES.md)

## Prototype limits

EOA sign-in only; no smart-account/ERC-1271 or WalletConnect support yet. Hosted static responses are the implemented service type. A buyer may copy delivered data, so entitlement is enforced at access time rather than DRM. Seller can change its on-chain policy; new quotes read current policy and stale versions are rejected. No escrow/refunds or quality arbitration. Local sessions/catalog are single-process infrastructure. Public-chain deployment and live-model integration require separate verification.
