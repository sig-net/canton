# daml-uint256

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
  - ../daml-uint256/.daml/dist/daml-uint256-0.0.1.dar
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

## Reference Implementations

The implementation design and test suite are inspired by established uint256 / bignum libraries:

| Library                                                                                                        | Language   | What we drew from                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [Go `math/big`](https://pkg.go.dev/math/big)                                                                   | Go         | Limb-based representation, schoolbook multiplication, carry/borrow chain patterns                                                          |
| [holiman/uint256](https://github.com/holiman/uint256)                                                          | Go         | Fixed-width 256-bit overflow detection, `AddOverflow`/`SubOverflow`/`MulOverflow` boundary tests, 41 `binTestCases` pairs                  |
| [CPython `int`](https://github.com/python/cpython/blob/main/Lib/test/test_long.py)                             | Python     | `test_long.py` squaring sweep `(2^k-1)^2` identity, Karatsuba threshold tests, algebraic property checks                                   |
| [parity-common `uint`](https://github.com/parity-tech/parity-common)                                           | Rust       | Checked arithmetic patterns, EVM-specific uint256 test vectors                                                                             |
| [TypeScript `BigInt`](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/BigInt) | TypeScript | Oracle for all test vectors — every hardcoded hex value in `TestUInt256.daml` is generated and verified against native `BigInt` arithmetic |

## Cross-language Test Vectors

The test suite uses a two-file oracle pattern:

- **`test/uint256-vectors.test.ts`** (2,392 tests) — TypeScript `BigInt` computes expected values for every operation (add, sub, mul, div, compare, checked variants). Includes 500 frozen fuzz vectors from a deterministic keccak256 PRNG, squaring sweeps, Karatsuba identity checks, and Euler expansion.
- **`TestUInt256.daml`** (72 test functions) + **`TestFuzz.daml`** (4 fuzz suites, 500 vectors each) + **`TestProperties.daml`** (22 property-based tests) + **`TestDivByZero.daml`** (1 error-path test) — Daml asserts identical hex results against the TS oracle.

TS and Daml test vectors must stay in sync — any change must be reflected in both.

## Build & Test

From the repo root:

```bash
dpm build --all
pnpm run daml:test
```

Tests live in `daml-uint256-tests` (Daml) and `test/` (TS oracle, `pnpm test`).
