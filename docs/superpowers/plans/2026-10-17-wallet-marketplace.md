# Wallet Marketplace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Let personal and agent wallets publish, discover and buy real local-chain services.
**Architecture:** Browser and CLI own signing. Express verifies SIWE challenges and on-chain offer/payment state; persistent off-chain catalog stores discoverable metadata and private hosted responses. Existing contract enforces discounts.
**Tech Stack:** React19, TypeScript, viem2, Express5, Zod4, Solidity0.8.28/Anvil.
**Spec:** docs/superpowers/specs/2026-10-17-wallet-marketplace.md

## Global Constraints
- Only chain31337 or97; faucet only31337.
- Six-decimal unbacked wBSC, no value. No browser/server custody of personal wallet keys.
- Shared HTTP/types in spec and app/shared/marketplace.ts.
- Existing seeded judge wallet must remain untouched.

## Review Focus
- Auth challenge replay, expiry, signature mismatch and wrong chain.
- Paid content hidden from discovery; wrong wallet/order/service denied.
- Publishing metadata cannot impersonate another seller or contradict chain policy.
- Wallet account/chain changes invalidate local session/quote.
- User rejection or uncertain receipt never triggers a new purchase automatically.

### Task1: Authentication and catalog API
Files: app/server/marketplace.ts, app/server/market-auth.ts, app/server/market-store.ts, app/server/index.ts, app/server/marketplace.test.ts.
- [x] Write and run negative auth/catalog/delivery tests.
- [x] Implement exact spec routes; mount before existing error handler. Persist deployment-scoped catalog; seed fixtures without exposing responses.
- [x] Verify API on real local chain using fresh disposable wallets.

### Task2: Wallet marketplace frontend
Files: app/src/Marketplace.tsx, app/src/wallet.ts, app/src/marketplace.css, app/src/App.tsx.
- [x] Build primary marketplace/search/detail/publish UI and separate Demo lab.
- [x] Connect/sign SIWE, fund local wallet, publish through setOffer, pay through bounded approve/checkout, then retrieve response.
- [x] Verify typecheck/build and responsive browser interactions.

### Task3: Agent CLI and portable skill
Files: app/scripts/market-agent.ts, skills/repeat-marketplace/SKILL.md, skills/repeat-marketplace/references/api.md.
- [x] Build read-only discovery and explicit signed wallet commands with cap and receipt handling.
- [x] Document install/use, authorization boundaries and canonical protocol.
- [x] Validate skill and exercise CLI against local API without touching judge wallet.

### Task4: Integration and demonstration
Files: README.md, HACKATHON_PACK.md, BUILD_PROGRESS.md, evidence/marketplace-e2e.json.
- [x] Run contract/unit/type/build verification.
- [x] Use disposable seller and buyer for publish/search/sign/buy/deliver, independent wallet auth failure checks, repeat discount.
- [x] Browser QA including no-wallet, errors, search/publish, mobile; document any unverified wallet extension interaction.
- [x] Update final ideal output/demo and concise run instructions.

Verification completed: 19 Forge + 69 app tests, server typecheck and Vite build pass. Actual local API and CLI signed flows saved to evidence/. Public desktop/mobile UI verified. Extension signing is implemented and requires a manual wallet-enabled-browser rehearsal. Independent review found disabled-offer recovery and stale CLI help flags; both fixed and checked. Current Demo lab history documented without reset.
