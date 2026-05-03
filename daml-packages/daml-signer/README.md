# daml-signer

Generic MPC signing infrastructure for Canton. The Signer is a small set of Daml templates that lets a calling contract ask a trusted MPC service (the `sigNetwork` party) to produce signatures for transactions on a downstream chain (currently EVM; extensible to BTC, Solana, etc.). It is chain-agnostic and reusable across multiple consumer implementations.

For a worked consumer example see [`daml-vault`](../daml-vault/README.md). For an executable end-to-end run-through (party allocation, vault setup, deposit, claim, withdrawal) see `test/src/test/helpers/e2e-setup.ts` in this repo.

## How this fits together

```
+--------------------+    create + exercise    +----------------------+
| Consumer contract  | ----------------------> | Canton (Signer)      |
|  (operators+req.)  |    SignRequest +        |   SignBidirectional  |
+--------------------+    SignBidirectional    |     -> Execute       |
        ^                                      |   SignBidirEvent     |
        |                                      +-----------+----------+
        |                                                  |
        |  SignatureRespondedEvent                         | observed off-Canton
        |  RespondBidirectionalEvent                       v
        +------------------------------------------ (MPC produces two
                                                    Canton evidence
                                                    contracts asynchronously)
```

For each `SignBidirectionalEvent` you emit, the MPC publishes two evidence contracts back on Canton:

- `SignatureRespondedEvent` — ECDSA signature over the EVM tx hash. The integrator reconstructs the signed EIP-1559 tx and broadcasts it (the MPC stays out of the destination-chain mempool).
- `RespondBidirectionalEvent` — ECDSA signature over `keccak256(requestId ‖ serializedOutput)` plus the ABI-encoded return data (or a `0xdeadbeef`-prefixed payload on revert). Verified on-ledger before the consumer acts on the outcome.

The Signer enforces operator-set isolation, not replay protection — calldata validation, single-use semantics, and per-deployment `path` namespacing are the consumer's job. See [Security checklist for integrators](#security-checklist-for-integrators).

## Quickstart

`daml.yaml`:

```yaml
data-dependencies:
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar     # transitive — required at compile time
  # add daml-abi if you need the calldata-decoding helpers used by daml-vault:
  # - ../daml-abi/.daml/dist/daml-abi-0.0.1.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

Daml imports:

```daml
import Signer
  ( Signer, SignRequest(..), SignBidirectionalEvent(..)
  , SignatureRespondedEvent(..), RespondBidirectionalEvent(..)
  , SignBidirectional(..)
  , Consume_SignatureResponded(..), Consume_RespondBidirectional(..)
  , requestIdFromSignEvent, signatureDer, validSignature
  , Signature(..), EcdsaSigData(..)
  )
