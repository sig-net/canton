# Canton MPC PoC

## Testing

### Daml tests

```bash
dpm build --all
pnpm run daml:test
```

> `dpm test` does not support `--all` — the `daml:test` script (package.json, also used by CI) tests each package individually.

### TypeScript oracle suites (no ledger needed)

Co-located TS tests that verify Daml logic against reference implementations (viem, etc.):

```bash
pnpm -r --filter='@canton/*' --filter='canton-sig' run test
```

### DevNet e2e (the only integration test)

`test/src/test/devnet-e2e.test.ts` runs the ERC-20 Vault deposit + withdraw lifecycle against the live Canton DevNet, the MPC cluster, and the DevNet EVM chain as a pure client. It mutates the live ledger and spends funds, so it runs only when `test/.env` is configured AND `MPC_CANTON_LIVE_MUTATE=1`:

```bash
cd test && MPC_CANTON_LIVE_MUTATE=1 pnpm test
```

The Vault hardcodes `caip2 = eip155:1` (test mode); the MPC accepts only that caip2. caip2 is decoupled from the EVM chainId, so the test signs with the **Sepolia chainId (11155111)** and broadcasts to `MPC_CANTON_ETH_RPC_URL`, which the MPC's `eip155:1` indexer watches. A Sepolia-devnet workaround — on mainnet it's unnecessary (the chain is genuinely `eip155:1`).

For a local loop (an MPC node against a local sandbox), see `TEST_LOCALLY.md` (Rust `mpc` repo).

### Regenerating bindings

`pnpm codegen:daml` (from the repo root) after Daml changes. `pnpm codegen:api` needs a reachable Canton JSON API on `:7575` (e.g. the local sandbox from `TEST_LOCALLY.md`, or DevNet).

## Project layout

- `daml-packages/` -- Daml source packages (`daml-signer` + `daml-vault` DARs, plus shared libs)
- `ts-packages/` -- TypeScript client packages (`canton-sig`)
- `test/` -- DevNet e2e + co-located unit tests
