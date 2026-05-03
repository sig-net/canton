# daml-signer

Generic MPC signing infrastructure for Canton. The Signer is a small set of Daml templates that lets a calling contract ask a trusted MPC service (the `sigNetwork` party) to produce signatures for transactions on a downstream chain (currently EVM; extensible to BTC, Solana, etc.). It is chain-agnostic and reusable across multiple consumer implementations.

For a worked consumer example see [`daml-vault`](../daml-vault/README.md). For an executable end-to-end run-through (party allocation, vault setup, deposit, claim, withdrawal) see `test/src/test/helpers/e2e-setup.ts` in this repo. For deeper rationale see [Architecture](#architecture).

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

- `SignatureRespondedEvent` — child-key ECDSA signature over the EVM tx hash. **You read it, reconstruct the signed EIP-1559 tx, and submit it via `eth_sendRawTransaction`.** The MPC never touches the destination-chain mempool.
- `RespondBidirectionalEvent` — root-key ECDSA signature over `keccak256(requestId ‖ serializedOutput)` plus the ABI-encoded return data (or a `0xdeadbeef`-prefixed payload on revert). You verify this signature on-ledger with `secp256k1WithEcdsaOnly` against the MPC root pubkey and act on `serializedOutput`.

Three rules to internalize before integrating:

1. **The MPC holds a single root secp256k1 key.** Per deployment, the MPC derives a *child* EVM key from the root + `(operatorsHash, path)`. The **child key controls funds on EVM** — its address is your deployment's "vault address". The **root key signs the on-Canton outcome proof** (`RespondBidirectionalEvent`).
2. **The MPC signs but does not broadcast.** Always you (the integrator) submit the signed EVM tx via `eth_sendRawTransaction`. The MPC just observes the receipt to drive the outcome.
3. **The Signer enforces operator-set isolation, not replay protection.** Single-use semantics, calldata domain checks, and deployment isolation (via `path`) are your job — see [Consumer responsibilities](#consumer-responsibilities).

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
2. The MPC **root** secp256k1 public key (uncompressed, hex). Used to verify `RespondBidirectionalEvent.signature` on-ledger and to derive your deployment's EVM child address off-ledger.

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
| `SignatureRespondedEvent.signature` | **child** key (derived from root + `(operatorsHash, path)`) | the EVM transaction hash | **The consumer reads it, reconstructs the signed EIP-1559 tx, and submits it via `eth_sendRawTransaction`.** Consumers typically do **not** verify this signature on-ledger. |
| `RespondBidirectionalEvent.signature` | **root** key | `responseHash = keccak256(requestId ‖ serializedOutput)` | The proof of execution + outcome. The consumer verifies this on-ledger and acts on `serializedOutput`. |

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

    -- Verify the outcome signature against the MPC ROOT public key (stored at deployment).
    let responseHash = computeResponseHash anchor.requestId outcome.serializedOutput
    assertMsg "Invalid MPC signature"
      (secp256k1WithEcdsaOnly (signatureDer outcome.signature) responseHash mpcRootPublicKey)

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

`mpcRootPublicKey` is the uncompressed secp256k1 public key (PublicKeyHex / SPKI form) you receive at integration time (see [Quickstart](#quickstart)). The `daml-vault` package stores it on the `Vault` contract as `evmMpcPublicKey` — the field name is historical; the value is the **root** key, not the EVM/child key.

### Failure modes

| Symptom | Meaning | Action |
| --- | --- | --- |
| `RespondBidirectionalEvent` arrives but `abiHasErrorPrefix outcome.serializedOutput` is `True` | EVM tx reverted; payload is `deadbeef` ‖ ABI-encoded error | Domain decision (refund, retry, surface error). |
| `secp256k1WithEcdsaOnly` returns `False` | Signature does not match `responseHash` under your stored root pubkey | Reject the claim. Either the wrong pubkey is stored or the response is forged — escalate, do not retry. |
| Only one of the two response events ever arrives | You haven't broadcast the signed tx yet (so no receipt to observe) or the destination chain hasn't confirmed it | Broadcast (or rebroadcast) the signed tx. There is no Canton-side timeout — add one in your consumer if you need it. |
| `Consume_*` exercised twice | Second exercise fails because the contract is already archived | Idempotent at your level (your claim choice should archive the anchor first, so a duplicate claim won't reach `Consume_*`). |
| Duplicate `SignBidirectionalEvent` with identical `requestId` | Replay attempt | Signing is RFC6979-deterministic, so duplicates produce identical signatures. Your single-use anchor prevents acting on it twice. |

### Consumer responsibilities

The Signer enforces operator-set hygiene only. The consumer must:

- **Replay-protect** repeated submissions of the same `SignRequest`. The Signer has no nonce, no nullifier set, and no approval state. See [Architecture → Authority model](#authority-model) for the patterns.
- **Validate `txParams.calldata`** at the domain level (e.g. ABI selector / argument checks). The Signer signs whatever bytes it is given.
- **Namespace `path`** when the same operator set is reused across multiple deployments — see [Architecture → Cross-operator-set isolation](#cross-operator-set-isolation).
- **Store the MPC root public key** at deployment time (typically on your equivalent of `Vault`). It is what `secp256k1WithEcdsaOnly` checks against.

## Minimum-viable consumer

If you just want to issue a single sign request and verify the outcome (no balance tracking, no multi-party setup), the smallest possible consumer is:

```daml
template SimpleConsumer
  with
    operators        : [Party]
    sigNetwork       : Party
    mpcRootPublicKey : PublicKeyHex
  where
    signatory operators
    observer sigNetwork

    nonconsuming choice Sign : (ContractId SignBidirectionalEvent, ContractId SimpleAnchor)
      with
        requester   : Party
        signerCid   : ContractId Signer
        evmTxParams : EvmType2TransactionParams
        path        : Text
      controller requester
      do
        let caip2Id = "eip155:" <> chainIdToDecimalText evmTxParams.chainId
        signReqCid <- create SignRequest with
          operators; requester; sigNetwork
          txParams = EvmType2TxParams evmTxParams
          caip2Id; keyVersion = 1; path
          algo = ""; dest = ""; params = ""
          outputDeserializationSchema = "[{\"name\":\"\",\"type\":\"bool\"}]"
          respondSerializationSchema  = "[{\"name\":\"\",\"type\":\"bool\"}]"
        signEventCid <- exercise signerCid SignBidirectional with
          signRequestCid = signReqCid; requester
        signEvent <- fetch signEventCid
        anchorCid <- create SimpleAnchor with
          operators; requester; sigNetwork
          requestId = requestIdFromSignEvent signEvent
        pure (signEventCid, anchorCid)

template SimpleAnchor
  with
    operators  : [Party]
    requester  : Party
    sigNetwork : Party
    requestId  : BytesHex
  where
    signatory operators
    observer requester, sigNetwork
```

Add a `Claim` choice that archives the anchor and runs the verification block from step 3, and you have a complete integration. For a real-world example with multi-party agreement, ABI-level calldata validation, optimistic balance updates, and refund-on-failure, see `daml-vault/daml/Erc20Vault.daml`.

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
| `path` | `Text` | KDF subkey path. Consumer namespaces by deployment id when reusing operator sets — see [Cross-operator-set isolation](#cross-operator-set-isolation). |
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

EVM-tx signature evidence. Created by `Signer.Respond`. The signature is the **child-key** ECDSA signature of the underlying EVM transaction hash; the **consumer** reads it, reconstructs the signed tx, and broadcasts it via `eth_sendRawTransaction`. Verification on Canton is done via `RespondBidirectionalEvent` (a separate signature over the outcome).

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

Outcome signature evidence. The signature is the **root-key** ECDSA signature of `responseHash = keccak256(requestId ‖ serializedOutput)`. **This is what the consumer verifies on-ledger** with `secp256k1WithEcdsaOnly`. `serializedOutput` is ABI-encoded return data on success, or `0xdeadbeef`+payload on failure (predicate `abiHasErrorPrefix` in `daml-abi`).

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

# Architecture

## Parties

| Party        | Role                               | Owns in this package           |
| ------------ | ---------------------------------- | ------------------------------ |
| `sigNetwork` | MPC infrastructure (single party)  | `Signer`, evidence contracts   |
| `operators`  | Consumer-side multi-sig `[Party]`  | Consumer templates (out of scope here) |
| `requester`  | End user / initiator               | —                              |

`sigNetwork` is both the MPC party identity AND the Signer operator. A consumer can have one or more operator parties (e.g. `[dex1, dex2, dex3]`); the Signer enforces only operator-set hygiene (`unique`, non-empty), not the consumer's multi-party agreement protocol.

## Layer overview

```
Signer (singleton)                    -- sigNetwork deploys, shares blob via disclosed contracts
  |
  +-- SignBidirectional               -- requester exercises (via the calling contract);
  |     controller: requester            delegates to SignRequest.Execute
  |
  +-- Respond                         -- sigNetwork publishes ECDSA signature for the underlying tx
  |     controller: sigNetwork
  |
  +-- RespondBidirectional            -- sigNetwork publishes outcome signature after confirmation
        controller: sigNetwork

SignRequest (transient)               -- created by a consumer choice body, consumed via Execute in same tx
                                         Execute computes `sender = computeOperatorsHash(operators)`
                                         from the on-ledger signatory set (NOT user-supplied)
SignBidirectionalEvent                -- what the MPC watches (signatory: operators, requester)
SignatureRespondedEvent               -- ECDSA signature evidence (signatory: sigNetwork)
RespondBidirectionalEvent             -- outcome signature evidence (signatory: sigNetwork)
```

The Signer layer **does not enforce signing uniqueness** — no Canton-side nonce, no used-`requestId` set, no Signer-side approval state. Replay prevention is the consumer's choice (see [Authority model](#authority-model) below).

## Key derivation

The MPC service holds threshold shares of a single root secp256k1 key pair. Per (`predecessorId`, `path`, `keyVersion`):

```
ε         = keccak256("sig.network v2.0.0 epsilon derivation:canton:global:{predecessorId}:{path}")
childPriv = (rootPriv + ε) mod n
childPub  = rootPub + ε·G                        -- consumers can derive this with deriveDepositAddress
```

`predecessorId` is `computeOperatorsHash(map partyToText operators)` (set by `SignRequest.Execute`, never caller-supplied). The KDF source-chain is hard-coded to `canton:global` — that's the source of the request, NOT the destination chain. `caip2Id` (the destination) enters `requestId`, not the KDF.

Two keys, two roles:

- The **child** secp256k1 keypair has an EVM address that holds funds on the destination chain. The MPC signs the EVM transaction with the child key (published in `SignatureRespondedEvent.signature`).
- The **root** key signs the on-Canton outcome proof: `secp256k1WithEcdsaOnly(rootSig, responseHash, rootPub)`. This is what the consumer verifies on-ledger; the consumer stores the root pubkey at deployment time.

The EVM child address is `derive_key(rootPub, epsilon)` where `epsilon` is the keccak above; flattening to an Ethereum address is the standard `keccak256(uncompressedPubKey[1..])[12..]`.

## Authority model

The Signer relies on Daml's flexible-controller pattern combined with disclosed contracts. A calling contract that needs a signature establishes this authority chain in a single transaction:

```
calling-contract choice (body authority: operators + requester)
  -> create SignRequest                       requires: operators (signatory) + requester (signatory) -- both available
  -> exercise Signer.SignBidirectional        requires: requester (controller); exercised on the disclosed Signer
     -> SignRequest.Execute                   body authority: operators (signatory) + requester (controller)
        -> SignBidirectionalEvent             signatory: operators, requester -- exact authority match
```

Constraints the Signer enforces:

1. `SignRequest` requires `operators` and `requester` as signatories — only a calling contract that already holds both authorities can create one.
2. `Signer` is exercised through a disclosed contract — `requester` is a flexible controller, so no explicit `sigNetwork` delegation is needed at exercise time.
3. `SignRequest.Execute`'s body computes `sender = computeOperatorsHash (map partyToText operators)` from the on-ledger signatory list — `sender` cannot be supplied by the caller.
4. `SignBidirectionalEvent`'s `ensure` clause re-checks `sender == computeOperatorsHash (...)` regardless of how the event was created.

What the Signer does **not** enforce, and which the consumer must:

- **Replay protection** across submissions of the same `SignRequest`. The Signer has no nonce, no nullifier set, and no approval-tracking state. Consumers pick the mechanism that fits their threat model — common choices include:
    - a single-use anchor template (one anchor contract per request, archived on completion — the pattern used by [`daml-vault`](../daml-vault/README.md)'s `PendingDeposit` / `PendingWithdrawal`);
    - a registry contract that records every used `requestId` (a nullifier set);
    - off-chain operator enforcement via a request-approve flow before the consumer ever creates the `SignRequest`;
    - or relying on the destination chain's transaction nonce when a duplicate sign is harmless — signing is RFC6979-deterministic, so a duplicate `SignBidirectionalEvent` produces an identical signature and only one destination-chain tx can ever land.
- Operator-set + deployment isolation when the same operator set is reused across multiple deployments — see [Cross-operator-set isolation](#cross-operator-set-isolation).
- Domain validation of `txParams.calldata` (e.g. ABI selector / argument checks). The Signer signs whatever bytes it is given.

## Cross-operator-set isolation

`sender` (the KDF predecessorId) is computed in `SignRequest.Execute` as `computeOperatorsHash (map partyToText operators)` — directly from the on-ledger `operators` signatory list. Since Canton party IDs are globally unique (`hint::sha256(namespace_key)`), two different operator sets can never produce the same `sender` even with identical `txParams`.

```
sender = computeOperatorsHash(map partyToText operators)
computeOperatorsHash = keccak256(concat(map (keccak256 . toHex) (sort operatorTexts)))
```

The caller never supplies `sender`; it is derived from authority that the caller provably holds. The MPC's KDF and the `requestId` hash both depend on `sender`, so the MPC signature is transitively bound to the full operator set — stripping or reordering operators breaks verification.

`SignBidirectionalEvent`'s `ensure` clause re-checks `sender == computeOperatorsHash(...)` — defence-in-depth against any future code path that would create the event without going through `Execute`.

### Consumer responsibility: `path` namespacing

The Signer **only** isolates operator sets, not deployments. Two consumer contracts that share the same operator set will share the same `sender`, and so the same key namespace, unless the consumer namespaces its requests via `path`. Since `path` feeds both the KDF and `requestId`, encoding a deployment identifier into `path` (the convention in `daml-vault` is to prefix with `vaultId`) gives different derived keys per deployment even with identical operators. The Signer cannot enforce this — it is a contract between the consumer and the MPC service.

## Security model

`SignBidirectionalEvent` has `signatory operators, requester` — `sigNetwork` is only an observer. A misbehaving `sigNetwork` therefore cannot create one of these directly; only a `requester` exercising a choice on a contract that already holds `operators` signatory authority can. The `Respond` and `RespondBidirectional` choices fetch the `SignBidirectionalEvent` and re-derive `(operators, requester, requestId)` from it, so even if `sigNetwork` exercises them with mismatched arguments, the choice body asserts the values match — a signature cannot be misattributed to a different operator set / requester / request than the one that actually produced the event.

The on-ledger `secp256k1WithEcdsaOnly` check binds every accepted outcome to your stored MPC root pubkey, so a forged `RespondBidirectionalEvent` is rejected at the consumer's claim choice.

Signing is RFC6979-deterministic, so a duplicate `SignBidirectionalEvent` produces an identical signature; combined with the consumer's single-use anchor, that means at most one destination-chain tx ever lands per request.

## Design decisions

- **No Signer-layer nonce.** The Signer enforces only that distinct operator sets cannot share a key namespace (by computing `sender = operatorsHash` from on-ledger signatories inside `SignRequest.Execute`, not by trusting caller input). Replay prevention is delegated to your consumer — pick whichever mechanism fits (single-use anchor, used-`requestId` registry, etc.).
- **`Respond*` takes a `signEventCid`, not raw fields.** The choice fetches the event and re-derives `(operators, requester, requestId)` from it; a misbehaving `sigNetwork` cannot misattribute a signature.
- **`SignBidirectionalEvent` re-checks `sender`.** Defence in depth against any future code path that creates the event without going through `Execute`.
- **Two signatures per request.** The child-key signature in `SignatureRespondedEvent` is what you assemble into the signed EIP-1559 tx and submit via `eth_sendRawTransaction`; the root-key signature in `RespondBidirectionalEvent` is the on-Canton outcome proof you verify with `secp256k1WithEcdsaOnly`. Splitting them lets you verify outcomes against a single, stable root pubkey without per-deployment key bookkeeping, and keeps the MPC service out of the destination-chain mempool.