import EvmTypes (EvmType2TransactionParams(..), EvmAccessListEntry(..))
import TxParams (TxParams(..))
import RequestId (computeRequestId, computeResponseHash)
```

You'll be given two things to integrate against:

1. The `signerCid` disclosed-contract envelope (the `Signer` singleton, exposed via `disclosedContracts` on every exercise that touches it).
2. The MPC **root** secp256k1 public key (uncompressed, hex). You derive two children from it off-ledger using the Canton KDF — `ε = keccak256("sig.network v2.0.0 epsilon derivation:canton:global:{operatorsHash}:{path}")`, child = `rootPub + ε·G`:
   - The **EVM child address** for the deployment's vault (`path` = whatever you pass on `SignRequest`; `canton-sig`'s `deriveDepositAddress` does this in one call).
   - The **response-verification pubkey** for the constant `path = "canton response key"` — store this on your contract so `secp256k1WithEcdsaOnly` can verify `RespondBidirectionalEvent.signature` on-ledger. See [Security checklist #4](#security-checklist-for-integrators).

## Integrator lifecycle

A single signing request, end-to-end. All steps run inside one Daml transaction except step 3 (off-Canton, asynchronous) and step 4 (a separate transaction once both response events are visible).

### 1. Issue a signing request

Inside a consumer choice body (which has `operators` signatory + `requester` controller authority):

```daml
nonconsuming choice MyDomainAction : (ContractId SignBidirectionalEvent, ContractId MyAnchor)
  with
    requester    : Party
    signerCid    : ContractId Signer
    evmTxParams  : EvmType2TransactionParams
    userPath     : Text
  controller requester
  do
    -- 1a. Domain-level authorization. The Signer signs whatever bytes you hand it,
    -- so you must validate calldata yourself if it matters (e.g. ABI selector match,
    -- argument bounds). See daml-vault's RequestDeposit for the ERC-20 case.

    -- 1b. Build the request envelope. Concrete values shown below.
    let caip2Id = "eip155:" <> chainIdToDecimalText evmTxParams.chainId   -- destination CAIP-2
    let fullPath = myDeploymentId <> "," <> partyToText requester <> "," <> userPath

    signReqCid <- create SignRequest with
      operators; requester; sigNetwork
      txParams = EvmType2TxParams evmTxParams
      caip2Id
      keyVersion = 1
      path = fullPath
      algo = ""                                   -- always ""
      dest = ""                                   -- always ""
      params = ""                                 -- always ""
      outputDeserializationSchema = "[{\"name\":\"\",\"type\":\"bool\"}]"
      respondSerializationSchema  = "[{\"name\":\"\",\"type\":\"bool\"}]"

    -- 1c. Hand off to the disclosed Signer. This consumes the SignRequest via Execute
    -- and creates the MPC-visible SignBidirectionalEvent in the same transaction.
    signEventCid <- exercise signerCid SignBidirectional with
      signRequestCid = signReqCid; requester

    -- 1d. Recompute the requestId for your anchor — the Daml/TS/Rust impls produce
    -- byte-identical hashes (see "requestId formula" below).
    signEvent <- fetch signEventCid
    let requestId = requestIdFromSignEvent signEvent

    -- 1e. Persist whatever single-use anchor enforces your replay-protection policy.
    anchorCid <- create MyAnchor with
      operators; requester; sigNetwork; requestId; evmTxParams

    pure (signEventCid, anchorCid)
