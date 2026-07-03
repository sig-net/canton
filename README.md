# Canton MPC

MPC-based ERC-20 custody on Canton. Daml smart contracts manage vault state (deposits, withdrawals, holdings); an MPC cluster signs EVM transactions using threshold-derived keys (compatible with [signet.js](https://github.com/sig-net/signet.js)); the Canton ledger verifies every MPC signature on-chain via `secp256k1WithEcdsaOnly` before crediting or debiting holdings. The `ts-packages/canton-sig` library is the TypeScript **client** for this protocol.

## Where to start

| You are…                                                         | Read                                                                                                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Integrating the Signer into a new Daml domain**                | [`daml-packages/signet-signer-v1/README.md`](daml-packages/signet-signer-v1/README.md) — authority model, lifecycle, full API                                  |
| **Charging or administering the CC signature fee**               | [`daml-packages/signet-signer-v1/FEE.md`](daml-packages/signet-signer-v1/FEE.md) — collector model, fee endpoint, upgrade rules, admin runbook, security model |
| **Using the ERC-20 Vault** (deposit / claim / withdraw / refund) | [`daml-packages/signet-vault-v1/README.md`](daml-packages/signet-vault-v1/README.md) — templates, choices, calldata shape, security invariants                 |
| **Building a TypeScript client / 3rd-party integration**         | [`ts-packages/canton-sig/README.md`](ts-packages/canton-sig/README.md) — `CantonClient` + crypto + EVM tx helpers                                              |
| **Reproducing `requestId` cross-language**                       | [`daml-packages/signet-eip712/README.md`](daml-packages/signet-eip712/README.md) — primitive encoders + composition rule                                       |
| **Decoding ABI return data on-ledger**                           | [`daml-packages/signet-abi/README.md`](daml-packages/signet-abi/README.md) — slot vs byte-offset addressing                                                    |
| **Deploying the Signer + fee + Vault to a network**              | [`test/src/scripts/deploy.ts`](test/src/scripts/deploy.ts) — network-aware (`CANTON_NETWORK`, default `devnet`); DevNet + testnet are live                     |
| **Running a full multi-participant Canton stack**                | [`SETUP.md`](SETUP.md) — local CN Quickstart (Keycloak, Splice, observability)                                                                                 |
| **Testing deposit/withdraw end-to-end**                          | [`test/src/test/devnet-e2e.test.ts`](test/src/test/devnet-e2e.test.ts) against DevNet, or [`TEST_LOCALLY.md`](TEST_LOCALLY.md) for a local sandbox + MPC       |

For an executable end-to-end flow: `test/src/test/devnet-e2e.test.ts` runs deposit + withdraw against the **Canton DevNet, the MPC, and the EVM chain** — the canonical worked example of disclosed-contract wiring, `RequestDeposit`/`RequestWithdrawal` arguments, signed-tx broadcast, and `ClaimDeposit`/`CompleteWithdrawal`. It is gated behind `MPC_CANTON_LIVE_MUTATE=1` (it spends funds). To exercise the flow against a local sandbox + an MPC instead, see [`TEST_LOCALLY.md`](TEST_LOCALLY.md).

## Architecture in one paragraph

This repo is the **Canton source-chain implementation** of the chain-agnostic [Sign Bidirectional Flow](https://docs.sig.network/architecture/sign-bidirectional) (request → MPC signature → client broadcast → MPC-observed outcome → verified claim); what follows is only how that flow maps onto Canton. The `Signer` is a singleton co-signed by the MPC party (`sigNetwork`) and the featured-app provider party (`sigNetworkFA`), and disclosed to consumer contracts. A consumer choice exercises `Signer.RequestSignature` (controlled by `operators + requester`), which derives the operator-set fingerprint on-chain (`sender = operatorsHash`), atomically charges the requester a Canton Coin signature fee through the registered, late-bound `FeeCollector` (`requester → feeReceiver`, priced by the FA-signed `FeePriceConfig` and settled via a token-standard `TransferFactory_Transfer` inside the `signet-fee-amulet` implementation package; if it cannot settle, the event is never created — fail-closed), and emits a `SignBidirectionalEvent` (signatory `operators, requester, sigNetworkFA`; `sigNetwork` is only an observer, so a compromised `sigNetwork` cannot forge a request) for the MPC to watch. The consumer stores that event CID on its single-use pending anchor. The MPC answers with the two evidence contracts of the generic flow: `SignatureRespondedEvent` (the EVM transaction signature, signed with the child key for `sender = operatorsHash` + the request `path`; the consumer reconstructs and broadcasts the signed tx — the MPC does not) and, after the on-chain outcome is observed, `RespondBidirectionalEvent`, whose signature (response-verification child key, `sender = operatorsHash`, fixed `path = "canton response key"`, over `keccak256(requestId ‖ serializedOutput)`) is verified **on-ledger** by the consumer's claim choice via `secp256k1WithEcdsaOnly`. After validated claim/completion, the consumer retires the pending anchor and — via the delegated `Consume_*` choices — both response evidence contracts and the original `SignBidirectionalEvent`. The `signet-vault-v1` package is one consumer of this protocol; ERC-20 holdings, deposit anchors, and refund-on-failure withdrawal are domain logic on top of the generic Signer.

Per-package details live in the documents listed under [Where to start](#where-to-start). Earlier design notes under `proposals/` describe pre-current iterations and may not reflect the shipped code.

## Prerequisites

| Tool           | Version | Install                                                           |
| -------------- | ------- | ----------------------------------------------------------------- |
| Java           | 17+     | [Temurin](https://adoptium.net/)                                  |
| Daml SDK (DPM) | 3.5.1   | `curl -sSL https://get.digitalasset.com/install/install.sh \| sh` |
| Node.js        | 22+     | [nodejs.org](https://nodejs.org/)                                 |
| pnpm           | 10+     | `corepack enable && corepack prepare pnpm@latest --activate`      |

After installing DPM, make sure `~/.dpm/bin` is on your `PATH`. The DevNet e2e test reads its `MPC_CANTON_*` + funding configuration from `test/.env`; see `test/.env.example` for all variables.

## Quick Start

### 1. Build the DAR and generate codegen

```bash
pnpm bootstrap     # dpm build --all + Daml codegen + pnpm install
```

### 2. Run tests

```bash
cd test
pnpm test          # runs the test/ Vitest suite (the DevNet e2e auto-skips unless configured)
```

The DevNet e2e (`src/test/devnet-e2e.test.ts`) runs only when `test/.env` is filled in and `MPC_CANTON_LIVE_MUTATE=1` — see [DevNet E2E Test](#devnet-e2e-test). For a local sandbox driven by an MPC node, see [`TEST_LOCALLY.md`](TEST_LOCALLY.md).

> `pnpm codegen:api` regenerates the OpenAPI types from a Canton JSON API on `:7575`. Point it at a local ledger spun up by the Rust harness in [`TEST_LOCALLY.md`](TEST_LOCALLY.md), or any reachable ledger. `pnpm generate` (clean + DAR + codegen + install) needs such a ledger up for the OpenAPI step.

## Daml Unit Tests

These don't need a ledger:

```bash
dpm build --all
pnpm run daml:test
```

> `dpm test` does not support `--all` — the `daml:test` script (package.json, also used by CI) tests each package individually.

## TypeScript Package Tests

These don't need a ledger:

```bash
pnpm -r --filter='@canton/*' --filter='canton-sig' run test
```

## DevNet E2E Test

`test/src/test/devnet-e2e.test.ts` exercises the full deposit + withdraw lifecycle against the live Canton DevNet, the MPC cluster, and a Sepolia EVM node, as a pure client.

Because it mutates the live ledger and spends DevNet funds, it runs only when the `MPC_CANTON_*` + funding env is present **and** `MPC_CANTON_LIVE_MUTATE=1`. Otherwise the suite skips it.

### Setup

```bash
cd test
cp .env.example .env
```

Fill in the `MPC_CANTON_*` values (DevNet JSON API URL, OIDC credentials, party id, the Signer + Vault contract/template ids, the MPC root public key, the CC registry URL for the signature fee), plus `MPC_CANTON_ETH_RPC_URL` (the DevNet EVM node) and `FAUCET_PRIVATE_KEY` (funds the derived deposit/vault addresses). See `test/.env.example` for the full list.

> The Vault hardcodes `caip2 = eip155:1` (test mode); the MPC accepts only that caip2. caip2 is decoupled from the EVM chainId, so the test signs with the **Sepolia chainId (11155111)** and broadcasts to `MPC_CANTON_ETH_RPC_URL`, which the MPC's `eip155:1` indexer watches. This split is a Sepolia-devnet workaround — on mainnet it's unnecessary, since the chain is genuinely `eip155:1`.

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

| Script      | Description                                                                                       |
| ----------- | ------------------------------------------------------------------------------------------------- |
| `pnpm test` | Run the test/ Vitest suite; the DevNet e2e runs only when configured + `MPC_CANTON_LIVE_MUTATE=1` |
