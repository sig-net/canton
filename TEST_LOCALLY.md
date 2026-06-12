# Testing Locally

This repo's TypeScript test (`test/src/test/devnet-e2e.test.ts`) runs against the **Canton DevNet + the MPC** — it does not spin anything up locally.

If you want a fully local loop instead — an **MPC node running against a local Canton sandbox** — that harness already exists in the Rust MPC repo (`git@github.com:sig-net/mpc`). It is the right place for local iteration because it wires up everything for you.

## What the Rust harness gives you

In a single `cargo test` run it starts:

- a local **Canton sandbox** — it literally shells out to `dpm sandbox --json-api-port 7575 -c <generated-auth.conf>` (`integration-tests/src/canton.rs`), with JWT/JWKS auth via a local OIDC test provider;
- the **`daml-vault` DAR** loaded into it, and a freshly created `Signer` contract (co-signed by `SigNetwork` + `SigNetworkFA` via `SignerProposal` → `AcceptSigner`) + parties (`SigNetwork` / `SigNetworkFA` / `Operator` / `Requester`);
- an **`mpc-node` cluster** wired to that sandbox;
- a local **Anvil** EVM container that the signed EIP-1559 txs are relayed to.

It then submits a sign request via `Signer.RequestSignature`, waits for the cluster to threshold-sign (`SignatureRespondedEvent`), relays the signed tx to Anvil, and verifies the bidirectional outcome (`RespondBidirectionalEvent`).

## Where it lives (in the `mpc` repo)

- `integration-tests/tests/cases/canton.rs` — full E2E (`test_canton_eth_bidirectional_flow`) plus auth-rejection tests.
- `integration-tests/tests/cases/canton_stream.rs` — sandbox + the node's Canton indexer/stream only.
- `integration-tests/src/canton.rs` — the `CantonSandbox` fixture (`dpm sandbox` + party/user/Signer bootstrap).
- `.github/workflows/canton.yml` — the de-facto runbook (exact build steps + commands).

> These differ from `canton_live.rs`, which targets the DevNet (the equivalent of this repo's `devnet-e2e.test.ts`).

## Prerequisites

- **dpm** (Daml SDK 3.5.1) on `PATH`: `curl -fsSL https://get.digitalasset.com/install/install.sh | sh`, then add `~/.dpm/bin`
- **Java 21** (Canton runs on the JVM)
- **Docker** (Redis + the Anvil EVM container)
- **Rust 1.81** (+ `wasm32-unknown-unknown` target) and **Node 18+** (for the eth contract build)
- Free host ports: **7575** (Canton JSON API), **6868** (Canton admin), **8545** (Anvil)

## Run it

From the `mpc` repo root, build the pieces the cluster spawns, then run the ignored Canton tests:

```bash
# one-time / when sources change
./build-contract.sh                                    # NEAR mpc-contract (wasm)
(cd chain-signatures/contract-eth && npm i && npx hardhat compile)
cargo build -p mpc-node --release                      # the node the cluster launches
cargo build -p integration-tests --tests

# full E2E: local sandbox + MPC cluster + Anvil
cargo test -p integration-tests --test lib -- cases::canton --ignored --nocapture --test-threads 1

# just the indexer/stream tests
cargo test -p integration-tests --test lib -- canton_stream --ignored --nocapture --test-threads 1
```

- `--ignored` is required — every Canton test is `#[ignore]`.
- `--test-threads 1` is required — the tests are serial and bind fixed ports (7575 / 6868).

## Keeping the DAR fixture in sync

The harness loads a checked-in copy of this repo's `daml-vault` DAR (`integration-tests/fixtures/canton/daml-vault-0.0.1.dar`). After changing Daml here, rebuild and copy it over:

```bash
# in THIS repo
dpm build --all
# in the mpc repo
cp <this-repo>/daml-packages/daml-vault/.daml/dist/daml-vault-poc-0.0.1.dar \
   integration-tests/fixtures/canton/daml-vault-0.0.1.dar
```

(Or point the harness at any DAR with `CANTON_DAR_PATH=/abs/path/to.dar`.)

## Regenerating this repo's TS bindings against the local sandbox

While the Rust harness has its sandbox up on `:7575`, you can regenerate the OpenAPI types here against it:

```bash
pnpm codegen:api
```