```

Notes:

- `chainIdToDecimalText` comes from `daml-eip712`. `evmTxParams.chainId` is the 32-byte uint256 hex of the destination chain id (e.g. `"00…aa36a7"` for Sepolia).
- All hex fields in `EvmType2TransactionParams` are bare hex (no `0x` prefix) and are 32-byte left-padded uint256s, except `to` (20-byte address) and `calldata` (raw bytes, may be `""`). You fetch `nonce` / fees / gas from the destination chain yourself — they are not auto-filled.
- `EvmAccessListEntry.address` is 20 bytes; each `storageKeys` entry is 32 bytes.
- `outputDeserializationSchema` and `respondSerializationSchema` are JSON ABI fragments describing the EVM call's return type; the MPC re-simulates the call and ABI-encodes the result accordingly. For a function returning `bool` (e.g. ERC-20 `transfer`) pass `[{"name":"","type":"bool"}]`; for `uint256` pass `[{"name":"","type":"uint256"}]`. The two strings are always identical in current usage.
- `algo`, `dest`, `params`: always pass `""`. They are hashed into `requestId` for forwards-compatibility but no current code path branches on them.

### 2. The MPC service responds (off-Canton, asynchronous)

The MPC service watches `SignBidirectionalEvent` (signatory `operators, requester`; observer `sigNetwork`) and produces **two** Canton events for each request — but they have different roles:

| Event | Signed by | Covers | Use |
| --- | --- | --- | --- |
| `SignatureRespondedEvent.signature` | **EVM child** key (derived from root + `(operatorsHash, path)`) | the EVM transaction hash | **The consumer reads it, reconstructs the signed EIP-1559 tx, and submits it via `eth_sendRawTransaction`.** Consumers typically do **not** verify this signature on-ledger. |
| `RespondBidirectionalEvent.signature` | **response-verification child** key (derived from root + `(operatorsHash, "canton response key")` — same KDF, constant path) | `responseHash = keccak256(requestId ‖ serializedOutput)` | The proof of execution + outcome. The consumer verifies this on-ledger and acts on `serializedOutput`. |

`serializedOutput` carries the ABI-encoded return data on success, or `0xdeadbeef`-prefixed payload on failure (predicate `abiHasErrorPrefix` in `daml-abi`).

### 3. Verify and act

Once both events are visible (poll via `/v2/state/active-contracts` for the template ids, or subscribe to `/v2/updates` for streaming), in a new transaction:

```daml
nonconsuming choice MyDomainClaim : ...
  with
    requester                    : Party
    anchorCid                    : ContractId MyAnchor
    respondBidirectionalEventCid : ContractId RespondBidirectionalEvent
    signatureRespondedEventCid   : ContractId SignatureRespondedEvent
  controller requester
  do
    -- Archive your single-use anchor first (replay protection).
    anchor <- fetch anchorCid
    archive anchorCid

    -- Validate that both response events match the anchor.
    outcome <- fetch respondBidirectionalEventCid
    assertMsg "outcome sigNetwork mismatch" (outcome.sigNetwork  == sigNetwork)
    assertMsg "outcome operators mismatch"  (sort outcome.operators == sort operators)
    assertMsg "outcome requester mismatch"  (outcome.requester  == requester)
    assertMsg "outcome requestId mismatch"  (outcome.requestId  == anchor.requestId)

    sigResp <- fetch signatureRespondedEventCid
    assertMsg "sigResp sigNetwork mismatch" (sigResp.sigNetwork == sigNetwork)
    assertMsg "sigResp operators mismatch"  (sort sigResp.operators == sort operators)
    assertMsg "sigResp requester mismatch"  (sigResp.requester  == requester)
    assertMsg "sigResp requestId mismatch"  (sigResp.requestId  == anchor.requestId)

    -- Verify the outcome signature against the response-verification pubkey
    -- (derived off-ledger from the MPC root + (operatorsHash, "canton response key") and stored at deployment).
    let responseHash = computeResponseHash anchor.requestId outcome.serializedOutput
    assertMsg "Invalid MPC signature"
      (secp256k1WithEcdsaOnly (signatureDer outcome.signature) responseHash mpcResponseVerifyKey)

    -- Interpret the outcome.
    --   abiHasErrorPrefix outcome.serializedOutput        → EVM revert; refund / abort
    --   abiDecodeBool     outcome.serializedOutput 0      → e.g. ERC-20 transfer success bit
    --   abiDecodeUint     outcome.serializedOutput 0      → e.g. balance return
    -- Branching on this is your domain logic.

    -- Clean up the evidence (you lack sigNetwork authority, so call Consume_*).
    exercise respondBidirectionalEventCid Consume_RespondBidirectional with actor = requester
    exercise signatureRespondedEventCid   Consume_SignatureResponded   with actor = requester

    -- Apply your domain effect.
    create MyHolding with ...
