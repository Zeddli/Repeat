# Repeat wallet marketplace
The primary product is a marketplace where people and agents publish paid services, discover services and purchase with their own signing wallets. Loyalty is seller-funded lower pricing enforced by the existing LoyaltyCheckout contract. Test wBSC and local gas have no monetary value; signing in and signing transactions are still required.

## Scope and decisions
- Browser injected EIP-1193 wallet; SIWE nonce sign-in (domain, chain, URI, issue/expiry); expiring bearer session held in browser memory. No private keys enter the frontend or API.
- Public discovery; publishing, local funding and delivery require the authenticated wallet. Wallet account/chain changes clear sign-in.
- Real seller setOffer transaction before publishing. Existing contract supports arbitrary seller/SKU without new deployment. New service SKU is keccak256(UTF8 service id). Only authenticated seller can publish its metadata; backend reads the confirmed offer and checks matching policy.
- Minimal useful service is a hosted text or JSON response, hidden from public discovery and returned only after checking buyer/order/seller/SKU in confirmed chain state. Existing four research records are visible as builder-operated fixtures.
- Free local faucet only chain 31337, topping disposable wallets to capped gas/token balances. Public BSC gas still requires tBNB. No faucet accepts chain 97.
- Each browser purchase explicitly signs a bounded exact allowance, then checkout with random order id, quote version, maximum amount and two-minute deadline. No automatic retries that create a second payment. Delivery retries reuse the order.
- Agent CLI performs the same auth, search, seller publish, quote, payment and delivery protocol. Its key stays in the agent's environment; explicit buy/publish commands and spending cap required.
- Existing scripted loyalty demo remains a clearly labeled Demo lab, separate from signed-in marketplace wallet.

## HTTP contract
Amounts are integer strings in six decimals. All POST bodies strict. Auth header: Authorization: Bearer TOKEN.
- GET /api/market/config -> MarketConfig
- POST /api/auth/challenge {address,chainId} -> AuthChallenge
- POST /api/auth/verify {challengeId,signature} -> WalletSession
- GET /api/auth/session -> {address,expiresAt,chainId}; POST /api/auth/logout -> {ok:true}
- GET /api/market/services?q=&category= -> {services:ServiceListing[]}
- GET /api/market/services/:id -> ServiceListing
- POST /api/market/services (auth, PublishService) -> ServiceListing (201)
- GET /api/market/services/:id/quote?buyer=ADDRESS -> ServiceQuote
- GET /api/market/wallet (auth) -> MarketWallet
- POST /api/market/faucet (auth, {}) -> FaucetResult
- POST /api/market/services/:id/deliver (auth, {orderId}) -> MarketDelivery
- Shared exact types: app/shared/marketplace.ts.
- All API failures {error,message}. 401 auth needed; 403 wrong owner/unpaid; 409 conflicts/stale policy; 400 invalid input.
