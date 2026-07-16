# Canton MPC

MPC-based ERC-20 custody on Canton. Daml smart contracts manage vault state (deposits, withdrawals, holdings); an MPC cluster signs EVM transactions using threshold-derived keys (compatible with [signet.js](https://github.com/sig-net/signet.js)); the Canton ledger verifies the MPC's signed outcome on-chain via `secp256k1WithEcdsaOnly` before crediting holdings or finalizing withdrawals. The `ts-packages/canton-sig` library is the TypeScript **client** for this protocol.

## Where to start

**Integrators: start with these two packages.** [`signet-signer-v1`](daml-packages/signet-signer-v1/README.md) is the core — the generic MPC signing protocol every consumer builds on. [`signet-vault-v1`](daml-packages/signet-vault-v1/README.md) is the worked integrator example (ERC-20 custody) to model your own consumer on. When you're ready to deploy, [`INTEGRATORS.md`](INTEGRATORS.md) is the deployment guide — integrators run their own Canton node and integrate over the shared synchronizer. Everything else is supporting infrastructure; the table below drills into specific tasks.

| You are…                                                   | Read                                                                                                                                                                                                                                                          |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integrating the Signer into a new Daml domain**          | [`daml-packages/signet-signer-v1/README.md`](daml-packages/signet-signer-v1/README.md) — authority model + lifecycle; full API in [`API.md`](daml-packages/signet-signer-v1/API.md), checklist in [`SECURITY.md`](daml-packages/signet-signer-v1/SECURITY.md) |
| **Looking for a worked example to model your consumer on** | [`daml-packages/signet-vault-v1/README.md`](daml-packages/signet-vault-v1/README.md) — the complete example consumer (ERC-20 custody): templates, choices, lifecycles, calldata shape                                                                         |
| **Deploying your consumer from your own Canton node**      | [`INTEGRATORS.md`](INTEGRATORS.md) — release DARs + package-id rules, vetting, client wiring, TestNet go-live, checklist                                                                                                                                      |
| **Building a TypeScript client / 3rd-party integration**   | [`ts-packages/canton-sig/README.md`](ts-packages/canton-sig/README.md) — `CantonClient` + crypto + EVM tx helpers                                                                                                                                             |
| **Charging or administering the CC signature fee**         | [`daml-packages/signet-signer-v1/FEE.md`](daml-packages/signet-signer-v1/FEE.md) — collector model, fee endpoint, upgrade rules, admin runbook, security model                                                                                                |

For an executable end-to-end flow: the live e2e test in `test/src/test/` runs deposit + withdraw against a **live Canton network, the MPC, and the EVM chain** — the canonical worked example of disclosed-contract wiring, `RequestDeposit`/`RequestWithdrawal` arguments, signed-tx broadcast, and `ClaimDeposit`/`CompleteWithdrawal`. It is gated behind `MPC_CANTON_LIVE_MUTATE=1` (it spends funds). To exercise the flow against a local sandbox + an MPC instead, see [`TEST_LOCALLY.md`](TEST_LOCALLY.md).

## Architecture

This repo is the **Canton source-chain implementation** of the chain-agnostic [Sign Bidirectional Flow](https://docs.sig.network/architecture/sign-bidirectional); what follows is only how that flow maps onto Canton. The `Signer` is a singleton co-signed by the MPC party (`sigNetwork`) and the featured-app provider party (`sigNetworkFA`), and disclosed to consumer contracts.

1. **Request.** A consumer choice exercises `Signer.RequestSignature` (controlled by `operators + requester`), which derives the operator-set fingerprint on-chain (`sender = operatorsHash`) and emits a `SignBidirectionalEvent` for the MPC to watch (signatory `operators, requester, sigNetworkFA`; `sigNetwork` is only an observer, so a compromised `sigNetwork` cannot forge a request). The consumer stores that event CID on its single-use pending anchor.
   - Atomically inside the same transaction, the requester is charged a Canton Coin signature fee through the registered, late-bound `FeeCollector` (`requester → feeReceiver`, priced by the FA-signed `FeePriceConfig` and settled via a token-standard `TransferFactory_Transfer` inside the `signet-fee-amulet` implementation package). If the fee cannot settle, the event is never created — fail-closed.
2. **MPC signature.** The MPC derives a child secp256k1 key from the root key using KDF inputs `sender = operatorsHash` and the request `path`, threshold-signs the EVM transaction, and publishes the signature in `SignatureRespondedEvent`.
3. **Client broadcast.** The consumer (or test/client) reads that signature, reconstructs the signed EIP-1559 tx, and submits it to the destination chain via `eth_sendRawTransaction`.
4. **MPC-observed outcome.** Once the receipt is finalized, the MPC re-simulates the call to extract the ABI-encoded return data and publishes a `RespondBidirectionalEvent`, signed with the response-verification child key (derived with `sender = operatorsHash` and `path = "canton response key"`) over `keccak256(requestId ‖ serializedOutput)`.
5. **Verified claim.** The consumer's claim choice verifies that signature on-ledger via `secp256k1WithEcdsaOnly`, then retires the pending anchor and — via the delegated `Consume_*` choices — both response evidence contracts and the original `SignBidirectionalEvent`.

The `signet-vault-v1` package is one consumer of this protocol — the worked integrator example: ERC-20 holdings, deposit anchors, and refund-on-failure withdrawal are domain logic on top of the generic Signer.

Per-package details live in each package's README. Earlier design notes under `proposals/` describe pre-current iterations and may not reflect the shipped code.

## Prerequisites

| Tool           | Version | Install                                                           |
| -------------- | ------- | ----------------------------------------------------------------- |
| Java           | 17+     | [Temurin](https://adoptium.net/)                                  |
| Daml SDK (DPM) | 3.5.1   | `curl -sSL https://get.digitalasset.com/install/install.sh \| sh` |
| Node.js        | 22+     | [nodejs.org](https://nodejs.org/)                                 |
| pnpm           | 10+     | `corepack enable && corepack prepare pnpm@latest --activate`      |

After installing DPM, make sure `~/.dpm/bin` is on your `PATH`. The live e2e test reads its `MPC_CANTON_*` + funding configuration from `test/.env`; see `test/.env.example` for all variables.

## Quick Start

### 1. Build the DAR and generate codegen

```bash
pnpm bootstrap     # dpm build --all + Daml codegen + pnpm install
```

### 2. Run tests

```bash
cd test
pnpm test          # runs the test/ Vitest suite (the live e2e auto-skips unless configured)
```

The live e2e (in `src/test/`) runs only when `test/.env` is filled in and `MPC_CANTON_LIVE_MUTATE=1` — see [Live E2E Test](#live-e2e-test). For a local sandbox driven by an MPC node, see [`TEST_LOCALLY.md`](TEST_LOCALLY.md).

> `pnpm codegen:api` regenerates the OpenAPI types from a Canton JSON API on `:7575`. Point it at a local ledger spun up by the Rust harness in [`TEST_LOCALLY.md`](TEST_LOCALLY.md), or any reachable ledger. `pnpm generate` (clean + DAR + codegen + install) needs such a ledger up for the OpenAPI step.

## Daml Unit Tests

These don't need a ledger:

```bash
dpm build --all
pnpm run daml:test
```

> `dpm test` has no multi-package mode (its `--all` flag only adds a package's dependencies) — the `daml:test` script (package.json, also used by CI) tests each package individually.

## TypeScript Package Tests

These don't need a ledger:

```bash
pnpm -r --filter='@canton/*' --filter='canton-sig' run test
```

## Live E2E Test

The live e2e test (in `test/src/test/`) exercises the full deposit + withdraw lifecycle against a live Canton network, the MPC cluster, and a Sepolia EVM node, as a pure client.

Because it mutates the live ledger and spends funds, it runs only when the `MPC_CANTON_*` + funding env is present **and** `MPC_CANTON_LIVE_MUTATE=1`. Otherwise the suite skips it.

### Setup

```bash
cd test
cp .env.example .env
```

Fill in the `MPC_CANTON_*` values (the network's JSON API URL, OIDC credentials, party id, the disclosure endpoint URL — the e2e fetches the Signer + Vault from it — the MPC root public key, and, for paid fee mode, the CC registry URL), plus `MPC_CANTON_ETH_RPC_URL` (the EVM node the MPC's indexer watches) and `FAUCET_PRIVATE_KEY` (funds the derived deposit/vault addresses). See `test/.env.example` for the full list.

> The Vault hardcodes `caip2 = eip155:1` (test mode); the MPC accepts only that caip2. caip2 is decoupled from the EVM chainId, so the test signs with the **Sepolia chainId (11155111)** and broadcasts to `MPC_CANTON_ETH_RPC_URL`, which the MPC's `eip155:1` indexer watches. This split is a test-mode workaround — on mainnet it's unnecessary, since the chain is genuinely `eip155:1`.

### Run

```bash
cd test
MPC_CANTON_LIVE_MUTATE=1 pnpm test
```

## Available Scripts

From the repo root:

| Script              | Description                                                               |
| ------------------- | ------------------------------------------------------------------------- |
| `pnpm bootstrap`    | Fresh-clone setup: build DARs + Daml codegen + install (no ledger needed) |
| `pnpm daml:build`   | Build all DARs (`dpm build --all`)                                        |
| `pnpm daml:test`    | Run every package's Daml Script tests                                     |
| `pnpm codegen:daml` | Regenerate `@daml.js` bindings from the built DARs                        |
| `pnpm codegen:api`  | Regenerate OpenAPI types (requires a reachable ledger on :7575)           |
| `pnpm codegen`      | `codegen:daml` + `codegen:api`                                            |
| `pnpm generate`     | Full clean rebuild: clean + DARs + codegen + install (needs a ledger)     |
| `pnpm check`        | Typecheck + lint + knip + format check                                    |
| `pnpm fix`          | Auto-fix lint + format                                                    |

From `test/`:

| Script      | Description                                                                                     |
| ----------- | ----------------------------------------------------------------------------------------------- |
| `pnpm test` | Run the test/ Vitest suite; the live e2e runs only when configured + `MPC_CANTON_LIVE_MUTATE=1` |