```

`mpcResponseVerifyKey` is the uncompressed secp256k1 pubkey you derive off-ledger from the MPC root + `(operatorsHash, "canton response key")` (formula and tooling pointer in [Security checklist #4](#security-checklist-for-integrators)) and store at deployment time. The `daml-vault` package stores it on the `Vault` contract under the field name `evmMpcPublicKey` — the field name is historical; the value is **not** the root key, and it is **not** the EVM child key either, it is the response-verification child derived with the constant `"canton response key"` path.

### Failure modes

| Symptom | Meaning | Action |
| --- | --- | --- |
| `RespondBidirectionalEvent` arrives but `abiHasErrorPrefix outcome.serializedOutput` is `True` | EVM tx reverted (or was replaced / dropped). The MPC still signs and publishes the outcome — payload is the 4-byte `0xdeadbeef` prefix followed by a 32-byte ABI-encoded `bool(true)` placeholder (no embedded EVM error data). The signature is valid; the prefix is the only revert signal. | Domain decision (refund, retry, surface error). |
| `secp256k1WithEcdsaOnly` returns `False` | Signature does not match `responseHash` under your stored response-verification pubkey | Reject the claim. Either the wrong pubkey is stored (e.g. someone stored the root by mistake — see Security checklist #4) or the response is forged. Escalate, do not retry. |
| Only one of the two response events ever arrives | You haven't broadcast the signed tx yet (so no receipt to observe) or the destination chain hasn't confirmed it | Broadcast (or rebroadcast) the signed tx. There is no Canton-side timeout — add one in your consumer if you need it. |
| `Consume_*` exercised twice | Second exercise fails because the contract is already archived | Idempotent at your level (your claim choice should archive the anchor first, so a duplicate claim won't reach `Consume_*`). |
| Duplicate `SignBidirectionalEvent` with identical `requestId` | Replay attempt | Signing is RFC6979-deterministic, so duplicates produce identical signatures. Your single-use anchor prevents acting on it twice. |

### Security checklist for integrators

The Signer signs whatever bytes it is given and tracks no per-request state. Every item below is the consumer's responsibility — getting any of them wrong can leak funds.

| # | Must do | Why |
| --- | --- | --- |
| 1 | **Validate `txParams.calldata` before `SignBidirectional`** (ABI selector + argument checks). | The Signer will sign anything. |
| 2 | **Use a single-use anchor for replay protection** (or a `requestId` nullifier set). | The Signer has no nonce, no nullifier set, no approval state. |
| 3 | **Namespace `path` per deployment** (e.g. `${vaultId},${requester},${userPath}`). | The Signer isolates operator sets only; two consumers sharing an operator set share the key namespace unless `path` says otherwise. |
| 4 | **Derive and store the response-verification pubkey at deployment time** on your equivalent of `Vault`: `derive_key(rootPub, derive_epsilon_canton(1, operatorsHash, "canton response key"))`. **Do not store the root pubkey directly** — verification will fail. | What `secp256k1WithEcdsaOnly` is checked against. Re-fetching at claim time opens a TOCTOU window. |
| 5 | **Cross-check `(operators, requester, requestId)`** between your anchor, `RespondBidirectionalEvent`, and `SignatureRespondedEvent`. | A misbehaving `sigNetwork` could otherwise pair a valid signature with a different anchor. |
| 6 | **Archive the anchor first in the claim choice**, before any other assertion. | Replay protection only holds if the anchor is gone before a later assertion can revert. |
| 7 | **Verify the outcome signature on-ledger before mutating state**, against the stored response-verification pubkey. | Forged `RespondBidirectionalEvent` rejected at the consumer's claim choice. |
| 8 | **Reject `serializedOutput` starting with `0xdeadbeef`** (revert payload) or that does not ABI-decode to your expected success value. | EVM revert ≠ Canton-side success. |

Replay-protection options (pick what fits your threat model):

- Single-use anchor template, one contract per request, archived on completion (the `daml-vault` pattern with `PendingDeposit` / `PendingWithdrawal`).
- A registry contract that records every used `requestId` (nullifier set).
- Off-chain operator enforcement via a request-approve flow before the consumer ever creates the `SignRequest`.
- Nothing — relying on the destination chain's nonce when a duplicate sign is harmless (signing is RFC6979-deterministic, so duplicates produce identical signatures and only one tx can land).

For a complete worked consumer, see [`daml-vault/daml/Erc20Vault.daml`](../daml-vault/daml/Erc20Vault.daml).

# API Reference

## Templates

### `Signer`

Singleton identity contract; disclosed off-chain.

- Signatory: `sigNetwork`
- Fields: `sigNetwork : Party`

| Choice | Type | Controller | Args | Returns |
| --- | --- | --- | --- | --- |
| `SignBidirectional` | nonconsuming | `requester` | `signRequestCid : ContractId SignRequest`, `requester : Party` | `ContractId SignBidirectionalEvent` |
| `Respond` | nonconsuming | `sigNetwork` | `signEventCid : ContractId SignBidirectionalEvent`, `requestId : BytesHex`, `signature : Signature` | `ContractId SignatureRespondedEvent` |
| `RespondBidirectional` | nonconsuming | `sigNetwork` | `signEventCid : ContractId SignBidirectionalEvent`, `requestId : BytesHex`, `serializedOutput : BytesHex`, `signature : Signature` | `ContractId RespondBidirectionalEvent` |

### `SignRequest` (transient)

Authority bridge from the consumer to the Signer. Created in the consumer body, consumed by `Execute` (called via `SignBidirectional`) in the same transaction.

- Signatory: `operators, requester`
- Observer: `sigNetwork`
- Ensure: `not (null operators) && unique operators && validTxParams txParams`

Fields:

| Field | Type | Notes |
| --- | --- | --- |
| `operators` | `[Party]` | Operator multi-sig. Non-empty, unique. Sorted internally for hashing — caller order doesn't matter. |
| `requester` | `Party` | Initiator. Becomes co-signatory of `SignBidirectionalEvent`. |
| `sigNetwork` | `Party` | Must equal the `Signer`'s `sigNetwork`. |
| `txParams` | `TxParams` | Chain-agnostic transaction wrapper. |
| `caip2Id` | `Text` | **Destination** chain CAIP-2 id, e.g. `"eip155:1"` (mainnet) or `"eip155:11155111"` (Sepolia). Build via `chainIdToDecimalText` from `daml-eip712`. |
| `keyVersion` | `Int` | KDF version. Use `1` (the latest supported). |
| `path` | `Text` | KDF subkey path. Consumer namespaces by deployment id when reusing operator sets (Security checklist #3). The Signer cannot enforce this. |
| `algo` | `Text` | Always `""`. Hashed into `requestId` for forwards-compat; no current code path branches on it. |
| `dest` | `Text` | Always `""`. Same. |
| `params` | `Text` | Always `""`. Same. |
| `outputDeserializationSchema` | `Text` | JSON ABI fragment, e.g. `[{"name":"","type":"bool"}]`. Tells the MPC how to ABI-encode the simulated return value into `serializedOutput`. |
| `respondSerializationSchema` | `Text` | Schema describing how the response is signed. Same value as `outputDeserializationSchema` in current usage. |

| Choice | Type | Controller | Returns |
| --- | --- | --- | --- |
| `Execute` | consuming | `requester` | `ContractId SignBidirectionalEvent` |

`Execute` derives `sender = computeOperatorsHash (map partyToText operators)` from the on-ledger signatory list and creates the event.

### `SignBidirectionalEvent`

Created by `SignRequest.Execute`. **What the MPC watches.** Has no choices — never archived directly.

- Signatory: `operators, requester`
- Observer: `sigNetwork`
- Ensure: `not (null operators) && unique operators && sender == computeOperatorsHash (map partyToText operators) && validTxParams txParams`

Fields: same as `SignRequest` plus `sender : BytesHex` (= `operatorsHash`, set by `Execute`).

### `SignatureRespondedEvent`

EVM-tx signature evidence. Created by `Signer.Respond`. Signed by the EVM child key (root + `(operatorsHash, path)`); used by the integrator to broadcast the signed tx. See [Integrator lifecycle § 2](#2-the-mpc-service-responds-off-canton-asynchronous) for the full key/usage table.

- Signatory: `sigNetwork`
- Observer: `operators, requester`
- Ensure: `isBytesN 32 requestId && validSignature signature`

| Field | Type |
| --- | --- |
| `sigNetwork`, `requester`, `responder` | `Party` |
| `operators` | `[Party]` |
| `requestId` | `BytesHex` (32 bytes) |
| `signature` | `Signature` |

| Choice | Type | Controller | Args |
| --- | --- | --- | --- |
| `Consume_SignatureResponded` | consuming | `actor : Party` (must be in `operators` or be `requester`) | — |

### `RespondBidirectionalEvent`

Outcome signature evidence. Signed by the response-verification child key (root + `(operatorsHash, "canton response key")`) over `responseHash = keccak256(requestId ‖ serializedOutput)`. The consumer verifies it on-ledger with `secp256k1WithEcdsaOnly` against the response-verification pubkey it stored at deployment. `serializedOutput` is ABI-encoded return data on success, or `0xdeadbeef`+payload on failure (predicate `abiHasErrorPrefix` in `daml-abi`).

- Signatory: `sigNetwork`
- Observer: `operators, requester`
- Ensure: `isBytesN 32 requestId && isCanonicalHex serializedOutput && validSignature signature`

| Field | Type |
| --- | --- |
| `sigNetwork`, `requester`, `responder` | `Party` |
| `operators` | `[Party]` |
| `requestId` | `BytesHex` (32 bytes) |
| `serializedOutput` | `BytesHex` |
| `signature` | `Signature` |

| Choice | Type | Controller | Args |
| --- | --- | --- | --- |
| `Consume_RespondBidirectional` | consuming | `actor : Party` (must be in `operators` or be `requester`) | — |

## Data types

### `EvmTypes.daml`

```daml
data EvmAccessListEntry = EvmAccessListEntry with
    address     : BytesHex          -- 20 bytes
    storageKeys : [BytesHex]        -- each 32 bytes

