# Service-specific loyalty correction
User requirement: only repeated purchases of the same service qualify. Key on-chain history by buyer + seller + SKU.

- [x] Reproduce same-seller cross-service leakage with a failing contract regression.
- [x] Correct the contract ledger and stats ABI; keep caller, quote, budget and replay constraints.
- [x] Test an upgrade that reads the immutable earlier checkout, retains seller offers and paid entitlements, and credits each verified old order at most once under its actual SKU and net amount.
- [x] Upgrade local checkout while retaining the same token, catalog, old receipts and agent recovery journals; no chain reset.
- [x] Verify existing data against OrderPaid logs and new service ledgers.
- [x] Rerun real signed agent create/discover/buy/deliver, budget and recovery checks; verify a different service from the same seller remains ineligible.
- [x] Update UI/skill/docs, rerun complete checks and answer SDK/on-chain boundaries accurately.
