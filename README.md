# Canton MPC PoC

MPC-based ERC-20 custody on Canton. Daml smart contracts manage vault state (deposits, withdrawals, holdings); a TypeScript MPC service signs EVM transactions using threshold-derived keys via [signet.js](https://github.com/sig-net/signet.js); the Canton ledger verifies every MPC signature on-chain via `secp256k1WithEcdsaOnly` before crediting or debiting holdings.

## Where to start

| You are… | Read |
| --- | --- |
| **Integrating the Signer into a new Daml domain** | [`daml-packages/daml-signer/README.md`](daml-packages/daml-signer/README.md) — authority model, lifecycle, full API |
| **Using the ERC-20 Vault** (deposit / claim / withdraw / refund) | [`daml-packages/daml-vault/README.md`](daml-packages/daml-vault/README.md) — templates, choices, calldata shape, security invariants |
| **Building a TypeScript client / 3rd-party integration** | [`ts-packages/canton-sig/README.md`](ts-packages/canton-sig/README.md) — `CantonClient` + crypto + EVM tx helpers |
| **Reproducing `requestId` cross-language** | [`daml-packages/daml-eip712/README.md`](daml-packages/daml-eip712/README.md) — primitive encoders + composition rule |
| **Decoding ABI return data on-ledger** | [`daml-packages/daml-abi/README.md`](daml-packages/daml-abi/README.md) — slot vs byte-offset addressing |
| **Running a full multi-participant Canton stack** | [`SETUP.md`](SETUP.md) — local CN Quickstart (Keycloak, Splice, observability) |

For executable end-to-end flows: `test/src/test/sepolia-e2e.test.ts` (deposit) and `test/src/test/sepolia-withdrawal-e2e.test.ts` (withdrawal + refund). The shared `test/src/test/helpers/e2e-setup.ts` is the canonical worked example of disclosed-contract wiring, `RequestDeposit` arguments, signed-tx broadcast, and `ClaimDeposit`.

## Architecture in one paragraph

The `Signer` is a singleton signed by the MPC party (`sigNetwork`) and disclosed to consumer contracts. A consumer choice creates a transient `SignRequest` (signed by `operators + requester`) and immediately exercises `Signer.SignBidirectional`, which derives the operator-set fingerprint on-chain (`sender = operatorsHash`) and emits a `SignBidirectionalEvent` for the MPC to watch. The MPC derives a child secp256k1 key from the root key + (`operatorsHash`, `path`), threshold-signs the EVM transaction, and publishes the signature in `SignatureRespondedEvent`. **The consumer (or test/client) reads that signature, reconstructs the signed EIP-1559 tx, and submits it to the destination chain via `eth_sendRawTransaction`** — the MPC never touches the destination-chain mempool. Once the receipt is observable, the MPC re-simulates the call to extract the ABI-encoded return data and publishes a `RespondBidirectionalEvent` whose signature (made with the **root** key over `keccak256(requestId ‖ serializedOutput)`) is verified on-ledger by the consumer's claim choice via `secp256k1WithEcdsaOnly`. The `daml-vault` package is one consumer of this protocol; ERC-20 holdings, deposit anchors, and refund-on-failure withdrawal are domain logic on top of the generic Signer.

Per-package details live in the documents listed under [Where to start](#where-to-start). Earlier design notes under `proposals/` describe pre-current iterations and may not reflect the shipped code.

## Prerequisites

| Tool           | Version | Install                                                           |
| -------------- | ------- | ----------------------------------------------------------------- |
| Java           | 21+     | [Temurin](https://adoptium.net/)                                  |
| Daml SDK (DPM) | 3.4.11  | `curl -sSL https://get.digitalasset.com/install/install.sh \| sh` |
| Node.js        | 24+     | [nodejs.org](https://nodejs.org/)                                 |
| pnpm           | 10+     | `corepack enable && corepack prepare pnpm@latest --activate`      |

After installing DPM, make sure `~/.dpm/bin` is on your `PATH`. To point at a non-default sandbox, set `CANTON_JSON_API_URL` in `test/.env` (defaults to `http://localhost:7575`); see `test/.env.example` for all variables.

## Quick Start

### 1. Build the DAR and generate codegen

```bash
dpm build --all
cd test
pnpm run codegen:daml
pnpm install
```

### 2. Start the Canton sandbox

In a separate terminal (keep it running):

```bash
cd test
pnpm daml:sandbox
```

Wait until you see the JSON API listening on port 7575. You can verify with:

```bash
curl -sf http://localhost:7575/docs/openapi > /dev/null && echo "Ready"
```

### 3. Run tests

```bash
cd test
pnpm test          # single run (unit + integration)
```

After Daml source changes: `cd test && pnpm generate` (clean + DAR + codegen + install; needs the sandbox up for OpenAPI codegen).

## Daml Unit Tests

These don't need the sandbox:

```bash
dpm build --all
for pkg in daml-abi daml-uint256 daml-eip712 daml-signer daml-vault; do
  (cd daml-packages/$pkg && dpm test)
done
```

> `dpm test` does not support `--all` — each package must be tested individually.

## Sepolia E2E Tests

End-to-end tests that exercise the full deposit/withdrawal lifecycle against a live Sepolia RPC and the Canton sandbox.

### Setup

```bash
cd test
cp .env.example .env
```

Fill in the required values:

| Variable               | Description                                                           |
| ---------------------- | --------------------------------------------------------------------- |
| `CANTON_JSON_API_URL`  | (optional) Canton JSON API base URL (default `http://localhost:7575`) |
| `SEPOLIA_RPC_URL`      | Sepolia JSON-RPC endpoint (Infura, Alchemy, etc.)                     |
| `MPC_ROOT_PRIVATE_KEY` | `0x`-prefixed secp256k1 private key (64 hex chars)                    |
| `MPC_ROOT_PUBLIC_KEY`  | Uncompressed SEC1 public key (`04` + x + y, no `0x` prefix)           |
| `VAULT_ID`             | Vault discriminator for MPC key derivation                            |
| `FAUCET_PRIVATE_KEY`   | (optional) Defaults to `MPC_ROOT_PRIVATE_KEY`                         |
| `ERC20_ADDRESS`        | (optional) Defaults to test USDC on Sepolia                           |

### Fund the faucet

```bash
pnpm sepolia:preflight    # prints faucet address + current balances
```

Send to the faucet address:

- ~0.002 ETH for gas per test run
- ERC-20 tokens for the deposit amount

### Run

```bash
# Start sandbox in a separate terminal first, then:
pnpm test          # runs all tests including Sepolia e2e when env is set
```

## Available Scripts

From `test/`:

| Script                   | Description                                                   |
| ------------------------ | ------------------------------------------------------------- |
| `pnpm test`              | Run all tests (unit + integration, Sepolia e2e if env is set) |
| `pnpm daml:build`        | Build the DAR                                                 |
| `pnpm daml:test`         | Run Daml Script tests                                         |
| `pnpm daml:sandbox`      | Start Canton sandbox with JSON API on :7575                   |
| `pnpm codegen:daml`      | Regenerate Daml JS codegen from built DAR                     |
| `pnpm codegen:api`       | Regenerate OpenAPI types (requires running sandbox)           |
| `pnpm generate`          | Full clean rebuild: DAR + codegen + install                   |
| `pnpm sepolia:preflight` | Check faucet balances and print deposit addresses             |

From root:

| Script       | Description                            |
| ------------ | -------------------------------------- |
| `pnpm check` | Typecheck + lint + knip + format check |
| `pnpm fix`   | Auto-fix lint + format                 |
