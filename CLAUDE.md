# Canton MPC PoC

## Testing

### Daml tests

```bash
dpm build --all
for pkg in daml-abi daml-uint256 daml-eip712 daml-signer daml-vault; do
  (cd daml-packages/$pkg && dpm test)
done
```

> `dpm test` does not support `--all` — each package must be tested individually.

### TypeScript oracle suites (no ledger needed)

Co-located TS tests that verify Daml logic against reference implementations (viem, etc.):

```bash
pnpm -r --filter='@canton/*' --filter='canton-sig' run test
```

### DevNet e2e (real network — the only integration test)

`test/src/test/devnet-e2e.test.ts` runs the ERC-20 Vault deposit + withdraw lifecycle against the live Canton DevNet, the deployed MPC cluster, and the DevNet EVM chain. There is **no** local sandbox and **no** in-process MPC — it is a pure client. It mutates the live ledger and spends real funds, so it runs only when `test/.env` is configured AND `MPC_CANTON_LIVE_MUTATE=1`:

```bash
cd test && MPC_CANTON_LIVE_MUTATE=1 pnpm test
```

The pre-deployed Vault hardcodes `caip2 = eip155:1` (test mode) and the deployed MPC accepts only that caip2. Since caip2 is decoupled from the EVM chainId, the test signs txs with the **real Sepolia chainId (11155111)** — valid on-chain — and broadcasts to `MPC_CANTON_ETH_RPC_URL` (a Sepolia RPC), which the MPC's `eip155:1` indexer watches.

For a local loop (a real MPC against a local sandbox), see `TEST_LOCALLY.md` (Rust `mpc` repo).

### Regenerating bindings

`cd test && pnpm codegen:daml` after Daml changes. `pnpm codegen:api` needs a reachable Canton JSON API on `:7575` (e.g. the local sandbox from `TEST_LOCALLY.md`, or DevNet).

## Project layout

- `daml-packages/` -- Daml source packages (`daml-signer` + `daml-vault` DARs, plus shared libs)
- `ts-packages/` -- TypeScript client packages (`canton-sig`)
- `test/` -- DevNet e2e + co-located unit tests
