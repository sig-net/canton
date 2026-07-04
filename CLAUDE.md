# Canton MPC

## Testing

### Daml tests

```bash
dpm build --all
pnpm run daml:test
```

> `dpm test` has no multi-package mode (its `--all` flag only adds a package's dependencies) — the `daml:test` script (package.json, also used by CI) tests each package individually.

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

`pnpm codegen:daml` (from the repo root) after Daml changes. `pnpm codegen:api` needs a reachable Canton JSON API on `localhost:7575` (e.g. the local sandbox from `TEST_LOCALLY.md`, or a port-forward to a hosted ledger).

## Project layout

- `daml-packages/` -- Daml source packages: `signet-signer-v1` + `signet-vault-v1`, the CC fee layer (`signet-api-fee-v1`, `signet-fee-amulet`), shared libs (`signet-abi`, `signet-eip712`, `signet-uint256`), their `*-tests` packages, and vendored splice token-standard DARs (`vendor/`)
- `ts-packages/` -- TypeScript client packages (`canton-sig`)
- `test/` -- DevNet e2e + co-located unit tests

## Deploying the MPC stack

`test/src/scripts/deploy.ts` deploys the Signer + CC fee infra + Vault to a Canton network, idempotently (reuses an existing Signer / collector / registration / price config / vault). Network-aware via `CANTON_NETWORK` (default `devnet`): it reads inputs from that network's env and writes the resulting ids + `apps/disclosure-api/disclosures.<network>.ts`. Free mode (`feeAmount 0`, no CC rails) by default; `MPC_CANTON_FEE_AMOUNT>0` for paid.

- DevNet: `DEPLOY_CONFIRM=1 pnpm exec tsx src/scripts/deploy.ts` (reads/writes `test/.env`).
- Testnet: `CANTON_NETWORK=testnet DOTENV_CONFIG_PATH=.env.testnet DEPLOY_CONFIRM=1 pnpm exec tsx src/scripts/deploy.ts` (reads/writes `test/.env.testnet`).

The per-network MPC root key comes from signet.js `ROOT_PUBLIC_KEYS` (`TESTNET_DEV` → devnet, `TESTNET` → testnet) and is baked into the Vault's derived addresses, so it must match the cluster that will watch the contracts. DevNet and testnet are both deployed. `apps/disclosure-api` serves the disclosures split per network (`/api/devnet`, `/api/testnet`; `/` aliases devnet). `deploy-vault.ts` is a separate vault-only deploy.

## Releasing (DAR assets are mandatory)

Every release tag MUST ship the built DARs as GitHub release assets. Integrators compile their consumer packages against these exact files (see `INTEGRATORS.md`): a DAR rebuilt from any other commit produces a different package-id under the same `name`+`version`, and Canton refuses to vet two same-name+version packages with different package-ids — so without published assets, integrator builds silently diverge from the deployed packages the moment `main` moves past the deploy commit.

On every release (after `git tag vX.Y.Z && git push origin vX.Y.Z && gh release create vX.Y.Z --generate-notes`):

1. `dpm build --all` at the release tag.
2. Stage the 6 distributed signet DARs (`signet-signer-v1`, `signet-fee-amulet`, `signet-api-fee-v1`, `signet-abi`, `signet-eip712`, `signet-uint256`) plus the 3 vendored `splice-api-token-*` DARs; `shasum -a 256 *.dar > SHA256SUMS.txt`. The example `signet-vault-v1` is NOT distributed — it is a copy-paste source model; anyone deploying it builds from the release tag. (v0.0.1's assets still include `signet-vault-v1-0.0.1.dar`; kept as history — it matches the deployed 0.0.1 instances.)
3. `gh release upload vX.Y.Z *.dar SHA256SUMS.txt`.
4. Append a package-id table to the release notes (main package-id per DAR — read it from `dpm inspect-dar` DALF paths) and state which networks those package-ids are vetted on. Cross-check against `apps/disclosure-api/disclosures.<network>.ts` template ids after deploying.

v0.0.1 has this done (assets + package-id manifest, matching DevNet + testnet).

## Canton node / network config (sig-net org)

The Canton node this repo targets is provisioned in **other sig-net repos**, not here. Query them with `gh` when you need network config — the Splice version, participant/validator settings, or auth:

- **`sig-net/sig-kustomize`** — the Canton/Splice node deployment, under `kustomize/Canton/canton-validator/`:
  - `base/{validator,participant}-release.yaml` — Flux `HelmRelease`s that pin the **Splice version** via the `splice-validator` / `splice-participant` charts from `oci://ghcr.io/digital-asset/decentralized-canton-sync/helm`. `base/` pins `0.6.3`; each overlay's `kustomization.yaml` may override it. **DevNet (`overlays/dev`) runs Splice `0.6.8`** (bumped from `0.6.3` on 2026-06-15), **MainNet (`overlays/mainnet`) runs `0.6.3`** (`overlays/testnet` for the remaining tier).
  - `overlays/<tier>/values/*.yaml` — participant/validator/postgres values; `overlays/dev/values/validator-values.yaml` carries the auth0 audience (`https://canton.network.global`) + jwksUrl that the JSON Ledger API auth uses.
- **`digital-asset/decentralized-canton-sync`** (public) — upstream Splice. The splice token-standard DARs vetted on the node are committed at `daml/dars/splice-api-token-*-1.0.0.dar` on the matching release tag (e.g. `v0.6.3`). **Our `daml-packages/vendor/splice-api-token-*` MUST be the build from the deployed Splice version**, or on-ledger DAR vetting fails (`KNOWN_PACKAGE_VERSION` / `TOPOLOGY_DEPENDENCIES_NOT_VETTED`): same name+version, different package-id, and Canton won't co-vet two packages with the same name+version.
- **`sig-net/sig-k8s`** (cluster infra, Flux), **`sig-net/sig-infrastructure`** (GCP infra) — broader infrastructure.
- **`sig-net/mpc`**, **`sig-net/mpc-infrastructure`** — the MPC services and node IaC (the `sigNetwork` party).
