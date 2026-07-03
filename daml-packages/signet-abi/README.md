# signet-abi

EVM ABI **decoding** for Daml. Provides slot-based access to ABI-encoded calldata and return data, covering static types (uint, int, bool, address, bytesN), dynamic types (bytes, string, arrays), nested tuples, and function selector checks.

Full ABI encoding and event log decoding are not supported.

## Slot Indices vs Byte Offsets

The library uses two addressing modes:

- **Slot index** (`Int`): 0-indexed position of a 32-byte slot. Used by `abiSlot`, `abiDecodeUint`, `abiDecodeInt`, `abiDecodeBool`, `abiDecodeAddress`, `abiDecodeBytesN`, and `abiReadOffset`.
- **Byte offset** (`Int`): byte position within the data. Used by `abiDecodeBytes`, `abiDecodeString`, `abiDecodeArrayLen`, `abiDecodeArrayElem`, `abiDecodeArrayDynElem`, `abiDecodeFixedArrayDynElem`, and `abiDecodeTupleDynMember`.

Typical pattern: read an offset pointer via `abiReadOffset` (slot index in), then pass the returned byte offset to a dynamic decoder:

```daml
let offset = abiReadOffset hex 1       -- slot index → byte offset
let name   = abiDecodeString hex offset -- byte offset → decoded value
```

## API Reference

### Calldata

- `abiSelector : BytesHex -> BytesHex` -- extract 4-byte function selector. Errors if data < 4 bytes.
- `functionSelector : Text -> BytesHex` -- compute the 4-byte selector for a Solidity function signature, which must already be in canonical ABI form (no spaces or parameter names, aliases spelled out — e.g. `transfer(address,uint256)`).
- `abiSelectorMatches : Text -> BytesHex -> Bool` -- check calldata selector against a Solidity function signature.
- `abiStripSelector : BytesHex -> BytesHex` -- strip selector, leaving ABI payload. Errors if data < 4 bytes.

### Slot Access

- `abiSlot : BytesHex -> Int -> BytesHex` -- read the i-th 32-byte slot (0-indexed). Errors if out of bounds.
- `abiSlotCount : BytesHex -> Int` -- number of complete 32-byte slots in the data.
- `abiHasExactSlotCount : Int -> BytesHex -> Bool` -- validate exact slot count with no partial trailing data.

### Static Type Decoders

All take a slot index and error on out-of-bounds, except `isAbiAddressSlot` / `abiAddressSlotToAddress`, which take the 32-byte slot value itself.

- `abiDecodeUint : BytesHex -> Int -> BytesHex` -- decode uint (any width) at slot i. Returns raw 32-byte hex.
- `abiDecodeInt : BytesHex -> Int -> BytesHex` -- decode int (two's complement) at slot i. Returns raw 32-byte hex. Use `hexCompareInt` from `signet-uint256/HexCompare` for signed comparisons.
- `abiDecodeBool : BytesHex -> Int -> Bool` -- decode bool at slot i (strict per the ABI spec: only the canonical all-zero / `…01` slots; anything else errors).
- `abiDecodeAddress : BytesHex -> Int -> BytesHex` -- decode address at slot i (20 bytes). Errors if the 12-byte zero padding is non-zero.
- `isAbiAddressSlot : BytesHex -> Bool` -- validate a 32-byte ABI-encoded address slot with zero high bytes.
- `abiAddressSlotToAddress : BytesHex -> BytesHex` -- extract the 20-byte address from a canonical ABI address slot.
- `abiDecodeBytesN : BytesHex -> Int -> Int -> BytesHex` -- decode bytesN at slot i. Errors if n is outside 0..32.

### Dynamic Type Decoders

These take byte offsets (except `abiReadOffset` which takes a slot index). Byte offsets must be non-negative multiples of 32; anything else errors.

- `abiReadOffset : BytesHex -> Int -> Int` -- read offset pointer at **slot index** i. Returns a byte offset. Errors on overflow (>= 2^63).
- `abiDecodeBytes : BytesHex -> Int -> BytesHex` -- decode dynamic bytes at byte offset. Errors if claimed length exceeds available data.
- `abiDecodeString : BytesHex -> Int -> Text` -- decode dynamic string (UTF-8) at byte offset. Errors on invalid UTF-8.
- `abiDecodeArrayLen : BytesHex -> Int -> Int` -- array length at byte offset. Errors on overflow.
- `abiDecodeArrayElem : BytesHex -> Int -> Int -> BytesHex` -- j-th element of static-element array. Errors if j is out of bounds.
- `abiDecodeArrayDynElem : BytesHex -> Int -> Int -> Int` -- resolve j-th element of dynamic-element array. Errors if j is out of bounds.
- `abiDecodeFixedArrayDynElem : BytesHex -> Int -> Int -> Int` -- resolve j-th element of fixed-size dynamic-element array. Caller must validate j < k (fixed arrays have no on-chain length).
- `abiDecodeTupleDynMember : BytesHex -> Int -> Int -> Int` -- resolve dynamic member within a tuple.

### Error Handling

- `abiHasErrorPrefix : BytesHex -> Bool` -- check for `deadbeef` error magic prefix. Returns False for short/empty input.
- `abiStripErrorPrefix : BytesHex -> BytesHex` -- strip 4-byte error prefix. Errors if data < 4 bytes or the prefix is not the `deadbeef` magic.

### Constants

- `slotBytes : Int` -- 32 (bytes per ABI slot)
- `zeroSlot : BytesHex` -- 32-byte zero slot
- `oneSlot : BytesHex` -- 32-byte slot encoding 1 (canonical ABI bool true)

## Dependencies

- `daml-prim`, `daml-stdlib` (the only dependencies)
- Optional: signed integer comparisons via the sibling `signet-uint256` package (`HexCompare.hexCompareInt`)

## Usage

Add to your `daml.yaml`:

```yaml
data-dependencies:
  - ../signet-abi/.daml/dist/signet-abi-0.0.1.dar
```

```daml
import Abi (abiStripSelector, abiDecodeAddress, abiDecodeUint, abiDecodeBool)

-- Decode transfer(address,uint256) calldata
let payload = abiStripSelector calldata
let recipient = abiDecodeAddress payload 0
let amount = abiDecodeUint payload 1

-- Decode ERC20 transfer return data (bool success)
let success = abiDecodeBool returnData 0
```

## Build & Test

From the repo root:

```bash
dpm build --all
pnpm run daml:test
```

Daml tests live in `signet-abi-tests`; a co-located viem oracle suite (`test/abi.test.ts`, run via `pnpm test`) cross-checks the same vectors.
