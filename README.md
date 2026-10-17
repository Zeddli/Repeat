# Repeat

Current correction: loyalty is per buyer + seller + service SKU. See [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md) for verified behavior, SDK/on-chain boundaries and agent test evidence.

A wallet-based marketplace for human and agent services. Sellers publish a service and choose a loyalty discount. Buyers discover services, sign in with their own wallet and pay with **wBSC**. The checkout transfers real ERC-20 balances and calculates discounts from confirmed prior purchases.

## Run locally

Use Ubuntu/WSL, Node 22.12+ and npm:

```bash
npm ci
npm --prefix app ci
npm run setup:local
npm run dev
```

Open **http://localhost:5173** in a browser with an injected Ethereum wallet, such as MetaMask or Rabby. The Codex in-app browser may have no wallet extension; public discovery still works there. Use a disposable wallet for this local test chain.

1. Choose **Connect wallet**, approve the local chain switch/addition and sign the sign-in message.
2. Choose the local funding action to receive capped mock wBSC and test gas.
3. Browse/search services and inspect your personalized price.
4. To sell, open **Publish service**, enter a public description, the ready-made content buyers receive, price and loyalty rule. Sign the on-chain offer, then publish.
5. To buy, sign the bounded token approval and checkout transaction. The purchased response appears after confirmed payment.

The API runs on 127.0.0.1:3001; the local Anvil chain is 31337 at 127.0.0.1:8545. All three processes must be accessible from the browser's machine. No money is needed locally. **wBSC is an unbacked six-decimal mock ERC-20, not wrapped or redeemable BNB.** Sign-in proves wallet ownership; purchase signatures authorize spending.

## Product boundaries

The marketplace supports a hosted text or JSON response per service. Public listings show metadata and pricing; the paid response stays on the server until the authenticated buyer proves a matching confirmed order. This is a useful first service type, with an external API/compute adapter left for a later version. The seeded BNB research listings use a labeled fixed corpus and builder-operated sellers.

The seller signs its offer from its own wallet. A buyer signs its own approval and checkout; the marketplace API never receives that wallet's private key. Local faucet minting is a separate builder-controlled operation, only available on31337. Sessions expire after one hour and are invalidated locally on wallet/chain changes. Sign-in currently supports EOA wallets; ERC-1271 smart-account authentication is a future extension.

The existing contract supports arbitrary sellers and service SKUs. Discovery metadata is stored off-chain, checked against the seller's on-chain policy. Loyalty is separate for every buyer, seller and service SKU. A seller funds a discount by accepting less revenue; there is no cashback subsidy or reward-token issuance.

## Agent access

Start in **any folder** on the same computer as the running platform:

```bash
curl -fsSL http://localhost:5173/api/market/client -o repeat-agent.mjs
node ./repeat-agent.mjs discover --query research
```

This downloads a standalone Node.js client with its npm dependencies bundled. Requires Node 22.12+; no project checkout or npm install. Running `npx tsx scripts/market-agent.ts` elsewhere only installs the runner and fails because the script is not there.

