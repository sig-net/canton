# daml-eip712

EIP-712-style primitive encoders for cross-language deterministic hashing in Daml.

> **Not a full EIP-712 implementation.** There is no domain separator and no struct-hash machinery. The Canton MPC stack hashes flat `keccak256(concat(encoded fields))` where each field is encoded by the same per-type rule EIP-712 uses for primitives (string → keccak, uint/address → 32-byte left-pad, bytes → keccak). This is enough to commit to all the fields the MPC service needs and is byte-identical between Daml, TypeScript, and Rust without anyone implementing the full EIP-712 type-graph.

Used by [`daml-signer`](../daml-signer/README.md)'s `RequestId.daml`. Any off-Canton implementation that recomputes `requestId` must apply these encoders in the same order — see [Worked example](#worked-example-how-requestid-composes).

## Encoding rules

| Field type | Helper | Bytes |
| --- | --- | --- |
| `string` | `eip712EncodeString : Text -> BytesHex` | `keccak256(utf8(text))` (32 bytes; `"" → keccak256Empty`) |
| `uint256` | `eip712EncodeUint256 : BytesHex -> BytesHex` | left-pad hex to 32 bytes |
| `address` | `eip712EncodeAddress : BytesHex -> BytesHex` | left-pad hex to 32 bytes |
| `bytes` | `eip712EncodeBytes : BytesHex -> BytesHex` | `keccak256(rawBytes)` (32 bytes; `"" → keccak256Empty`) |
| `bytes[]` | `eip712EncodeBytesArray : [BytesHex] -> BytesHex` | `keccak256(concat (map keccak256 items))` (32 bytes; `[] → keccak256Empty`) |

`safeKeccak256` is the empty-input-aware keccak; it returns the precomputed `keccak256("")` value (`keccak256Empty`) instead of failing on `""`. Use it whenever an input may legitimately be empty.

## Worked example: how `requestId` composes

`computeRequestId` in `daml-signer/daml/RequestId.daml` is just:

```daml
keccak256 $
     eip712EncodeString  sender                      -- 32B
  <> hashTxParams        txParams                    -- 32B (per-tx-type keccak)
  <> eip712EncodeString  caip2Id                     -- 32B
  <> eip712EncodeUint256 (toHex keyVersion)          -- 32B
  <> eip712EncodeString  path                        -- 32B
  <> eip712EncodeString  algo                        -- 32B
  <> eip712EncodeString  dest                        -- 32B
  <> eip712EncodeString  params                      -- 32B
```

## API

### Encoders

- `eip712EncodeString : Text -> BytesHex`
- `eip712EncodeUint256 : BytesHex -> BytesHex`
- `eip712EncodeAddress : BytesHex -> BytesHex`
- `eip712EncodeBytes : BytesHex -> BytesHex`
- `eip712EncodeBytesArray : [BytesHex] -> BytesHex`

### Keccak utilities

- `safeKeccak256 : BytesHex -> BytesHex` — `keccak256` with the empty-input fixup.
- `keccak256Empty : BytesHex` — the precomputed `keccak256("")` (`c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470`).

### Hex utilities

- `padLeft : BytesHex -> Int -> BytesHex` — left-pad to the given byte width.
- `assertBytes32 : BytesHex -> BytesHex` — assert the value is exactly 32 bytes; aborts otherwise.
- `ensureEvenHex : BytesHex -> BytesHex` — prepend `"0"` if the length is odd.
- `hexToInt : BytesHex -> Int` — parse a hex string into an `Int`.
- `chainIdToDecimalText : BytesHex -> Text` — `"00…aa36a7" → "11155111"`. Combine with the `"eip155:"` prefix at the call site to get the CAIP-2 id.

## Usage

```yaml
# daml.yaml
data-dependencies:
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

```daml
import DA.Crypto.Text (BytesHex, keccak256)
import Eip712 (eip712EncodeString, eip712EncodeUint256, chainIdToDecimalText)

myCommitment : Text -> BytesHex -> BytesHex
myCommitment label amount =
  keccak256 (eip712EncodeString label <> eip712EncodeUint256 amount)
```

