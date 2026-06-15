# signet-uint256

Limb-based unsigned 256-bit integer arithmetic for Daml. Uses 10 limbs in base 2^28 (little-endian), matching the GMP/Python bignum approach adapted for Daml's 64-bit `Int`.

## Modules

- `UInt256` -- 256-bit arithmetic: add, sub, mul, compare, short division, hex conversion
- `HexCompare` -- unsigned and signed (two's complement) comparison of hex-encoded values

## API Reference

### UInt256 Type and Constants

- `UInt256` -- record with `limbs : [Int]` (10 limbs, little-endian)
- `uint256Zero`, `uint256One`, `uint256Max` -- common constants

### Hex Conversion

- `uint256FromHex : BytesHex -> UInt256` -- parse hex (up to 64 chars; errors past 64) into UInt256
- `uint256ToHex : UInt256 -> BytesHex` -- convert to 64-char lowercase hex

### Arithmetic (mod 2^256, wrapping)

- `uint256Add`, `uint256Sub`, `uint256Mul` -- wrapping arithmetic
- `uint256AddChecked`, `uint256SubChecked`, `uint256MulChecked` -- return `(result, Bool)` overflow/underflow flag

### Short Division

- `uint256DivInt : UInt256 -> Int -> (UInt256, Int)` -- divide by positive Int < 2^28, returns (quotient, remainder)

### Comparison

- `uint256Compare : UInt256 -> UInt256 -> Ordering`
- `uint256Eq`, `uint256Gt`, `uint256Gte`, `uint256Lt`, `uint256Lte`, `uint256IsZero`

### BytesHex Convenience

- `hexAddUint256`, `hexSubUint256`, `hexMulUint256` -- operate directly on hex strings

### HexCompare

- `hexCompareUint`, `hexCompareInt` -- compare same-length hex values (unsigned / signed)
- `hexEqUint`, `hexGtUint`, `hexGteUint`, `hexLtUint`, `hexLteUint`
- `hexIsZero`, `hexPadUint256` -- utilities

## Dependencies

- `daml-prim`, `daml-stdlib`

## Usage

Add to your `daml.yaml`:

```yaml
data-dependencies:
  - ../signet-uint256/.daml/dist/signet-uint256-0.0.1.dar
```

```daml
import UInt256 (uint256FromHex, uint256Add, uint256ToHex)
import HexCompare (hexGtUint)

let a = uint256FromHex "0de0b6b3a7640000"  -- 1e18
let b = uint256FromHex "0de0b6b3a7640000"
let sum = uint256ToHex (uint256Add a b)
-- "0000000000000000000000000000000000000000000000001bc16d674ec80000"

let isGreater = hexGtUint sum "0000000000000000000000000000000000000000000000000de0b6b3a7640000"  -- True
```

## Limitations

Full uint256/uint256 division (`uint256Div`, `uint256Mod`, `uint256DivMod`) is not implemented. Use `uint256DivInt` for divisors that fit in a single limb (< 2^28).

## Build & Test

From the repo root:

```bash
dpm build --all
pnpm run daml:test
```

The implementation is oracle-tested against TypeScript `BigInt`: the Daml suites in `signet-uint256-tests` assert byte-identical results against the vectors in this package's `test/uint256-vectors.test.ts` (`pnpm test`). That oracle file documents the suite map and vector provenance, and the two sides must stay in sync.