Read the [agent skill](skills/repeat-marketplace/SKILL.md) or open [the served skill](http://localhost:5173/api/market/skill). Its [API reference](skills/repeat-marketplace/references/api.md) includes the publication JSON format. An agent can follow those instructions and invoke the client; an LLM runtime is not installed or started by these commands.

Discover and quote without a signing key:

```bash
node ./repeat-agent.mjs quote --service SERVICE_ID --buyer 0xYOUR_WALLET
```

Use an actual ID from discovery and your actual wallet address. For publishing, funding, buying or retrieving, configure the agent's **own disposable wallet key** as MARKET_AGENT_PRIVATE_KEY in its environment. The client signs wallet authentication and transactions locally; the key is never sent to the API. Never paste a key into chat or a webpage.

```bash
# With the disposable local key already configured in your environment:
node ./repeat-agent.mjs wallet
node ./repeat-agent.mjs faucet
node ./repeat-agent.mjs publish --file ./service.json
node ./repeat-agent.mjs buy --service SERVICE_ID --max-spend 0.06 --intent my-first-purchase
node ./repeat-agent.mjs deliver --service SERVICE_ID --order 0xSAVED_ORDER_ID
```

The agent formats the owner's ready-made report or guide in service.json using the API reference; the human can write normal text. Buying requires the owner's intended service and explicit cap. Keep the downloaded client's .repeat-agent folder with its saved intents/orders; set MARKET_AGENT_DATA_DIR to a fixed absolute directory if you work across folders. Reuse the original intent to recover rather than paying again after a timeout.

The default API is http://127.0.0.1:3001. Set MARKET_API_URL or --api for another instance; its API and configured RPC must be reachable. A remote cloud agent cannot access this computer through its own localhost.

The repository CLI also works from any folder on this machine:

```bash
npm --prefix /home/zhijian/Discount/app run market:agent -- discover --query research
```

## Ideal judge demo

See [MARKETPLACE.md](MARKETPLACE.md) for the current architecture, exact acceptance criteria and three-minute presentation.

Show a seller signing in and publishing a new service. A different buyer signs in, receives mock local funds, searches and buys it; a real receipt unlocks the private response. Then use the same service from an agent through the CLI/skill. Finish with the prepared loyalty comparison: fresh wallet A 0.05/B 0.045, returning wallet A 0.04 because of at least 0.15 prior paid spend. The lower price is enforced by the contract.

### Prepared loyalty Demo lab

The **Demo lab** is a separate builder-operated demonstration using disposable server-held fixture wallets. Its wallet is separate from the personal wallet connected to the marketplace.

Setup makes three real prior A purchases for both rehearsal and judge wallets. Keep rehearsals separate from the stage wallet. Historical purchases are now counted per service, so the earlier purchases across different research records no longer unlock a shared tier. Read the actual service quote before presenting; see IMPLEMENTATION_STATUS.md. Set ACTIVE_BUYER_ROLE=judge in ignored app/.env.local and restart the API before judging, then verify its actual current history before presenting.

The mission “Get this BNB research record. Spend no more than0.06 wBSC” selects A 0.04, leaving0.02. Optional B 0.035 is a quote comparison for a newly requested mission. It never silently buys an extra task.

## AI planning

The Demo lab uses a visibly labeled deterministic task planner without credentials. Add an existing ANTHROPIC_API_KEY and available LLM_MODEL to ignored app/.env.local to enable model planning, then restart the API. The model proposes allowed corpus tasks; fixed code enforces budgets and destinations. The marketplace itself is usable directly by humans or agents and does not require a hosted model key.

## Verification

```bash
npm run verify
npm --prefix app run check:marketplace
npm --prefix app run check:agent:standalone
```

The marketplace integration check requires the running local API and chain. It uses separate disposable seller/buyer wallets, publishes a real offer, tests authentication and content gating, makes real0.05/0.05/0.04 payments, and checks seller revenue. It never consumes the reserved judge wallet. Public evidence is saved to evidence/marketplace-e2e.json.

Additional original-demo checks:

```bash
npm --prefix app run smoke
cd app
node --import tsx scripts/check-seed-recovery.ts
npm run quote -- --chain 31337 --buyer 0xYourBuyerAddress --record bnb-budget
```

The smoke command performs a real purchase using the currently configured fixture role; choose rehearsal before running it. The independent reader works with the API stopped and imports no server key or journal. See [evidence/README.md](evidence/README.md) for observed results and limitations.

## BSC testnet

Chain97 is supported by configuration; local verification does not imply public deployment. The mock spending asset does not replace native tBNB gas. Use five distinct disposable funded wallets for deployer, buyers and merchants. Public Anvil fixture keys are rejected by the testnet deployment script.

Preserve your local configuration before using app/.env.testnet.example. Compile with node scripts/foundry.mjs forge build --root contracts, then run npm --prefix app run deploy:testnet. Copy the emitted token/checkout addresses into the ignored environment and restart. The local funding API is disabled on 97. Public deployment also needs HTTPS, durable/shared auth and catalog infrastructure, abuse controls and an operational delivery policy.

## Components

- contracts/src/MockWBSC.sol: six-decimal test asset with restricted minting.
- contracts/src/LoyaltyCheckout.sol: seller offers, prior paid spend and atomic bounded checkout.
- app/server/marketplace.ts, market-auth.ts, market-store.ts: discovery, SIWE sessions, verified publication and paid delivery.
- app/src/Marketplace.tsx and wallet.ts: marketplace and browser-owned transaction signing.
- app/scripts/market-agent.ts: agent-owned signing and recoverable purchases.
- skills/repeat-marketplace/: portable skill and API reference.
- app/server/runner.ts and app/src/App.tsx: prepared loyalty Demo lab.

No Studio/ERC-8183/B402 adapter is claimed. Payment proves entitlement, not service quality. Refunds, escrow, arbitrary external service execution and public production hosting are outside this prototype.

Original validation and sprint: [HACKATHON_PACK.md](HACKATHON_PACK.md), [FOUR_HOUR_BUILD_PLAN.md](FOUR_HOUR_BUILD_PLAN.md), [DEV_RESOURCES.md](DEV_RESOURCES.md).