data EvmType2TransactionParams = EvmType2TransactionParams with
    chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit, value : BytesHex   -- each 32-byte uint256
    to                                                                  : Optional BytesHex   -- None = contract creation; Some 20-byte address
    calldata                                                            : BytesHex            -- raw EVM calldata, no 0x prefix; "" allowed
    accessList                                                          : [EvmAccessListEntry]
```

### `TxParams.daml`

```daml
data TxParams = EvmType2TxParams EvmType2TransactionParams
```

Single constructor today; `BtcTxParams` / `SolTxParams` slot in the future.

### `Signer.daml`

```daml
data EcdsaSigData = EcdsaSigData with
    der        : SignatureHex   -- DER-encoded (r, s)
    recoveryId : Int            -- 0 or 1

data Signature = EcdsaSig EcdsaSigData
-- future variants: EddsaSig, SchnorrSig
```

DER because `secp256k1WithEcdsaOnly` requires DER. Union for future EdDSA / Schnorr without changing the wire format.

## Helpers

### `Signer.daml`

| Symbol | Type | Use |
| --- | --- | --- |
| `signatureDer` | `Signature -> SignatureHex` | Extract DER bytes for `secp256k1WithEcdsaOnly` |
| `validSignature` | `Signature -> Bool` | Predicate used by evidence-contract `ensure` clauses |
| `requestIdFromSignEvent` | `SignBidirectionalEvent -> BytesHex` | Recompute `requestId` from a fetched event |

### `RequestId.daml`

| Symbol | Type | Use |
| --- | --- | --- |
| `computeOperatorsHash` | `[Text] -> BytesHex` | `keccak256(concat (map (keccak256 . toHex) (sort operatorTexts)))` |
| `computeRequestId` | `Text -> TxParams -> Text -> Int -> Text -> Text -> Text -> Text -> BytesHex` | Full sign-request commitment (formula below) |
| `computeResponseHash` | `BytesHex -> BytesHex -> BytesHex` | `keccak256(requestId ‖ output)` |
| `hashTxParams` | `TxParams -> BytesHex` | Per-chain dispatch |

### `EvmTypes.daml`

| Symbol | Type | Use |
| --- | --- | --- |
| `isBytesN` | `Int -> BytesHex -> Bool` | Length-checked canonical hex |
| `isCanonicalHex` | `BytesHex -> Bool` | Even-length hex (or empty) |
| `isEvmUInt256` | `BytesHex -> Bool` | 32-byte canonical hex |
| `validOptionalAddress` | `Optional BytesHex -> Bool` | `None` or 20-byte address |
| `validAccessListEntry` | `EvmAccessListEntry -> Bool` | Per-entry validator |
| `validEvmType2TransactionParams` | `EvmType2TransactionParams -> Bool` | Full record validator |

### `TxParams.daml`

| Symbol | Type | Use |
| --- | --- | --- |
| `validTxParams` | `TxParams -> Bool` | Per-chain dispatch validator |

## `requestId` and `responseHash` formulas

```
requestId = keccak256(
    eip712EncodeString  sender                    -- = operatorsHash, set by Execute
  ‖ hashTxParams        txParams
  ‖ eip712EncodeString  caip2Id
  ‖ eip712EncodeUint256 (toHex keyVersion)
  ‖ eip712EncodeString  path
  ‖ eip712EncodeString  algo
  ‖ eip712EncodeString  dest
  ‖ eip712EncodeString  params
)

responseHash = keccak256(requestId ‖ serializedOutput)
```

Every implementation that mirrors this off-Canton must produce byte-identical hashes — verify cross-language with golden vectors before integrating.

## Build & Test

From the repo root:

```bash
dpm build --all                                  # build all packages
(cd daml-packages/daml-signer && dpm test)       # per-package — dpm test does NOT support --all
```
