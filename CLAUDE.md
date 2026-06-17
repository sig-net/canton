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

- `daml-packages/` -- Daml source packages: `signet-signer-v1` + `signet-vault-v1`, the CC fee layer (`signet-api-fee-v1`, `signet-fee-amulet`), shared libs (`signet-abi`, `signet-eip712`, `signet-uint256`), their `*-tests` packages, and vendored splice token-standard DARs (`vendor/`)
- `ts-packages/` -- TypeScript client packages (`canton-sig`)
- `test/` -- DevNet e2e + co-located unit tests

## Canton node / network config (sig-net org)

The Canton node this repo targets is provisioned in **other sig-net repos**, not here. Query them with `gh` when you need network config — the Splice version, participant/validator settings, or auth:

- **`sig-net/sig-kustomize`** — the Canton/Splice node deployment, under `kustomize/Canton/canton-validator/`:
  - `base/{validator,participant}-release.yaml` — Flux `HelmRelease`s that pin the **Splice version** via the `splice-validator` / `splice-participant` charts from `oci://ghcr.io/digital-asset/decentralized-canton-sync/helm`. `base/` pins `0.6.3`; each overlay's `kustomization.yaml` may override it. **DevNet (`overlays/dev`) runs Splice `0.6.8`** (bumped from `0.6.3` on 2026-06-15), **MainNet (`overlays/mainnet`) runs `0.6.3`** (`overlays/testnet` for the remaining tier).
  - `overlays/<tier>/values/*.yaml` — participant/validator/postgres values; `overlays/dev/values/validator-values.yaml` carries the auth0 audience (`https://canton.network.global`) + jwksUrl that the JSON Ledger API auth uses.
- **`digital-asset/decentralized-canton-sync`** (public) — upstream Splice. The splice token-standard DARs vetted on the node are committed at `daml/dars/splice-api-token-*-1.0.0.dar` on the matching release tag (e.g. `v0.6.3`). **Our `daml-packages/vendor/splice-api-token-*` MUST be the build from the deployed Splice version**, or on-ledger DAR vetting fails (`KNOWN_PACKAGE_VERSION` / `TOPOLOGY_DEPENDENCIES_NOT_VETTED`): same name+version, different package-id, and Canton won't co-vet two packages with the same name+version.
- **`sig-net/sig-k8s`** (cluster infra, Flux), **`sig-net/sig-infrastructure`** (GCP infra) — broader infrastructure.
- **`sig-net/mpc`**, **`sig-net/mpc-infrastructure`** — the MPC services and node IaC (the `sigNetwork` party).
