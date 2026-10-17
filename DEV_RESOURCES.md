# Repeat — Hackathon Development Resources

Research checked 16 October 2026. Companion: [HACKATHON_PACK.md](HACKATHON_PACK.md) and [FOUR_HOUR_BUILD_PLAN.md](FOUR_HOUR_BUILD_PLAN.md).

This file contains preparation recipes and references. Commands here have not been run against a generated app. Example app scripts must be implemented by the build plan before use. Verify installed CLI help and pin working dependency versions.

## 1. Open these first

- [Official KL event](https://luma.com/ldp3i5kn) — event details; confirm submission and minimum Studio usage with the mentor.
- [Studio live quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/) — documented npm/TypeScript setup.
- [Studio architecture](https://docs.bnbchain.org/developer-kit/bnbchain-studio/architecture/) — deterministic signer and paid-work boundaries.
- [BSC RPC endpoints](https://docs.bnbchain.org/bnb-smart-chain/developers/json_rpc/json-rpc-endpoint/) — network configuration.
- [BSC funding instructions](https://docs.bnbchain.org/bnb-smart-chain/developers/faucet/) — fund disposable test wallets before the sprint if rules permit.
- [Viem simulateContract](https://viem.sh/docs/contract/simulateContract) — simulate before writing.
- [Foundry installation](https://getfoundry.sh/introduction/installation/) — install Forge in WSL if absent.

## 2. Network values

```dotenv
CHAIN_ID=97
RPC_URL=https://bsc-testnet-dataseed.bnbchain.org
RPC_FALLBACK_URL=https://bsc-testnet.bnbchain.org
EXPLORER_BASE=https://testnet.bscscan.com
```

Another documented fallback: `https://bsc-prebsc-dataseed.bnbchain.org`.

Explorer: [BscScan testnet](https://testnet.bscscan.com/). Gas token is **tBNB**. Check `eth_chainId` returns `0x61`; a responsive RPC is not sufficient if it points at the wrong network. Use actual deployment addresses from your deploy output, not copied addresses from old examples.

Funding avenues:

- [Official faucet](https://www.bnbchain.org/en/testnet-faucet) — current access conditions may block a fresh wallet; do not assume instant funding.
- [QuickNode BNB testnet faucet](https://faucet.quicknode.com/binance-smart-chain/bnb-testnet) and [Chainstack BNB testnet faucet](https://faucet.chainstack.com/bnb-testnet-faucet) — alternatives linked by BNB's funding docs; eligibility varies.
- BNB's funding docs also describe official support channels. A mentor may help with test funds at the workshop.

The [Studio v4 announcement](https://www.bnbchain.org/en/blog/bnb-agent-studio-v4-one-prompt-fewer-steps-to-a-running-agent) describes automatic test-wallet funding and additional deployment/payment options. Test availability in the installed release rather than assuming this covers every local wallet or arbitrary wBSC.

## 3. Core development references

### Contracts

- [Foundry getting started](https://getfoundry.sh/introduction/installation/) — tool installation; Windows users should follow its WSL guidance.
- [Forge init](https://getfoundry.sh/forge/reference/forge-init/) — scaffold a contract project.
- [Forge install](https://getfoundry.sh/forge/reference/forge-install/) — dependencies and version refs.
- [Forge testing](https://getfoundry.sh/forge/tests/overview/) — contract checks.
- [OpenZeppelin ERC20](https://docs.openzeppelin.com/contracts/5.x/erc20) — demo token; override decimals to six.
- [OpenZeppelin ERC20 API / SafeERC20](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) — checked token transfers.
- [OpenZeppelin utilities](https://docs.openzeppelin.com/contracts/5.x/api/utils) — reentrancy guard.
- [Solidity documentation](https://docs.soliditylang.org/en/latest/) — arithmetic, ABI and compiler settings.

### TypeScript chain integration

- [Viem local accounts](https://viem.sh/docs/accounts/local) — server-side disposable signer.
- [Viem public client](https://viem.sh/docs/clients/public) and [wallet client](https://viem.sh/docs/clients/wallet) — separate read and write responsibilities.
- [readContract](https://viem.sh/docs/contract/readContract), [simulateContract](https://viem.sh/docs/contract/simulateContract), [writeContract](https://viem.sh/docs/contract/writeContract) — core call sequence.
- [waitForTransactionReceipt](https://viem.sh/docs/actions/public/waitForTransactionReceipt) — successful confirmed payment before eligibility/UI updates.
- [decodeEventLog](https://viem.sh/docs/utilities/decodeEventLog) — verify the actual checkout event.
- [recoverMessageAddress](https://viem.sh/docs/utilities/recoverMessageAddress) — verify the delivery-access signature.
- [Viem chain definitions source](https://github.com/wevm/viem/tree/main/src/chains/definitions) — inspect `bscTestnet` configuration when debugging.

### App and AI

- [Vite guide](https://vite.dev/guide/) — React TypeScript scaffold and proxy config.
- [React documentation](https://react.dev/learn) — small console UI.
- [Express routing](https://expressjs.com/en/guide/routing.html) — local JSON API.
- [Zod](https://zod.dev/) — validate plan and input schemas.
- [Vitest guide](https://vitest.dev/guide/) — deterministic controller tests.
- [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript) — server-side model request and tool input schema. Use an available model configured in `LLM_MODEL`; do not hardcode a retired model.

Viem, Vite, and the Anthropic SDK were also checked through their current source documentation in Context7. Supporting references are official documentation entry points; this is not a claim that every linked tutorial or every package combination has been execution-tested.

## 4. Suggested project layout

```text
Discount/
  HACKATHON_PACK.md
  DEV_RESOURCES.md
  FOUR_HOUR_BUILD_PLAN.md
  contracts/
    foundry.toml
    src/MockWBSC.sol
    src/LoyaltyCheckout.sol
    test/LoyaltyCheckout.t.sol
    script/Deploy.s.sol
  app/
    src/App.tsx
    src/styles.css
    server/index.ts
    server/planner.ts
    server/policy.ts
    server/runner.ts
    server/service.ts
    server/journal.ts
    shared/types.ts
    shared/abi.ts
    scripts/seed.ts
    scripts/quote.ts
    tests/policy.test.ts
    tests/runner.test.ts
    data/corpus.json
    data/runs.jsonl             # ignored local runtime journal
    deployments/97.json         # public contract/merchant metadata
    .env.example
    .env.local                  # ignored; secrets stay on server
  evidence/
    README.md
    transactions.json
    demo.mp4
```

## 5. Preparation and install recipes

Run these in **Ubuntu/WSL bash**, not PowerShell, from the project root. Prepare tools tonight only to the extent the event's prebuilt-work rules allow. The documents themselves can be reviewed without scaffolding anything.

```bash
node --version
npm --version
forge --version
git --version
```

Use Node 22.12+ or a newer supported LTS. Install Foundry using its official instructions if `forge` is absent. After installation, confirm `forge`, `cast` and `anvil` are available in the same WSL shell used for the project.

```bash
forge init contracts --no-git
cd contracts
forge install OpenZeppelin/openzeppelin-contracts --no-git
cd ..

npm create vite@latest app -- --template react-ts
cd app
npm install
npm install viem express zod dotenv @anthropic-ai/sdk
npm install --save-dev tsx vitest @types/express @types/node
```

Pin the OpenZeppelin checkout/ref and npm lockfile once the compiler/build passes. Do not update dependencies during the final rehearsal. Inspect `forge init --help` if the installed version's flags differ.

Set `solc_version = "0.8.28"` and `evm_version = "paris"` in `contracts/foundry.toml`, with a remapping for `@openzeppelin/contracts/` to the installed contracts directory. Remove the generated Counter sample only when replacing it with the real contracts and tests. Confirm the selected OpenZeppelin code compiles with those settings; choose a compatible pinned 5.x release if it requires a different compiler target.

### Proposed app scripts

The implementer must add these script entries; Vite does not supply the custom ones:

```json
{
  "dev:api": "tsx watch server/index.ts",
  "test": "vitest run",
  "seed": "tsx scripts/seed.ts",
  "quote": "tsx scripts/quote.ts",
  "typecheck:server": "tsc --noEmit -p tsconfig.server.json"
}
```

Keep Vite's generated `dev` and `build` scripts. Add `tsconfig.server.json` covering `server`, `shared`, `scripts` and tests, using NodeNext/ES2022 as appropriate. Add a Vite `/api` proxy to `http://127.0.0.1:3001`; the API binds only to that loopback interface.

### Environment template

```dotenv
# Server-side .env.local; never prefix secret values with VITE_.
CHAIN_ID=97
RPC_URL=https://bsc-testnet-dataseed.bnbchain.org
RPC_FALLBACK_URL=https://bsc-testnet.bnbchain.org
CHECKOUT_ADDRESS=
TOKEN_ADDRESS=
MERCHANT_A_ADDRESS=
MERCHANT_B_ADDRESS=
BUYER_PRIVATE_KEY=
JUDGE_BUYER_PRIVATE_KEY=
ACTIVE_BUYER_ROLE=rehearsal
DEPLOYER_PRIVATE_KEY=
MERCHANT_A_PRIVATE_KEY=
MERCHANT_B_PRIVATE_KEY=
ANTHROPIC_API_KEY=
LLM_MODEL=
MAX_SPEND_UNITS=300000
API_HOST=127.0.0.1
API_PORT=3001
```

Load it explicitly on the server with `dotenv.config({ path: '.env.local' })`. Avoid printing environment variables or keys. Store public deployment metadata separately in `deployments/97.json` for the frontend and independent quote reader.

`MAX_SPEND_UNITS=300000` is the application ceiling. The final judge preset submits `maxSpend: "60000"` for one `bnb-budget` record; after paying40000 it has20000 remaining. Follow [the final ideal-output script](HACKATHON_PACK.md#9-final-ideal-output). An optional35000 competitor purchase requires a new explicitly requested mission with sufficient approved budget.

Suggested ignore entries:

```gitignore
.env*
!.env.example
.studio/
node_modules/
dist/
contracts/cache/
contracts/out/
app/data/runs.jsonl
```

Do not put secrets in deployment metadata, logs, screenshots or video. Separate local keys are simplest for the demo; reuse none on mainnet.

## 6. Build and verify commands

These are intended commands **after** implementation:

```bash
# From project root
forge test --root contracts -vv

# From app/
npm test
npm run typecheck:server
npm run build
```

Deployment script should read credentials through a local environment or encrypted account; do not pass raw keys in copied command-line arguments. The script must deploy both contracts and output public addresses and the deployment block. The exact Forge script invocation depends on the signer setup chosen at build time; run its dry-run before `--broadcast` and assert chain 97.

Run the local API and Vite dev server in separate terminals. Before showing the independent reader, stop the API and run:

```bash
# From app/; script reads only public deployment metadata + RPC.
npm run quote -- --buyer 0xYourBuyerAddress --record bnb-budget
```

The implementation must parse those arguments. A fresh-wallet preview needs no private key. The reader uses public metadata/RPC configuration and must not load the server's secret `.env.local`. `npm run seed` should configure all four SKU offers, mint buyer test funds, approve a bounded allowance, and make three real A purchases for the first three records **for each of the rehearsal and reserved judge wallets**. Each step is idempotent or explicitly refuses to repeat; it never silently resets chain history. Once the service is built, retrieve those setup records through their existing entitlements and save delivery evidence. The live judge mission requests only `bnb-budget`; its spend starts at zero while merchant history remains150000.

Use `BUYER_PRIVATE_KEY` for rehearsal and `JUDGE_BUYER_PRIVATE_KEY` for the reserved live wallet. The runner selects one from local `ACTIVE_BUYER_ROLE=rehearsal|judge` configuration at startup; the browser cannot supply a private key or arbitrary wallet. Capture purchase four during rehearsal as the backup recording. Restore B's `bnb-budget` price to45000 and confirm it before switching to the untouched judge wallet for the live presentation.

## 7. BNB Agent Studio resources and separate route

- [Quickstart](https://docs.bnbchain.org/developer-kit/bnbchain-studio/quickstart/)
- [Architecture](https://docs.bnbchain.org/developer-kit/bnbchain-studio/architecture/)
- [CLI reference](https://docs.bnbchain.org/developer-kit/bnbchain-studio/cli-reference/)
- [Deployment](https://docs.bnbchain.org/developer-kit/bnbchain-studio/deployment/)
- [Troubleshooting](https://docs.bnbchain.org/developer-kit/bnbchain-studio/troubleshooting/)
- [SDK network/address guidance](https://docs.bnbchain.org/developer-kit/bnbagent-sdk/networks/)
- [ERC-8183 draft](https://eips.ethereum.org/EIPS/eip-8183)
- [APEX contracts](https://github.com/bnb-chain/apex-contracts), [IACP ABI](https://github.com/bnb-chain/apex-contracts/blob/main/contracts/IACP.sol), [deployment address source](https://github.com/bnb-chain/apex-contracts/blob/main/scripts/addresses.ts)
- [ERC-8004 draft](https://eips.ethereum.org/EIPS/eip-8004)

Documented setup, to inspect independently of the custom checkout:

```bash
npm install --global @bnbagent/studio-cli
bag --version
bag --help
bag skills install
bag init --help
bag doctor
bag dev
```

Run `doctor`/`dev` only inside a generated Studio project. The quickstart documents Claude Code/Cursor skill installation, Node 22+, pnpm 10 and Bun 1.3+ for deployment. Codex can edit generated TypeScript; do not assume the installer has a Codex target. Inspect emitted `app/agent/src/sellerCore.ts` and `signing.ts` before choosing an extension.

**Documentation caveat:** live quickstart/architecture now describe TypeScript, but some indexed pages/snippets still describe Python and a different runtime. The linked Studio GitHub source URL returned 404 during research, so a source-clone install is not part of this plan. Published deployment options also differ between the quickstart and the later v4 announcement. Installed package help, generated source and an actual smoke test decide what is usable; no Studio package was installed during this research.

Do not hardcode APEX addresses from a README: its deployment table and address source differed during research. Resolve the installed SDK/network configuration, compare to current upstream deployment source, and verify bytecode and the actual job interface on chain 97. A new checkout contract is a custom rail, not an ERC-8183 deployment.

Suggested Studio scaffold brief:

> Create one TypeScript BSC-testnet seller for a fixed BNB documentation corpus. Keep native ERC-8183 payment verification and deterministic signing. Expose the simplest locally supported face. Inspect the generated source before adding seller-specific pricing based only on completed jobs. Keep LLM tools read-only. Show current installed CLI options and settlement timing before selecting cloud deployment.

## 8. Copyable core coding-agent brief

```text
Implement Repeat from HACKATHON_PACK.md and FOUR_HOUR_BUILD_PLAN.md.
This is a solo four-hour BSC97 prototype. Follow the contract/API interfaces
in those files; ask only about genuinely missing requirements.

Build MockWBSC (6 decimals, restricted mint) and LoyaltyCheckout. Record prior
net paid spend by buyer/merchant/service SKU; seller offers define SKU price, threshold,
discount <=2000bps, enabled flag and version. Apply the discount to future
purchases after prior spend reaches threshold. Checkout is atomic, derives
buyer from msg.sender, deduplicates buyer/orderId across merchants, enforces
deadline/version/maxAmount and emits OrderPaid. Use SafeERC20 and a guard.

Use Node/TypeScript + viem + Express, React/Vite + plain CSS, Zod and an
existing server-side Anthropic key. Model proposes only allowed tasks;
deterministic code compares quotes, caps spend and signs. One run at a time.
Persist order IDs/hashes before retry. No private key reaches the browser.
Gate each delivered record by a matching paid order and buyer signature.

Publish four record SKUs from a labeled fixed corpus. Seller A: 50000 units,
threshold150000, discount2000bps. B:55000, no discount; local demo control
can set B to45000 or35000 through real merchant transactions. Application
ceiling300000; final-demo mission cap60000, leaving20000 after payment40000.
An optional35000 purchase needs a new explicitly requested funded mission.
Warm-up is three real distinct A purchases, not a state overwrite.

Build an independent quote CLI needing no API database or signing key.
Test thresholds, transfer rollback, replay, config changes, budget and
ambiguous-tx recovery. Keep one live discounted testnet purchase working.
Do not add cashback, identity NFTs, bridges, databases, cloud custody,
streaming settlement, or pretend this custom rail is ERC-8183/B402.
Record exact live/fixture boundaries and fresh verification evidence.
```

## 9. Submission/evidence checklist

- [ ] README: problem, what is built, two-minute run instructions, architecture and limitations.
- [ ] Chain ID, checkout/token addresses, deployment block and source/compiler versions.
- [ ] Three warm-up hashes and one discounted purchase hash; event amounts match balances.
- [ ] Independent reader command and its output; fresh-wallet negative case.
- [ ] LLM success and deterministic budget/selection evidence.
- [ ] Forge, controller test, server typecheck and frontend build results.
- [ ] Two-minute MP4 backup; no private keys or secret terminal output visible.
- [ ] Exact source-corpus/demo-token/merchant-operation disclosures.
- [ ] Event submission form completed before 5pm MYT; eligibility clarified with organizer.

## 10. Competitive references for the pitch

- [PayPerAgent](https://github.com/TheQuantumChronicle/payperagent)
- [402Gate agent rewards](https://docs.402gate.com/ecosystem-and-rewards/user-and-ai-agent-rewards)
- [ACP checkout](https://www.agenticcommerce.dev/docs/reference/checkout)
- [Nevermined dynamic pricing](https://nevermined.ai/docs/integrate/patterns/dynamic-pricing)

Use these to acknowledge existing work. Do not claim “first agent loyalty protocol,” universal integration, or proven customer demand.

## Wallet marketplace extension (17October2026)

Current architecture, component stacks and judge flow: [MARKETPLACE.md](MARKETPLACE.md). Wallet/agent HTTP protocol and skill: [API reference](skills/repeat-marketplace/references/api.md), [SKILL.md](skills/repeat-marketplace/SKILL.md). Authentication uses [SIWE/ ERC-4361](https://eips.ethereum.org/EIPS/eip-4361) with [viem](https://viem.sh/docs/siwe/utilities/createSiweMessage); user transactions use an [EIP-1193 custom transport](https://viem.sh/docs/clients/transports/custom). Local integration: npm --prefix app run check:marketplace.
