# signet-signer-v1 — API reference

_Part of [`signet-signer-v1`](./README.md) — templates, data types, helpers, and the `requestId`/`responseHash` formulas. For the lifecycle and integrator obligations, start at the [README](./README.md)._

## Templates

### `Signer`

Singleton identity contract; disclosed off-chain (see the [Quickstart](./README.md#quickstart)).

- Signatory: `sigNetwork, sigNetworkFA`
- Fields: `sigNetwork : Party`, `sigNetworkFA : Party`

| Choice             | Type         | Controller             | Args                                                                                                      | Returns                             |
| ------------------ | ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `RequestSignature` | nonconsuming | `operators, requester` | the request fields (table below) + the three fee args (`feeRegistrationCid`, `feeInputs`, `feeExtraArgs`) | `ContractId SignBidirectionalEvent` |

`Respond` and `RespondBidirectional` (both nonconsuming, controller `sigNetwork`) are the MPC-side choices that create `SignatureRespondedEvent` / `RespondBidirectionalEvent`; integrators never exercise them.

`RequestSignature` charges the CC signature fee (fail-closed — see [CC signature fee](./README.md#cc-signature-fee)), derives `sender = computeOperatorsHash (map partyToText operators)` from the on-ledger operators, and creates the `SignBidirectionalEvent`, all in one transaction.

`RequestSignature` request fields (also the fields stamped onto `SignBidirectionalEvent`; note there is no `sigNetwork` arg — the `Signer` knows its own):

| Field                         | Type       | Notes                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operators`                   | `[Party]`  | Operator multi-sig. Non-empty, unique. Sorted internally for hashing — caller order doesn't matter.                                                                                                                                                                           |
| `requester`                   | `Party`    | Initiator. Becomes co-signatory of `SignBidirectionalEvent`.                                                                                                                                                                                                                  |
| `txParams`                    | `TxParams` | Chain-agnostic transaction wrapper.                                                                                                                                                                                                                                           |
| `caip2Id`                     | `Text`     | **Destination** chain CAIP-2 id, e.g. `"eip155:1"` (mainnet) or `"eip155:11155111"` (Sepolia). Build as `"eip155:" <> chainIdToDecimalText chainId` (from `signet-eip712`). The deployed MPC currently accepts only `"eip155:1"` (see `signet-vault-v1`'s test-mode pinning). |
| `keyVersion`                  | `Int`      | KDF version. Use `1` (the latest supported).                                                                                                                                                                                                                                  |
| `path`                        | `Text`     | KDF subkey path. Consumer namespaces by deployment id when reusing operator sets ([security checklist](./SECURITY.md) #3). The Signer cannot enforce this.                                                                                                                    |
| `algo`                        | `Text`     | Opaque; hashed into `requestId` — no current code path branches on it. In-repo consumers pass `"ECDSA"`.                                                                                                                                                                      |
| `dest`                        | `Text`     | Same; in-repo consumers pass `"ethereum"`.                                                                                                                                                                                                                                    |
| `params`                      | `Text`     | Same; in-repo consumers pass `""`.                                                                                                                                                                                                                                            |
| `outputDeserializationSchema` | `Text`     | JSON ABI fragment, e.g. `[{"name":"","type":"bool"}]`. Tells the MPC how to decode the traced return data of the destination call.                                                                                                                                            |
| `respondSerializationSchema`  | `Text`     | Schema the MPC uses to encode the decoded output into `serializedOutput`.                                                                                                                                                                                                     |

### `SignerProposal`

Two-party creation ceremony for the `Signer`: `sigNetwork` proposes, `sigNetworkFA` accepts. Deployment-side — integrators never exercise it.

- Signatory: `sigNetwork`
- Observer: `sigNetworkFA`
- Fields: `sigNetwork : Party`, `sigNetworkFA : Party`

| Choice         | Type      | Controller     | Args | Returns             |
| -------------- | --------- | -------------- | ---- | ------------------- |
| `AcceptSigner` | consuming | `sigNetworkFA` | —    | `ContractId Signer` |

### Fee packages

The fee surface lives outside `signet-signer-v1`:

| Package             | Contents                                                                    |
| ------------------- | --------------------------------------------------------------------------- |
| `signet-api-fee-v1` | `FeeCollector` interface, `FeeCollector_Charge`, `FeeCollectorRegistration` |
| `signet-fee-amulet` | `CcFeeCollector` (charge logic), `FeePriceConfig` (rotating price)          |

`RequestSignature` only ever sees the frozen API: it validates the registration and exercises
`FeeCollector_Charge`. Everything else (pricing, settlement policy, the token-standard dependency)
is the implementation package's business. Stability and upgrade rules: see [`FEE.md`](./FEE.md).

### `SignBidirectionalEvent`

Created by `Signer.RequestSignature`. **What the MPC watches.**

- Signatory: `operators, requester, sigNetworkFA`
- Observer: `sigNetwork`
- Ensure: `not (null operators) && unique operators && sender == computeOperatorsHash (map partyToText operators) && validTxParams txParams`

Fields: the `RequestSignature` request fields (table above) plus `sigNetwork : Party`, `sigNetworkFA : Party` and `sender : BytesHex` (= `operatorsHash`, set by `RequestSignature`).

| Choice                      | Type      | Controller                                                 | Args            |
| --------------------------- | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_SignBidirectional` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

Keep `signEventCid` on your pending anchor and exercise `Consume_SignBidirectional` **only in the final claim/completion transaction**, after the response evidence has been validated and consumed — exercising it earlier would delete a request the MPC has not yet answered (forfeiting the already-paid fee).

### `SignatureRespondedEvent`

Request-signature evidence. Created by `Signer.Respond`, signed by the **request child** key (`sender = operatorsHash`, request `path`); the consumer uses it according to its downstream-chain submission flow. See [Integrator lifecycle § 2](./README.md#2-the-mpc-service-responds-off-canton-asynchronous) for the key/usage table.

- Signatory: `sigNetwork, sigNetworkFA`
- Observer: `operators, requester`
- Ensure: `isBytesN 32 requestId && validSignature signature`

| Field                                                  | Type                  |
| ------------------------------------------------------ | --------------------- |
| `sigNetwork`, `sigNetworkFA`, `requester`, `responder` | `Party`               |
| `operators`                                            | `[Party]`             |
| `requestId`                                            | `BytesHex` (32 bytes) |
| `signature`                                            | `Signature`           |

| Choice                       | Type      | Controller                                                 | Args            |
| ---------------------------- | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_SignatureResponded` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

### `RespondBidirectionalEvent`

Outcome signature evidence. Created by `Signer.RespondBidirectional`, signed by the **response-verification child** key (`sender = operatorsHash`, `path = "canton response key"`) over `responseHash = keccak256(requestId ‖ serializedOutput)`; the consumer verifies it on-ledger with `secp256k1WithEcdsaOnly` against its stored `mpcResponseVerifyKey`. `serializedOutput` is ABI-encoded return data on success, or `0xdeadbeef`+payload on failure (`abiHasErrorPrefix` in `signet-abi`). See [Integrator lifecycle § 2](./README.md#2-the-mpc-service-responds-off-canton-asynchronous).

- Signatory: `sigNetwork, sigNetworkFA`
- Observer: `operators, requester`
- Ensure: `isBytesN 32 requestId && isCanonicalHex serializedOutput && validSignature signature`

| Field                                                  | Type                  |
| ------------------------------------------------------ | --------------------- |
| `sigNetwork`, `sigNetworkFA`, `requester`, `responder` | `Party`               |
| `operators`                                            | `[Party]`             |
| `requestId`                                            | `BytesHex` (32 bytes) |
| `serializedOutput`                                     | `BytesHex`            |
| `signature`                                            | `Signature`           |

| Choice                         | Type      | Controller                                                 | Args            |
| ------------------------------ | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_RespondBidirectional` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

## Data types

### `EvmTypes.daml`

```haskell
data EvmAccessListEntry = EvmAccessListEntry with
    address     : BytesHex          -- 20 bytes
    storageKeys : [BytesHex]        -- each 32 bytes

data EvmType2TransactionParams = EvmType2TransactionParams with
    chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit : BytesHex            -- each 32-byte uint256
    to                                                           : Optional BytesHex   -- None = contract creation; Some 20-byte address
    value                                                        : BytesHex            -- 32-byte uint256
    calldata                                                     : BytesHex            -- raw EVM calldata, no 0x prefix; "" allowed
    accessList                                                   : [EvmAccessListEntry]
```

### `TxParams.daml`

```haskell
data TxParams = EvmType2TxParams EvmType2TransactionParams
```

Single constructor today; `BtcTxParams` / `SolTxParams` slot in the future.

### `Signer.daml`

```haskell
data EcdsaSigData = EcdsaSigData with
    der        : SignatureHex   -- DER-encoded (r, s)
    recoveryId : Int            -- 0 or 1

data Signature = EcdsaSig EcdsaSigData
-- future variants: EddsaSig, SchnorrSig
```

## Helpers

### `Signer.daml`

| Symbol                   | Type                                 | Use                                                  |
| ------------------------ | ------------------------------------ | ---------------------------------------------------- |
| `signatureDer`           | `Signature -> SignatureHex`          | Extract DER bytes for `secp256k1WithEcdsaOnly`       |
| `validSignature`         | `Signature -> Bool`                  | Predicate used by evidence-contract `ensure` clauses |
| `requestIdFromSignEvent` | `SignBidirectionalEvent -> BytesHex` | Recompute `requestId` from a fetched event           |

### `RequestId.daml`

| Symbol                 | Type                                                                          | Use                                                                |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `computeOperatorsHash` | `[Text] -> BytesHex`                                                          | `keccak256(concat (map (keccak256 . toHex) (sort operatorTexts)))` |
| `computeRequestId`     | `Text -> TxParams -> Text -> Int -> Text -> Text -> Text -> Text -> BytesHex` | Full sign-request commitment (formula below)                       |
| `computeResponseHash`  | `BytesHex -> BytesHex -> BytesHex`                                            | `keccak256(requestId ‖ output)`                                    |
| `hashTxParams`         | `TxParams -> BytesHex`                                                        | Per-chain dispatch                                                 |

### `EvmTypes.daml`

| Symbol                           | Type                                | Use                          |
| -------------------------------- | ----------------------------------- | ---------------------------- |
| `isBytesN`                       | `Int -> BytesHex -> Bool`           | Length-checked canonical hex |
| `isCanonicalHex`                 | `BytesHex -> Bool`                  | Even-length hex (or empty)   |
| `isEvmUInt256`                   | `BytesHex -> Bool`                  | 32-byte canonical hex        |
| `validOptionalAddress`           | `Optional BytesHex -> Bool`         | `None` or 20-byte address    |
| `validAccessListEntry`           | `EvmAccessListEntry -> Bool`        | Per-entry validator          |
| `validEvmType2TransactionParams` | `EvmType2TransactionParams -> Bool` | Full record validator        |

### `TxParams.daml`

| Symbol          | Type               | Use                          |
| --------------- | ------------------ | ---------------------------- |
| `validTxParams` | `TxParams -> Bool` | Per-chain dispatch validator |

## `requestId` and `responseHash` formulas

```
requestId = keccak256(
    eip712EncodeString  sender                    -- = operatorsHash, set by RequestSignature
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

Every implementation that mirrors this off-Canton must produce byte-identical hashes — verify cross-language with golden vectors before integrating. The Daml vectors live in `signet-signer-v1-tests/daml/TestRequestId.daml`; the DevNet e2e asserts the TS mirror against the on-ledger `requestId` at runtime.
