import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Cross-language vectors (oracle: TypeScript BigInt)
// Must match daml/TestUInt256.daml
// ---------------------------------------------------------------------------

const UINT256_MAX = (1n << 256n) - 1n;

function toHex256(n: bigint): string {
  return (n & UINT256_MAX).toString(16).padStart(64, "0");
}

// ---------------------------------------------------------------------------
// Vector constants — no 0x prefix, 64 lowercase hex chars (Daml convention)
// ---------------------------------------------------------------------------

const VECTORS = {
  // --- Constants ---
  zero: "0000000000000000000000000000000000000000000000000000000000000000",
  one: "0000000000000000000000000000000000000000000000000000000000000001",
  two: "0000000000000000000000000000000000000000000000000000000000000002",
  three: "0000000000000000000000000000000000000000000000000000000000000003",
  seven: "0000000000000000000000000000000000000000000000000000000000000007",
  twentyOne: "0000000000000000000000000000000000000000000000000000000000000015",
  max: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",

  // --- Limb boundaries (base 2^28) ---
  limbMax: "000000000000000000000000000000000000000000000000000000000fffffff",
  limbBase: "0000000000000000000000000000000000000000000000000000000010000000",

  // --- Powers of two ---
  pow128: "0000000000000000000000000000000100000000000000000000000000000000",
  pow129: "0000000000000000000000000000000200000000000000000000000000000000",

  // --- EVM values ---
  oneEth: "0000000000000000000000000000000000000000000000000de0b6b3a7640000",
  twoEth: "0000000000000000000000000000000000000000000000001bc16d674ec80000",
  oneUsdc: "00000000000000000000000000000000000000000000000000000000000f4240",
  oneTrillion: "000000000000000000000000000000000000000000000000000000e8d4a51000",
  gasPrice20Gwei: "00000000000000000000000000000000000000000000000000000004a817c800",
  gasCost21k: "00000000000000000000000000000000000000000000000000017dfcdece4000",

  // --- Division results ---
  maxDiv2Quotient: "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",

  // --- Addition results ---
  addOnePlusOne: "0000000000000000000000000000000000000000000000000000000000000002",
  addLimbCarry: "0000000000000000000000000000000000000000000000000000000010000000",
  addOverflow: "0000000000000000000000000000000000000000000000000000000000000000",
  addOneEthPlusOneEth: "0000000000000000000000000000000000000000000000001bc16d674ec80000",

  // --- Subtraction results ---
  subTwoMinusOne: "0000000000000000000000000000000000000000000000000000000000000001",
  subLimbBorrow: "000000000000000000000000000000000000000000000000000000000fffffff",
  subUnderflow: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",

  // --- Multiplication results ---
  mulThreeTimesSeven: "0000000000000000000000000000000000000000000000000000000000000015",
  mulOneEthTimesTwo: "0000000000000000000000000000000000000000000000001bc16d674ec80000",
  mulPow128Squared: "0000000000000000000000000000000000000000000000000000000000000000",
  mulMaxTimesMax: "0000000000000000000000000000000000000000000000000000000000000001",

  // --- Short division results ---
  divMaxBy2Quotient: "7fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  divOneEthBy1e6Quotient: "000000000000000000000000000000000000000000000000000000e8d4a51000",
  divSevenByTwoQuotient: "0000000000000000000000000000000000000000000000000000000000000003",

  // --- Additional powers of two ---
  pow56: toHex256(1n << 56n),
  pow140: toHex256(1n << 140n),
  pow252: toHex256(1n << 252n),
  pow255: toHex256(1n << 255n),

  // --- Limb-range maxima ---
  lower2LimbsMax: toHex256((1n << 56n) - 1n),
  lowerFiveLimbsMax: toHex256((1n << 140n) - 1n),
  lower9LimbsMax: toHex256((1n << 252n) - 1n),

  // --- Alternating bit patterns ---
  patternA: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  pattern5: "5555555555555555555555555555555555555555555555555555555555555555",

  // --- 128-bit boundary ---
  pow128MinusOne: toHex256((1n << 128n) - 1n),
  pow128PlusOne: toHex256((1n << 128n) + 1n),

  // --- Multiplication index boundary ---
  limbMaxTimesLimbBase: toHex256(((1n << 28n) - 1n) * (1n << 28n)),

  // --- Short division edge ---
  divMaxByLimbMaxQuotient: "0000001000000100000010000001000000100000010000001000000100000010",

  // --- Audit vectors: addChecked / mulChecked / subChecked ---
  maxMinusOne: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffe",
  subThreeMinusSeven: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffc",
  oneMinusPow128: "ffffffffffffffffffffffffffffffff00000000000000000000000000000001",

  // --- Audit vectors: Karatsuba ---
  karatsubaResult: "fffffffffffffffffffffffffffffffe00000000000000000000000000000001",

  // --- Audit vectors: powers-of-2 divisors ---
  divMaxBy16Quotient: "0fffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  divMaxByPow27Quotient: "0000001fffffffffffffffffffffffffffffffffffffffffffffffffffffffff",

  // --- Audit vectors: random multi-limb addition ---
  randAddA: "c4043e2c4cc49e4d6870103ce7c2ff2d512bf4b1b67553ba410db514ee0af888",
  randAddB: "3bf9c1d3b33b61b2978fefc31843d00d2aed40b4e498aac45bef24aeb11f5877",
  randAddResult: "fffe000000000000000000000006cf3a7c1935669b0dfe7e9cfcd9c39f2a50ff",
  randAdd2A: "a1b2c3d4e5f60718293a4b5c6d7e8f9001122334455667788990aabbccddeeff",
  randAdd2B: "05e4d3c2b1a09f8e7d6c5b4a39281706ffeedccbbaa998877665543210012301",
  randAdd2Result: "a79797979796a6a6a6a6a6a6a6a6a6970100fffffffffffffff5feeddcdf1200",
  randAdd3A: "deadbeefcafebabe1234567890abcdef0011223344556677fedcba9876543210",
  randAdd3B: "1111111111111111111111111111111122222222222222224444444444444444",
  randAdd3Result: "efbed000dc0fcbcf23456789a1bcdf00223344556677889a4320fedcba987654",

  // --- Audit vectors: asymmetric multiplication ---
  mulAsym1A: "deadbeefcafebabe1234567890abcdef0011223344556677fedcba9876543210",
  mulAsym1B: "00000000000000000000000000000000000000000000000000000000000000ff",
  mulAsym1Result: "cf1130db33bc0354222222181b2221111111111111111186ddddddddddddddf0",
  mulAsym2A: "ffffffffffffffffffffffffffffffff00000000000000000000000000000000",
  mulAsym2B: "0000000000000000000000000000000000000000000000000000000000000003",
  mulAsym2Result: "fffffffffffffffffffffffffffffffd00000000000000000000000000000000",
  mulAsym3A: "a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5",
  mulAsym3B: "0000000000000000000000000000000000000000000000000000000000010001",
  mulAsym3Result: "4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4b4aa5a5",

  // --- Audit v2: per-limb comparison ---
  cmpL1Val1: toHex256(1n << 28n),
  cmpL1Val2: toHex256(2n << 28n),
  cmpL5Val1: toHex256(1n << 140n),
  cmpL5Val2: toHex256(2n << 140n),

  // --- Audit v2: powers at all limb boundaries ---
  pow84: toHex256(1n << 84n),
  pow84MinusOne: toHex256((1n << 84n) - 1n),
  pow112: toHex256(1n << 112n),
  pow112MinusOne: toHex256((1n << 112n) - 1n),
  pow168: toHex256(1n << 168n),
  pow168MinusOne: toHex256((1n << 168n) - 1n),
  pow196: toHex256(1n << 196n),
  pow196MinusOne: toHex256((1n << 196n) - 1n),
  pow224: toHex256(1n << 224n),
  pow224MinusOne: toHex256((1n << 224n) - 1n),
  pow127: toHex256(1n << 127n),

  // --- Audit v2: multiplication ---
  mulAssocResult1: toHex256(
    (((BigInt("0xdeadbeefcafebabe1234567890abcdef0011223344556677fedcba9876543210") * 0xffn) %
      (1n << 256n)) *
      0x10001n) %
      (1n << 256n),
  ),
  mulAssocResult2: toHex256(
    (((BigInt("0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5") *
      ((1n << 128n) + 1n)) %
      (1n << 256n)) *
      3n) %
      (1n << 256n),
  ),
  squareDeadbeef: toHex256(0xdeadbeefn * 0xdeadbeefn),
  square2p192p1: toHex256(((1n << 192n) + 1n) ** 2n),
  square2p64m1: toHex256(((1n << 64n) - 1n) ** 2n),
  patAxPatB: toHex256(BigInt("0x" + "aa".repeat(32)) * BigInt("0x" + "55".repeat(32))),
  patASquared: toHex256(BigInt("0x" + "aa".repeat(32)) ** 2n),
  maxTimes3: toHex256(((1n << 256n) - 1n) * 3n),
  maxTimes7: toHex256(((1n << 256n) - 1n) * 7n),
  maxTimes255: toHex256(((1n << 256n) - 1n) * 255n),
  mulHalfMaxTimes3: toHex256(((1n << 255n) - 1n) * 3n),

  // --- Audit v2: division ---
  divMaxBy3Q: toHex256(((1n << 256n) - 1n) / 3n),
  divMaxBy10Q: toHex256(((1n << 256n) - 1n) / 10n),
  divMaxBy17Q: toHex256(((1n << 256n) - 1n) / 17n),
  divMaxBy255Q: toHex256(((1n << 256n) - 1n) / 255n),
  divMaxBy4Q: toHex256(((1n << 256n) - 1n) / 4n),
  divMaxBy8Q: toHex256(((1n << 256n) - 1n) / 8n),
  divMaxBy32Q: toHex256(((1n << 256n) - 1n) / 32n),
  divMaxBy256Q: toHex256(((1n << 256n) - 1n) / 256n),
  divPow252By3Q: toHex256((1n << 252n) / 3n),
  divPow252By7Q: toHex256((1n << 252n) / 7n),
  divPow252ByLimbMaxQ: toHex256((1n << 252n) / ((1n << 28n) - 1n)),
  div1e18By2Q: toHex256(10n ** 18n / 2n),
  div1e18By10Q: toHex256(10n ** 18n / 10n),
  divMaxBy100Q: toHex256(((1n << 256n) - 1n) / 100n),

  // --- Audit v2: subtraction ---
  maxMinusOneEth: toHex256((1n << 256n) - 1n - 10n ** 18n),

  // --- Audit v2: addChecked boundary ---
  addCheckedS15CarryA: "efffffff00000000000000000000000000000000000000000000000000000000",
  addCheckedS15CarryB: "0000000100000000000000000000000000000000000000000000000000000000",
  addCheckedS15CarryR: "f000000000000000000000000000000000000000000000000000000000000000",
  addCheckedS16CarryB: "1000000100000000000000000000000000000000000000000000000000000000",

  // --- Audit v2: euler ---
  eulerResult: toHex256((10n ** 18n + (1n << 128n)) ** 2n),

  // --- Audit v2: compare fallthrough ---
  cmpUpperDominatesA: "100000000000000000000000000000000000000000000000000000000fffffff",
  cmpUpperDominatesB: "2000000000000000000000000000000000000000000000000000000000000000",

  // --- Audit v2: isZero middle limb values ---
  limbL1Only: toHex256(1n << 28n),
  limbL3Only: toHex256(1n << 84n),
  limbL5Only: toHex256(1n << 140n),
  limbL7Only: toHex256(1n << 196n),
  limbL8Only: toHex256(1n << 224n),

  // --- Audit v2: single-bit boundaries ---
  pow27: toHex256(1n << 27n),
  pow55: toHex256(1n << 55n),

  // --- Audit v2: small values ---
  five: toHex256(5n),
  six: toHex256(6n),
  ten: toHex256(10n),
  hex100: toHex256(100n),

  // --- Audit v2: sub simple ---
  subFiveMinusThree: toHex256(5n - 3n),
  subSevenMinusOne: toHex256(7n - 1n),

  // --- Audit v2: mul small ---
  mulTwoTimesFive: toHex256(2n * 5n),

  // --- Audit v2: simultaneous carry ---
  simultCarryInput: toHex256(
    4n * (1n << 28n) ** 9n +
      Array.from({ length: 9 }, (_, i) => (1n << 27n) * (1n << 28n) ** BigInt(i)).reduce(
        (a, b) => a + b,
        0n,
      ),
  ),
  simultCarryResult: toHex256(
    (4n * (1n << 28n) ** 9n +
      Array.from({ length: 9 }, (_, i) => (1n << 27n) * (1n << 28n) ** BigInt(i)).reduce(
        (a, b) => a + b,
        0n,
      )) *
      2n,
  ),
  simultCarryOvInput: toHex256(
    8n * (1n << 28n) ** 9n +
      Array.from({ length: 9 }, (_, i) => (1n << 27n) * (1n << 28n) ** BigInt(i)).reduce(
        (a, b) => a + b,
        0n,
      ),
  ),
  simultCarryOvResult: toHex256(
    (8n * (1n << 28n) ** 9n +
      Array.from({ length: 9 }, (_, i) => (1n << 27n) * (1n << 28n) ** BigInt(i)).reduce(
        (a, b) => a + b,
        0n,
      )) *
      2n,
  ),

  // --- Audit v2: subChecked boundary ---
  subFullBorrowA: toHex256((1n << 252n) + 1n),
  subFullBorrowResult: toHex256((1n << 252n) + 1n - 2n),
  subD9AbsorbedA: toHex256(2n * (1n << 28n) ** 9n + 1n),
  subD9AbsorbedB: toHex256(1n * (1n << 28n) ** 9n + 2n),
  subD9AbsorbedResult: toHex256(2n * (1n << 28n) ** 9n + 1n - (1n * (1n << 28n) ** 9n + 2n)),
  subD9UnderflowA: toHex256(1n * (1n << 28n) ** 9n + 1n),
  subD9UnderflowB: toHex256(1n * (1n << 28n) ** 9n + 2n),
  subOnlyL9A: toHex256(3n * (1n << 28n) ** 9n + 5n),
  subOnlyL9B: toHex256(5n * (1n << 28n) ** 9n + 3n),
  subOnlyL9Result2: toHex256(
    (3n * (1n << 28n) ** 9n + 5n - (5n * (1n << 28n) ** 9n + 3n) + (1n << 256n)) % (1n << 256n),
  ),

  // --- Audit v2: boundary l0 inline results ---
  bndL0BmTwoPlusBmOne: toHex256((1n << 28n) - 2n + ((1n << 28n) - 1n)),
  bndL0BmOneSquared: toHex256(((1n << 28n) - 1n) ** 2n),

  // --- Audit v2: div quotients ---
  divPow252By2Q: toHex256((1n << 252n) / 2n),
  divMax4Q: toHex256(((1n << 256n) - 1n) / 4n),
  divMax8Q: toHex256(((1n << 256n) - 1n) / 8n),
  divMax32Q: toHex256(((1n << 256n) - 1n) / 32n),
} as const;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UInt256 arithmetic vectors (cross-language ground truth)", () => {
  // -------------------------------------------------------------------------
  // 1. Constants
  // -------------------------------------------------------------------------
  describe("Constants", () => {
    it("zero", () => {
      expect(toHex256(0n)).toBe(VECTORS.zero);
    });

    it("one", () => {
      expect(toHex256(1n)).toBe(VECTORS.one);
    });

    it("max (2^256 - 1)", () => {
      expect(toHex256(UINT256_MAX)).toBe(VECTORS.max);
    });

    it("two", () => {
      expect(toHex256(2n)).toBe(VECTORS.two);
    });

    it("three", () => {
      expect(toHex256(3n)).toBe(VECTORS.three);
    });

    it("seven", () => {
      expect(toHex256(7n)).toBe(VECTORS.seven);
    });

    it("twentyOne (0x15)", () => {
      expect(toHex256(21n)).toBe(VECTORS.twentyOne);
    });

    it("limbMax (2^28 - 1)", () => {
      expect(toHex256((1n << 28n) - 1n)).toBe(VECTORS.limbMax);
    });

    it("limbBase (2^28)", () => {
      expect(toHex256(1n << 28n)).toBe(VECTORS.limbBase);
    });

    it("pow128 (2^128)", () => {
      expect(toHex256(1n << 128n)).toBe(VECTORS.pow128);
    });

    it("pow129 (2^129)", () => {
      expect(toHex256(1n << 129n)).toBe(VECTORS.pow129);
    });
  });

  // -------------------------------------------------------------------------
  // 2. Hex round-trip
  // -------------------------------------------------------------------------
  describe("Hex round-trip", () => {
    const roundTripCases: [string, bigint][] = [
      ["zero", 0n],
      ["one", 1n],
      ["max", UINT256_MAX],
      ["limbMax", (1n << 28n) - 1n],
      ["limbBase", 1n << 28n],
      ["pow128", 1n << 128n],
      ["oneEth", 10n ** 18n],
      ["oneUsdc", 10n ** 6n],
    ];

    for (const [label, value] of roundTripCases) {
      it(`${label}: BigInt -> hex -> BigInt`, () => {
        const hex = toHex256(value);
        const parsed = BigInt("0x" + hex);
        expect(parsed).toBe(value);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 3. Addition
  // -------------------------------------------------------------------------
  describe("Addition", () => {
    it("identity: 1 + 1 = 2", () => {
      const result = toHex256(1n + 1n);
      expect(result).toBe(VECTORS.addOnePlusOne);
      expect(result).toBe(VECTORS.two);
    });

    it("carry: limbMax + 1 = limbBase", () => {
      const result = toHex256((1n << 28n) - 1n + 1n);
      expect(result).toBe(VECTORS.addLimbCarry);
      expect(result).toBe(VECTORS.limbBase);
    });

    it("overflow wrap: max + 1 = 0", () => {
      const result = toHex256(UINT256_MAX + 1n);
      expect(result).toBe(VECTORS.addOverflow);
      expect(result).toBe(VECTORS.zero);
    });

    it("oneEth + oneEth = twoEth", () => {
      const result = toHex256(10n ** 18n + 10n ** 18n);
      expect(result).toBe(VECTORS.addOneEthPlusOneEth);
      expect(result).toBe(VECTORS.twoEth);
    });

    it("commutativity: a + b = b + a", () => {
      const a = 10n ** 18n;
      const b = (1n << 128n) - 1n;
      expect(toHex256(a + b)).toBe(toHex256(b + a));
    });
  });

  // -------------------------------------------------------------------------
  // 4. Subtraction
  // -------------------------------------------------------------------------
  describe("Subtraction", () => {
    it("identity: 2 - 1 = 1", () => {
      const result = toHex256(2n - 1n);
      expect(result).toBe(VECTORS.subTwoMinusOne);
      expect(result).toBe(VECTORS.one);
    });

    it("borrow: limbBase - 1 = limbMax", () => {
      const result = toHex256((1n << 28n) - 1n);
      expect(result).toBe(VECTORS.subLimbBorrow);
      expect(result).toBe(VECTORS.limbMax);
    });

    it("underflow wrap: 0 - 1 = max", () => {
      const result = toHex256(0n - 1n);
      expect(result).toBe(VECTORS.subUnderflow);
      expect(result).toBe(VECTORS.max);
    });

    it("inverse: (a + b) - b = a", () => {
      const a = 10n ** 18n;
      const b = (1n << 128n) - 1n;
      const sum = (a + b) & UINT256_MAX;
      expect(toHex256(sum - b)).toBe(toHex256(a));
    });
  });

  // -------------------------------------------------------------------------
  // 5. Multiplication
  // -------------------------------------------------------------------------
  describe("Multiplication", () => {
    it("identity: 3 * 7 = 21", () => {
      const result = toHex256(3n * 7n);
      expect(result).toBe(VECTORS.mulThreeTimesSeven);
      expect(result).toBe(VECTORS.twentyOne);
    });

    it("by zero: max * 0 = 0", () => {
      expect(toHex256(UINT256_MAX * 0n)).toBe(VECTORS.zero);
    });

    it("small: oneEth * 2 = twoEth", () => {
      const result = toHex256(10n ** 18n * 2n);
      expect(result).toBe(VECTORS.mulOneEthTimesTwo);
      expect(result).toBe(VECTORS.twoEth);
    });

    it("large overflow: 2^128 * 2^128 = 0 (mod 2^256)", () => {
      const result = toHex256((1n << 128n) * (1n << 128n));
      expect(result).toBe(VECTORS.mulPow128Squared);
      expect(result).toBe(VECTORS.zero);
    });

    it("max * max = 1 (mod 2^256)", () => {
      const result = toHex256(UINT256_MAX * UINT256_MAX);
      expect(result).toBe(VECTORS.mulMaxTimesMax);
      expect(result).toBe(VECTORS.one);
    });

    it("commutativity: a * b = b * a", () => {
      const a = 10n ** 18n;
      const b = 12345n;
      expect(toHex256(a * b)).toBe(toHex256(b * a));
    });
  });

  // -------------------------------------------------------------------------
  // 6. Short division
  // -------------------------------------------------------------------------
  describe("Short division", () => {
    it("max / 2 = (2^255 - 1, remainder 1)", () => {
      const q = UINT256_MAX / 2n;
      const r = UINT256_MAX % 2n;
      expect(toHex256(q)).toBe(VECTORS.divMaxBy2Quotient);
      expect(toHex256(q)).toBe(VECTORS.maxDiv2Quotient);
      expect(r).toBe(1n);
    });

    it("1e18 / 1e6 = (1e12, remainder 0)", () => {
      const q = 10n ** 18n / 10n ** 6n;
      const r = 10n ** 18n % 10n ** 6n;
      expect(toHex256(q)).toBe(VECTORS.divOneEthBy1e6Quotient);
      expect(toHex256(q)).toBe(VECTORS.oneTrillion);
      expect(r).toBe(0n);
    });

    it("7 / 2 = (3, remainder 1)", () => {
      const q = 7n / 2n;
      const r = 7n % 2n;
      expect(toHex256(q)).toBe(VECTORS.divSevenByTwoQuotient);
      expect(toHex256(q)).toBe(VECTORS.three);
      expect(r).toBe(1n);
    });

    it("invariant: q * d + r == x", () => {
      const x = UINT256_MAX;
      const d = 2n;
      const q = x / d;
      const r = x % d;
      expect(q * d + r).toBe(x);
    });
  });

  // -------------------------------------------------------------------------
  // 7. Comparison
  // -------------------------------------------------------------------------
  describe("Comparison", () => {
    const pairs: [string, bigint, string, bigint][] = [
      ["zero", 0n, "one", 1n],
      ["one", 1n, "max", UINT256_MAX],
      ["pow128", 1n << 128n, "max", UINT256_MAX],
      ["oneEth", 10n ** 18n, "twoEth", 2n * 10n ** 18n],
      ["oneUsdc", 10n ** 6n, "oneEth", 10n ** 18n],
    ];

    for (const [labelA, a, labelB, b] of pairs) {
      it(`${labelA} < ${labelB}`, () => {
        expect(a < b).toBe(true);
      });

      it(`${labelB} > ${labelA}`, () => {
        expect(b > a).toBe(true);
      });
    }

    it("equal: max == max", () => {
      const a = UINT256_MAX;
      const b = (1n << 256n) - 1n;
      expect(a === b).toBe(true);
    });

    it("equal: zero == zero", () => {
      const a = 0n;
      const b = UINT256_MAX + 1n - UINT256_MAX - 1n;
      expect(a === b).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // 8. EVM values
  // -------------------------------------------------------------------------
  describe("EVM values", () => {
    it("1 ETH = 10^18 wei", () => {
      expect(toHex256(10n ** 18n)).toBe(VECTORS.oneEth);
    });

    it("2 ETH = 2 * 10^18 wei", () => {
      expect(toHex256(2n * 10n ** 18n)).toBe(VECTORS.twoEth);
    });

    it("1 USDC = 10^6", () => {
      expect(toHex256(10n ** 6n)).toBe(VECTORS.oneUsdc);
    });

    it("1 trillion = 10^12", () => {
      expect(toHex256(10n ** 12n)).toBe(VECTORS.oneTrillion);
    });

    it("gas price: 20 gwei", () => {
      expect(toHex256(20n * 10n ** 9n)).toBe(VECTORS.gasPrice20Gwei);
    });

    it("gas cost: 21000 * 20 gwei = 0.00042 ETH", () => {
      const cost = 21000n * 20n * 10n ** 9n;
      expect(toHex256(cost)).toBe(VECTORS.gasCost21k);
      // Verify it equals 4.2e14 wei
      expect(cost).toBe(420000000000000n);
    });
  });

  // -------------------------------------------------------------------------
  // 9. MulChecked
  // -------------------------------------------------------------------------
  describe("MulChecked", () => {
    it("3 * 7 = 21, no overflow", () => {
      const a = 3n;
      const b = 7n;
      const full = a * b;
      expect(full <= UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.twentyOne);
    });

    it("1e18 * 2, no overflow", () => {
      const a = 10n ** 18n;
      const b = 2n;
      const full = a * b;
      expect(full <= UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.twoEth);
    });

    it("2^128 * 2^128 overflows, result = 0", () => {
      const a = 1n << 128n;
      const b = 1n << 128n;
      const full = a * b;
      expect(full > UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.zero);
    });

    it("max * max overflows, result = 1", () => {
      const full = UINT256_MAX * UINT256_MAX;
      expect(full > UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.one);
    });

    it("(2^128-1) * (2^128+1) = max, NO overflow", () => {
      const a = (1n << 128n) - 1n;
      const b = (1n << 128n) + 1n;
      const full = a * b;
      expect(full).toBe(UINT256_MAX);
      expect(full <= UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.max);
    });
  });

  // -------------------------------------------------------------------------
  // 10. Associativity
  // -------------------------------------------------------------------------
  describe("Associativity", () => {
    it("(a + b) + c == a + (b + c) for 1e18, 2^128-1, 7", () => {
      const a = 10n ** 18n;
      const b = (1n << 128n) - 1n;
      const c = 7n;
      const lhs = toHex256(a + b + c);
      const rhs = toHex256(a + (b + c));
      expect(lhs).toBe(rhs);
    });

    it("(a + b) + c == a + (b + c) for 2^252, 2^128, 1e18", () => {
      const a = 1n << 252n;
      const b = 1n << 128n;
      const c = 10n ** 18n;
      const lhs = toHex256(a + b + c);
      const rhs = toHex256(a + (b + c));
      expect(lhs).toBe(rhs);
    });

    it("(a + b) + c == a + (b + c) with carry propagation", () => {
      const a = (1n << 56n) - 1n;
      const b = 1n;
      const c = (1n << 140n) - (1n << 56n);
      const lhs = toHex256(a + b + c);
      const rhs = toHex256(a + (b + c));
      expect(lhs).toBe(rhs);
      expect(lhs).toBe(VECTORS.pow140);
    });
  });

  // -------------------------------------------------------------------------
  // 11. Distributive
  // -------------------------------------------------------------------------
  describe("Distributive", () => {
    it("a * (b + c) == a*b + a*c for a=1e18, b=2^128, c=7", () => {
      const a = 10n ** 18n;
      const b = 1n << 128n;
      const c = 7n;
      const lhs = toHex256(a * (b + c));
      const rhs = toHex256(a * b + a * c);
      expect(lhs).toBe(rhs);
    });
  });

  // -------------------------------------------------------------------------
  // 12. Carry at every limb boundary
  // -------------------------------------------------------------------------
  describe("Carry at every limb boundary", () => {
    it("(2^56 - 1) + 1 = 2^56 (carry l1 -> l2)", () => {
      const result = toHex256((1n << 56n) - 1n + 1n);
      expect(result).toBe(VECTORS.pow56);
    });

    it("(2^140 - 1) + 1 = 2^140 (carry l4 -> l5)", () => {
      const result = toHex256((1n << 140n) - 1n + 1n);
      expect(result).toBe(VECTORS.pow140);
    });

    it("(2^252 - 1) + 1 = 2^252 (carry l8 -> l9, critical 4-bit boundary)", () => {
      const result = toHex256((1n << 252n) - 1n + 1n);
      expect(result).toBe(VECTORS.pow252);
    });
  });

  // -------------------------------------------------------------------------
  // 13. Borrow at every limb boundary
  // -------------------------------------------------------------------------
  describe("Borrow at every limb boundary", () => {
    it("2^56 - 1 = lower2LimbsMax (borrow from l2)", () => {
      const result = toHex256((1n << 56n) - 1n);
      expect(result).toBe(VECTORS.lower2LimbsMax);
    });

    it("2^140 - 1 = lowerFiveLimbsMax (borrow from l5)", () => {
      const result = toHex256((1n << 140n) - 1n);
      expect(result).toBe(VECTORS.lowerFiveLimbsMax);
    });

    it("2^252 - 1 = lower9LimbsMax (borrow from l9)", () => {
      const result = toHex256((1n << 252n) - 1n);
      expect(result).toBe(VECTORS.lower9LimbsMax);
    });
  });

  // -------------------------------------------------------------------------
  // 14. Alternating bit patterns
  // -------------------------------------------------------------------------
  describe("Alternating bit patterns", () => {
    it("0xAAAA... + 0x5555... = max", () => {
      const a = BigInt("0x" + VECTORS.patternA);
      const b = BigInt("0x" + VECTORS.pattern5);
      expect(toHex256(a + b)).toBe(VECTORS.max);
    });

    it("patternA round-trips through hex", () => {
      const val = BigInt("0x" + VECTORS.patternA);
      expect(toHex256(val)).toBe(VECTORS.patternA);
    });

    it("pattern5 round-trips through hex", () => {
      const val = BigInt("0x" + VECTORS.pattern5);
      expect(toHex256(val)).toBe(VECTORS.pattern5);
    });
  });

  // -------------------------------------------------------------------------
  // 15. Multiplication index boundary
  // -------------------------------------------------------------------------
  describe("Multiplication index boundary", () => {
    it("2^28 * 2^28 = 2^56 (product at limb index 2)", () => {
      const result = toHex256((1n << 28n) * (1n << 28n));
      expect(result).toBe(VECTORS.pow56);
    });

    it("1 * 2^252 = 2^252 (product at limb index 9)", () => {
      const result = toHex256(1n * (1n << 252n));
      expect(result).toBe(VECTORS.pow252);
    });

    it("limbMax * limbBase = 2^56 - 2^28", () => {
      const result = toHex256(((1n << 28n) - 1n) * (1n << 28n));
      expect(result).toBe(VECTORS.limbMaxTimesLimbBase);
      expect(result).toBe(toHex256((1n << 56n) - (1n << 28n)));
    });
  });

  // -------------------------------------------------------------------------
  // 16. Short division edge cases
  // -------------------------------------------------------------------------
  describe("Short division edge cases", () => {
    it("max / (2^28 - 1): max valid divisor, remainder < divisor", () => {
      const d = (1n << 28n) - 1n;
      const q = UINT256_MAX / d;
      const r = UINT256_MAX % d;
      expect(toHex256(q)).toBe(VECTORS.divMaxByLimbMaxQuotient);
      expect(r < d).toBe(true);
    });

    it("q * d + r == max using BigInt", () => {
      const d = (1n << 28n) - 1n;
      const q = UINT256_MAX / d;
      const r = UINT256_MAX % d;
      expect(q * d + r).toBe(UINT256_MAX);
    });
  });

  // -------------------------------------------------------------------------
  // 17. Cross-operation round-trips
  // -------------------------------------------------------------------------
  describe("Cross-operation round-trips", () => {
    it("(a * d) / d == a for small d", () => {
      const a = 10n ** 18n;
      const d = 7n;
      const product = (a * d) & UINT256_MAX;
      expect(toHex256(product / d)).toBe(toHex256(a));
    });

    it("(a - b) + b == a", () => {
      const a = 10n ** 18n;
      const b = 7n;
      const diff = (a - b) & UINT256_MAX;
      expect(toHex256(diff + b)).toBe(toHex256(a));
    });

    it("(a / d) * d + (a % d) == a with d near limit", () => {
      const a = UINT256_MAX;
      const d = (1n << 28n) - 1n;
      const q = a / d;
      const r = a % d;
      expect(q * d + r).toBe(a);
      expect(toHex256(q * d + r)).toBe(VECTORS.max);
    });
  });

  // -------------------------------------------------------------------------
  // 18. AddChecked: MAX + MAX
  // -------------------------------------------------------------------------
  describe("AddChecked: MAX + MAX", () => {
    it("max + max = max-1 with overflow", () => {
      const full = UINT256_MAX + UINT256_MAX;
      expect(full > UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.maxMinusOne);
    });
  });

  // -------------------------------------------------------------------------
  // 19. MulChecked: MAX * 2
  // -------------------------------------------------------------------------
  describe("MulChecked: MAX * 2", () => {
    it("max * 2 = max-1 with overflow", () => {
      const full = UINT256_MAX * 2n;
      expect(full > UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.maxMinusOne);
    });
  });

  // -------------------------------------------------------------------------
  // 20. MulChecked: 0 * large (no overflow)
  // -------------------------------------------------------------------------
  describe("MulChecked: 0 * large", () => {
    it("0 * max = 0, no overflow", () => {
      const full = 0n * UINT256_MAX;
      expect(full <= UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.zero);
    });
  });

  // -------------------------------------------------------------------------
  // 21. SubChecked: general underflow (3 - 7)
  // -------------------------------------------------------------------------
  describe("SubChecked: general underflow", () => {
    it("3 - 7 = max-3 with underflow", () => {
      const result = toHex256(3n - 7n);
      expect(result).toBe(VECTORS.subThreeMinusSeven);
      // 3 < 7 => underflow, wrapped result = 2^256 - 4
      expect(result).toBe(VECTORS.subThreeMinusSeven);
    });
  });

  // -------------------------------------------------------------------------
  // 22. Zero dividend in short division
  // -------------------------------------------------------------------------
  describe("Zero dividend in short division", () => {
    it("0 / 7 = (0, remainder 0)", () => {
      const q = 0n / 7n;
      const r = 0n % 7n;
      expect(toHex256(q)).toBe(VECTORS.zero);
      expect(r).toBe(0n);
    });
  });

  // -------------------------------------------------------------------------
  // 23. Self-division in short division
  // -------------------------------------------------------------------------
  describe("Self-division in short division", () => {
    it("7 / 7 = (1, remainder 0)", () => {
      const q = 7n / 7n;
      const r = 7n % 7n;
      expect(toHex256(q)).toBe(VECTORS.one);
      expect(r).toBe(0n);
    });
  });

  // -------------------------------------------------------------------------
  // 24. Anti-symmetry of subtraction
  // -------------------------------------------------------------------------
  describe("Anti-symmetry of subtraction", () => {
    it("(pow128 - 1) + (1 - pow128) == 0 mod 2^256", () => {
      const a = 1n << 128n;
      const b = 1n;
      const aMinusB = (a - b) & UINT256_MAX;
      const bMinusA = (b - a) & UINT256_MAX;
      const sum = (aMinusB + bMinusA) & UINT256_MAX;
      expect(toHex256(sum)).toBe(VECTORS.zero);
      expect(toHex256(bMinusA)).toBe(VECTORS.oneMinusPow128);
    });
  });

  // -------------------------------------------------------------------------
  // 25. Double-complement
  // -------------------------------------------------------------------------
  describe("Double-complement", () => {
    it("max - (max - oneEth) == oneEth", () => {
      const x = 10n ** 18n;
      const inner = (UINT256_MAX - x) & UINT256_MAX;
      const result = (UINT256_MAX - inner) & UINT256_MAX;
      expect(toHex256(result)).toBe(VECTORS.oneEth);
    });

    it("max - (max - pow128) == pow128", () => {
      const x = 1n << 128n;
      const inner = (UINT256_MAX - x) & UINT256_MAX;
      const result = (UINT256_MAX - inner) & UINT256_MAX;
      expect(toHex256(result)).toBe(VECTORS.pow128);
    });
  });

  // -------------------------------------------------------------------------
  // 26. Remainder bound
  // -------------------------------------------------------------------------
  describe("Remainder bound", () => {
    const divCases: [string, bigint, bigint][] = [
      ["max / 2", UINT256_MAX, 2n],
      ["1e18 / 1e6", 10n ** 18n, 10n ** 6n],
      ["7 / 2", 7n, 2n],
      ["max / (2^28-1)", UINT256_MAX, (1n << 28n) - 1n],
      ["1e18 / 7", 10n ** 18n, 7n],
      ["max / 3", UINT256_MAX, 3n],
      ["0 / 7", 0n, 7n],
      ["7 / 7", 7n, 7n],
      ["max / 16", UINT256_MAX, 16n],
      ["max / 2^27", UINT256_MAX, 1n << 27n],
    ];

    for (const [label, x, d] of divCases) {
      it(`${label}: 0 <= r < d`, () => {
        const r = x % d;
        expect(r >= 0n).toBe(true);
        expect(r < d).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------------
  // 27. Powers-of-2 divisors
  // -------------------------------------------------------------------------
  describe("Powers-of-2 divisors", () => {
    it("max / 16 = (quotient, remainder 15)", () => {
      const q = UINT256_MAX / 16n;
      const r = UINT256_MAX % 16n;
      expect(toHex256(q)).toBe(VECTORS.divMaxBy16Quotient);
      expect(r).toBe(15n);
      expect(q * 16n + r).toBe(UINT256_MAX);
    });

    it("max / 2^27 = (quotient, remainder 2^27-1)", () => {
      const d = 1n << 27n;
      const q = UINT256_MAX / d;
      const r = UINT256_MAX % d;
      expect(toHex256(q)).toBe(VECTORS.divMaxByPow27Quotient);
      expect(r).toBe(d - 1n);
      expect(q * d + r).toBe(UINT256_MAX);
    });
  });

  // -------------------------------------------------------------------------
  // 28. max * 2 wrapping (explicit wrapping mul)
  // -------------------------------------------------------------------------
  describe("max * 2 wrapping", () => {
    it("max * 2 = max-1 (carry at every position)", () => {
      const result = toHex256(UINT256_MAX * 2n);
      expect(result).toBe(VECTORS.maxMinusOne);
    });
  });

  // -------------------------------------------------------------------------
  // 29. Karatsuba identity
  // -------------------------------------------------------------------------
  describe("Karatsuba identity", () => {
    it("(2^128-1)^2 = 2^256 - 2^129 + 1 mod 2^256", () => {
      const p128m1 = (1n << 128n) - 1n;
      const result = toHex256(p128m1 * p128m1);
      expect(result).toBe(VECTORS.karatsubaResult);
      // Verify the algebraic identity
      const expected = toHex256(UINT256_MAX - (1n << 129n) + 2n);
      expect(result).toBe(expected);
    });
  });

  // -------------------------------------------------------------------------
  // 30. Random multi-limb addition vectors
  // -------------------------------------------------------------------------
  describe("Random multi-limb addition vectors", () => {
    it("randAdd: a + b mod 2^256", () => {
      const a = BigInt("0x" + VECTORS.randAddA);
      const b = BigInt("0x" + VECTORS.randAddB);
      expect(toHex256(a + b)).toBe(VECTORS.randAddResult);
    });

    it("randAdd2: a + b mod 2^256", () => {
      const a = BigInt("0x" + VECTORS.randAdd2A);
      const b = BigInt("0x" + VECTORS.randAdd2B);
      expect(toHex256(a + b)).toBe(VECTORS.randAdd2Result);
    });

    it("randAdd3: a + b mod 2^256", () => {
      const a = BigInt("0x" + VECTORS.randAdd3A);
      const b = BigInt("0x" + VECTORS.randAdd3B);
      expect(toHex256(a + b)).toBe(VECTORS.randAdd3Result);
    });
  });

  // -------------------------------------------------------------------------
  // 31. Asymmetric multiplication vectors
  // -------------------------------------------------------------------------
  describe("Asymmetric multiplication vectors", () => {
    it("large * 0xff (255)", () => {
      const a = BigInt("0x" + VECTORS.mulAsym1A);
      const b = BigInt("0x" + VECTORS.mulAsym1B);
      expect(toHex256(a * b)).toBe(VECTORS.mulAsym1Result);
    });

    it("upper-half-max * 3", () => {
      const a = BigInt("0x" + VECTORS.mulAsym2A);
      const b = BigInt("0x" + VECTORS.mulAsym2B);
      expect(toHex256(a * b)).toBe(VECTORS.mulAsym2Result);
    });

    it("alternating-a5 * 0x10001 (65537)", () => {
      const a = BigInt("0x" + VECTORS.mulAsym3A);
      const b = BigInt("0x" + VECTORS.mulAsym3B);
      expect(toHex256(a * b)).toBe(VECTORS.mulAsym3Result);
    });
  });

  // ---------------------------------------------------------------------------
  // Frozen fuzz vectors (generated by generate-uint256-vectors.ts)
  // Seed: keccak256("uint256-fuzz-vectors-v1") -- deterministic, do not edit
  // ---------------------------------------------------------------------------

  const FUZZ_VECTORS = [
    {
      a: "9c058ff97be1f628cc5322cd50f9a31d3c3ff4262d8dc15d16c6e9491fddf894",
      b: "20ae049a756ee7f9908caa142556c089c50ea57cadfd31222401770f0b1ae9d5",
      add: "bcb39493f150de225cdfcce1765063a7014e99a2db8af27f3ac860582af8e269",
      sub: "7b578b5f06730e2f3bc678b92ba2e29377314ea97f90903af2c5723a14c30ebf",
      mul: "e32643fd2c4bbaeeedccda02deea7fd93cb78a68f38ecffca8c1cabe25f68724",
      d: 158520680,
      divQ: "000000108342b4952007674ac92712a496ab655d4db9c2ea7fa011e60bc6d501",
      divR: 74160940,
    },
    {
      a: "ac5dd667b0fd08fcdaf4dedda8a4bc2b376c3d5624515df31cd7cdac201eba13",
      b: "41283e3483b2525062153592a0fefb24a36e88af0faa37afd71de468ffa42774",
      add: "ed86149c34af5b4d3d0a147049a3b74fdadac60533fb95a2f3f5b2151fc2e187",
      sub: "6b3598332d4ab6ac78dfa94b07a5c10693fdb4a714a7264345b9e943207a929f",
      mul: "271a591e7dcefd41912c4f87bacfb5bfd2286dc436939ff29bbd1da35d71359c",
      d: 104384748,
      divQ: "0000001bb41d9cb4a012e188944d5cb43ec97ad7c0b6a785f56e6d1e850b3100",
      divR: 59084307,
    },
    {
      a: "6d6916f1b93b517b93be4f9ee47375a46591308b7121917b768ff1b752aa84f6",
      b: "0b9a7c695fe38d30b7133ddd28a5e572c33221b346484a6a74bcb4d79dba914b",
      add: "7903935b191edeac4ad18d7c0d195b1728c3523eb769dbe5eb4ca68ef0651641",
      sub: "61ce9a885957c44adcab11c1bbcd9031a25f0ed82ad9471101d33cdfb4eff3ab",
      mul: "48090a785e099f85b655af38db08191f1fa7e7f51ed00391c053ec9146004a12",
      d: 254044429,
      divQ: "0000000739bbd50d7e7a834bccfb5b4d9f1b8141dc0b6c3967ed6fce1c61ec2a",
      divR: 200035540,
    },
    {
      a: "3c4ceb35527f10a3f489c0e5d1978d15f515711594259d690088adf49263e86f",
      b: "9432156d113eef05ebe687fba72c5ec5d034d25eb212303193e44114d2cee70f",
      add: "d07f00a263bdffa9e07048e178c3ebdbc54a43744637cd9a946cef096532cf7e",
      sub: "a81ad5c84140219e08a338ea2a6b2e5024e09eb6e2136d376ca46cdfbf950160",
      mul: "5cb8f8689666d40be651a0efd1dba9dc249465f3cf694249858bfa28d1e8c781",
      d: 130287913,
      divQ: "00000007c3d1231ac1393f5b0f81420892805478fd61747befb931342be82f2d",
      divR: 118998330,
    },
    {
      a: "ecf2ba008d1914841c4930476208de2b5650e7561d207ae111f5aacc68b8be93",
      b: "18ff11bce0b809427e92691622ee4805787fc36198375b06f8bbf12296c8605c",
      add: "05f1cbbd6dd11dc69adb995d84f72630ced0aab7b557d5e80ab19beeff811eef",
      sub: "d3f3a843ac610b419db6c7313f1a9625ddd123f484e91fda1939b9a9d1f05e37",
      mul: "4c366c5b3fdb5317d6c8ab1700971c3e739f908450f2d75f3ab6cb3feeb39cd4",
      d: 67901347,
      divQ: "0000003a8bb176c6098dbae229baf0ee4c1f0968f2875858f5ed4146ed275f1a",
      divR: 31709957,
    },
    {
      a: "f857290e941e6dd8e4ecdcbd118636b36a28bbdd00f7cb5e1f92ba48e9da2fc2",
      b: "ce1b8017d0228ec8654b29bcaf5c4f749b02f2a7c3f78aeab18e77cf18c45444",
      add: "c672a9266440fca14a380679c0e28628052bae84c4ef5648d1213218029e8406",
      sub: "2a3ba8f6c3fbdf107fa1b3006229e73ecf25c9353d0040736e044279d115db7e",
      mul: "20d22dd109c23ba1d695dc3387b9be2cd6b57feecb4d28332114b37e76285788",
      d: 231605330,
      divQ: "00000011fd4f334d37669782836d032260648f10a3e78378039ba98be2763761",
      divR: 168881840,
    },
    {
      a: "07a70702313919dcb81f7af8b67d5a9ab5dc2be38115dc9fae02765fde9c266a",
      b: "9b628335ea0c120326f1bf175d61e5da669aab6338e4c4d272b9b15a5a9ac4a2",
      add: "a3098a381b452bdfdf113a1013df40751c76d746b9faa17220bc27ba3936eb0c",
      sub: "6c4483cc472d07d9912dbbe1591b74c04f418080483117cd3b48c505840161c8",
      mul: "a986b0394c13a2ad294a1f623f5a90ded5d1b0fff50362e41a2de9cecbfd7714",
      d: 80635137,
      divQ: "00000001979a0e52d45e70857c8a43933548a38ec982e0cc26cdbd790492f5c6",
      divR: 29233828,
    },
    {
      a: "74a8106308ae61d7b537e019fbe39b776301ecfc8d77cc2a8925f3c98d39c15c",
      b: "826cd15010973565f11fb16e13ac3fea8c9c24f0ad88c5a2074a0e1cbb634a02",
      add: "f714e1b31945973da65791880f8fdb61ef9e11ed3b0091cc907001e6489d0b5e",
      sub: "f23b3f12f8172c71c4182eabe8375b8cd665c80bdfef068881dbe5acd1d6775a",
      mul: "9170ce04b868820f5c6895b0178eae31095e0cf18668e5b38f5b2609c6ec1ab8",
      d: 99745653,
      divQ: "000000139f227ce0c8868ab20032ec2afb436a4566b51871551ee60e48cecf11",
      divR: 41037719,
    },
    {
      a: "9c9ee64e5745a813ce13958c7c89ce5527382324175a18fd37b9d0d8cfda6e1f",
      b: "686d5942ce86255eccadb48882372cdb3a928cfe736b58fcf91337a3acf79e30",
      add: "050c3f9125cbcd729ac14a14fec0fb3061cab0228ac571fa30cd087c7cd20c4f",
      sub: "34318d0b88bf82b50165e103fa52a179eca59625a3eec0003ea6993522e2cfef",
      mul: "437dd503573acdd40526ddbf7c4c0caa74c7706ca8581403e79e0d69dcd4c7d0",
      d: 102863961,
      divQ: "000000198b84c66a9c26f3ecfe7e7451789ea33e70ca851b3f27a6274d8e2b82",
      divR: 8660461,
    },
    {
      a: "5e16e50de9ccf5d61729e4a4ff1b11658c0df6be9f689bdc79050f68d7c4459e",
      b: "5a28eb8b14b83866d66fb0db1e44b1749d0af22c7ef6762c5ae69c28cb22b5fd",
      add: "b83fd098fe852e3ced9995801d5fc2da2918e8eb1e5f1208d3ebab91a2e6fb9b",
      sub: "03edf982d514bd6f40ba33c9e0d65ff0ef030492207225b01e1e73400ca18fa1",
      mul: "4e362dd737abd581ebd73fe40c95e9aa3190343df1b5f22dc5f5cf208b2d8326",
      d: 207102323,
      divQ: "000000079f433fa6d61aeb755d536f2cd2e7758bfbe0ae0e812dbf50ac4a8747",
      divR: 40982969,
    },
    {
      a: "a5e4e348e567aab7e774468e46da12da21656120bf668492caa898887bd68f9f",
      b: "89c5fbb4cf92395b9a7818bafec3c9deff29c4201b6b5f4030d77503171b9210",
      add: "2faadefdb4f9e41381ec5f49459ddcb9208f2540dad1e3d2fb800d8b92f221af",
      sub: "1c1ee79415d5715c4cfc2dd3481648fb223b9d00a3fb255299d1238564bafd8f",
      mul: "1ef5d46d4aa303ece72617b569ece48d908e753e1aa1d5501cbd0f8d8a16a7f0",
      d: 55590016,
      divQ: "0000003211396c531c6291b1842c52a83f30470299bd85dfc6fbc9bf3d40c5a3",
      divR: 20023839,
    },
    {
      a: "44132646fc108d6be5f1334ec610772457b0b3825443b3d9b6ed90032dd548c1",
      b: "f74fd91f9c2ef4a195fa3840410bf3ab4ab54c80f6232b967f5dae370aa62de7",
      add: "3b62ff66983f820d7beb6b8f071c6acfa26600034a66df70364b3e3a387b76a8",
      sub: "4cc34d275fe198ca4ff6fb0e850483790cfb67015e208843378fe1cc232f1ada",
      mul: "f183cbf1cced5c34a21afec193310dfe6ffde853d06b0fc651ea5e8890649327",
      d: 181575059,
      divQ: "000000064a3ceaa6a5c36136e8aedd0efac3890125171d488d408f6f5abf291c",
      divR: 81953197,
    },
    {
      a: "71355ac2ee31435d6c375597a2bdcba6609086a7ef7375f7d24d4055368d5431",
      b: "e2efc516c8410cd4b1436782a4327ebcaa0597d1ee271bc565bac54f8654cc00",
      add: "54251fd9b67250321d7abd1a46f04a630a961e79dd9a91bd380805a4bce22031",
      sub: "8e4595ac25f03688baf3ee14fe8b4ce9b68aeed6014c5a326c927b05b0388831",
      mul: "23ed98e70133f4a02fd2888aa164a73d921d0c666848b37d5dc87808e52b0c00",
      d: 215202269,
      divQ: "00000008d3648adc5e351b312e93cde88e3ab9ad29e1a8b865062495aeb55d5d",
      divR: 64783848,
    },
    {
      a: "bf8d30492cbc3e6c43a0813cd30e5e2ff3ef874b567165571dfcba7c7a2587a8",
      b: "63d1d5b8bda73236ea1b7993d9238c90d12ae8e99ca60ce113db8b1e5fba6638",
      add: "235f0601ea6370a32dbbfad0ac31eac0c51a7034f317723831d8459ad9dfede0",
      sub: "5bbb5a906f150c35598507a8f9ead19f22c49e61b9cb58760a212f5e1a6b2170",
      mul: "ec22da77cf6820702c5f87f1eb0af61a7ddb9e7d0350469227212e3194529cc0",
      d: 201188733,
      divQ: "0000000ff93b8510fc9614138d27d2faa6d741a4561f9d7ccc9ad96fd9411b9f",
      divR: 109236229,
    },
    {
      a: "63d9f0af55959c75490bc291a539d84799dbfedefeea31bee4eda20f0883d45b",
      b: "25639f6878c67128697734d42c887da215da8a5d13538e678f116f0a3a09ede3",
      add: "893d9017ce5c0d9db282f765d1c255e9afb6893c123dc02673ff1119428dc23e",
      sub: "3e765146dccf2b4cdf948dbd78b15aa584017481eb96a35755dc3304ce79e678",
      mul: "efc90708301e66e3d2bffa58408c542b0dc2689723efb18b85788983adb08bb1",
      d: 53348067,
      divQ: "0000001f66decc63c4e2dec8dabbdc8d5bd2545d35c7b14242d1968f451e00a4",
      divR: 23948015,
    },
    {
      a: "4b163d1cf8bf1a60a9b697133b1b59beab6f44e40e01cbb5d22044ac54c23a91",
      b: "62daa68f93845e8ae03eccbb4851e0bdec9f50d8c8c8d2cbafeb7802f771c6bf",
      add: "adf0e3ac8c4378eb89f563ce836d3a7c980e95bcd6ca9e81820bbcaf4c340150",
      sub: "e83b968d653abbd5c977ca57f2c97900becff40b4538f8ea2234cca95d5073d2",
      mul: "6be938bb783bb0d520b4d95afa96a5a94a8af9d45fcfc810e81cc3813736d82f",
      d: 127142639,
      divQ: "00000009e87cac14cd041585d06601473c1735ed378268cb1b2fe7a99d1436e1",
      divR: 61486210,
    },
    {
      a: "3b9887918f16035b491da1e20962ca58a97f15d6a32469bc2cc1b63bc5a69e0c",
      b: "7e27c0019e6c85db934dbf42002761a7a78441295b63fc0f8e52947ee07d7f8c",
      add: "b9c047932d828936dc6b6124098a2c00510356fffe8865cbbb144abaa6241d98",
      sub: "bd70c78ff0a97d7fb5cfe2a0093b68b101fad4ad47c06dac9e6f21bce5291e80",
      mul: "65e647478d1cde9bb6f76a781bc81b611d2618d616de9493beb1564b6b626290",
      d: 253044528,
      divQ: "00000003f387a3da519f53ebf0ae3ee160624a1a3ddfe0096ae158c4a81686ea",
      divR: 195931180,
    },
    {
      a: "b7b6d9bf46a2e4e813b9fdcbb2319196304d3f7bc8765d5d0d197d1c8c8879d2",
      b: "1c70af50653dbdf04c44107f914cfc5c43cb03086541745fc27c294f0c45a4f3",
      add: "d427890fabe0a2d85ffe0e4b437e8df2741842842db7d1bccf95a66b98ce1ec5",
      sub: "9b462a6ee16526f7c775ed4c20e49539ec823c736334e8fd4a9d53cd8042d4df",
      mul: "65440a9645ff6c7d12cda044ccf35a19cc4aabb7c540ff1f31f88c6d81302a56",
      d: 62058811,
      divQ: "00000031aa7ff1880e61b1bc9652c2116f115257e48a4de99aa7388de3485fce",
      divR: 23951192,
    },
    {
      a: "c7e22e2da0d099aa13511d95af8cdbd2387837c4b602bb80d97f740f498066a1",
      b: "4e32353972e557c3ac359c5d49c6f9bb9bc79d86aa2e02947ab4255967a42e1d",
      add: "1614636713b5f16dbf86b9f2f953d58dd43fd54b6030be1554339968b12494be",
      sub: "79aff8f42deb41e6671b813865c5e2169cb09a3e0bd4b8ec5ecb4eb5e1dc3884",
      mul: "937f47b50d58d8875c3364956bcd032f01a2fd3ed8e1073b0a559775ec208e3d",
      d: 157046891,
      divQ: "000000155a7a086d144181eed3bc4214a30f8200759b42e78b8ed32b9d82a335",
      divR: 130021242,
    },
    {
      a: "e4842a0e27c064a471141bbf43201b00df4948824805e3a0af29fc072e0a3419",
      b: "5b9956f82030b484863bb3497651328f71a1f36357390006f43fc137e71fee4d",
      add: "401d810647f11928f74fcf08b9714d9050eb3be59f3ee3a7a369bd3f152a2266",
      sub: "88ead316078fb01fead86875cccee8716da7551ef0cce399baea3acf46ea45cc",
      mul: "7d4734ba4c3fb57a630e4a034aff8f77a9f0a3320563c8aef2f84d943387e985",
      d: 212951332,
      divQ: "0000001200e4982ecc7d53c5e812d48b75bf36d4518f9ee0ed093bb6bdaee0f9",
      divR: 101398549,
    },
    {
      a: "afffab634fdfd362098b876a491b66e445397166fdc02f50f944e75dbb7722f2",
      b: "0ffaf3bd9bd1bff893b9271419227a4dc026dc4b7bbcf3191a9afb3b4a87e9ad",
      add: "bffa9f20ebb1935a9d44ae7e623de13205604db2797d226a13dfe29905ff0c9f",
      sub: "a004b7a5b40e136975d260562ff8ec968512951b82033c37dea9ec2270ef3945",
      mul: "771d939f840aa0126144c344b8c6aed0eb83abddcb5f4310e20f49aa7feedf8a",
      d: 174322955,
      divQ: "00000010f041273eeb19c57d64e6d1e3571cc3587b5dba9557276ca5f136d195",
      divR: 149522571,
    },
    {
      a: "c187196682222a9e068fb58ca7d71b85195572f26b8a85a1989f6a4a32561e79",
      b: "10a29c777df4efadad8697c0c66f649e1d020f67264e0ef13ac1e5ee021fbacd",
      add: "d229b5de00171a4bb4164d4d6e4680233657825991d89492d36150383475d946",
      sub: "b0e47cef042d3af059091dcbe167b6e6fc53638b453c76b05ddd845c303663ac",
      mul: "3c6e573083fcf7be96983635a4bacaf27935d826fc03192cb6ce5c2583c150e5",
      d: 1270667,
      divQ: "000009fb3cead27c68a9a9925ec26c06ba9d9f38468849041ec3559a61763d56",
      divR: 560839,
    },
    {
      a: "bce82ae8606feee737bb904d5b8c8831df74cb2f058bd95e3ed587c5e5806648",
      b: "4a3d334748823327aada469a0944ea16cfef8e1830f12484c5da50230736c679",
      add: "07255e2fa8f2220ee295d6e764d17248af645947367cfde304afd7e8ecb72cc1",
      sub: "72aaf7a117edbbbf8ce149b352479e1b0f853d16d49ab4d978fb37a2de499fcf",
      mul: "4009937dce7df89e68789b4309a7cca4fa98e2e99ef13cd8e8c9a3c453fc0808",
      d: 101669670,
      divQ: "0000001f2c3efa20b5c12fcb5bcce9b31820afbab3241cd147a9d02cab1eeaca",
      divR: 60669516,
    },
    {
      a: "6bbe5c5f91e1a0f35dfc6535a40f046cc52dfcbb6e1fec186b9eb06bf8b17807",
      b: "60b16a7d9843cbf638bf77d425898a3aa2aa1462124305daf74dbd2db050a8f0",
      add: "cc6fc6dd2a256ce996bbdd09c9988ea767d8111d8062f1f362ec6d99a90220f7",
      sub: "0b0cf1e1f99dd4fd253ced617e857a322283e8595bdce63d7450f33e4860cf17",
      mul: "4f85133b4417e83df21b1f3188d9bb2115a2b657395b3321fd2e3ea2ef551e90",
      d: 252623140,
      divQ: "0000000727ccf5b1da1bb8703e874191615c5f133a91622f24ab5f7ada808c2d",
      divR: 198917299,
    },
    {
      a: "3ae3e4235c3f8bc0bbeef62e901c9b6cd64a2e3c11520ecab85ba5fe66752510",
      b: "b0cce47da58cd02fe64d4f75de020e6319297dc120ea84c549b323cb379e0398",
      add: "ebb0c8a101cc5bf0a23c45a46e1ea9cfef73abfd323c9390020ec9c99e1328a8",
      sub: "8a16ffa5b6b2bb90d5a1a6b8b21a8d09bd20b07af0678a056ea882332ed72178",
      mul: "84e471895ac8e09f284e8b239891706a3e39ec6f61f7db486188853384dd3180",
      d: 84406297,
      divQ: "0000000bb4984df61c7c1fbe5e8f9a4bdf42c6cc8f69fb5dc012cf87d96a65ed",
      divR: 17301739,
    },
    {
      a: "17e8b8e7a082be4b8b1b895e40037e42037b2307b597435bcdf0099fadd38d1a",
      b: "1af07fd0224cbd362efeda76fe79ba0b2882095c038f7b46193244dc3d36651b",
      add: "32d938b7c2cf7b81ba1a63d53e7d384d2bfd2c63b926bea1e7224e7beb09f235",
      sub: "fcf839177e3601155c1caee74189c436daf919abb207c815b4bdc4c3709d27ff",
      mul: "e5c19201ff3efec0172e6d8bc4778df90a4f922e6c2154762c934102c17723be",
      d: 127750059,
      divQ: "0000000323d32d62920fcfcecc7fd1caca1e22a33916a486db0ecce4c990b1c4",
      divR: 35476270,
    },
    {
      a: "c756ccc21371dd5f4ebfc3b35147d53287ec55d354550779f3e6a8429e781e20",
      b: "6fc9daa0ab7cbc5d9c8d1ebd22c0a6f74c08595640d7994bcee0c762b52a3edb",
      add: "3720a762beee99bceb4ce27074087c29d3f4af29952ca0c5c2c76fa553a25cfb",
      sub: "578cf22167f52101b232a4f62e872e3b3be3fc7d137d6e2e2505e0dfe94ddf45",
      mul: "dc447129c23513e54621d8bb9dc10dcbc81fb65634fa7e9c5d7168a0394d8560",
      d: 3295678,
      divQ: "000003f6c5117a037c7c59612274a64e3de8d2e652962f26010503ebd4790c52",
      divR: 1677124,
    },
    {
      a: "ee0823d16bac0b58c0329362551b4d64b632a5f1c144797c98fb58243f40b026",
      b: "12066e5cf36e06dc9e08e7bc6199b7554d849b3870e5cb29a57fc8982f347187",
      add: "000e922e5f1a12355e3b7b1eb6b504ba03b7412a322a44a63e7b20bc6e7521ad",
      sub: "dc01b574783e047c2229aba5f381960f68ae0ab9505eae52f37b8f8c100c3e9f",
      mul: "f7f24749a916a1f7e76ed954628b01ef202bb3369a025a1e264d7b13aa95aa0a",
      d: 68067409,
      divQ: "0000003aab813fb8f576f9c42e1a8300b3669bd2f38b964ef5c7fd00248d2226",
      divR: 53289504,
    },
    {
      a: "ae369761304a1b8675a8729952534f606e5ca71dbe1a12c1c4407b29be6d5f7a",
      b: "78fcee88cfd50e8357266348e95c460acfa8c8d737ad358cf0da0153d68f7be8",
      add: "273385ea001f2a09ccced5e23baf956b3e056ff4f5c7484eb51a7c7d94fcdb62",
      sub: "3539a8d860750d031e820f5068f709559eb3de46866cdd34d36679d5e7dde392",
      mul: "67ebf43276e80289ac00061c0f38633faab2d0a3ac6ae3835fd6e7c971242490",
      d: 53006233,
      divQ: "0000003724145b4cc4957219b04fbd9d4229c98952bec6a9a57058ba696a9e44",
      divR: 18599126,
    },
    {
      a: "0d065430790e2e069c896e8dfe07a222fddc3437c652d73aaa287d678e7ed790",
      b: "d7e09a0b5fafd9b3e06b0d81f28eb3848b2dd39809b3a6d5c97966ca4f41edfe",
      add: "e4e6ee3bd8be07ba7cf47c0ff09655a7890a07cfd0067e1073a1e431ddc0c58e",
      sub: "3525ba25195e5452bc1e610c0b78ee9e72ae609fbc9f3064e0af169d3f3ce992",
      mul: "eeceab12610fe92a13b9f3616b01f853e25c0c69cb99713809931604fafa30e0",
      d: 103583608,
      divQ: "000000021c0ddba3766d3ee0c324f902da2326bdb09f0cfc086ba5af55dac6a8",
      divR: 102359248,
    },
    {
      a: "1a74ff3b3d39310a3ace77f0860aefc67f0de7015675982e3688163f6bd53e48",
      b: "b73b5c0a16d8b9ec0eb774dae62b962901495ed820195e044e65dadeb0e68ac5",
      add: "d1b05b455411eaf64985eccb6c3685ef805745d9768ef63284edf11e1cbbc90d",
      sub: "6339a3312660771e2c1703159fdf599d7dc48829365c3a29e8223b60baeeb383",
      mul: "b956030c88091fe6ec9801d39b481d9936931ed6c39acc9386321dc6635bbd68",
      d: 173545696,
      divQ: "000000028ec468c9d11241e49b65725f6079be2184adc0492056591e6aa8c31e",
      divR: 126858248,
    },
    {
      a: "c96e799460aed2274e79145301f8eb6bd82bc10e460269e8ec65e59b7019f25e",
      b: "cf1f0950f9fd73fce9258acec4e74c4cee83445e379f876d3cddee1e301cadfc",
      add: "988d82e55aac4624379e9f21c6e037b8c6af056c7da1f1562943d3b9a036a05a",
      sub: "fa4f704366b15e2a655389843d119f1ee9a87cb00e62e27baf87f77d3ffd4462",
      mul: "f78d4b352886edf4981eee4191c3f3b57b8d9b5606daa8e55800fb10049c1a88",
      d: 125555856,
      divQ: "0000001aea7e7ef5c2395be9d23f3094f287ed21bb9ce7606742766a4526b59a",
      divR: 82985918,
    },
    {
      a: "4ca80339f808f17f02ca69f55a35268a9fcde1d5ca40a4a0972bf87a2d7882f4",
      b: "f7769261e9ac53ce0989a90849c791cb7f6239d2782e4df132507c154029d3e7",
      add: "441e959be1b5454d0c5412fda3fcb8561f301ba8426ef291c97c748f6da256db",
      sub: "553170d80e5c9db0f940c0ed106d94bf206ba803521256af64db7c64ed4eaf0d",
      mul: "e80bda2bae60564c7bd92ec61eb0560bfd4abdae773d18a7abfa40c754c1462c",
      d: 170652439,
      divQ: "0000000789479efe9774a07975660bfe18f7efc6a7f4bebc1007b8c742e62443",
      divR: 18786287,
    },
    {
      a: "cc67626f006e9d2ba92e0d51045d68426ebc14a83b7e42ad7653d61060d76c27",
      b: "98e4e1d57b16cf351eae50dddda9a9d9eeec4df8dfefbece3fd7bbd720084652",
      add: "654c44447b856c60c7dc5e2ee207121c5da862a11b6e017bb62b91e780dfb279",
      sub: "338280998557cdf68a7fbc7326b3be687fcfc6af5b8e83df367c1a3940cf25d5",
      mul: "6c7ac0e5842308081c0a204c59e8f98c944af3cd874707b5aeae51bb2dcb4e7e",
      d: 238459900,
      divQ: "0000000e619303719e6df19594aa5db272fdad14c64e8a7295a52c8db46fe891",
      divR: 71873131,
    },
    {
      a: "ad28c0033cd8dab71977dc8ff894e09138b5c9d53ac65bc0c6020135d34159ca",
      b: "51f5ca9dd3293db242d6c640296708cf30586dce409c76e47e22312f8c77d28c",
      add: "ff1e8aa1100218695c4ea2d021fbe960690e37a37b62d2a5442432655fb92c56",
      sub: "5b32f56569af9d04d6a1164fcf2dd7c2085d5c06fa29e4dc47dfd00646c9873e",
      mul: "414be94616ab3a87c24c541ec17f6f196b7e567dcf0c468a91a6e74c584ace78",
      d: 42014556,
      divQ: "00000045255165a586c55709e053d0011b9140018075b782309bfeead9c6fcad",
      divR: 31326366,
    },
    {
      a: "24cd6e0611e4d4f0268873fcad306f785fa5bee30939fbee678788fe0d1ff09f",
      b: "1337317824d4b0d56a0708d23c429e3928facd3c58c966c5ca4481e2c8335349",
      add: "38049f7e36b985c5908f7ccee9730db188a08c1f620362b431cc0ae0d55343e8",
      sub: "11963c8ded10241abc816b2a70edd13f36aaf1a6b07095289d43071b44ec9d56",
      mul: "2ad0daa6128157a7cf42e1d651c14837da0dd09fd367cf2c4a9c8b6a40cc2a57",
      d: 48638605,
      divQ: "0000000cb1cad2117fbe90be0ae2db3e3230fc194ac7a7b563a8997afe36b315",
      divR: 12573710,
    },
    {
      a: "7b83d18a647f270858b5cb8a0a5ad1991f4e6c01499f4835047da027c16e82bc",
      b: "4d895cd621006a6c443f6e9ff27aa50bbedf69f5579094eec0f6128f339b6edc",
      add: "c90d2e60857f91749cf53a29fcd576a4de2dd5f6a12fdd23c573b2b6f509f198",
      sub: "2dfa74b4437ebc9c14765cea17e02c8d606f020bf20eb34643878d988dd313e0",
      mul: "fd6aa47aad3116bcfb952c16a6cd02e2fc3ebda232afd34b2cf6184052f92190",
      d: 4897629,
      divQ: "000001a71c31425020f88654134f310cfe4c865ea0d01e97141a6cab48c0fdc1",
      divR: 2906271,
    },
    {
      a: "e9a17fd6ccb161d5ae82bb72f1aeeb011033291864af6d54ec9ac7142b6f504d",
      b: "6ec17fa9e9f055c37f63c9b5c41c63243aa76684e0d2b202e75a7745e66a7174",
      add: "5862ff80b6a1b7992de68528b5cb4e254ada8f9d45821f57d3f53e5a11d9c1c1",
      sub: "7ae0002ce2c10c122f1ef1bd2d9287dcd58bc29383dcbb5205404fce4504ded9",
      mul: "1163b6597219071087ef98d858a5781f9b252bec84e5f7b03ec88a4d3ec45fe4",
      d: 214642472,
      divQ: "0000001242ec1f303c3d896ac0584987f6e40cb626480a412816e3091834139b",
      divR: 63556373,
    },
    {
      a: "6c86c9080d186d1b4ccae6f0496bfeb4ef988fcc37c64379cc7c9598537974ce",
      b: "54754f2671a07b7833b5c5562a64323f998cb359c34b9eb413d8dc304173f150",
      add: "c0fc182e7eb8e8938080ac4673d030f489254325fb11e22de05571c894ed661e",
      sub: "181179e19b77f1a31915219a1f07cc75560bdc72747aa4c5b8a3b9681205837e",
      mul: "132e5e15c241a617e9a7ca945b0bb13439be811b0897e8cdef596b0733746e60",
      d: 151384155,
      divQ: "0000000c070a1b484781fb5894832f2d2fc51cbbc4f0db753c766c3dbed52cdc",
      divR: 123224730,
    },
    {
      a: "09408798fb6da97b04e1ac3e9a226f84fd1990ecba74c5f1e2748649478f624a",
      b: "f8fd509974fc0c48caa58c5b73c839838c81707a0fd7ab43527fe49d430dad2f",
      add: "023dd8327069b5c3cf87389a0deaa908899b0166ca4c713534f46ae68a9d0f79",
      sub: "104336ff86719d323a3c1fe3265a360170982072aa9d1aae8ff4a1ac0481b51b",
      mul: "abc53173162792bcc66499412f3433aa1872ea79a46c00295ec6853364810d96",
      d: 153438422,
      divQ: "0000000102faa1d874f4428c68d28d0aa85b1f04118d05d6c3e885ede467cc4a",
      divR: 111397998,
    },
    {
      a: "a165a63de5725aee491abe18f851e2b4cf3c18358cd947bb31733d1425c1208f",
      b: "76ec9b75b81b176299de47b565e17671b90e1d42b282a9f76b8cab631d64dac7",
      add: "185241b39d8d7250e2f905ce5e335926884a35783f5bf1b29cffe8774325fb56",
      sub: "2a790ac82d57438baf3c766392706c43162dfaf2da569dc3c5e691b1085c45c8",
      mul: "af0d5a34b461acd0c59081060bc4e6c46879527b8c51ccc3e4605f3db9b61529",
      d: 71138208,
      divQ: "000000261057e9b089e78a76a5ea58a3927f31d10020af0416dec6a20aac6614",
      divR: 36812815,
    },
    {
      a: "4a53c69bde6f79a9e532c9d671f632f40b3aab2b9b0a8a2828ddc10bf6348e95",
      b: "f91e5feb55c0dc5c324c6ca43fec187af4586ba7ad772c383c4988aa4bfc7e8e",
      add: "4372268734305606177f367ab1e24b6eff9316d34881b660652749b642310d23",
      sub: "513566b088ae9d4db2e65d32320a1a7916e23f83ed935defec943861aa381007",
      mul: "37df3539708128843ae6ecec430fb088384a5c1f9b8b77f9580f904471006ca6",
      d: 24680060,
      divQ: "0000003286dbfe65524ddcdf5d39e2f9d2fac6118052b9db4830c73989385b8e",
      divR: 11731405,
    },
    {
      a: "252e77cab0956288196c0028ec3270a5041a8f3e84078cce9972f9c813734035",
      b: "45065911acc8b292d4f6e0939e1390e830df5fb6bd6aa80fb8b4d704ef2385f0",
      add: "6a34d0dc5d5e151aee62e0bc8a46018d34f9eef5417234de5227d0cd0296c625",
      sub: "e0281eb903ccaff544751f954e1edfbcd33b2f87c69ce4bee0be22c3244fba45",
      mul: "241cf5f04a3e03fa96ee80de6e5053518ad98174b5cda712de0fe3345ea6bab0",
      d: 43051475,
      divQ: "0000000e7d5c003f094a954a906c9643e050fd6e5146c4ba66258b05104e591a",
      divR: 19342791,
    },
    {
      a: "6bbd6a51bef0bb0a59e08f12aedfda711e38708812738885094d7c7f150fc2d7",
      b: "b2df8d2af6176639252d93cca46795a4617b3d9750d7fae5bd9405d0eaf02696",
      add: "1e9cf77cb50821437f0e22df534770157fb3ae1f634b836ac6e1824fffffe96d",
      sub: "b8dddd26c8d954d134b2fb460a7844ccbcbd32f0c19b8d9f4bb976ae2a1f9c41",
      mul: "c773ac5e8a596fe3c689365353529638dfc061bd7987fcb89f2e7825ddb813fa",
      d: 53412814,
      divQ: "00000021d773c4f3e60ce7865ec2b276241466fad8ef650cc315a98e91dd77b6",
      divR: 543843,
    },
    {
      a: "97e1351e88f5e492998ffbff51a1c7539cb543795edf97cca5eb91484b4f83ad",
      b: "17bbaf9d56f9d9d5c527a86a0849493840a77b4e800316c039954459355738f4",
      add: "af9ce4bbdfefbe685eb7a46959eb108bdd5cbec7dee2ae8cdf80d5a180a6bca1",
      sub: "8025858131fc0abcd468539549587e1b5c0dc82adedc810c6c564cef15f84ab9",
      mul: "ec6518a47bb9655b290a6826544d10de32899ab290877af879c712cebd6258e4",
      d: 153508721,
      divQ: "000000109963d3e0792d3089c499b86442de79a958cc5082bd7ea8a91b37f634",
      divR: 56580793,
    },
    {
      a: "7c33e3bd89806769628ba3e83299768466947d04ae4d215a4206c25286d17674",
      b: "0f04e8fa52c2b3259a60e0708adec4aa13978d55f06dd2e8197de15fec591e0a",
      add: "8b38ccb7dc431a8efcec8458bd783b2e7a2c0a5a9ebaf4425b84a3b2732a947e",
      sub: "6d2efac336bdb443c82ac377a7bab1da52fcefaebddf4e722888e0f29a78586a",
      mul: "475bd9615b2cac4b4fbfe2f5e2b212f5db7d891b39507fd74d7e2416ee643888",
      d: 53311952,
      divQ: "0000002716222be53b5239187ba5cefe1fdb2756e23b0a108e0d76dc63821df8",
      divR: 5694708,
    },
    {
      a: "6c5f8ad5b1d64594e4f60a775f5043db3f9f569a9e6f3b287fde7e776ec71f6a",
      b: "20f519ba80da0dc281ca96278c67c6a2e163794ec49d4cc8f2eba7c79939f45f",
      add: "8d54a49032b0535766c0a09eebb80a7e2102cfe9630c87f172ca263f080113c9",
      sub: "4b6a711b30fc37d2632b744fd2e87d385e3bdd4bd9d1ee5f8cf2d6afd58d2b0b",
      mul: "5c7202965d53d31cebbc79a7e2a206229cd6b2dbcdcf276e1a7d016a3e6fb056",
      d: 163096354,
      divQ: "0000000b25e4630dac5e1406bac062aea69bc75b5b9a4fb895bbfbc7942721c5",
      divR: 133505088,
    },
    {
      a: "7d67edf62adaf3be7e9d765aeff3e64c129fef9f5ba02112f0a77922b254ce61",
      b: "2e751f3486ab618cb6486883fb2c5575c9b10ef549d6bf9800d947ca6b3ba18b",
      add: "abdd0d2ab186554b34e5dedeeb203bc1dc50fe94a576e0aaf180c0ed1d906fec",
      sub: "4ef2cec1a42f9231c8550dd6f4c790d648eee0aa11c9617aefce315847192cd6",
      mul: "f14848c8312f0f19b944ff9a5964e8396d5499c15a449c2d9606e35645320fab",
      d: 89706718,
      divQ: "00000017742c052d005b072745ddda97326e72a37ff0a239d9e864e4e4add16f",
      divR: 4653087,
    },
    {
      a: "00682e071204cadf1030eab0c23f592ba730a7bba8bffc221773e87c747d5c3d",
      b: "45f63c4aa7022e0a4ee88959c9999ae32b6d570419decff8bdb003be78273f0f",
      add: "465e6a51b906f8e95f19740a8bd8f40ed29dfebfc29ecc1ad523ec3aeca49b4c",
      sub: "ba71f1bc6b029cd4c1486156f8a5be487bc350b78ee12c2959c3e4bdfc561d2e",
      mul: "bcb923212e1184a509ee2b7e9a8c3bd470de394b2ab9648407a0ee9152566a93",
      d: 9262573,
      divQ: "00000000bcb32efd55a6da8a463c9091919161597783218c2fe594033621a926",
      divR: 3941903,
    },
    {
      a: "0e62334c95b52eba15cd515c4578b38148b14ab4411293d380714198aab9e9ba",
      b: "9e59d30104645a90cf7267a95eb4ed7aead6b97f91766ecf09006f0fbbf44455",
      add: "acbc064d9a19894ae53fb905a42da0fc33880433d28902a28971b0a866ae2e0f",
      sub: "7008604b9150d429465ae9b2e6c3c6065dda9134af9c25047770d288eec5a565",
      mul: "e7601352ac6123bfffeb3280b7f3c9221433a05ef36ae6caec7c33ddb51802c2",
      d: 196657157,
      divQ: "000000013a22c9c231a12b8a5343013a637d2998ebedb8182e11229fc1840a24",
      divR: 95074054,
    },
    {
      a: "eea456384f60d9eae14ffb2c44cd96be2853a757d4f8f2e3d5c55318cfa19765",
      b: "1c77f1a25025f50f7f956197a9f65ef3ce0b5f74d1c8fcb005ca6a9bda1f2ecd",
      add: "0b1c47da9f86cefa60e55cc3eec3f5b1f65f06cca6c1ef93db8fbdb4a9c0c632",
      sub: "d22c6495ff3ae4db61ba99949ad737ca5a4847e3032ff633cffae87cf5826898",
      mul: "e47d93c001ec319b0c876b807bae92b2ba67466c712b7168e2fb3bd1a4d561e1",
      d: 133952416,
      divQ: "0000001de3aad8a28478deb67dc09056a44b036ac922ab71f94f51ca50578322",
      divR: 119561253,
    },
    {
      a: "920a4505ba996f14cba91a0b9180f88835afeac808f8911909762b47dd007b8b",
      b: "a169f21d72bed639b4c6820a2f03931dfc5d90ec6436a77f640a670747a1b68d",
      add: "337437232d58454e806f9c15c0848ba6320d7bb46d2f38986d80924f24a23218",
      sub: "f0a052e847da98db16e29801627d656a395259dba4c1e999a56bc440955ec4fe",
      mul: "03c2affad99b3f9e0f52140f645ffdee2bb9e974ba5d52f4bb7e5b115083dd8f",
      d: 164934823,
      divQ: "0000000edaf1151a191004cd01d0488a5722b2c505928d778b6b4079cf4f2a86",
      divR: 159221281,
    },
    {
      a: "e926e4ff7d4d0da03296f66938436615246fe5aee7b8abcfe60bce06366a0435",
      b: "0984f48dfd013784c897ad3fecda235f348905ab385b2cd1a9941b398757394c",
      add: "f2abd98d7a4e4524fb2ea3a9251d897458f8eb5a2013d8a18f9fe93fbdc13d81",
      sub: "dfa1f071804bd61b69ff49294b6942b5efe6e003af5d7efe3c77b2ccaf12cae9",
      mul: "275a8abc5dc69971febf0ab1ba396d1c89b6e1b35808380eeedf7902236c0cbc",
      d: 135014199,
      divQ: "0000001cf8d9559ce6be1b4c406ec0af1cfee30e0daab292fe7f6f9279ba0949",
      divR: 10217094,
    },
    {
      a: "98f5df80e7efb07b780532910c8ef00914ecd5e54ede10df24af25ae01de4588",
      b: "3cd4075c4f12dfb8dc525270609e007eca5defd3d0d00343e83ba1d7d3af6384",
      add: "d5c9e6dd37029034545785016d2cf087df4ac5b91fae14230ceac785d58da90c",
      sub: "5c21d82498dcd0c29bb2e020abf0ef8a4a8ee6117e0e0d9b3c7383d62e2ee204",
      mul: "40e4f48ab7e0b6709cdb4a6ac8b80116e013e42e6be12a2d751e1fea8b777220",
      d: 205145644,
      divQ: "0000000c82688066f624459f62efa6e4555f7c044d66901bf556c6d9827e7f04",
      divR: 108878040,
    },
    {
      a: "daef5bd3171b70f88de2ed345483b00aab9476a43b593036ef9e47657b383227",
      b: "fbb1fe797b6af487caf33aa88ce8453d81cbdf778c0f2e361f1082c1d8bbcd47",
      add: "d6a15a4c9286658058d627dce16bf5482d60561bc7685e6d0eaeca2753f3ff6e",
      sub: "df3d5d599bb07c70c2efb28bc79b6acd29c8972caf4a0200d08dc4a3a27c64e0",
      mul: "3cfbfee7780567412397b6bc400109dfb9adf1ef95a665de45701a95b73c23d1",
      d: 138225362,
      divQ: "0000001a92cb39f643a703cb99be9e467b7ed5759a82c277971cf8eb987914cf",
      divR: 24864345,
    },
    {
      a: "306190d4df46b2992a766537cae579a24fdb05e9543bffcf034f252734a20441",
      b: "24916175f57e31fd3f93790c2d10d21faed24287ef7014e7e39f76b3bb14f9a4",
      add: "54f2f24ad4c4e4966a09de43f7f64bc1fead487143ac14b6e6ee9bdaefb6fde5",
      sub: "0bd02f5ee9c8809beae2ec2b9dd4a782a108c36164cbeae71fafae73798d0a9d",
      mul: "6da5b6c3af181bb52f2bd1adbb03656e4fa889f2da4a9ee266f754861e01f2a4",
      d: 67870361,
      divQ: "0000000bf5a67ac22ae9823395159ca7c5745fd6fa92ddd94cbfd4e6573f7a67",
      divR: 62474930,
    },
    {
      a: "a4b42331e2826d6ff8ec7bb87cc02bbe896eb6f29a5f91ef2cb0736d1ad09516",
      b: "30fc57a08d8de795419b9f94486bb22655b3febb00108b9b6bf340305c598da7",
      add: "d5b07ad2701055053a881b4cc52bdde4df22b5ad9a701d8a98a3b39d772a22bd",
      sub: "73b7cb9154f485dab750dc243454799833bab8379a4f0653c0bd333cbe77076f",
      mul: "4638637c3f60c7557ff5ec560ddd7f0aeae9d76f7f42a53f8f8320291cd45f5a",
      d: 38862363,
      divQ: "000000471a9ed33d7a717fc2ad577031d21f23aab501e1939d8ad58a059d88bd",
      divR: 7840551,
    },
    {
      a: "ec38528dac43a2a4b5f6acdd8c9e20e1292598180c932d225e5ca48991aee7ef",
      b: "2eebd9a1d5d139d12ec19701ceac413a5120c0a1a8f8efb50bf92fd47e404505",
      add: "1b242c2f8214dc75e4b843df5b4a621b7a4658b9b58c1cd76a55d45e0fef2cf4",
      sub: "bd4c78ebd67268d3873515dbbdf1dfa6d804d776639a3d6d526374b5136ea2ea",
      mul: "5bafde2c6175331c3e8d034469f2b05be764471009cc2cfd4624bfc19aadf2ab",
      d: 174150469,
      divQ: "00000016c1c02daeefdf1e3a0139cb268e7cfe310bc59e2fcaa079a9a37d864a",
      divR: 138786813,
    },
    {
      a: "ef0ea24da9b68b6c3a88d62af58d0f25c998da8a981d68b90b676900c0986792",
      b: "0eb675a3accb936310ebaf38a9a01eb0e49d3b6c35208a9f49b7c5d0500f627c",
      add: "fdc517f156821ecf4b7485639f2d2dd6ae3615f6cd3df358551f2ed110a7ca0e",
      sub: "e0582ca9fceaf809299d26f24becf074e4fb9f1e62fcde19c1afa33070890516",
      mul: "06a0d8fdc2b0fe489133ecf2a058fccf29debb2cf7c29ad8ee69900353060eb8",
      d: 45904746,
      divQ: "000000575ecf30c2eebbc80ddd8a34b717c3e603b6d642cb1d7183f8ba86aa10",
      divR: 45141234,
    },
    {
      a: "acf6aaf3b9bafdf45898002aae30ea561ad4a2af8b10e012fe99a962c6a34af7",
      b: "9e2eee19da5e5acc43a65b788d1393346de8bdf41040d9a109d6dcfc6b22e0c2",
      add: "4b25990d941958c09c3e5ba33b447d8a88bd60a39b51b9b40870865f31c62bb9",
      sub: "0ec7bcd9df5ca32814f1a4b2211d5721acebe4bb7ad00671f4c2cc665b806a35",
      mul: "6ec2e029a7d489afae2c0fc197e174e49f1676f01d2965ca63717bd29b24ef2e",
      d: 221844832,
      divQ: "0000000d149d41cda8c25ccdddb045958b7fdf5a0a05267245a8d6ef9006b5fa",
      divR: 8882999,
    },
    {
      a: "b18ad417a2e482ce4d9bdf9d0ad64e9505495d73d2ca8798c43aad914abfde65",
      b: "1aead496bc5efd61261f1c7d189f2e9fbe5eca323f02b5ef03c0e6dc4843900e",
      add: "cc75a8ae5f43802f73bafc1a23757d34c3a827a611cd3d87c7fb946d93036e73",
      sub: "969fff80e685856d277cc31ff2371ff546ea934193c7d1a9c079c6b5027c4e57",
      mul: "0ac8590a9023bbd997ce21f8db4c392599ffbb1f2be33fb9a0559b8da005f986",
      d: 105063002,
      divQ: "0000001c59ea4f5b2f82dd614a1ee99f5f2ec733a50be0bbee340b8422fcb885",
      divR: 76961187,
    },
    {
      a: "7b1e9faf686f1116094a8d0bf38f1fe38d68df28903d428b7571b78826e6e7ac",
      b: "6bd54e41a487cf93eee77fe0afde4eba824e454507c997d89ed351b1a042ba44",
      add: "e6f3edf10cf6e0a9f8320ceca36d6e9e0fb7246d9806da6414450939c729a1f0",
      sub: "0f49516dc3e741821a630d2b43b0d1290b1a99e38873aab2d69e65d686a42d68",
      mul: "ae8dd739b01285309b545e6768525b5751b22a5b3f6cd4454aaf9ead540081b0",
      d: 154805141,
      divQ: "0000000d57df95517dd5901b04c45a8917cf6d64fb995c24753b514cb6b9371c",
      divR: 37290080,
    },
    {
      a: "bac94f1fba9e940eb0a1e15f6bed926be477c2e350a8f5bf34ad215184f7b1e2",
      b: "26653452139b4adaeafd069154194f7d1dbec08a22527d5110fb4acf2b9f4747",
      add: "e12e8371ce39dee99b9ee7f0c006e1e90236836d72fb731045a86c20b096f929",
      sub: "94641acda7034933c5a4dace17d442eec6b902592e56786e23b1d68259586a9b",
      mul: "2814e2195fbe85b26a5b3cbfc275eaa789e83ecf6419f999a98333f3046603ae",
      d: 207380671,
      divQ: "0000000f1c72aa1d3b1ee9fdcd09654b144bb720f47e06ede0fa54060508015b",
      divR: 46698237,
    },
    {
      a: "355f9083b584511fa91dc10daf56638339793076e0492d06b89ed4c48f005fcd",
      b: "1dde96b029d125e7188254f0c04311c06838afea78266eba55de1fadcc29ad5e",
      add: "533e2733df557706c1a015fe6f997543a1b1e061586f9bc10e7cf4725b2a0d2b",
      sub: "1780f9d38bb32b38909b6c1cef1351c2d140808c6822be4c62c0b516c2d6b26f",
      mul: "4b51fae6e95d8fc5613d3cc4572d24a682c198b384649f71a92ab8bf76b5b646",
      d: 166859287,
      divQ: "000000055dd4e866de08e02271bdd59470309834871efe727cb5639f005f4441",
      divR: 87206902,
    },
    {
      a: "0235fa22c16af8fc3facbbc53ce7d1945ad44a27b6a013962242e606df0bb6d6",
      b: "7b816157e00dcd38e1b87702c7195cd25215e2f93f85759f978a03455a2f94b7",
      add: "7db75b7aa178c635216532c804012e66acea2d20f6258935b9cce94c393b4b8d",
      sub: "86b498cae15d2bc35df444c275ce74c208be672e771a9df68ab8e2c184dc221f",
      mul: "3da360485fece73dd43b9bf81b6dff3a5522454a145f31d1db2442f8045d6afa",
      d: 93216371,
      divQ: "0000000065dd88c2318cb3ba0dfc0cacd4e9a231068ee4826f8877e276cc7404",
      divR: 6430986,
    },
    {
      a: "8a4c6b55e4de2b1a331e5d56ff9e7565954902f62fb47415d2ad134ecede7125",
      b: "267d00b7e08942fa1cd7e508b5036a381ecadd5dec24935a1bf719f2ab6c69a5",
      add: "b0c96c0dc5676e144ff6425fb4a1df9db413e0541bd9076feea42d417a4adaca",
      sub: "63cf6a9e0454e8201646784e4a9b0b2d767e2598438fe0bbb6b5f95c23720780",
      mul: "81edd373c830370d3f3d592b4c05ec177e992da9c99449a6e8ed320a046319d9",
      d: 91996129,
      divQ: "0000001938a8946745a50489b4f08c0ae567944947e49d5d4e8e975605a2ab0f",
      divR: 34662390,
    },
    {
      a: "6f787a954746f7596ba1bab17d02583f06c8166e5fe0ae8f833f8cd68f0b5153",
      b: "30a903186f9a04253bef30bc77982cac6b004e644fc67abce8b8cd98f24ecab8",
      add: "a0217dadb6e0fb7ea790eb6df49a84eb71c864d2afa7294c6bf85a6f815a1c0b",
      sub: "3ecf777cd7acf3342fb289f5056a2b929bc7c80a101a33d29a86bf3d9cbc869b",
      mul: "741373cb549d63769c8ba1dd95fe568621232e167ea68df0e1e68fb0fb97f1a8",
      d: 190512391,
      divQ: "00000009d106c2969efd8ae134e364a16add0bdc96715a0d758278cec7f67291",
      divR: 102425180,
    },
    {
      a: "39930ddbcd31ecaa2fdafaf8c8fb05710dec6a26ee29f862099d914bf7dec1a3",
      b: "7468278949bea3d16b99775f6da812151efe18d425c9c881a6c47fababa14485",
      add: "adfb356516f0907b9b74725836a317862cea82fb13f3c0e3b06210f7a3800628",
      sub: "c52ae652837348d8c44183995b52f35beeee5152c8602fe062d911a04c3d7d1e",
      mul: "d10e8fcd0fa633c209387a2b6507373ad2e067b432974297ff748d9f9aace5af",
      d: 79211736,
      divQ: "0000000c31c36b5759fed5696bac6f7cbb94cdbbcabc13d0fcc95e66a1437738",
      divR: 43551331,
    },
    {
      a: "01bd042ff453f4f18b14abffe8a855a35fdfcf2d9f3a133b991dfcde71e67cdc",
      b: "fea60c33f1467d13a52577caa6f4200de7ee9e3b2dd474239337b6413cec8df3",
      add: "00631063e59a7205303a23ca8f9c75b147ce6d68cd0e875f2c55b31faed30acf",
      sub: "0316f7fc030d77dde5ef343541b4359577f130f271659f1805e6469d34f9eee9",
      mul: "48480a1a77ee1ef2da5d4cee50deb19129b4513b2a6831910b0ead7cbb5db0d4",
      d: 81475028,
      divQ: "000000005ba3193033ecb2777a28efc908ade6167efe330a88e1c2860d6ab33a",
      divR: 64032468,
    },
    {
      a: "4d60756ca54656d403af13ea7aa56d2f09b76acdba33d49d03150c0a91356859",
      b: "f6f39d3c5e2f0d11d8ba870cb422419db1a1791eb5a5275b8fa02f0cf1d1caf5",
      add: "445412a9037563e5dc699af72ec7aeccbb58e3ec6fd8fbf892b53b178307334e",
      sub: "566cd830471749c22af48cddc6832b915815f1af048ead417374dcfd9f639d64",
      mul: "20cf6f30a88b7e32bb9c89ef8047ed82aeb95e98dc9d71ace141ebb3161c172d",
      d: 157651691,
      divQ: "000000083c01aa4541d717f0a09c8508501b57982e1d253b5007300df3dce3c3",
      divR: 77340248,
    },
    {
      a: "46be74e99f5d6ebd7717a0cdebb4206445693dc8ecd4740de894841e6f852e5f",
      b: "71f77589b703e08175b425ec9057d02838719a50a7a937c9b1a0c0109c9578b7",
      add: "b8b5ea7356614f3eeccbc6ba7c0bf08c7ddad819947dabd79a35442f0c1aa716",
      sub: "d4c6ff5fe8598e3c01637ae15b5c503c0cf7a378452b3c4436f3c40dd2efb5a8",
      mul: "dc33861c33eca849d820ddafcbfb12d0738ecd3534d70958d73eecbe073bade9",
      d: 25254753,
      divQ: "0000002eff1f877a8559b58f55b2e350893895b8056281933f2dbff8b0752332",
      divR: 23990893,
    },
    {
      a: "acaf4c22cfb4f7554d6f4e20275dbe7be547d4187c2499e7c1e6de2d9258f1de",
      b: "55ad1a0a3f86d5fabc7ea85af86cbdad44337928894f46cab1ade7d591edc43c",
      add: "025c662d0f3bcd5009edf67b1fca7c29297b4d410573e0b27394c6032446b61a",
      sub: "57023218902e215a90f0a5c52ef100cea1145aeff2d5531d1038f658006b2da2",
      mul: "f0edf58bbe20d35cec3544074c85cc10a7f635d16b2cb6d4ab9263c70e8ca808",
      d: 250907476,
      divQ: "0000000b8bf8bbd79d1bb48b74ebedec3072671d466d39848d6cfb65c2c011e1",
      divR: 153741578,
    },
    {
      a: "a5cc06123cbb86d0616afc62c6a557cc08fe1920faa01d6de6503f467737db7b",
      b: "1911ab9a97cb968314f6fef3b2179a60f517f12c759b7434566ac0ac55bd668d",
      add: "beddb1acd4871d537661fb5678bcf22cfe160a4d703b91a23cbafff2ccf54208",
      sub: "8cba5a77a4eff04d4c73fd6f148dbd6b13e627f48504a9398fe57e9a217a74ee",
      mul: "de5ae3dbc19e139816330ae943906af07272b4aa7b647c2721163410cc05e4bf",
      d: 13242750,
      divQ: "000000d20c41bde5169f1f46ffd8047218cfd4f03bfe9c91a16f9084d2c083bd",
      divR: 9795445,
    },
    {
      a: "2421c3658c4b6f752d67d6a71442b4c80de9d941f22cb285aa69bf112837f588",
      b: "b19c51d9c9779e292ce610764a69ae7706617b98b24adc555f40bf0d2388a83f",
      add: "d5be153f55c30d9e5a4de71d5eac633f144b54daa4778edb09aa7e1e4bc09dc7",
      sub: "7285718bc2d3d14c0081c630c9d9065107885da93fe1d6304b29000404af4d49",
      mul: "f4b1cfcc13b7886d212908f805a83eb0ce58fe7cb57f5d2ad40e3bd1a726ac78",
      d: 162328001,
      divQ: "00000003bbff89d8eb99849814e4c5a371e02b49993c5f2d084c305ff7c5ed81",
      divR: 57899591,
    },
    {
      a: "c808b5708b81c57368d8173a9db4b7c7b162ce185680733cd5b6cf59e015fdbe",
      b: "a497c3e19edb8597d3d1883293a9f60ff39f38c9971a5501033880641a6b0921",
      add: "6ca079522a5d4b0b3ca99f6d315eadd7a50206e1ed9ac83dd8ef4fbdfa8106df",
      sub: "2370f18eeca63fdb95068f080a0ac1b7bdc3954ebf661e3bd27e4ef5c5aaf49d",
      mul: "20bf8e9e4b2f59974aa1faab2c3022b732311e7253bf2c800833e6a5032b637e",
      d: 117105607,
      divQ: "0000001ca8738006c3fa536fb2c4a44e241437931eb21929d163576ecb56907d",
      divR: 94033299,
    },
    {
      a: "6321bdb392e9fe2e87a93b3987e1f339245c36e01d8fb20b87734280341e4fc8",
      b: "cbec1f9254580a6e3f2b58545520317b83c685f30ee2f6e442757737685db8b8",
      add: "2f0ddd45e742089cc6d4938ddd0224b4a822bcd32c72a8efc9e8b9b79c7c0880",
      sub: "97359e213e91f3c0487de2e532c1c1bda095b0ed0eacbb2744fdcb48cbc09710",
      mul: "de8f43fd7978bc2a534234f31c63c76a4477995aee650bd8c0644cff7ac917c0",
      d: 251513721,
      divQ: "000000069cd24ff977b7e64120be1d1c049a1366b0b65b4540f5c759e23a3873",
      divR: 137326701,
    },
    {
      a: "1950cde44c30c5fe6733e80124578d3188f4851a4a6e3730116e6aac7b8d7dd0",
      b: "f31de41ae10321fbfd3b5df360724b29327d9875a9ed8fe43bf27cac9727a15c",
      add: "0c6eb1ff2d33e7fa646f45f484c9d85abb721d8ff45bc7144d60e75912b51f2c",
      sub: "2632e9c96b2da40269f88a0dc3e542085676eca4a080a74bd57bedffe465dc74",
      mul: "413524951c38e0e4f66b5e4d6fa628abc8d5260b7928b5b61c8d5f343da906c0",
      d: 237524606,
      divQ: "00000001c9c331f8e3805ba4658cecea0eff809676b94cf8538f9a9c2c11bb1d",
      divR: 57649034,
    },
    {
      a: "b4c0cb3f4261c59a61a20a01ed0cf7eaf1b88f9b73d01e43914877d93e7ae6a1",
      b: "8aa04f0f70ad3d3517be425e86f95fd5ae53c9fe2333ccdc2dad57794a82dd5f",
      add: "3f611a4eb30f02cf79604c60740657c0a00c59999703eb1fbef5cf5288fdc400",
      sub: "2a207c2fd1b4886549e3c7a3661398154364c59d509c5167639b205ff3f80942",
      mul: "4afb1eff40b62035138733a0b51916b68e8e3eb09aea14ce9600febaf07692bf",
      d: 13688475,
      divQ: "000000dd8a091e7e0d8948c7df90259dba5ad9058f30163923d46d1ed0d509ea",
      divR: 12909043,
    },
    {
      a: "9e0bc82c66ada7e3cf1ec88c1a366deecf6ffdd77d691e36fe613c73a0c9d795",
      b: "54195e01842b539b0eaaf9b34b0e5cc2924053d87731518f8231280123ea5e7c",
      add: "f225262dead8fb7eddc9c23f6544cab161b051aff49a6fc680926474c4b43611",
      sub: "49f26a2ae2825448c073ced8cf28112c3d2fa9ff0637cca77c3014727cdf7919",
      mul: "22fd03fb2ff45ab2d8f87a9ed84acbbfdf2c05f12924c91a13f66d996c1f222c",
      d: 248230531,
      divQ: "0000000aae909e37e1d6ead40d0f0114abbcbc0ac17d624f5ad44b2a1461de01",
      divR: 227379986,
    },
    {
      a: "12d8ad9a2f5409ccc35f88c14933f40bfa0db6d99d96e324247fee2e8b858f86",
      b: "ef88be08ca17ae587cb889eb3a7caf4befef5b697697fe9eef80054e746281cf",
      add: "02616ba2f96bb825401812ac83b0a357e9fd1243142ee1c313fff37cffe81155",
      sub: "234fef91653c5b7446a6fed60eb744c00a1e5b7026fee48534ffe8e017230db7",
      mul: "a7b04f797ab341336bdda7f1323050122e71592b00df48e63b0052eec79d935a",
      d: 121382995,
      divQ: "000000029ada7ab9af71ed12da807be76bc42bdf2f154e3d93332b52f4ee4f0d",
      divR: 64742991,
    },
    {
      a: "a4baf994a64e49aadced9142c43db5cced20c2ba5f6e08d28d7bf41fcffedff1",
      b: "6e81512bfc4d4caef4c2e50cf52c7c43651e8157efd04f4b2ee16606ac831b3c",
      add: "133c4ac0a29b9659d1b0764fb96a3210523f44124f3e581dbc5d5a267c81fb2d",
      sub: "3639a868aa00fcfbe82aac35cf113989880241626f9db9875e9a8e19237bc4b5",
      mul: "83e84903009a6a1f3947a403d8c78d35c2a99ca9789ef03215d785ed25ade77c",
      d: 120801981,
      divQ: "00000016e0c9a60bde017da4887024e54cd710ac2cf5f21f187cd853ba8dbc3b",
      divR: 3201634,
    },
    {
      a: "dbec7ba720bce2e69e95df36226a1618980d2c5a811c6ba22deeee97f38c7a06",
      b: "8eaf793322303b7915b30b63fa8befa8eb8cfb4c306b0fcd0a70152496cc1a42",
      add: "6a9bf4da42ed1e5fb448ea9a1cf605c1839a27a6b1877b6f385f03bc8a589448",
      sub: "4d3d0273fe8ca76d88e2d3d227de266fac80310e50b15bd5237ed9735cc05fc4",
      mul: "4818d14183dfe31105b5a12f7ac7ab11195c3de9bcb8f20daa02fc31cf64118c",
      d: 155261228,
      divQ: "00000017c3b78a0e8e9d2c7ee3c71174fa20cdcb4cb8058c798b090bcb9d3250",
      divR: 72221766,
    },
    {
      a: "487d794b690452b0cbe48abd4ebeb0b282409b266026d813cda55c42ad1f8a61",
      b: "a4acf29305cdf662c82b2e0f166fe0dd383aaf20424f79b91db7a3b846cf4f5d",
      add: "ed2a6bde6ed24913940fb8cc652e918fba7b4a46a27651cceb5cfffaf3eed9be",
      sub: "a3d086b863365c4e03b95cae384ecfd54a05ec061dd75e5aafedb88a66503b04",
      mul: "764e536dfacc75ba2d55487166b884eaf373937b610a0d10fde9ecb50a98343d",
      d: 146302560,
      divQ: "0000000850131218d96bab658801e3bbca604d8ff838005783a716b18acb48ac",
      divR: 105890273,
    },
    {
      a: "7aa2c0326e6c47bc3e8aa2683f58e48e12ce81fdcf3f09b6e25beb5d5e82aae7",
      b: "f80e18fe02a90999142c738fb4f5b952105eb31a946d797fb16fd7b56c11e3dd",
      add: "72b0d9307115515552b715f7f44e9de0232d351863ac833693cbc312ca948ec4",
      sub: "8294a7346bc33e232a5e2ed88a632b3c026fcee33ad1903730ec13a7f270c70a",
      mul: "ca8bfb4478651a2758d07c3fe16baf9447305a0d6b1e7acd5134378241af5e6b",
      d: 249259426,
      divQ: "000000084120320ccf6f86f729a61ae2050770f3b7a0b3f2930c327cd9e154b8",
      divR: 236353143,
    },
    {
      a: "0ef9de41e370a0dfc8ac84a5076bc79b26a9c946e51b6dde0d6d78cc9f013209",
      b: "d8e4f1cbafbbee7ef07bda1ade0692d0f459b9dfa2998e4bd49c6878cf589a4c",
      add: "e7ded00d932c8f5eb9285ebfe5725a6c1b03832687b4fc29e209e1456e59cc55",
      sub: "3614ec7633b4b260d830aa8a296534ca32500f674281df9238d11053cfa897bd",
      mul: "dfa0e97efd907bdff0843adac5349b61305aa6c982a99d9ec872b07c668c44ac",
      d: 166688741,
      divQ: "0000000181e0f286571a183c1b11d917e9b2d888cfa0ce4fc3fb35a72ffeaf4b",
      divR: 44926706,
    },
    {
      a: "71d8e56024c58e18a6fb199ed0c869d1fb4b1f273d3b487fed90fcf9a3590d2b",
      b: "54f1bbe5864a3b2df965c9c7e93de257697cf0fac62972aa596ac7b1aea9e6a6",
      add: "c6caa145ab0fc946a060e366ba064c2964c810220364bb2a46fbc4ab5202f3d1",
      sub: "1ce7297a9e7b52eaad954fd6e78a877a91ce2e2c7711d5d594263547f4af2685",
      mul: "5723c5a827f8e18375ae537392d4b1e08785e1edc56fc6a28dbc3719d8f62be2",
      d: 140404775,
      divQ: "0000000d9a934d6a7920f23bd2cf9499ca410af7072eaec06ef7a57532d05eec",
      divR: 73578295,
    },
    {
      a: "f38651a7bef0c7901b637d1b3dfb89ae16afc8507d740cd8d54aeb1476cce01f",
      b: "b5b4e2fc7f35478a68cec3ae6a3e4d8e2f19470f52bbca43c09bc82b3f7677e1",
      add: "a93b34a43e260f1a843240c9a839d73c45c90f5fd02fd71c95e6b33fb6435800",
      sub: "3dd16eab3fbb8005b294b96cd3bd3c1fe79681412ab8429514af22e93756683e",
      mul: "592393ceb36f7fc1e2b51f105dedbce080a98dcbec3f039ba5112b019589643f",
      d: 166392964,
      divQ: "000000188de7f7ad371221bb99d9d87d017d41c236245e9a94df71e3820d7f59",
      divR: 35414587,
    },
    {
      a: "bce4089ad9d7123e7a9b250a5e0c942751156b4148552d7095aaa8e0283353d3",
      b: "c0fff4c73bd349a20e60e85e5e4c29f01c3f3d5557d8339acd865fcc72303287",
      add: "7de3fd6215aa5be088fc0d68bc58be176d54a896a02d610b633108ac9a63865a",
      sub: "fbe413d39e03c89c6c3a3cabffc06a3734d62debf07cf9d5c8244913b603214c",
      mul: "7aa7520c61a2795209c5f4461bcfb9bb4c418348c5585f44aa5d5426e7006a45",
      d: 101662230,
      divQ: "0000001f2c25d60efa65653ec8403b06254e2b1be1c9e41a5d9e0a46e82aacf4",
      divR: 72965851,
    },
    {
      a: "8a868e20e31efbff09a2693939400fdb744ac4c095c1b954f85f7c8e93817217",
      b: "54a9df84420e9739b1778e04c9eadcb75764e3330e7dfa7a26702bb5a8b3ab96",
      add: "df306da5252d9338bb19f73e032aec92cbafa7f3a43fb3cf1ecfa8443c351dad",
      sub: "35dcae9ca11064c5582adb346f5533241ce5e18d8743bedad1ef50d8eacdc681",
      mul: "986e9186aad481a96139dc11de90f6b4f013bc0979c1464f5563d5b6c323367a",
      d: 2249341,
      divQ: "0000040939729f09212c845e1b5e2ae5de03ca0cf8252989d506003ef9ef0ecb",
      divR: 1323768,
    },
    {
      a: "a420677b206f3ad2f4b3384f8a15c4c0fdddba8d3bb0589e78ed9d56e1cf4928",
      b: "f0cafa010aa140932620110a29430de371a363dba497129faeca3a2ac22b9cf0",
      add: "94eb617c2b107b661ad34959b358d2a46f811e68e0476b3e27b7d781a3fae618",
      sub: "b3556d7a15cdfa3fce93274560d2b6dd8c3a56b1971945feca23632c1fa3ac38",
      mul: "908ae798c8fc7d64d5a5ab398b8f6697b663da93dfbbd7f25b8086df9ca0f580",
      d: 121934784,
      divQ: "00000016951bedde20cb9da6e05da29d61eb026c59252cdf62e112dda19c4231",
      divR: 110592360,
    },
    {
      a: "368d8b4350c0f0a8ba233916887a596cc9bcc2d5a72dbcea875b6ff71fd29d70",
      b: "e8c1697ef96c672db7b706a943936b58258f3cb595e2af5ef97eacc2198de978",
      add: "1f4ef4c24a2d57d671da3fbfcc0dc4c4ef4bff8b3d106c4980da1cb9396086e8",
      sub: "4dcc21c45754897b026c326d44e6ee14a42d8620114b0d8b8ddcc3350644b3f8",
      mul: "7287a0d12767461d7ca1087ea0e314b6f0a9e9c744b64500857f0f0e42b4bc80",
      d: 6753913,
      divQ: "00000087836fe7528b687026dfe84f8705e7d905adaaa224701cbccf68059443",
      divR: 2023365,
    },
    {
      a: "4cb736255486f2aceaf772803d5df38ae12cfc155bae10b56d0d477389e7808c",
      b: "d784c9f83d594725feb47e0745c7bffae09edbdb3488924c9ae038426f54fc53",
      add: "243c001d91e039d2e9abf0878325b385c1cbd7f09036a30207ed7fb5f93c7cdf",
      sub: "75326c2d172dab86ec42f478f7963390008e203a27257e68d22d0f311a928439",
      mul: "732885088851109b3414fd55f0fe582df6ded692f5382deadca64b007a887d64",
      d: 161032385,
      divQ: "00000007fe1e4244b33ca07d275fc081356986365a0ddc807210ad0b81d35a4c",
      divR: 560448,
    },
    {
      a: "10c1bd859a0945792f6ac77f446b5a0f782fb58d5204ff707f675c75a8d28db2",
      b: "cc2c29649fc1f0cfdc7f5bf500ff184ef0162657c94d8e6a8cfd2235b06acf80",
      add: "dcede6ea39cb36490bea2374456a725e6845dbe51b528ddb0c647eab593d5d32",
      sub: "44959420fa4754a952eb6b8a436c41c088198f3588b77105f26a3a3ff867be32",
      mul: "cf766d1e510fee1a26441e76f8a48b6b9248ed070ed1a9b0bf8d00c9b58dc700",
      d: 99219378,
      divQ: "00000002d55c8015ae5373223afff610964b0b17e8a35b8761956e0f47ecf454",
      divR: 31432522,
    },
    {
      a: "3bd0ff6235aa676003a09637385e869a5688370b4ab2a3fa6c424c7d53c84994",
      b: "a970038fceb319e1c8e2b7e8fe58f73f782c872eead3c6a4766bf5d406b85b39",
      add: "e54102f2045d8141cc834e2036b77dd9ceb4be3a35866a9ee2ae42515a80a4cd",
      sub: "9260fbd266f74d7e3abdde4e3a058f5ade5bafdc5fdedd55f5d656a94d0fee5b",
      mul: "5ed6e084a1402ed24e86bd7c2254c32a3bf0be4835e71f189f2210ee341ffdf4",
      d: 149480683,
      divQ: "00000006b6ae17f7bf85e174a6ee6c6c1e9e8cb0b1d191aca3f294a54c6bdde0",
      divR: 136846580,
    },
    {
      a: "0dc7b97f54d2bedd4c752ed7eef6414bd0caf131441d9c90b9a9fa676a939911",
      b: "4ee53534bd4a4fc2e067fe8d481753dbf99860bdae005be258d82859a2c62fde",
      add: "5caceeb4121d0ea02cdd2d65370d9527ca6351eef21df873128222c10d59c8ef",
      sub: "bee2844a97886f1a6c0d304aa6deed6fd7329073961d40ae60d1d20dc7cd6933",
      mul: "0db07eacdb4932539a2865ce5264cc95462446cc39ac8d486f60d62daa3edbbe",
      d: 138356512,
      divQ: "00000001abc64a4bc26290cb41dd1f882091ed05dfea1799cd1843f55ca99c12",
      divR: 103504081,
    },
    {
      a: "aeb87330bbb81c4bde0ff7ca00480272483fe6d92a02f620a18adc5355ff8670",
      b: "d3f97d11eab5052933f3dce240f7f9a3b4444d274dfdd620f105350759ad3fb9",
      add: "82b1f042a66d21751203d4ac413ffc15fc8434007800cc419290115aafacc629",
      sub: "dabef61ed1031722aa1c1ae7bf5008ce93fb99b1dc051fffb085a74bfc5246b7",
      mul: "27234dfd3e99ba3decd91687bfd2f31a39fa45a495ee476817ca8addd16db6f0",
      d: 87235461,
      divQ: "000000219a39058000b8c807e11339b569c3ce822985d629861ea90275abafd0",
      divR: 30556000,
    },
    {
      a: "e013de2f0daf271d48d862a95af32f84bca7d8725c1fdc00b5ff4a0a1f0ee7c8",
      b: "45dbafc44d92db2cb7f377be7b3cfa3d31696269cfb318d6bfa01ff5b71621fd",
      add: "25ef8df35b42024a00cbda67d63029c1ee113adc2bd2f4d7759f69ffd62509c5",
      sub: "9a382e6ac01c4bf090e4eaeadfb635478b3e76088c6cc329f65f2a1467f8c5cb",
      mul: "e81924e3ad76f9d51ae37e84229ea4824e3c6fa8a0d2c4e8fb3ed76180cbd8a8",
      d: 141731500,
      divQ: "0000001a8658b7aee2e9525b7df456b5b495f20c6d8c15c7266011203f92041c",
      divR: 97647864,
    },
    {
      a: "e791a817df6efa2c7ef2de6feba7d292657c0c869918d7c803da490d1eac538a",
      b: "d0934c65fc9a7697d6e358779957a4c193a59d67e33b47a9e798f78ac2c090a1",
      add: "b824f47ddc0970c455d636e784ff7753f921a9ee7c541f71eb734097e16ce42b",
      sub: "16fe5bb1e2d48394a80f85f852502dd0d1d66f1eb5dd901e1c4151825bebc2e9",
      mul: "2841eeee3f2995b2eb761b363b80bfc6c2f2c7773b49b17fdde4197274de29ca",
      d: 178411704,
      divQ: "00000015c6a409187da69871dfd998312e9a8a6b1adfad1615e6140cc0903dcd",
      divR: 67596338,
    },
    {
      a: "fda0be9ef899cc2b81fe57c4d9496aed169636394b7c9172df14e9ac7f866507",
      b: "4595d454aaacaf2963b344e46ce236c99f6af5ac91b7af83cc3b658258fa03a0",
      add: "433692f3a3467b54e5b19ca9462ba1b6b6012be5dd3440f6ab504f2ed88068a7",
      sub: "b80aea4a4ded1d021e4b12e06c673423772b408cb9c4e1ef12d9842a268c6167",
      mul: "8df118f59b47728cb1e7c1d2b26e87aebd29b6285372fb20ced1ddd558043960",
      d: 186267719,
      divQ: "00000016d8292a5677a2ae74e502fecccf889f67a9d342bee688eca1b84a4503",
      divR: 8821042,
    },
    {
      a: "63f4c98d070cf38562f47723d73ab1a01a78db837a2659983fda4e5a030dca57",
      b: "20ef6792cd61f794515ace2cb43ff84af3772f2fa78e49baed10b2597b1ade15",
      add: "84e4311fd46eeb19b44f45508b7aa9eb0df00ab321b4a3532ceb00b37e28a86c",
      sub: "430561fa39aafbf11199a8f722fab9552701ac53d2980fdd52c99c0087f2ec42",
      mul: "e143321e3f2bff5f0cd1aaedc4e9918ead925d0ce2c95b7d986241e58f6f0b23",
      d: 162439073,
      divQ: "0000000a52e3db285b1fe01b3e9070ff66caea5964d321424b713b3ecbbaeb6b",
      divR: 76433164,
    },
    {
      a: "9169d1360365e5323889c97627432a79456157fed497c2dd0c656108352861e6",
      b: "e9e5292727107e27cc1188c46ac2c60e5b28f085c0d91e775c269954e46dc91d",
      add: "7b4efa5d2a76635a049b523a9205f087a08a48849570e154688bfa5d19962b03",
      sub: "a784a80edc55670a6c7840b1bc80646aea38677913bea465b03ec7b350ba98c9",
      mul: "1539eb195a6de64594eedcb78e3b92f61d80f4010421cee964689e85415ead0e",
      d: 54166179,
      divQ: "0000002d0a2d0d87b2f168f869ef1babb075f1216bce17b8328e3a767032687f",
      divR: 37313289,
    },
    {
      a: "628ee2f340143feb5f3ca40d3c73d9c16bd8a29407b3f1baaa2e4de00f8c9cf0",
      b: "620a04297b9bb52098bceaf00d1315de5ede78bda2ad32e0e80066964347e65d",
      add: "c498e71cbbaff50bf7f98efd4986ef9fcab71b51aa61249b922eb47652d4834d",
      sub: "0084dec9c4788acac67fb91d2f60c3e30cfa29d66506bed9c22de749cc44b693",
      mul: "5a9b9c9cff75c23cb9850ecd171d8133ff4c053c94fc5ea34ceb4a1051a4a330",
      d: 76534539,
      divQ: "000000159ae38fb137f0b00f86f892708d01b05d19f4a22c6d52a365566097be",
      divR: 20086214,
    },
    {
      a: "f122969b76f81d2e83780dbb28220d23df4d74b0050b3163b90667f740c0ad40",
      b: "ac07af5f469b3d070c402ea971cd2ed6cdd514e1eff26d33b380732c42b4d50c",
      add: "9d2a45fabd935a358fb83c6499ef3bfaad228991f4fd9e976c86db238375824c",
      sub: "451ae73c305ce0277737df11b654de4d11785fce1518c4300585f4cafe0bd834",
      mul: "646cdcf64b37ffce0ed0573835a14a5ab8fbfc2afecbd6bde84a539baa2e5f00",
      d: 116266548,
      divQ: "00000022cbb2f1f5dfa6d237ebe04465b169cf9ebb8c0655701038816cc77aa9",
      divR: 76758252,
    },
    {
      a: "40d4b90fc538dff9e4b6435a6680ddc44d2f245b0fa17e00c44ec3796423d318",
      b: "3aff8807e30e6d56828c88932fb04ff550a26d96f099245a5904477ba2c77e7d",
      add: "7bd44117a8474d506742cbed96312db99dd191f2003aa25b1d530af506eb5195",
      sub: "05d53107e22a72a36229bac736d08dcefc8cb6c41f0859a66b4a7bfdc15c549b",
      mul: "3c915e16569eb7ad6bdb72435282a17c0b0e408fe01589671488c985cf0be2b8",
      d: 103613647,
      divQ: "0000000a7f5b41ccbc647878148f7405f118a4d509f699341cf39944a548c406",
      divR: 36649534,
    },
    {
      a: "3da07c67f1c190e3db230a82d78499f4344b8b499c3021e123c58a17454ede17",
      b: "829029f96d0a3a5687d401c597730e479123d4898dc0b4c8822378989e836c1e",
      add: "c030a6615ecbcb3a62f70c486ef7a83bc56f5fd329f0d6a9a5e902afe3d24a35",
      sub: "bb10526e84b7568d534f08bd40118baca327b6c00e6f6d18a1a2117ea6cb71f9",
      mul: "588f3ee68e58a0f286acbf7c85180610fc676d5444a3479fb82aca0d3cb4bab2",
      d: 133016235,
      divQ: "00000007c5dfad43087e5b417fe294e01e11f3a90154fa3b95b0d99b95dfa7a2",
      divR: 77484257,
    },
    {
      a: "8c0b0e432f6d07c086d276e2e646babc6662e9eb2a2cd50ef77a7404481114b0",
      b: "34b8084ab4cca28e50aa19bf1a2a26f0dbe3269642802b97d5361003432aa866",
      add: "c0c3168de439aa4ed77c90a20070e1ad424610816cad00a6ccb084078b3bbd16",
      sub: "575305f87aa0653236285d23cc1c93cb8a7fc354e7aca9772244640104e66c4a",
      mul: "4fd7d9df4ad6dca28172628061cd8168a506891fc8022b01d51b92476141be20",
      d: 88223185,
      divQ: "0000001aa1b81fe9a6c805beabcb217667f5801227360dd15466320a20add65b",
      divR: 16848229,
    },
    {
      a: "6764e49421f3f66655c60e569430aecfdb4a8fe207cd0b9c1f457eb887f3243e",
      b: "81129925319b8ea198b2302c19e00bda7642470930b62adc139f1b14ac710d79",
      add: "e8777db9538f8507ee783e82ae10baaa518cd6eb3883367832e499cd346431b7",
      sub: "e6524b6ef05867c4bd13de2a7a50a2f5650848d8d716e0c00ba663a3db8216c5",
      mul: "23e2be10413d2d8dc0ba87a26c985a80f1de885267e612ef9a6701a44221474e",
      d: 80794765,
      divQ: "00000015785358e6bcddb20509bb5357e5315f1d28f0d06d6a507a94a952d481",
      divR: 8996145,
    },
    {
      a: "cfb7d7ee88f80832c6c57335967b34aa6f83bbe25506789b690f559f6c20f933",
      b: "63ba1259cc7f5afb2db55d43ea9fb00f930c9ec9c893bd22ed25530a4abcb045",
      add: "3371ea485577632df47ad079811ae4ba02905aac1d9a35be5634a8a9b6dda978",
      sub: "6bfdc594bc78ad37991015f1abdb849adc771d188c72bb787bea0295216448ee",
      mul: "10d2321e0d598c7a189958349be6b117f4e6175b8b4edfa7f7c8e38c8faa3abf",
      d: 54697506,
      divQ: "0000003fb67b0a8c01e8cd4db3f1d3eead0bb70360cbb952235998123426fd10",
      divR: 10714387,
    },
    {
      a: "c2aa4382bbbad84679c6ee922d60bc991989a61b326a59414d80062fabd95cde",
      b: "2b70e1def4ea5ed59e47f8d5ba91ac821b85a630f33e491ca4124d3f1f21fa55",
      add: "ee1b2561b0a5371c180ee767e7f2691b350f4c4c25a8a25df192536ecafb5733",
      sub: "973961a3c6d07970db7ef5bc72cf1016fe03ffea3f2c1024a96db8f08cb76289",
      mul: "08cf63772bb99f495c39a9119d0f1817ac87bdc38f1b8e18be89b58c2e7aa1b6",
      d: 153168823,
      divQ: "00000015528dae9a07936eab85505b4a55e154fd481e01edaac8190adf638fdb",
      divR: 71876177,
    },
    {
      a: "70d95e1372e6e127ebc96e527d00c7bf13fd2595e6eff541c05e2d151ee4925f",
      b: "d843ef3ca84fd16529fd7eaa772643fa2b37593b52451e9271cf9435d8313ad1",
      add: "491d4d501b36b28d15c6ecfcf4270bb93f347ed1393513d4322dc14af715cd30",
      sub: "98956ed6ca970fc2c1cbefa805da83c4e8c5cc5a94aad6af4e8e98df46b3578e",
      mul: "2038d24db5db358188cf0d23e9470a76ded5b57ea8c16f2ba9f796292df4058f",
      d: 245245157,
      divQ: "00000007b8522e3f691f4f1e36f69903c16d9c17bd0949c865d9df29886518c2",
      divR: 20849877,
    },
    {
      a: "a78f58afe8ef44bdc237c10bf891464033bd3cb731a23598b2cf844013af2f61",
      b: "60184d01aef96001525dd0add9eb29b10979ee627520edb256d5642a52071446",
      add: "07a7a5b197e8a4bf149591b9d27c6ff13d372b19a6c3234b09a4e86a65b643a7",
      sub: "47770bae39f5e4bc6fd9f05e1ea61c8f2a434e54bc8147e65bfa2015c1a81b1b",
      mul: "744f69d762b488069d63d143f5bd581722c04705b46ba514ea167bf06f418886",
      d: 8081522,
      divQ: "0000015bda9d11a3561b426283f78b2100033aaa99997c85f98732a3f71b1601",
      divR: 4461295,
    },
    {
      a: "fe8f70b3981fa9039be71649bfe1c73d18dca067d3e77babab34adba75e88b83",
      b: "ac4fe345713ab2009ebc458bbaf150466f3d210ee81d8902aa133d26ffad7da4",
      add: "aadf53f9095a5b043aa35bd57ad317838819c176bc0504ae5547eae175960927",
      sub: "523f8d6e26e4f702fd2ad0be04f076f6a99f7f58ebc9f2a901217093763b0ddf",
      mul: "ccbff7fe3e035b9d0a0043f4ba4d8cdaec70f2a6ece5ceebcb839495d99f56ec",
      d: 202696118,
      divQ: "0000001511ed82c3aadc12a6cf8873037a07d539176d9ba9df33af01bb41bce5",
      divR: 156198837,
    },
    {
      a: "d53973324e00b78e4226c56d76932d115aaa23e52d4a11d194667742b84dcfa7",
      b: "ab54beba52282d9d20a37bd9c46cfbb5ec0ed1e98b8a96b27c9dc6a200640b0c",
      add: "808e31eca028e52b62ca41473b0028c746b8f5ceb8d4a88411043de4b8b1dab3",
      sub: "29e4b477fbd889f121834993b226315b6e9b51fba1bf7b1f17c8b0a0b7e9c49b",
      mul: "643533f1f5ec8667acff52bd944519e64ac030b43d2cd669ff41051f18cde8d4",
      d: 228051568,
      divQ: "0000000fafb90a7acbc5cc45ca2929520b361bcbfaecb21ed8787ed8293cb7de",
      divR: 179712647,
    },
    {
      a: "a09d587d9c3a35bf2b50e4267b161c7705cfa5c8b25f1650ce3af8eed22c3244",
      b: "0e51f83199b06ec7356181c159e01f89912d99d853a84222a60126b0e49c1910",
      add: "aeef50af35eaa48660b265e7d4f63c0096fd3fa106075873743c1f9fb6c84b54",
      sub: "924b604c0289c6f7f5ef62652135fced74a20bf05eb6d42e2839d23ded901934",
      mul: "91f0528758dc44e37da99bff95c0238c2038aa2cb633c20462d2f7e6a51bc840",
      d: 254080374,
      divQ: "0000000a9b066c1ec3b1afae4078e01abe0878d27208d3ba3b75ccdb55e756d7",
      divR: 70412330,
    },
    {
      a: "ae4391c4b623dc9a4740deb0edd73b3b19434f566f07cc23fb4852cc23c407b5",
      b: "81efaf9398b2892aeb59e2b177916974d58b80143d7eef5be69663a61e24b09a",
      add: "303341584ed665c5329ac1626568a4afeececf6aac86bb7fe1deb67241e8b84f",
      sub: "2c53e2311d71536f5be6fbff7645d1c643b7cf423188dcc814b1ef26059f571b",
      mul: "56aae43ea076057c8634825f5d4a7f0d8a7f9c098e2bc89a957a263a94ad12e2",
      d: 193358,
      divQ: "00003b10784942bc5d50fc7755e5cf1cdd393324ddca09fe38847f1f651f4e67",
      divR: 24403,
    },
    {
      a: "23d00930756e3c916c1a09f561e59e230674bc0a03e005c7cbc37efa7c934db8",
      b: "81a8ca9eec9928ce3c16846056633819f04953d12897b36a15f8ab5c96fc63ba",
      add: "a578d3cf6207655fa8308e55b848d63cf6be0fdb2c77b931e1bc2a57138fb172",
      sub: "a2273e9188d513c3300385950b826609162b6838db48525db5cad39de596e9fe",
      mul: "87e5f9d3abd9045abd18ffe54cd7c2cc0d2bdd77bfe3254cf5cfe6d5cb349fb0",
      d: 140184269,
      divQ: "00000004493a647a48e2e49dadc1651810d7928144fb128c0a23189255d30d77",
      divR: 45997933,
    },
    {
      a: "1db054dfd38439de27536297f63c070cd7b6504dd9df9a6e2b6fed2fb6b0a242",
      b: "f8b1081d7bb42b0f633815444dd263471165b4e5c98138e57e9d3a029c277346",
      add: "16615cfd4f3864ed8a8b77dc440e6a53e91c0533a360d353aa0d273252d81588",
      sub: "24ff4cc257d00ecec41b4d53a869a3c5c6509b68105e6188acd2b32d1a892efc",
      mul: "379891cfdc9b07c713d36f411bbba7d130da2d80f850c336ce5dfa6a3d3e040c",
      d: 36264682,
      divQ: "0000000dbc28d101b9e6822bea39740a9c935a3bdb54f07eb25612020d4e8726",
      divR: 5225862,
    },
    {
      a: "fca6dd68f37dac0903bb791a169b015b7b6aa0b977da1caccc03b4f6090a005f",
      b: "3426b9c460465bcb8c1c2e296697fbf915ff280c8a12f49b8dffde72b6d2ccf9",
      add: "30cd972d53c407d48fd7a7437d32fd549169c8c601ed11485a039368bfdccd58",
      sub: "c88023a49337503d779f4af0b0030562656b78acedc728113e03d68352373366",
      mul: "ffc3b7bfa8951a3b486691463328d8dd85ac5660d381ce6d247725489af41067",
      d: 158427560,
      divQ: "0000001ac16273f14fecec725002e356b060d223fa7d207dc42dd3dc34775c52",
      divR: 61196431,
    },
    {
      a: "5a6800f44da7141704d8d42f7fcdc4c6cc403fc8f2f9757616f5a5201dc6790f",
      b: "6d3953dfe159ea6ad02b67189eaa82f5651f906f00ed3fb38b921b8ffe8fb64c",
      add: "c7a154d42f00fe81d5043b481e7847bc315fd037f3e6b529a287c0b01c562f5b",
      sub: "ed2ead146c4d29ac34ad6d16e12341d16720af59f20c35c28b6389901f36c2c3",
      mul: "e08510ff15e431d906439b0a80e6edc8f8646d7457e115ec4efd9d0f725d9a74",
      d: 117147354,
      divQ: "0000000cf28f65184cd30b3151b9b82f2a94bf33a4f2072266c4e36c320bdc5e",
      divR: 103390467,
    },
    {
      a: "6734467353ba57d8d648d1bfe894cc72fe274d933757ec666f09227cb88f8af0",
      b: "219b1a11305e3373aee9e522a9f12ff50f8102d48276b6decb857e5361f9a567",
      add: "88cf608484188b4c8532b6e29285fc680da85067b9cea3453a8ea0d01a893057",
      sub: "45992c62235c2465275eec9d3ea39c7deea64abeb4e13587a383a4295695e589",
      mul: "3c3701a1584b8489aa8379801c502d2f22a4b4c90368fbe158c15635d9bd9690",
      d: 209112998,
      divQ: "0000000847b57473cb4a95674abf43a2563e640ad16de17847383dc66de9ed2a",
      divR: 46058420,
    },
    {
      a: "7d33bf95d37e7d0306644d3eb7822b6a799eb0e07637b800e7213c79fe2bc4dc",
      b: "1f942d3ae8d1a4e8027107f7258addaf1b84f0a4e4f267150f917d2c24b6426b",
      add: "9cc7ecd0bc5021eb08d55535dd0d09199523a1855b2a1f15f6b2b9a622e20747",
      sub: "5d9f925aeaacd81b03f3454791f74dbb5e19c03b914550ebd78fbf4dd9758271",
      mul: "28c413dceff4f3670c15698969916db39464441390de498bc635d7216973fff4",
      d: 38501350,
      divQ: "000000368ec27f656a1bdfdbb620db7f23b5702d3af3c07e5b9cc45f0b66c07e",
      divR: 7621032,
    },
    {
      a: "b9b1cbaebf24e92b1bcdbef8a2bdb139298ea36cf65513dfd0630ad3be09d4e6",
      b: "55b9c506b9ec6be917d6e6733b30614015c2ff4c1b321bd84db251e0cb1dd353",
      add: "0f6b90b57911551433a4a56bddee12793f51a2b911872fb81e155cb48927a839",
      sub: "63f806a805387d4203f6d885678d4ff913cba420db22f80782b0b8f2f2ec0193",
      mul: "a77d70f1809e41ee548d1f07f96f92d4b00afb01d4b58376ee9a6a7837b79892",
      d: 138261184,
      divQ: "0000001688719af01fc59cb14cb56db9e2a49fd42cd1e3c45855d7af67b36d45",
      divR: 67954470,
    },
    {
      a: "6c71eaa304ebc31ff0e393fa076b9a7061ffbc063396c70da10bbffc41097c4e",
      b: "0ed8bfa8049b17ff4cbf46561932596e378c3ba6afbc6eb8a5a2e2c6d2f50db5",
      add: "7b4aaa4b0986db1f3da2da50209df3de998bf7ace35335c646aea2c313fe8a03",
      sub: "5d992afb0050ab20a4244da3ee3941022a73805f83da5854fb68dd356e146e99",
      mul: "7f5b140236779402e08aad8612242f4d637bfd403f7f813fbc41930769aad926",
      d: 227232414,
      divQ: "0000000801bdc7d09901443cdf21bcd91665287cc71ec028fc4238c46501f65a",
      divR: 62876866,
    },
    {
      a: "69f8500cb2f88173d28106a9050b6be149376c4ce867d940d1bde4ef7f24a431",
      b: "5624d21d9a176c94d09fef983b96d22ae22d558e4a7279878991d07b20f09843",
      add: "c01d222a4d0fee08a320f64140a23e0c2b64c1db32da52c85b4fb56aa0153c74",
      sub: "13d37def18e114df01e11710c97499b6670a16be9df55fb9482c14745e340bee",
      mul: "7cbffea0f07d17fb86effa07b70022585889d29dcfd9abfa49d09897160410d3",
      d: 212526148,
      divQ: "000000085d8f6ffa6794818101159741456af92cebb970b119200bd0343877f8",
      divR: 177989201,
    },
    {
      a: "7024ff10ef7cf75f26147b74a576906abc8fdb17fbe52129fa0205bb53da2614",
      b: "0c8968ae03ca812665cc2bd81de7dc4e57de2072d6d176e72808e101446a1bff",
      add: "7cae67bef34778858be0a74cc35e6cb9146dfb8ad2b69811220ae6bc98444213",
      sub: "639b9662ebb27638c0484f9c878eb41c64b1baa52513aa42d1f924ba0f700a15",
      mul: "7c5744829939d94361d311522cf2b0774667df842f3f77c8c066dbf59c9809ec",
      d: 241530290,
      divQ: "00000007ca305e5bc09a436fead796e0eb49be2c003e8cf8d7bbbf79276d0857",
      divR: 149395094,
    },
    {
      a: "183659776936e0487f6954879f06f30bc983bf9e723cb79a74363777da56e763",
      b: "9cfc27f726f38dc3dc0940ca20d25cd3a99c7a63cac88620af2526ace29de22e",
      add: "b532816e902a6e0c5b729551bfd94fdf73203a023d053dbb235b5e24bcf4c991",
      sub: "7b3a318042435284a36013bd7e3496381fe7453aa7743179c51110caf7b90535",
      mul: "019316377455268d52f62ab59485e6a5d19b9872d3e03e9c49028e5f4199f9ca",
      d: 83154406,
      divQ: "00000004e293e5e9cce0a8aeae86222a0316c2701bd11c5c042cb601bcd1edbc",
      divR: 62776443,
    },
    {
      a: "01dc5f659d2d8b17630d8ee152111b1858bd6d3a54e547dd76b4ab08a7e41805",
      b: "e104a30515cd16b3c71b7219e547e6b60f6f9069fa45843bf2719c3cc013be73",
      add: "e2e1026ab2faa1cb2a2900fb375901ce682cfda44f2acc196926474567f7d678",
      sub: "20d7bc60876074639bf21cc76cc93462494ddcd05a9fc3a184430ecbe7d05992",
      mul: "f5ce3ff6327f809985cd72c240a73124f0032658fe332a2645f6769c3da9803f",
      d: 236665029,
      divQ: "0000000021c526ac461f22b6058828ed0626a99735cc410731f4f805077e834f",
      divR: 192595002,
    },
    {
      a: "ae10d19253c2a9bd556240889f4da3af335c16196d69812ef5e7b4aa8b323bcd",
      b: "ccaeebc5d43439af371d48e141cc7b971ee69a3057e99e4dae2b298991b4b218",
      add: "7abfbd5827f6e36c8c7f8969e11a1f465242b049c5531f7ca412de341ce6ede5",
      sub: "e161e5cc7f8e700e1e44f7a75d81281814757be9157fe2e147bc8b20f97d89b5",
      mul: "1ebf1e1ae18e15fcdb8da264c5fc00024852c7bafbcdefefb4fdadac236e2538",
      d: 2023268,
      divQ: "000005a3606cdc70bea76f0264ba7e79de8229cda75da62b5c5c16bccfcbf4f8",
      divR: 1213165,
    },
    {
      a: "af3f2e9bbcf7de8664013dd388499e09852230d2ee487f9e56913fe4d66c46df",
      b: "9674bf55130c6ac45931364d82bb4ff0478c50c5c218da2f54e4eebf8e762288",
      add: "45b3edf0d004494abd3274210b04edf9ccae8198b06159cdab762ea464e26967",
      sub: "18ca6f46a9eb73c20ad00786058e4e193d95e00d2c2fa56f01ac512547f62457",
      mul: "4657aa30783cdc801e97cf7a6b57c5ca01a728ecb18a1fb799596da5a7b94478",
      d: 38377304,
      divQ: "0000004c9c9d7e08877215adbaff0a6c4b565f41c0d632e4b536c00037a10ad1",
      divR: 35014663,
    },
    {
      a: "31a9153e05e908c399879c05f0f82555d4161745ad6644c15e2aa93d0c8f44fb",
      b: "64345e388fb0e02c6e6df88ba2d8e12c6bf496f0ff3863d48c584a851c8ffc30",
      add: "95dd73769599e8f007f5949193d10682400aae36ac9ea895ea82f3c2291f412b",
      sub: "cd74b705763828972b19a37a4e1f442968218054ae2de0ecd1d25eb7efff48cb",
      mul: "c664b04edabfe78339fe040e6268b267da8545137855ef78c7b8e7c95ef90310",
      d: 168289891,
      divQ: "00000004f365afdf725071e67a839f4b96a6b82cb12fd95289ee0a634e6d89a7",
      divR: 83230566,
    },
    {
      a: "c8855d31219c6b681d0a0fbba1eb773665a1476fed23504f9f87a02e83acb717",
      b: "7e7c643f3494bddef5fe8fdb69b07e2e26980f5b0f11554b690e30b3c939e094",
      add: "4701c1705631294713089f970b9bf5648c3956cafc34a59b0895d0e24ce697ab",
      sub: "4a08f8f1ed07ad89270b7fe0383af9083f093814de11fb0436796f7aba72d683",
      mul: "fd0d019e0f50fc5085b2f59bda435fc452e5dd8ba3022613fca99066132cf94c",
      d: 134367582,
      divQ: "000000190983a838fb4e06d119f753bd57e13bcde87932f3668cb30e5643b942",
      divR: 74899163,
    },
    {
      a: "1b1f7ef999c8565a118b63df880fef460c9c38586e4d17766f962640b6c143e6",
      b: "a57f71eb4e819fd694e61c76cfa1c33bb433382cdf654360a201c6b78e221ffc",
      add: "c09ef0e4e849f630a671805657b1b281c0cf70854db25ad71197ecf844e363e2",
      sub: "75a00d0e4b46b6837ca54768b86e2c0a5869002b8ee7d415cd945f89289f23ea",
      mul: "351aa0b205f53c4bb946e17da4cfb8afeacc2171fa299cd6eef86493e603b068",
      d: 207439339,
      divQ: "000000023192ef609b6cb0e7183df9553ffc6c2a481c7aaa97f1458e1004163c",
      divR: 87469778,
    },
    {
      a: "c85be877a51b7933712e2452419d61af00faf0752b07a661b605fed2f2afbbc7",
      b: "834bd8d0755df96263710a364f12d17838eb7d13adfe770d8c6310870e51f28b",
      add: "4ba7c1481a797295d49f2e8890b0332739e66d88d9061d6f42690f5a0101ae52",
      sub: "45100fa72fbd7fd10dbd1a1bf28a9036c80f73617d092f5429a2ee4be45dc93c",
      mul: "d7214088f8cf88059b4e415e5861997b543785f1a859301f1286a1c430e4130d",
      d: 103651858,
      divQ: "000000206e2bb47af97de3da50711db8b7f8e12133d66045f51e47ef959619ed",
      divR: 98588445,
    },
    {
      a: "38c10f424d39cb2c15be95df9c772fb999cb1cd475b548c2300f9a8f9727ff5f",
      b: "d76ed3389b473b6d432839b3aa2d31e9abc28f93f434b94d9a91cd05a52f12d0",
      add: "102fe27ae881069958e6cf9346a461a3458dac6869ea020fcaa167953c57122f",
      sub: "61523c09b1f28fbed2965c2bf249fdcfee088d4081808f74957dcd89f1f8ec8f",
      mul: "4ad9f7da99621d2899d2e4b68604153611de22ac0c3ecb56d86b4516bde52b30",
      d: 42456494,
      divQ: "000000166d5710701f63a61e6312e879268772a1f842264140e2e2d7af44e655",
      divR: 31176857,
    },
    {
      a: "e8409fb5b3aef955d845a04bc41c07a9566b694c3f610dcb4caddb7d2a547d8b",
      b: "1e0b80fcbd8659b5a94d61cd3726a8377f3f618d38d5690c84b8464cb16937bc",
      add: "064c20b27135530b81930218fb42afe0d5aacad9783676d7d16621c9dbbdb547",
      sub: "ca351eb8f6289fa02ef83e7e8cf55f71d72c07bf068ba4bec7f5953078eb45cf",
      mul: "e971d1866e13d96e6c4ebd7f45a1202ea0ba64f5b729bc8bcdc122bbd6080f14",
      d: 154071031,
      divQ: "000000194a64f7caf0afcdd57567c97cd3746ea329de34c4d133439aeb158509",
      divR: 146782940,
    },
    {
      a: "49f82a8819eb86812c496ae07cc328b7cfdeed0df3bea269b9380d9c9a6555b5",
      b: "ecff3adb9ecc5dd0a45d1d1f3df73ecf1429e254c722b6523db7d9fae30ba8d5",
      add: "36f76563b8b7e451d0a687ffbaba6786e408cf62bae158bbf6efe7977d70fe8a",
      sub: "5cf8efac7b1f28b087ec4dc13ecbe9e8bbb50ab92c9bec177b8033a1b759ace0",
      mul: "92d276205c297714d95df4669a72f4e16eadc5bba66bdca36933b5bb24561799",
      d: 251168265,
      divQ: "00000004f0dfaf3398f1473fa21c82ff4724c6e291fe4ecfab5e282d8dae7c9c",
      divR: 183061561,
    },
    {
      a: "534d36ed1e9d2e1cf78a9cd7620666f025e79cabd6c942874719e02f5f333b86",
      b: "8b1930e4dd6fef8676648e8f5ac24876ae17adaabd978be3cc2caf9f195c53c4",
      add: "de6667d1fc0d1da36def2b66bcc8af66d3ff4a569460ce6b13468fce788f8f4a",
      sub: "c8340608412d3e9681260e4807441e7977cfef011931b6a37aed309045d6e7c2",
      mul: "8216f46e134c537a99906960b357daccfc6cb697385539602e5bc995f9ae0498",
      d: 47088928,
      divQ: "0000001dadea8ecdc38a450f1c36a818e8a0ca5a175bbaec76bed9f32b3f944c",
      divR: 34420230,
    },
    {
      a: "3a2c079498ddbe4594d7a72217f54b94ed370e8f788ad4e5e225e6c962864bad",
      b: "9943c999a965eaf7827978f4ebc67b0b026a4e1fe6203966f6ecc3ee6dc8c9ef",
      add: "d36fd12e4243a93d1751201703bbc69fefa15caf5eab0e4cd912aab7d04f159c",
      sub: "a0e83dfaef77d34e125e2e2d2c2ed089eaccc06f926a9b7eeb3922daf4bd81be",
      mul: "9e3e0e00c053f9326241f1716fb47856ffda1a4b2fff93c7d5d9dd5834f37b83",
      d: 44996629,
      divQ: "00000015b091272831e1886d1823c4fdc890ac3fd754e30b1c37513ff3693deb",
      divR: 40284006,
    },
    {
      a: "d5e43c18af9657bcfbd233c0fae6893fe7ec0b152a010895c4f9ae379443bec7",
      b: "4311f8ab9bf280309ff0c068cd22eaf7e8b84bb3648c09ee9f94937b8212114d",
      add: "18f634c44b88d7ed9bc2f429c8097437d0a456c88e8d1284648e41b31655d014",
      sub: "92d2436d13a3d78c5be173582dc39e47ff33bf61c574fea725651abc1231ad7a",
      mul: "2890863d6f8e59dd87d82870d20aa0b696c174cde62cf0a85402d9d1900998db",
      d: 184537365,
      divQ: "000000137229dc2eb059a98b25138f0c52d2f313915603baf7759b75ce6a0a77",
      divR: 8174596,
    },
    {
      a: "2773e8d230ad786f90a9e8fbd166138ce2e25eeff4c150ce67993df4055f7824",
      b: "766796dbb19e590f039d07c055bff4f0b672fd8ad7a53eede0468177f6a16021",
      add: "9ddb7fade24bd17e9446f0bc2726087d99555c7acc668fbc47dfbf6bfc00d845",
      sub: "b10c51f67f0f1f608d0ce13b7ba61e9c2c6f61651d1c11e08752bc7c0ebe1803",
      mul: "774b6f6068097820bc25a3963ab9bac88b725640ce24f00f3a6099b1a4fffca4",
      d: 19287944,
      divQ: "00000022513218e6354a9dcdc7e6b9d5bfe76c6d4317ac6a35116bd4858ceb9c",
      divR: 10824004,
    },
    {
      a: "2c93b8df75d90991613ce39a52795a5e0c740f0c1463e3f630e4878f4d03d707",
      b: "73badf6416da2150e0c799b69e7a4d3f7fb79737ef8b0ac3f922fc6e23235d81",
      add: "a04e98438cb32ae242047d50f0f3a79d8c2ba64403eeeeba2a0783fd70273488",
      sub: "b8d8d97b5efee840807549e3b3ff0d1e8cbc77d424d8d93237c18b2129e07986",
      mul: "47f20a29cdf4e6efb4b7eebe73a1498886b411efd83292f905c5b51e8f01e587",
      d: 248799141,
      divQ: "0000000301862974551e59098d485d18071c460015a458e50e6795f3044bc1c8",
      divR: 27703583,
    },
    {
      a: "d6798eb88d13b63d1de3c1e8b18a898aed5621a17a21cebd461bbbeb57d0bff8",
      b: "fa5d1ef73f97079e064e9b915b60cd743305cc8becef417c3ed7f61743df7bc9",
      add: "d0d6adafccaabddb24325d7a0ceb56ff205bee2d6711103984f3b2029bb03bc1",
      sub: "dc1c6fc14d7cae9f179526575629bc16ba5055158d328d410743c5d413f1442f",
      mul: "69b0bdd36248f33992d917a6a2a8a657cc085701ea79e3196e8f4f56602ae1b8",
      d: 165392066,
      divQ: "00000015c19178229e6753cbb518e799a559771a56da37bd52fcf121a3adee74",
      divR: 78853136,
    },
    {
      a: "685200f310e223848511ca1f4627d6e630c4d0344d2a1bc7459b676ad7bdab4b",
      b: "e7d53c38405c49fa6ce0acd346cb910f8811e2274369f0e1adf88e7e608d9bf9",
      add: "50273d2b513e6d7ef1f276f28cf367f5b8d6b25b90940ca8f393f5e9384b4744",
      sub: "807cc4bad085d98a18311d4bff5c45d6a8b2ee0d09c02ae597a2d8ec77300f52",
      mul: "a5e643a46730b42bd162ed91ef65e4f0935f9e89bdd57d03d68b2429268104f3",
      d: 223553353,
      divQ: "00000007d43af1b5315ac3079daf16dd01c667faff780f79068c842a48becd1e",
      divR: 22780861,
    },
    {
      a: "9c08cb46c689043ec27558c14557a1d55a072f485a815ef756572cf29c839394",
      b: "3627e82a579e5abee4617f31ec3ac598dba9233ffdc41454052fcb788f8fb9a8",
      add: "d230b3711e275efda6d6d7f33192676e35b052885845734b5b86f86b2c134d3c",
      sub: "65e0e31c6eeaa97fde13d98f591cdc3c7e5e0c085cbd4aa35127617a0cf3d9ec",
      mul: "97c949061cbe0578071c3200cb46bcf13db475549309baf2f98348a0e7aacd20",
      d: 200740954,
      divQ: "0000000d0a71ab6b3815d15624f8e8bdd488e2aba5ccbb276f55d8c9a442d85b",
      divR: 112251798,
    },
    {
      a: "f359ccb65d2a3caf67649eda18e4645379b69a8b76f241cc033822abe87f4654",
      b: "0a6d66f111d2cdecd2d0093ef0971663c3cf77beddc4f092ea08f56e4047944d",
      add: "fdc733a76efd0a9c3a34a819097b7ab73d86124a54b7325eed41181a28c6daa1",
      sub: "e8ec65c54b576ec29494959b284d4defb5e722cc992d5139192f2d3da837b207",
      mul: "1935e07a1e9ae867e5b75396943d972361fda80caf508b00b359b918043cb744",
      d: 119278993,
      divQ: "000000223a8324ee8f384dfc234171100c081b0aa7a155fd12f26cddbb87648b",
      divR: 75515033,
    },
    {
      a: "5ed561819ffdeb2168646591cbabdecdf6292d145d52c53cf8076aca2b87daae",
      b: "7b2e68ddd1b19b3a3e7c49dc287d4b0ecf711a428fe294cf6d7843a746aca800",
      add: "da03ca5f71af865ba6e0af6df42929dcc59a4756ed355a0c657fae71723482ae",
      sub: "e3a6f8a3ce4c4fe729e81bb5a32e93bf26b812d1cd70306d8a8f2722e4db32ae",
      mul: "ba652cf61fce285b80fd2660e9d370c3202757016031ecb7713c4325a86a3000",
      d: 25023026,
      divQ: "0000003f9548516631d9376c84117ec1b234f05d28dbf68e84d74d8b555106be",
      divR: 23506322,
    },
    {
      a: "47fada8dd79daf3ea1ccd242e9de5f7c2cd02d05092c4ebd913e3078b2445989",
      b: "0dbc5e23a1a5f0cb0aa5741edd2b88bec608b4af415efcbf517b114442713e85",
      add: "55b738b17943a009ac724661c709e83af2d8e1b44a8b4b7ce2b941bcf4b5980e",
      sub: "3a3e7c6a35f7be7397275e240cb2d6bd66c77855c7cd51fe3fc31f346fd31b04",
      mul: "9c1b1eba74b8b9c38c188bb5c83afe7ac4555ded42c7cae44a359a8602aab22d",
      d: 126875559,
      divQ: "0000000984a659250e4252dd4845376e8046ff12b4d17a3d988f324231d0cc80",
      divR: 37712393,
    },
    {
      a: "665b1106f14574ad5036d7874b60efe26a948fd75efab32dcb5497555015871e",
      b: "9323c4415953df7d8e42f41086040c8cae5f06d0eb03db62daba3ab9d9e9f9de",
      add: "f97ed5484a99542ade79cb97d164fc6f18f396a849fe8e90a60ed20f29ff80fc",
      sub: "d3374cc597f1952fc1f3e376c55ce355bc35890673f6d7caf09a5c9b762b8d40",
      mul: "ddfaffee984dbd1169165a186a7fd4da6a9ae687027f49bc200ccaaecb655a04",
      d: 45104909,
      divQ: "00000026127d39be6692e3b45c3d45c77a28d0ce8e8efbe2e0667cb79a723bab",
      divR: 617071,
    },
    {
      a: "da7bfe15cec70a3d90e3338580c10434ccad95606e9d41c87df2b132f476b50a",
      b: "4bbc9a77dad63bcb4ba12870fa07020dc493862909e679eacc49deb0abb96c6d",
      add: "2638988da99d4608dc845bf67ac8064291411b897883bbb34a3c8fe3a0302177",
      sub: "8ebf639df3f0ce7245420b1486ba0227081a0f3764b6c7ddb1a8d28248bd489d",
      mul: "e56f2f20f1b6daf357c703c8db82450069adc184a6a33e87b4aa096aad254d42",
      d: 165936012,
      divQ: "000000161717192359adde1f0dc8c6dd1a24e2323df6cf81962c5ec27b0328b8",
      divR: 44566634,
    },
    {
      a: "b658d4dc35cc841ee47ce6efda29fe4e70a0efb5435c4757d8b343eeede94d7e",
      b: "889568d3484953cf5f870196bc0b4267f133ed118ac52ddcd8a5ed3f1e051847",
      add: "3eee3daf7e15d7ee4403e886963540b661d4dcc6ce217534b159312e0bee65c5",
      sub: "2dc36c08ed83304f84f5e5591e1ebbe67f6d02a3b897197b000d56afcfe43537",
      mul: "f38ec1624668f1be25e31f94a94a909703346eabb6361c3b06fff237226e4df2",
      d: 115166095,
      divQ: "0000001a9063e94fcaca8c0f7d77fd77757f1351278a189533d8a1efdcf6b4b4",
      divR: 29729010,
    },
    {
      a: "01196787c83628c1d50be3b0bbf5a0ea1f053c18ffa318afc58ccfa591575a82",
      b: "19016edd9d6126bc8b97151e281b22829a49d83a0662dd4296f3cb3a7c93680a",
      add: "1a1ad66565974f7e60a2f8cee410c36cb94f14530605f5f25c809ae00deac28c",
      sub: "e817f8aa2ad502054974ce9293da7e6784bb63def9403b6d2e99046b14c3f278",
      mul: "7b25c9d40d295e49294799c2b8e765a9227fa369aa520dc8a249bbf71ad45914",
      d: 146037808,
      divQ: "000000002054184d2e2cc6ac7eece551f0826d2c813cd17463f6af9cbf24f2b9",
      divR: 18570194,
    },
    {
      a: "6c6241c905fe73fab218f1fd629e257bf2e12c43326c7e5299cff9e9a7fc13a7",
      b: "7ce7b1e45799a779cb2e48097d90693cba666e7b6156660becc5fc50ce967762",
      add: "e949f3ad5d981b747d473a06e02e8eb8ad479abe93c2e45e8695f63a76928b09",
      sub: "ef7a8fe4ae64cc80e6eaa9f3e50dbc3f387abdc7d1161846ad09fd98d9659c45",
      mul: "8add195721d16ad284a19f00a0b9be2db916e36043da5fbbb880163c617c26ee",
      d: 163959320,
      divQ: "0000000b172627ab704c568ca2b23e056d9d3ab90fd9e9c88b371a232156d404",
      divR: 47770439,
    },
    {
      a: "e2546b4c8ecbcffd2c1038006d0d07517ddb4b4675c852bb1ef80420b33be43a",
      b: "611f7c5a8da2cab191537de07cce8e76ebd137303710c82cd5264f5166f90edc",
      add: "4373e7a71c6e9aaebd63b5e0e9db95c869ac8276acd91ae7f41e53721a34f316",
      sub: "8134eef20129054b9abcba1ff03e78da920a14163eb78a8e49d1b4cf4c42d55e",
      mul: "db023c3c9cb72503f82f5d237cfb5beee882601cacf8a4c98c92a471665d4dd8",
      d: 39995482,
      divQ: "0000005ef0b7e895b545d2980aab0978f926122078c6e0f8b1a43bcb4b76f2de",
      divR: 35656238,
    },
    {
      a: "26922d91aafdf3c84cf84d23a7adf7a52cbb1f8bd02d22668996cdeaa9628a88",
      b: "b3a24632a65c8e3376782a0f01512b028d8b4c7792b53e2bae80406be18f1afb",
      add: "da3473c4515a81fbc3707732a8ff22a7ba466c0362e2609238170e568af1a583",
      sub: "72efe75f04a16594d6802314a65ccca29f2fd3143d77e43adb168d7ec7d36f8d",
      mul: "6a4d18e425b7e00f2a6ae44293b06403b97b8a9f852e266d9f8bdaecffa7a358",
      d: 37983130,
      divQ: "00000011097124b4c539d38b25a547ac095062569e6341acc4f04099d9cc6723",
      divR: 17458810,
    },
    {
      a: "f58d7b1ef6b6461467d911a529e46c53dc7d790d8c6d6e741a3fb284652d7dca",
      b: "055b36cebd1cc5656a2611875d3e2e4cd3b58c32b2314e5f5399ff4b6828effe",
      add: "fae8b1edb3d30b79d1ff232c87229aa0b03305403e9ebcd36dd9b1cfcd566dc8",
      sub: "f0324450399980aefdb3001dcca63e0708c7ecdada3c2014c6a5b338fd048dcc",
      mul: "ee142b210c1984e93e6b7b9ad1402f4c91df1f349cc895add10114359322646c",
      d: 196097651,
      divQ: "000000150223dec0fe54dab7948af0448473d11b3d28a27055a081dd11dbee49",
      divR: 99486975,
    },
    {
      a: "d7ff10c2ee243c2715fe2be0d2395998c73934adac4cf844dd1747e6d8f73483",
      b: "2e2fcb82b602171abef88769aa030ba99ef7491f28ba70ccc5eebdbbbaf6e2fa",
      add: "062edc45a4265341d4f6b34a7c3c654266307dccd5076911a30605a293ee177d",
      sub: "a9cf45403822250c5705a47728364def2841eb8e8392877817288a2b1e005189",
      mul: "40096e16b9d82198bc19c0af3fdf78fa500f2f1ea9f6aa79e6d02f5ec1a6edee",
      d: 85222785,
      divQ: "0000002a858de94895ab9fb21e36967606e2bd046900cb1db06ca4a5b03c3c1d",
      divR: 60913894,
    },
    {
      a: "c207f466004382a4167675fa83a8507a176829245b80d00862ecb247cbefa4f1",
      b: "00fd6921ae81cf8fc9980b98f2fe49c66a2536e549b89c2cc089723fdc61cc92",
      add: "c3055d87aec55233e00e819376a69a40818d6009a5396c3523762487a8517183",
      sub: "c10a8b4451c1b3144cde6a6190aa06b3ad42f23f11c833dba2634007ef8dd85f",
      mul: "f22b494f1c6309c57daab092a6578c0524b1e3353a5d255e35eb0450e16d1d72",
      d: 227799196,
      divQ: "0000000e4a4c077940ff2d1aa504b7b23f4d2b547b117b0685523849ac432d96",
      divR: 220282249,
    },
    {
      a: "9809ce1f4c0fb633edb82cfba417e41b2dce3eeb425c563028f34e5b4105cc01",
      b: "341625f0a35f25dffc75056961443c2aab38b7e7d67d8abefd00cf297d1af805",
      add: "cc1ff40fef6edc13ea2d3265055c2045d906f6d318d9e0ef25f41d84be20c406",
      sub: "63f3a82ea8b09053f143279242d3a7f0829587036bdecb712bf27f31c3ead3fc",
      mul: "33bf5aeb5feec8e79187838654c8c0bc0c3ce6a7538850211b8fd92217d7f405",
      d: 114241762,
      divQ: "0000001653f1b47cf72de731c47a85d53c5462b688b87e4e66d4a09b8eaa69f2",
      divR: 67691613,
    },
    {
      a: "e8e1fcd6c24a169f27f47e1f3bd39ebefb2c7cb34cee7d8cb01eed5e71841d00",
      b: "c4fd645942cecba98a911b70ef5f3a9e5eba6e673065c58dee21e6e11646577c",
      add: "addf61300518e248b28599902b32d95d59e6eb1a7d54431a9e40d43f87ca747c",
      sub: "23e4987d7f7b4af59d6362ae4c7464209c720e4c1c88b7fec1fd067d5b3dc584",
      mul: "0bf3e0bc3c44ecfb06e328c311604c0ed2b4b57a580658d70b65f3f0cfd90c00",
      d: 29642642,
      divQ: "00000083cebc872de81d58326892bf9bc14a58ceeeff64eb1ecc6f07838f910d",
      divR: 15491222,
    },
    {
      a: "82ba5ad752b3da6184eff22d4e44d6c2fc504468d86e318de501ea3dce6f7b8a",
      b: "c6f35142eaad36fba971b0b68105479bc56efa23042450cc9c7031f4a1c9dbb9",
      add: "49adac1a3d61115d2e61a2e3cf4a1e5ec1bf3e8bdc92825a81721c3270395743",
      sub: "bbc709946806a365db7e4176cd3f8f2736e14a45d449e0c14891b8492ca59fd1",
      mul: "6265470ea476523d90bb5d8ab650b5b38aee837e78ce1eb728678205569954ba",
      d: 242956636,
      divQ: "0000000906ff73410022aab210c73221993209cab27d65ea4b0677a4b5284f77",
      divR: 169110982,
    },
    {
      a: "e35b970b3d364cafb7a6d84fa11a5cbf02ae91e3d2f5410bd0534c7519c263a6",
      b: "7f0887f23b032f37094d436a17b7463b53ae2282e773265d990443d74f1af50c",
      add: "62641efd78397be6c0f41bb9b8d1a2fa565cb466ba6867696957904c68dd58b2",
      sub: "64530f1902331d78ae5994e589631683af006f60eb821aae374f089dcaa76e9a",
      mul: "a1725f0ed1aa18e3b0cb6af278ceb7ba41f786e590687ff7a9d9640c975689c8",
      d: 247387970,
      divQ: "0000000f6b37c2872762e241abd81e4f16876c5c3c73454943367329c16d5cd2",
      divR: 46143362,
    },
    {
      a: "925aea0a954a59bb412a4505fd717bc7130636dfa7e2f0c073be08353a9703f0",
      b: "7f2161175302815537462534fe6ade799897c537006dbec8faaa3b894d90ad92",
      add: "117c4b21e84cdb1078706a3afbdc5a40ab9dfc16a850af896e6843be8827b182",
      sub: "133988f34247d86609e41fd0ff069d4d7a6e71a8a77531f77913ccabed06565e",
      mul: "8934b31948eefbd5a56fd2e141eeda20baf329e21e6eddf434967384dec96ee0",
      d: 152508523,
      divQ: "0000001019acb5b435698bf0b3582fd455fc092fd5f684e8800297e533eead65",
      divR: 75502265,
    },
    {
      a: "b81d42b5e95b26401f0f512f3d286988597cb1f9fc2aca05873564e9414d5952",
      b: "2bad293672f13ac2c465cd17784bdd98f3187b44dcd81cfc2026b6f0dab0b89d",
      add: "e3ca6bec5c4c6102e3751e46b57447214c952d3ed902e701a75c1bda1bfe11ef",
      sub: "8c70197f7669eb7d5aa98417c4dc8bef666436b51f52ad09670eadf8669ca0b5",
      mul: "febad2dc58d856036e5e0e26224b778680213d696e10fbae066f5619e102b74a",
      d: 230495064,
      divQ: "0000000d66b948a1f9e5b98d61527f2366ee12dfc5bd479f3f5a27bf4f4e69c6",
      divR: 122768194,
    },
    {
      a: "554a7e2aa71e3ac8bd8b59f3af98c89fe9785ada6379d1373f63ba013f9ec0d5",
      b: "eed1b15d740fd7afc4c2a0e6a8b323a8a2d96347e3e38ab3b51c7827ff84f21f",
      add: "441c2f881b2e1278824dfada584bec488c51be22475d5beaf48032293f23b2f4",
      sub: "6678cccd330e6318f8c8b90d06e5a4f7469ef7927f9646838a4741d94019ceb6",
      mul: "8f033a1a0e5ad8ba36091db127d9c84208500f3da97a5bf5e5cbdcad5f56b3cb",
      d: 257324924,
      divQ: "000000058f93ded58b7a6cfa3c22df289f27f820326aed3cdd279369f0bf2bac",
      divR: 99657093,
    },
    {
      a: "36308c976d2cf0a4b88ed0bcbcbc25d88fad9848bb2b1aa4babdb03cc1183d8b",
      b: "ea290d7d9948f9a98ab054b2af1cac32c8e633387ab675e47ba7fcb06251dcde",
      add: "20599a150675ea4e433f256f6bd8d20b5893cb8135e190893665aced236a1a69",
      sub: "4c077f19d3e3f6fb2dde7c0a0d9f79a5c6c765104074a4c03f15b38c5ec660ad",
      mul: "16e0a47120b76957598fb49737d59a54a7436d9428b949d785038e6af6e3d28a",
      d: 258696297,
      divQ: "0000000383acf621cc29d613d51484fb9d1c2aaf68b84b288d2990ffcf0cce3d",
      divR: 231264902,
    },
    {
      a: "44b1437b4ce3845f19f728d356edf3ab42c95981c8b0314f7e2d5baf16e85f66",
      b: "172ecbf7855f2f5b36bfb10dd815beac29034e7530e41c03f694d08b8196c20f",
      add: "5be00f72d242b3ba50b6d9e12f03b2576bcca7f6f9944d5374c22c3a987f2175",
      sub: "2d827783c7845503e33777c57ed834ff19c60b0c97cc154b87988b2395519d57",
      mul: "f4c89b96ea126e33ff8e51249a20b95b02febdcc9f35c5f11fec3f3abbace2fa",
      d: 25650492,
      divQ: "0000002cedfe1284475bcdb05170db27f2caa6911261b89540d9341ded3ba10a",
      divR: 2076430,
    },
    {
      a: "f04b4babed6ae809f0e800bcbf87d53ddb77229c3a22a619e2494c0a1cafc7a3",
      b: "c5472c551ab9c41bbd47177a9a9d9b60611cd8133859a6ef19a9928979c7dd0e",
      add: "b59278010824ac25ae2f18375a25709e3c93faaf727c4d08fbf2de939677a4b1",
      sub: "2b041f56d2b123ee33a0e94224ea39dd7a5a4a8901c8ff2ac89fb980a2e7ea95",
      mul: "049acbcf79e2ec810608d5afd88562a11f9dd7d05aa89d2ad99a118c8ba9a1ea",
      d: 196402646,
      divQ: "0000001486cb34ca97ea41c53cfcf114d8a296c373ba4d62be02b19efdd39174",
      divR: 129174699,
    },
    {
      a: "eb0e75de6f545b9400e9209b4c54a218e49d541928f3ab590ca60409c4c90a0d",
      b: "cfe585ac258ed0b3edfabde36c41ed9aa29b8b8b2a52b8aed6ac7d0fb1620189",
      add: "baf3fb8a94e32c47eee3de7eb8968fb38738dfa453466407e3528119762b0b96",
      sub: "1b28f03249c58ae012ee62b7e012b47e4201c88dfea0f2aa35f986fa13670884",
      mul: "cc99ed1e7a48c1d327f5c3d4d4a24285a07559de50b32005081477aaee9a6df5",
      d: 140973544,
      divQ: "0000001bf957d717192d0e7592ca350aeac6a0e33f4d3c650b253c356eedf896",
      divR: 56718365,
    },
    {
      a: "056e5490bd680db64ab20e4bf00fbaba1962f9b5b3ebed8956d89c747f397abb",
      b: "d5c27d98b4a097321f578d6e90b8104b1be2ab5332840f83633c352349d3d7c8",
      add: "db30d2297208a4e86a099bba80c7cb053545a508e66ffd0cba14d197c90d5283",
      sub: "2fabd6f808c776842b5a80dd5f57aa6efd804e628167de05f39c67513565a2f3",
      mul: "3e6b161a11bd6651ee74bf3b3378bc9515f2b4965e4f95465104d0cd261bef18",
      d: 209156571,
      divQ: "000000006f8603ee2e9ec293b03d43ba4148ba3197ba16c7adb182463b1fb93c",
      divR: 27568231,
    },
    {
      a: "527ed5e395f0adfabcab2585e08b54411163101ca52733f60984c6702ede6b2e",
      b: "2349b654197bedf91bac1c05a211e725e088629affeb2d1410f5636f5bc27a9f",
      add: "75c88c37af6c9bf3d857418b829d3b66f1eb72b7a512610a1a7a29df8aa0e5cd",
      sub: "2f351f8f7c74c001a0ff09803e796d1b30daad81a53c06e1f88f6300d31bf08f",
      mul: "f8e748b401c677628205d8474cfd6f02caf5b71e74fd936d3a9e8d9bae147d92",
      d: 171767523,
      divQ: "000000080ec2b1622f00a8e25fbe067c5dceeee781a33361e962acae07a9b2d7",
      divR: 19283081,
    },
    {
      a: "e680a3a1dc67198ef4db3b08e6ed8dc8d0c141b1846876aa5ec17f52aa4b11c5",
      b: "506f31df67cfbb6c11ff4de0929aa77034260e0a1d8aad4dc9aef28c367e2fea",
      add: "36efd5814436d4fb06da88e97988353904e74fbba1f323f8287071dee0c941af",
      sub: "961171c274975e22e2dbed285452e6589c9b33a766ddc95c95128cc673cce1db",
      mul: "8aca62c0736729cbb1ce4d6de5f5dcc554c10d5e93f822a3169a2741bdd76912",
      d: 107684836,
      divQ: "00000023e98058b64b985d24fe51d9dbbbd44798d655bd242d81d39b8824f4fe",
      divR: 28845453,
    },
    {
      a: "1c18378a1900e05b3f0162c8c7d942fe405882c46732483467c8aa6c5e9d7c4a",
      b: "21a222343c2100a99bef71181ae43f7a45ab91b7f524cec4168973d0b257e3f6",
      add: "3dba59be5521e104daf0d3e0e2bd82788604147c5c5716f87e521e3d10f56040",
      sub: "fa761555dcdfdfb1a311f1b0acf50383faacf10c720d7970513f369bac459854",
      mul: "a71ba7f9769a782bedee9934dfa8a5674fba4edd2d08ac3f6cf3be1941b10d1c",
      d: 55506007,
      divQ: "000000087dea680f7b15b87fee5fa7850ba8253a512e2b36dde5b158442a8083",
      divR: 12907461,
    },
    {
      a: "afaa5d0d101b124a7beb9db2d9758a045169ded95d2ec195050940bd2241edfc",
      b: "9f771a05f220b3134e557e2ec912e1b683dcffd9d8db729d25ab250b4c266a40",
      add: "4f217713023bc55dca411be1a2886bbad546deb3360a34322ab465c86e68583c",
      sub: "103343071dfa5f372d961f841062a84dcd8cdeff84534ef7df5e1bb1d61b83bc",
      mul: "a0d8badb6680dae8a71e55f1fa861ee4c2a2970f587d4afe3cebcdbc006dd700",
      d: 74152051,
      divQ: "00000027bebc46326406f6c8cbdb515d6fa200476a37e733c3b5365c286eff88",
      divR: 46490596,
    },
    {
      a: "fce90d56ea06986bdb0e57102cd683c89323bdb1c615e00a6d88dbb37a08c19f",
      b: "a9739470e586326e25b371c0384f632145d8f63a81536cb92453844a370e4576",
      add: "a65ca1c7cf8ccada00c1c8d06525e6e9d8fcb3ec47694cc391dc5ffdb1170715",
      sub: "537578e6048065fdb55ae54ff48720a74d4ac77744c273514935576942fa7c29",
      mul: "09fb2b24fb6d7fafac0b64aa3e0a1fc583fae7092c5451c9e04026a85beb1a4a",
      d: 113462234,
      divQ: "000000256598e12e454153f6ce17716778eba08bf8e7633d39007961b14d9426",
      divR: 111114051,
    },
    {
      a: "55a336251049e4d10e375b91fa2c2a8d789bc71c3003b830ccd0bf4ad654ff43",
      b: "55761597b593d8fe661e64278c9b4aa93781c41e907b99ce1756c237d8334df3",
      add: "ab194bbcc5ddbdcf7455bfb986c77536b01d8b3ac07f51fee4278182ae884d36",
      sub: "002d208d5ab60bd2a818f76a6d90dfe4411a02fd9f881e62b579fd12fe21b150",
      mul: "01c12733588b3994fd7141be56af142efa09f3f358d258d1afa51e3565ce7399",
      d: 90844449,
      divQ: "0000000fd0cb3fccff9027da9efddd6f1a9d4907d964d3c09bcf6afda61dfebc",
      divR: 14163207,
    },
    {
      a: "463163fff3e477135c7fd269e127fe5ba24f59961e3446ccc170c70deeafc8bd",
      b: "6d76f71c9adf2bdbacd7afe8e91cf57118f5c379838c88acc356b73c4862b652",
      add: "b3a85b1c8ec3a2ef09578252ca44f3ccbb451d0fa1c0cf7984c77e4a37127f0f",
      sub: "d8ba6ce359054b37afa82280f80b08ea8959961c9aa7be1ffe1a0fd1a64d126b",
      mul: "5e80e1691f7cc7ad5280f4782c2948538837019c3730fd19424aa1336d5eaa8a",
      d: 233543218,
      divQ: "000000050ae15dbf673f876f343ff3a80c7f552f070d748799fa67078e59ae34",
      divR: 123554453,
    },
    {
      a: "0250148f97ddffed82a35dba86280b8d4e08121d11140f1749720b87b5c13298",
      b: "f31f53906641d1e1271d1d1a9b0fbd65ab22b0c6801aeeda05bcf9a6f9325ca5",
      add: "f56f681ffe1fd1cea9c07ad52137c8f2f92ac2e3912efdf14f2f052eaef38f3d",
      sub: "0f30c0ff319c2e0c5b86409feb184e27a2e5615690f9203d43b511e0bc8ed5f3",
      mul: "ace1a9ee8aecae86f5b789faf93bd6995f1d3e0102b57cfb780d444b4d643bf8",
      d: 21232266,
      divQ: "00000001d3d8ebd5b278d24774b0f1980c25d378921821e113cf30908291eda0",
      divR: 2677336,
    },
    {
      a: "78674abb4e6698996bfeebf2fc190a94148808502495d4729f7d1824e92a787b",
      b: "59e8e7130eb3032416e3a3398ea904dd05428c8739253b43abd9adf1ece3623f",
      add: "d25031ce5d199bbd82e28f2c8ac20f7119ca94d75dbb0fb64b56c616d60ddaba",
      sub: "1e7e63a83fb39575551b48b96d7005b70f457bc8eb70992ef3a36a32fc47163c",
      mul: "7fb5e4007ede0e83f04a9fe9dcbcb158a6504882d2a4786e105e84dcdca3bc45",
      d: 46268071,
      divQ: "0000002ba8cd143b061d0f781495acdd1ed284f021ca4eeead664acecf60c338",
      divR: 35753715,
    },
    {
      a: "2d74ec318dd8b369ae7c253b5f37fa4b0865224e646548b3d4590a9203eea8cc",
      b: "b0a92052e021aea6402ff3a77fb954348fbe6d6cfbfa31b8d2f6d025d13acc8a",
      add: "de1e0c846dfa620feeac18e2def14e7f98238fbb605f7a6ca74fdab7d5297556",
      sub: "7ccbcbdeadb704c36e4c3193df7ea61678a6b4e1686b16fb01623a6c32b3dc42",
      mul: "5d2849c58822ce345ea077279e1ad445bbb790a673b262af0d62ef3517618df8",
      d: 50167676,
      divQ: "0000000f33a70df0f2159eda413af2cadd718052933efff03df3d1c62adffab0",
      divR: 35908492,
    },
    {
      a: "b4fe7be56646a69757cb64f41949acb63a573d32f628970c1d45833e1d5df535",
      b: "12ae0528e912cdd2085a05a8aa7340d648f97cc1e23f8734fde66ed5f6d28d05",
      add: "c7ac810e4f59746960256a9cc3bced8c8350b9f4d8681e411b2bf2141430823a",
      sub: "a25076bc7d33d8c54f715f4b6ed66bdff15dc07113e90fd71f5f1468268b6830",
      mul: "dea0ec821ed4813c9208da10c114688f16f2327ce18c514fb1f8f230665dfb09",
      d: 46768218,
      divQ: "00000040ed9f41d274528b9e2a2c28d0569242eb35c06aecdb5d3c38518dfe18",
      divR: 30122181,
    },
    {
      a: "9a262eff923fc917d1720e490fd4fa53aa60734889da47e2aa061440bdcfef21",
      b: "b6e11de64d9cf934a735c766756546d6dc04245a967aab8a72709c43b7f66b45",
      add: "51074ce5dfdcc24c78a7d5af853a412a866497a32054f36d1c76b08475c65a66",
      sub: "e345111944a2cfe32a3c46e29a6fb37cce5c4eedf35f9c58379577fd05d983dc",
      mul: "e5c394936272ec673c518a1677828ba9b75d176ae68f2e55cf94402c72b43ee5",
      d: 47240227,
      divQ: "00000036bede61e3d53c924fffee02d550558f3a55e343c4258a4dddbc605568",
      divR: 23732713,
    },
    {
      a: "4398cfeb679e939b46fc9a24fe5c5e9576fa07c7805ea8b6290b06b1c9505718",
      b: "e5f81c58019eccca199327c956323b19ceefd286b10eb248bd3bc7f755d9c9eb",
      add: "2990ec43693d6065608fc1ee548e99af45e9da4e316d5afee646cea91f2a2103",
      sub: "5da0b39365ffc6d12d69725ba82a237ba80a3540cf4ff66d6bcf3eba73768d2d",
      mul: "ed9cf181c6073746a72f8ee13d680e6c92b1567a764de69a84abbe70ac79cb08",
      d: 240998966,
      divQ: "00000004b4ae037d3a6663e7a69c8f32f67a9ded975f10a66dc4c0b3bfe41a88",
      divR: 175566440,
    },
    {
      a: "1627c47ba3a83165a556def0e5a848d2b338d6b92a57d55cd516c27cffc2115c",
      b: "730b723577576a3a14f67b8ad1bad553d71044becd2437b0a29949f4e716f96a",
      add: "893336b11aff9b9fba4d5a7bb7631e268a491b77f77c0d0d77b00c71e6d90ac6",
      sub: "a31c52462c50c72b9060636613ed737edc2891fa5d339dac327d788818ab17f2",
      mul: "93cd2a4a77c9899d8b36ce0a767da611409ac135a2f2de719405fc8d2b25ac18",
      d: 116123739,
      divQ: "000000033370b5e02a43ff90ebdcd3c1e1414db04b85826eae103ab954436578",
      divR: 45105076,
    },
    {
      a: "2aea8ea1c3fb1cac5a36b293acbc1d2bcb8dfbad84a197d862f80844959a6dd3",
      b: "e5bd0a430efff38df437733180e4936ff294c84a5638fef6b79b427eb8d9e252",
      add: "10a798e4d2fb103a4e6e25c52da0b09bbe22c3f7dada96cf1a934ac34e745025",
      sub: "452d845eb4fb291e65ff3f622bd789bbd8f933632e6898e1ab5cc5c5dcc08b81",
      mul: "092ec03303055a04a1b1c0615bc4d5690cc04ee4f59070f6be7c74bb00467396",
      d: 106130400,
      divQ: "00000006c8c482eb2d6c241dce225dc1eeecf6f02ffe551ace056ba86fb3d0fc",
      divR: 104217939,
    },
    {
      a: "7226ec7c26643647207ef2cd665f825b517513f02f3144b1b49312bbe567c922",
      b: "8154ab0fdac93b83f1f19a6cdc179d4d60760e538812755ee0e3298c2efedb4a",
      add: "f37b978c012d71cb12708d3a42771fa8b1eb2243b743ba1095763c481466a46c",
      sub: "f0d2416c4b9afac32e8d58608a47e50df0ff059ca71ecf52d3afe92fb668edd8",
      mul: "75cc66d33c0c972788e92821e3bb9d8eeb2dd5f213f76e228a4edb45c4cc39d4",
      d: 47732139,
      divQ: "000000281f78b2a7e4f7f2f03ff73d0a2ee4eae5784203d88d4a9875d8a70fb8",
      divR: 39334202,
    },
    {
      a: "7ca9ed6f1f2d19f9f2151984c8aeb54bf22328904b5bf10f8e580f790e65e28f",
      b: "a5c37b74dc310e140d89191ff5904193bcc1804ad051af3ea3b67ffe68a10934",
      add: "226d68e3fb5e280dff9e32a4be3ef6dfaee4a8db1bada04e320e8f777706ebc3",
      sub: "d6e671fa42fc0be5e48c0064d31e73b83561a8457b0a41d0eaa18f7aa5c4d95b",
      mul: "70f3b283ae5c02477586344e5db1b0f010e10c0877d5f267de8f931815980c0c",
      d: 105815701,
      divQ: "00000013c3fe911e862766b56a024cdfa081c1bc47909fc86ac90aada3a2f5e2",
      divR: 99568133,
    },
    {
      a: "44f40b9b38a54a06095f572e9a481209662a3e2960a7e2a51898825efa071e1f",
      b: "0bb49ad23a0c4abe39b7996378271ef73689bfb6b861da99ce64dca66a38ecb5",
      add: "50a8a66d72b194c44316f092126f31009cb3fde01909bd3ee6fd5f0564400ad4",
      sub: "393f70c8fe98ff47cfa7bdcb2220f3122fa07e72a846080b4a33a5b88fce316a",
      mul: "3ea72d47e8e5674d404eb45906a680e833261eaa98cfecbec8ed8bc6c394dfeb",
      d: 183147962,
      divQ: "000000065102b013ac30aa27bbf446aa01b127a145f5a7638d4e1fd758b89400",
      divR: 153589279,
    },
    {
      a: "9992d23795fd0adad00ab1d19aa299f84c95f02701352f5e6f9fe3f2f1bb8779",
      b: "79c59687608858c2be02c54a7948515b6f26847ca5bab56d235424d19ec6adfb",
      add: "135868bef685639d8e0d771c13eaeb53bbbc74a3a6efe4cb92f408c490823574",
      sub: "1fcd3bb03574b2181207ec87215a489cdd6f6baa5b7a79f14c4bbf2152f4d97e",
      mul: "d43cb1bf257991842bdb836a380b287649c15b629afdbb4975c2feff330098a3",
      d: 167704712,
      divQ: "0000000f5d1033e2b05339e58daa98a08a4ebb3394c49ddf8e62be765bad2948",
      divR: 5232953,
    },
    {
      a: "657bc36241d17762fd050ab579641c78309673e4b5f61508c8ab12ab6977f111",
      b: "ff865dd372647bab2227696c1aadd4de2ee933501d4c40eae25a6fa4c725c43c",
      add: "65022135b435f30e1f2c74219411f1565f7fa734d34255f3ab058250309db54d",
      sub: "65f5658ecf6cfbb7dadda1495eb6479a01ad409498a9d41de650a306a2522cd5",
      mul: "fd7dbc69f9c4e0fc662d0ccdbee3539a005b405f6c0b7cff487ce58a9b2283fc",
      d: 63789345,
      divQ: "0000001ab0edf5aa6c046ff4d323b714084cd3a4bb0a6d71cf6ed4fc67a0c8ca",
      divR: 3003655,
    },
    {
      a: "e3d73f8f12d5e9c2303aba4accb0f42cd3797ddc47c9a3e4e57eb9bf29ade5c4",
      b: "983748051a87556dce7aa2ca97b52eb60c9585e4b837aabcc2db02a6169119b9",
      add: "7c0e87942d5d3f2ffeb55d15646622e2e00f03c100014ea1a859bc65403eff7d",
      sub: "4b9ff789f84e945461c0178034fbc576c6e3f7f78f91f92822a3b719131ccc0b",
      mul: "e590128444f559d5d284f8eda103143c138ca302f73aefab54cdf88d161f2ea4",
      d: 24937938,
      divQ: "00000099482aa992b03c8ae3fad8e5488584edf874028bfc9cad5268c27dd25b",
      divR: 18485278,
    },
    {
      a: "7c5c6724ecd20ff6c3783e63ea76216d8f7fd7a0cbd6eb8d270dc2457ce2e065",
      b: "ac5b764cde55ff7f08a08bc3b17a8733fde5c7d40a5f4f8c5ef011c95aa1b0d3",
      add: "28b7dd71cb280f75cc18ca279bf0a8a18d659f74d6363b1985fdd40ed7849138",
      sub: "d000f0d80e7c1077bad7b2a038fb9a39919a0fccc1779c00c81db07c22412f92",
      mul: "39bb04320d7fb956541b7d6bdcc6435405433d7047170151d53b17018ac9633f",
      d: 239218555,
      divQ: "00000008b8cbbff229326e95f2c8ed28d8b37b55d2303d93a9d13f9fd4a4fe2d",
      divR: 156794310,
    },
    {
      a: "6ca77a3cdc7d01de0ced431c5c79b2e58373d54481f2e0c812bdd3d73779231b",
      b: "ccbcaa31c067bc71bb4b54f32f2dfb37d6b166f139c1099a9327cf8ea8f0c8c8",
      add: "3964246e9ce4be4fc838980f8ba7ae1d5a253c35bbb3ea62a5e5a365e069ebe3",
      sub: "9fead00b1c15456c51a1ee292d4bb7adacc26e534831d72d7f9604488e885a53",
      mul: "2a0d50b5e473c795ff8eebb04185bc9c984645ed26eaab055aaa720e9b608518",
      d: 237119799,
      divQ: "00000007b00faa35697db33f0f546bcd57c900750be2ef21d08727ab1db602aa",
      divR: 140334741,
    },
    {
      a: "375812a720f47c8da2b8b5f3b900d08ea4c603ec983d56c71e5e4b28e0f42689",
      b: "deb32c31e2bcf41e0f42a40b56963fa1e0391074c35c2ffed3a9d743ef5e4a23",
      add: "160b3ed903b170abb1fb59ff0f97103084ff14615b9986c5f208226cd05270ac",
      sub: "58a4e6753e37886f937611e8626a90ecc48cf377d4e126c84ab473e4f195dc66",
      mul: "da5cc147794a6f414a86c328ca8a94661790b7bcfaafbb497358c61861d2debb",
      d: 63585550,
      divQ: "0000000e9a4899f7a20face03e3ced792928f098dcbfdbcac9a1f376e4fcdb9b",
      divR: 25048335,
    },
    {
      a: "dce41d35d7e65968716162796cd13691b77314d7ed47a978d23cb00d557031e9",
      b: "d805248cf3b454935e6bfa5a4bae0b16036d813fcbb8b16d774f8c435a515823",
      add: "b4e941c2cb9aadfbcfcd5cd3b87f41a7bae09617b9005ae6498c3c50afc18a0c",
      sub: "04def8a8e43204d512f5681f21232b7bb4059398218ef80b5aed23c9fb1ed9c6",
      mul: "1b0b0b779d12829c82d45820042117a106f31bce7eeecb206ca19d37f437eadb",
      d: 211149327,
      divQ: "000000118d1f85583f64f58e7acfa75fd79bd3888298cd29fb1e4e8d7b0c1767",
      divR: 2024672,
    },
    {
      a: "661f93266d308081dc384151e27973773aa18a5ed4e12966e969cedb1c61801f",
      b: "f9643b02f668e8dd016f76ba567a0ed23c59f8417221fc8a203a47763cc01599",
      add: "5f83ce296399695edda7b80c38f3824976fb82a0470325f109a41651592195b8",
      sub: "6cbb582376c797a4dac8ca978bff64a4fe47921d62bf2cdcc92f8764dfa16a86",
      mul: "bfb51f9c5f9e0c509c4af8c093563512cbde7a42a7dc5c2cb3b064b951081d87",
      d: 23126260,
      divQ: "0000004a16298f3a5dc2108097478de18c442fe8861f8e19114d5c2aeed50f4e",
      divR: 11184583,
    },
    {
      a: "d7af97429be19eaae4cc3466f0efbd2aa42d3be4c7bdc7470377cec36317fcdb",
      b: "4115f1a154aef4127883e7409e79b44be70ae66f22a8204e89ba8dbdffa94ac8",
      add: "18c588e3f09092bd5d501ba78f6971768b382253ea65e7958d325c8162c147a3",
      sub: "9699a5a14732aa986c484d26527608debd225575a515a6f879bd4105636eb213",
      mul: "c3a929e234332ec1790a327dd90c04e739d3b97dbf295bd4bf279fad6b67d918",
      d: 133524351,
      divQ: "0000001b19ca373558f835ca5bfc8d5a4e477701a1aec0799a6335e8b6f50bf6",
      divR: 119094225,
    },
    {
      a: "d020c75d2ecf79f1b41559fd73959cc4f15c3573436963717436c813e02cddff",
      b: "4dadf6ec24dd53181dd67bc8562ce1164747e284edf44ec35f706b63309f07dc",
      add: "1dcebe4953accd09d1ebd5c5c9c27ddb38a417f8315db234d3a7337710cbe5db",
      sub: "8272d07109f226d9963ede351d68bbaeaa1452ee557514ae14c65cb0af8dd623",
      mul: "6e9692c647b49eb974ca9760d58a1440480602dfb11a36d98fa090509201c024",
      d: 16031236,
      divQ: "000000d9d016971210c056cd1ed7de26ed3c94d26d2053859f120621ba9dc4cf",
      divR: 15861955,
    },
    {
      a: "3b6936369050a60f7005c4ae72171bbec5f26ebb75b088f4288f5d6b4df24a25",
      b: "d8b59acf042e33a12e88e0bb6b17ed05727e1fdc085f5b9832ace64c915facb1",
      add: "141ed105947ed9b09e8ea569dd2f08c438708e977e0fe48c5b3c43b7df51f6d6",
      sub: "62b39b678c22726e417ce3f306ff2eb953744edf6d512d5bf5e2771ebc929d74",
      mul: "c2774e72e8ce6324b437366b5e09da7b9fa7c0b4be68ff4dad43197427111f95",
      d: 122989033,
      divQ: "000000081ab9341ffa6b1289303743d4e1462da23e9b646ba9a10562dbdd8416",
      divR: 65702943,
    },
    {
      a: "910f53fb1022cfdc84a6b69c1d620768b1147183f9ecd2beb556d56b87e6a9fb",
      b: "e017aef279eedb1f3b3d32855c6e9a26dc767db7b9cdd8abe993f01e0d254258",
      add: "712702ed8a11aafbbfe3e92179d0a18f8d8aef3bb3baab6a9eeac589950bec53",
      sub: "b0f7a5089633f4bd49698416c0f36d41d49df3cc401efa12cbc2e54d7ac167a3",
      mul: "8cda8f89b0f3d1fb6cfdf9b64d8d0ff7fbeab6a917b3598641d4ac627f642448",
      d: 242390921,
      divQ: "0000000a0a57662d47e2f0c87e1a5eea36a02e08bc9e5c9971dc732ce3759017",
      divR: 163642540,
    },
    {
      a: "530c24958b2f1707077295199134f768a3e6c44b50564b32103a0cf02090fc9d",
      b: "03dc1293e3b57285d73e1c65e638cbe8f6eeda9fae15a1a0b89bdcc4ed624fc0",
      add: "56e837296ee4898cdeb0b17f776dc3519ad59eeafe6becd2c8d5e9b50df34c5d",
      sub: "4f301201a779a481303478b3aafc2b7facf7e9aba240a991579e302b332eacdd",
      mul: "6376f5133e1c9aebb33ba43c619ab8dd84e6294fb8d69d10aac1d3b737cbe8c0",
      d: 58311662,
      divQ: "00000017e4e3c9115a1dbba33d90af67b112777dc20dfc0a77cb13955015eb8c",
      divR: 9985141,
    },
    {
      a: "906613355e2dfca50ba3d2a220319621909a031eca9691e7ec8feed307c10f27",
      b: "b4285974b6d134750ccc6b87a01d87617a5172b70321b2990f6a906f3709c31a",
      add: "448e6caa14ff311a18703e29c04f1d830aeb75d5cdb84480fbfa7f423ecad241",
      sub: "dc3db9c0a75cc82ffed7671a80140ec016489067c774df4edd255e63d0b74c0d",
      mul: "58fcfe468a499e5f30c154a96d2b78ade15846c24aefac1dea00424ac1853ef6",
      d: 175612038,
      divQ: "0000000dcb9448411d183657a0801752547747a64ecb3c280063d4ef33fb2388",
      divR: 132085239,
    },
    {
      a: "245752e6e269ecda77d5e976373e80a809bfdc3e25b398d435b5b40e099b1c41",
      b: "51da6ffec03d19a95bb3451aaba9b8ea1912a782d07a7e006157b32dbdba0c1e",
      add: "7631c2e5a2a70683d3892e90e2e8399222d283c0f62e16d4970d673bc755285f",
      sub: "d27ce2e8222cd3311c22a45b8b94c7bdf0ad34bb55391ad3d45e00e04be11023",
      mul: "59d9db8764fbee8204275aef066a5a2ca19451d02b2d85f05f22ab13e9ba5b9e",
      d: 161720347,
      divQ: "00000003c52593eaa9b28f8dd501f135d47e3d339a0cf0c9c2f64ef8352e4766",
      divR: 49063039,
    },
    {
      a: "eca0ef0a3794a199db4f8e938a36e6faf30f7fd02fe343a9fbd9dae2c9329939",
      b: "f25dbb5d3c33fcf05308cb53a6b8301106e27ab15b7ea64c2afbf24a08cbb30d",
      add: "defeaa6773c89e8a2e5859e730ef170bf9f1fa818b61e9f626d5cd2cd1fe4c46",
      sub: "fa4333acfb60a4a98846c33fe37eb6e9ec2d051ed4649d5dd0dde898c066e62c",
      mul: "4cd83e09b771e8adc22a741f8b9f33e4277435ae15337bbe5896fc95e0e7a2e5",
      d: 41415264,
      divQ: "0000005fdb8f072be229ede8bf9f80f94c38926a112c2485666d0f34923d3ba9",
      divR: 38238169,
    },
    {
      a: "6c6a16e62b6f0858c2bb02fe1f9fd27df29c65dc401a3b537ea6ff8ec2960daf",
      b: "98b249187c331c658311c245b07beafd2f1fd2691baeead3403d180ff50c4c16",
      add: "051c5ffea7a224be45ccc543d01bbd7b21bc38455bc92626bee4179eb7a259c5",
      sub: "d3b7cdcdaf3bebf33fa940b86f23e780c37c9373246b50803e69e77ecd89c199",
      mul: "eb786eabec57a166279aa3242a856a838bc3dc26f1871f338be9476b6429210a",
      d: 233566129,
      divQ: "00000007c9986a3a9ed961c942b677511f9595b21303ce9b617374c770aa1a3a",
      divR: 155174293,
    },
    {
      a: "78561fdfa4360e508c107362c3757c1112602841e55e667cddc7fe261f85cffb",
      b: "2db17bce4b00b67c3c4deb02addb18cee31b79e7e28901bd0b0ba1ac69f02850",
      add: "a6079badef36c4ccc85e5e65715094dff57ba229c7e76839e8d39fd28975f84b",
      sub: "4aa4a411593557d44fc28860159a63422f44ae5a02d564bfd2bc5c79b595a7ab",
      mul: "46481795ebb905c2efe6bd6da26b1f1b285d3ad4c0aad9d7835e683bb0a03670",
      d: 125835926,
      divQ: "000000100b42d808ae365686dbbd9b4ce0e40626f3d016eb9d78dbc6c0abbff8",
      divR: 90449067,
    },
    {
      a: "83ee028e8a6d52006283a3df24d273dd48965686c5a5e14515552b4171075a49",
      b: "3a1480249b535aa4c987c95c64df967d771acdd225a77198254011d64036ca2e",
      add: "be0282b325c0aca52c0b6d3b89b20a5abfb12458eb4d52dd3a953d17b13e2477",
      sub: "49d98269ef19f75b98fbda82bff2dd5fd17b88b49ffe6facf015196b30d0901b",
      mul: "9b51f04fa5a7ec62db1e8707e5971afecc8a7aaac2116f779de3691767f5d31e",
      d: 147743447,
      divQ: "0000000efb41655d8d71d5dd7a3c34114d0412677b429ac6b24b6e38c3901889",
      divR: 56642874,
    },
    {
      a: "198e3035d3d4eee8f875dca3a412b95e64fed17142381b570379074da1c44a61",
      b: "b669f0fdc820eaa89f04a70313c734c0a94f7e344c451e089dc2c7584065db32",
      add: "cff821339bf5d991977a83a6b7d9ee1f0e4e4fa58e7d395fa13bcea5e22a2593",
      sub: "63243f380bb40440597135a0904b849dbbaf533cf5f2fd4e65b63ff5615e6f2f",
      mul: "758d3897043a50eda6fcc9f99ba9bc26e2c9e49ecadbec5f8cc1b3ee1c3c81f2",
      d: 111695038,
      divQ: "00000003d6ac4eb79ac81733bb71635a56bcac7c731320aff8342d05b48b176f",
      divR: 67140095,
    },
    {
      a: "f92b1c975f2112dd47ea8055c0f479376167e1932e8c0f6568abe1496b0d567e",
      b: "a1aa644674be3553cd242e54f727f8e26ea153907519ed3974c3725ab32169be",
      add: "9ad580ddd3df4831150eaeaab81c7219d0093523a3a5fc9edd6f53a41e2ec03c",
      sub: "5780b850ea62dd897ac65200c9cc8054f2c68e02b972222bf3e86eeeb7ebecc0",
      mul: "93d8aacb16d3f607da22400cbd6bba545da11694500e15c41c77f5e42c9ddf84",
      d: 132293288,
      divQ: "0000001f99604272ec0cf2d4545533912d83100e9e54b6e33b25a84f98df0e74",
      divR: 52327006,
    },
    {
      a: "bb1a8277845a8f56c7c607d78e0a90362e2d69574e80bafd213d3f94af4d48d4",
      b: "721ff258a714165591a2826334e06d1a98afd6371cf61691cbf25e7ff39ec227",
      add: "2d3a74d02b6ea5ac59688a3ac2eafd50c6dd3f8e6b76d18eed2f9e14a2ec0afb",
      sub: "48fa901edd46790136238574592a231b957d9320318aa46b554ae114bbae86ad",
      mul: "578219a5727f725d82078e76f468e18069ed1de4492391ec272ae37f74cec04c",
      d: 24715344,
      divQ: "0000007f025cad49d55752f9f712e8386ea4d5e625e3f1b8bcd7b35f5876a5d4",
      divR: 4912788,
    },
    {
      a: "a89563a2fbe059093f9a79b780c1afd147f4a5ae66ce323e5b2420346286b8d5",
      b: "b1076e158688d3c693a2cce86403687a84bacf356864284fdb39f56d75792420",
      add: "599cd1b882692ccfd33d469fe4c5184bccaf74e3cf325a8e365e15a1d7ffdcf5",
      sub: "f78df58d75578542abf7accf1cbe4756c339d678fe6a09ee7fea2ac6ed0d94b5",
      mul: "0d1e204d8aab4b25fa597a3962482f0f23cd2b6ba4c6fdd8e383143ef8820ea0",
      d: 100803841,
      divQ: "0000001c0ede9b41acfba2a7ccd4cc8edfbf9218a65e77870487aabb94082b36",
      divR: 97763231,
    },
    {
      a: "9a9964f94f5bf934b795c2a12ddcf80edacf6739fde592cae7f3b1165f199487",
      b: "0d572d4188bb06c957e087d3108d2e528fdb397787cddb8b9e58d1750313da71",
      add: "a7f0923ad816fffe0f764a743e6a26616aaaa0b185b36e56864c828b622d6ef8",
      sub: "8d4237b7c6a0f26b5fb53ace1d4fc9bc4af42dc27617b73f499adfa15c05ba16",
      mul: "1f9e499ed9b53037f77a3720c6609d9616ba65cc218176e0087fac325dca8597",
      d: 139977624,
      divQ: "00000012879ac43be3813fac78a0d36383902a3218b12c0878db0544bc163dfc",
      divR: 139088615,
    },
    {
      a: "64ef5db01cf57f6c60c44fb476c32a0c62b2600913c098a5e9498adc41b0c066",
      b: "1dbb68056ea46a7997b8a2ac39eae5b6598e8f7339ba5d64b6f0c25fef2f2e96",
      add: "82aac5b58b99e9e5f87cf260b0ae0fc2bc40ef7c4d7af60aa03a4d3c30dfeefc",
      sub: "4733f5aaae5114f2c90bad083cd844560923d095da063b413258c87c528191d0",
      mul: "0809c0ba78f8f2ed492cb1e59ea391cf87b472be8b4ba41f3dd3b5c8ccdd0fc4",
      d: 161914153,
      divQ: "0000000a756c343b238923178e6e8b62d502f6687bd644b2ebabfe1a1bc2665b",
      divR: 80121043,
    },
    {
      a: "4f60e1beb68a59fed396b506dc0f488e2a1a340a863bcd0c0259be2162952626",
      b: "69181ee66c02954671f23529d446c082dd4064db8378e4b986ce54fb83b2226e",
      add: "b87900a5228cef454588ea30b0560911075a98e609b4b1c58928131ce6474894",
      sub: "e648c2d84a87c4b861a47fdd07c8880b4cd9cf2f02c2e8527b8b6925dee303b8",
      mul: "f0c23fc73f4f9c9be43e9cafd0ff670f6e43b001f6e570b165cddeec23937054",
      d: 34734452,
      divQ: "000000265743a3372fe7c0d3f59df5592136998d68d9a071061d5f36e78d3592",
      divR: 18828798,
    },
    {
      a: "0edb80e4d99c91750a48f05f06e61d00a45d31deea92b09e6e27f8297887b978",
      b: "48db6b570c95f991c5de2cb1630ec9b9f3cf721d9b2544e9fa196df072fba535",
      add: "57b6ec3be6328b06d0271d1069f4e6ba982ca3fc85b7f58868416619eb835ead",
      sub: "c600158dcd0697e3446ac3ada3d75346b08dbfc14f6d6bb4740e8a39058c1443",
      mul: "751bd3e051bbda0819907ffa3bdef9b16a7e11c3119fc94a6f7cb16fb74bbdd8",
      d: 122624940,
      divQ: "0000000208629a2d4d9b8c2d26b892112b655f56c6420a3a2aeb7a49e45cf697",
      divR: 41361156,
    },
    {
      a: "dc6f3f93ed57c8d371e943c8eddc49b9d5bed7392455f24b07e5f54ef4293ce3",
      b: "8a5b533f883ec6c858bd156f4de4ece5e64cedc665f42d4b47a3d7007b53c20c",
      add: "66ca92d375968f9bcaa659383bc1369fbc0bc4ff8a4a1f964f89cc4f6f7cfeef",
      sub: "5213ec546519020b192c2e599ff75cd3ef71e972be61c4ffc0421e4e78d57ad7",
      mul: "e8b7a222fc9e20bc7e060d0e6bb6c1d9e035438707ea36a07641f35a80abe0a4",
      d: 179649132,
      divQ: "00000014960bda1353b89e0e079a65df1753ce9802bb3609719238394bdcb0fb",
      divR: 58635519,
    },
    {
      a: "b9665dbf834c1a64c326bdc2550bdd63354088b7aa712390a2f450c3b1bbf473",
      b: "fd0b70297a58d7cae186506e9817531d3cf2c0d12b098bfdbf8f936df114821d",
      add: "b671cde8fda4f22fa4ad0e30ed23308072334988d57aaf8e6283e431a2d07690",
      sub: "bc5aed9608f34299e1a06d53bcf48a45f84dc7e67f679792e364bd55c0a77256",
      mul: "7735ada780552c8b5cb2e8d7b488dd79380acc061c6d81a903ee7832f0691707",
      d: 118639238,
      divQ: "0000001a37d46be6636f0923b27113d5de92af242f943a8ae17fd06dba0f3603",
      divR: 116576481,
    },
    {
      a: "e31c708deea9b72beeca53dbff810b65bd2bc45ab7e0749bf98a4a0c4a84a0c8",
      b: "03fbbce7325a37e6ff47c3c9da7a597773a424afa64817c594b7a8e9aa901217",
      add: "e7182d752103ef12ee1217a5d9fb64dd30cfe90a5e288c618e41f2f5f514b2df",
      sub: "df20b3a6bc4f7f44ef8290122506b1ee49879fab11985cd664d2a1229ff48eb1",
      mul: "e1db2a5735c41732e6d9f5d8fb20a3f3a2b267968ce4be46603917bf45b881f8",
      d: 136246798,
      divQ: "0000001bf7527669410f23f39bc089ca1c3f78630d0f13e5dfc7f2272a4e81aa",
      divR: 129248636,
    },
    {
      a: "0b35d0a699091aa0de6a7e3a57f1cb747026ee2815e4b4a9fff813ad99b6bcbc",
      b: "7f23a72a514642c5c8ca3ef2ed006c57e94ca59aebf6852fcd1cc391ed6c0f32",
      add: "8a5977d0ea4f5d66a734bd2d44f237cc597393c301db39d9cd14d73f8722cbee",
      sub: "8c12297c47c2d7db15a03f476af15f1c86da488d29ee2f7a32db501bac4aad8a",
      mul: "edeb861b1e03877e905f00b3e5bc335ace8a45af7dc8bf20fefa2437660fe0b8",
      d: 126653630,
      divQ: "000000017c26a95af4b6cf71cbe428f585c1f982a455e370b77c25e713ec3618",
      divR: 67155692,
    },
    {
      a: "bb4bdf0e584976c9a741964fda195058de8e215fb6ad4c9c442ca9a6e8e7f26e",
      b: "c5abb1b1956e2160986578bed11ad73e864da95281b8d7bcbcd82cc7932290d9",
      add: "80f790bfedb7982a3fa70f0eab34279764dbcab2386624590104d66e7c0a8347",
      sub: "f5a02d5cc2db55690edc1d9108fe791a5840780d34f474df87547cdf55c56195",
      mul: "4a48f494d77af67c458098f28c0727f704aff3a523a45f7487fa2c0341965f3e",
      d: 228211191,
      divQ: "0000000dc4f1cdf7c653edcfcb59710e4f2f7ce78317ce96b251b81918712605",
      divR: 37955227,
    },
    {
      a: "5ae17f1f1037fb5d23f16a9aee35e7408c87fa609fe7f5dd5a7cfd39b8e2f83e",
      b: "7fb4e8fdd4d5af8c5e448567e652d9141f44ed3d06aebe226529237f8b1cf236",
      add: "da96681ce50daae98235f002d488c054abcce79da696b3ffbfa620b943ffea74",
      sub: "db2c96213b624bd0c5ace53307e30e2c6d430d23993937baf553d9ba2dc60608",
      mul: "935df3e00da726fc9cd8ae5759663dc9a913a343950887d53fe911525f52f914",
      d: 41115188,
      divQ: "00000025159412e866671dfffe1765f6356654fa18dbd855aa7ce1bb80baf216",
      divR: 35895238,
    },
    {
      a: "b32245ca0f53fa6c00e9e389ed3a9102b15aea2b48213e93f12b5a282220cc18",
      b: "303ff93f8ed347a3afce313073608500feaf30efda3ef60f7f1f58ae2b4f53b1",
      add: "e3623f099e27420fb0b814ba609b1603b00a1b1b226034a3704ab2d64d701fc9",
      sub: "82e24c8a8080b2c8511bb25979da0c01b2abb93b6de24884720c0179f6d17867",
      mul: "4bea402e8850e8c0410c85823c6e9783332af6ced78a6fa374ad5b873e40e498",
      d: 109018009,
      divQ: "0000001b914ff86cb51301062ad7dcfec6217d2e5d913dd173dd2b03e5cb923d",
      divR: 32511651,
    },
    {
      a: "fc367bf9e106446cc705cc34aa050b780ea7e46d347265efabff862ed5c5c7c4",
      b: "e059f46c84b5c1fb3668018f5a0945b54eaf8c62ac028b580da47a4ff4d23361",
      add: "dc90706665bc0667fd6dcdc4040e512d5d5770cfe074f147b9a4007eca97fb25",
      sub: "1bdc878d5c508271909dcaa54ffbc5c2bff8580a886fda979e5b0bdee0f39463",
      mul: "91e6885b03b579bba2f052409bf7e46b4c7af93b07d6d221f08518761584bd44",
      d: 142390666,
      divQ: "0000001db78fee934d068c730eb3b797d91248f89950db45c14836629b66e9c2",
      divR: 51223344,
    },
    {
      a: "0eef3b4e18f9682d7fbb64cad1dcb5429693b3e487fabf46d23fd63134f428f8",
      b: "948f642a5743541d0e3b68f07faebfc585c3e877fb12e996712fc1d9aeb70331",
      add: "a37e9f78703cbc4a8df6cdbb518b75081c579c5c830da8dd436f980ae3ab2c29",
      sub: "7a5fd723c1b61410717ffbda522df57d10cfcb6c8ce7d5b061101457863d25c7",
      mul: "0398e5e53e3e374414326f185c0cbd63b1fd400a838e0117804713a3d87ebf78",
      d: 118306330,
      divQ: "000000021e2dc57a7e2870599ffe4a2a9a9e9bee11d20a8de3508bf2bef5d32d",
      divR: 19413094,
    },
    {
      a: "d58d4b20fda5d465d8cb24c63182a62c763dc31d95e1c6afdbf7d72252250d6e",
      b: "6fa9cda0a4a4e7634cb006ee92fe661ddbe57578075b03a56d25c318e97c991a",
      add: "453718c1a24abbc9257b2bb4c4810c4a522338959d3cca55491d9a3b3ba1a688",
      sub: "65e37d805900ed028c1b1dd79e84400e9a584da58e86c30a6ed2140968a87454",
      mul: "e72d7d6d7b3eff57462f8202fec7b47ca0d4556cbb3f4ef09bbcec101c121b2c",
      d: 17279088,
      divQ: "000000cf596bc8a6450b0b170dc9242c8db5b73416cdbc711d4cde82bd82fc8b",
      divR: 5134494,
    },
    {
      a: "3a5d0c41aa2cf6d5aa1799019fa3da9d7d7c9cb077938ac4525fbbcfa6b4d7e5",
      b: "d698bac460544a8f02434558da75904186b6c450ac4c62528a334f02a3491351",
      add: "10f5c7060a814164ac5ade5a7a196adf0433610123dfed16dc930ad249fdeb36",
      sub: "63c4517d49d8ac46a7d453a8c52e4a5bf6c5d85fcb472871c82c6ccd036bc494",
      mul: "da6a377a80e21e3dfd77335cee71e23125d4d70a79e8fbf0813edfe58a8b4e75",
      d: 110815114,
      divQ: "00000008d60c7956a3f51f11688acc8031fa9bef4a2b49d5ade32b69ff0b239d",
      divR: 52361795,
    },
    {
      a: "6e26e3fbaaa2b343fe85abe0af08f67c6b8ced1bea4a1b27894860bbc42bf2b7",
      b: "669ed880a614773e7aa3d0fc005e7f3296542f3f8cfe74ded03deafb0d217b9d",
      add: "d4c5bc7c50b72a8279297cdcaf6775af01e11c5b7748900659864bb6d14d6e54",
      sub: "07880b7b048e3c0583e1dae4aeaa7749d538bddc5d4ba648b90a75c0b70a771a",
      mul: "a0b9331fa80394794eb33e799387d73d6ae40ace18bd593c01954ed30128c73b",
      d: 264808063,
      divQ: "00000006fa92a1daed45904be0b0929caa3e1f68d4be7d23a717538cb50498e6",
      divR: 235861149,
    },
    {
      a: "b1100f531620126bf9ce21337b06cf5cfc285eb103d8e849837fafb1cec6d907",
      b: "2b9e8e8f40a37d14217a128eba3085e933deb6262288f91efe591833b9eccd15",
      add: "dcae9de256c38f801b4833c235375546300714d72661e16881d8c7e588b3a61c",
      sub: "857180c3d57c9557d8540ea4c0d64973c849a88ae14fef2a8526977e14da0bf2",
      mul: "7820fc73318240a883cdc6d46f003cd53dc75f92cf9a8419bae802b6538e6893",
      d: 176048487,
      divQ: "00000010dfb61c6a88204901b71d315214ed11a0f3ee9818ebda29b066b4bf47",
      divR: 110142582,
    },
    {
      a: "84ec702b1ddd956e1077a5c82b24c85822a937d566f41643520841c6fe04c1f2",
      b: "7fa5b823e07feded85d40b13bc0aadc1e2bb322a6697d5c0c6f897a599dd74c3",
      add: "0492284efe5d835b964bb0dbe72f761a056469ffcd8bec041900d96c97e236b5",
      sub: "0546b8073d5da7808aa39ab46f1a1a963fee05ab005c40828b0faa2164274d2f",
      mul: "26a0cad76a32f807cb407adb84db88762e029c4124328e17869926acb56b6356",
      d: 244925085,
      divQ: "000000091aed461bf7f13a373ff65e6d8499615cececcd7285c23f1b4ee22dfc",
      divR: 165123686,
    },
    {
      a: "561894a5d60fabebd8f58baacb3d06b7cd4f3219c61c7d873afffec011b9ea56",
      b: "887cd777aa405a00d7e78458c58b79731cf2a2985609c8ef77656fa406e494fb",
      add: "de956c1d805005ecb0dd100390c8802aea41d4b21c264676b2656e64189e7f51",
      sub: "cd9bbd2e2bcf51eb010e075205b18d44b05c8f817012b497c39a8f1c0ad5555b",
      mul: "d79826c5556c6eb6292f11c29ddef4cf9f5efc3c3077a8f6a1635ebb955a7a52",
      d: 38430632,
      divQ: "0000002596004675bf5ea5a618084cbfbe421cfbbedbc8ff212c73951c762581",
      divR: 30434990,
    },
    {
      a: "c6b67c14aefe671f8c100f74ac2929ad0ae367bd6b45684cb060851af6a8c75e",
      b: "ef649a35aa334f8259e26ce7330d7c278af7db933fdf32064ac94d01ceba8a11",
      add: "b61b164a5931b6a1e5f27c5bdf36a5d495db4350ab249a52fb29d21cc563516f",
      sub: "d751e1df04cb179d322da28d791bad857feb8c2a2b6636466597381927ee3d4d",
      mul: "720391d70883e5ceada1517e950acdec146b533d9924330d95aa742ddaf9e93e",
      d: 186052205,
      divQ: "00000011eb3c0ddd239f60a0aff23d91a90023895cc812aa02d52d946849f6c7",
      divR: 161723043,
    },
    {
      a: "b057c52e3df6daf77499c17dd89422060748191d14d3b5f5e1a8a18c438afebe",
      b: "2d4edaefc28e9546b3947dd36eac1ad7118cde9ebca076962038628399d43212",
      add: "dda6a01e0085703e282e3f5147403cdd18d4f7bbd1742c8c01e1040fdd5f30d0",
      sub: "8308ea3e7b6845b0c10543aa69e8072ef5bb3a7e58333f5fc1703f08a9b6ccac",
      mul: "d8216a744a8b9f865c99e70648d1453b16a17e01bdc8d3c4a923d9a268df055c",
      d: 219481721,
      divQ: "0000000d7acbf049129e627388f1d56168090fcbc337f8da478be527267b0102",
      divR: 37189836,
    },
    {
      a: "7bfdd113d6958a8a9b54dffc82619fb352bc37f1b0bbc80d61c4f854161d2a4b",
      b: "d8678ef280de57272a3171589dc23a87e42736d757d4bc78956eb4f2a64fffab",
      add: "546560065773e1b1c58651552023da3b36e36ec908908485f733ad46bc6d29f6",
      sub: "a396422155b7336371236ea3e49f652b6e95011a58e70b94cc5643616fcd2aa0",
      mul: "6db1be31819ab622c3102b21d09a5ff140264fe35ee01a79e6c0158481c0f519",
      d: 48129613,
      divQ: "0000002b38b0ffbe3cf908bbf873412bdb91cbc011eddfbecaccaead341d1c88",
      divR: 34432355,
    },
    {
      a: "7de8528eaa457f93a6650f11f78c6445dce8f0d7ef1faf3ec0d393c5db7f3870",
      b: "83a03eb4d539f8fd3df31f07206a73caa30c628ea325e1557e7ad6917eb44422",
      add: "018891437f7f7890e4582e1917f6d8107ff55366924590943f4e6a575a337c92",
      sub: "fa4813d9d50b86966871f00ad721f07b39dc8e494bf9cde94258bd345ccaf44e",
      mul: "c4559d8ccd4cce823a71e72c117719dde597b11555832732ca1db93fc0a33ee0",
      d: 149352698,
      divQ: "0000000e24bfc081bf079e0017e6711e9e5df02b9ace01880949e91e5a84868a",
      divR: 133592492,
    },
    {
      a: "7f69c14fbe69be448319186d1d3260a87a7e9402f52d9408aed69dc3d76640b8",
      b: "ad467b28631f4024cb38add9b20b4c5d20656078c80fbe480eee1851ab844f79",
      add: "2cb03c782188fe694e51c646cf3dad059ae3f47bbd3d5250bdc4b61582ea9031",
      sub: "d22346275b4a7e1fb7e06a936b27144b5a19338a2d1dd5c09fe885722be1f13f",
      mul: "d6e72cbd7074f9c00a795d4ad76d36d7c0bc3c7bea9c0b9d00781935a42d5ef8",
      d: 208772165,
      divQ: "0000000a3d3511aceae8e48890b35b21f1dd34ed6703b7a7afdb14b83c95c1cf",
      divR: 9428973,
    },
    {
      a: "eac1ede2012e89b14daa21efbac1f22e479ff833640c19b6a2a4d90257064ae4",
      b: "d082fae574d65e8f3a517514239ddc9071bf2ccc92b4178d20f84ad690bb3857",
      add: "bb44e8c77604e84087fb9703de5fcebeb95f24fff6c03143c39d23d8e7c1833b",
      sub: "1a3ef2fc8c582b221358acdb9724159dd5e0cb66d158022981ac8e2bc64b128d",
      mul: "fe86bacbbba0d22daa749f5c96708b60abd850177ad12146c8efe125e811537c",
      d: 219382286,
      divQ: "00000011f3fa1c6d26be9b9a7171b9ebd13142e982638684a6631fae3f12b279",
      divR: 23336518,
    },
    {
      a: "f9eaf90b4d7c1c7537569f680eb3ce0b2fa91ba5cbbcc9d9513c5cb9782e7a7a",
      b: "2afd9e3a041b33d0e7af346f138d88e272e17d15b28da7c7b3c3033c0415ff64",
      add: "24e89745519750461f05d3d7224156eda28a98bb7e4a71a104ff5ff57c4479de",
      sub: "ceed5ad14960e8a44fa76af8fb264528bcc79e90192f22119d79597d74187b16",
      mul: "2d732f033e359585da87e6b5657f9cf7ac4cbf62adaaa9f6ac4aaf7b32295da8",
      d: 236987200,
      divQ: "00000011b14ff4bf15032c36e715873edaee543d10f84999bde6f84d470f5743",
      divR: 151683258,
    },
    {
      a: "f550107e6c85248ce838d291dc12fc26fd813e96239a485aee63515d135468ee",
      b: "5501bb9aaa0f1d627ccc083e63b0da8136246017bac6733c4d36cf77d1c812df",
      add: "4a51cc19169441ef6504dad03fc3d6a833a59eadde60bb973b9a20d4e51c7bcd",
      sub: "a04e54e3c276072a6b6cca53786221a5c75cde7e68d3d51ea12c81e5418c560f",
      mul: "d2f9a0c1fcf7ce23a9c10fcdca10fe9eb0b700bf6e8bcd082704a7ae0dd82352",
      d: 91627615,
      divQ: "0000002cead4234c6e53c203757379bea0975164909110e998af88d99230c615",
      divR: 63588131,
    },
    {
      a: "56de692f1ec063951459edbf5d2f5a4350cff70d3a2586b451f5e4b9948d952f",
      b: "d4b980165dc9aa2f88b42b7c1abc6b43ea32e5ecd1d74ae4e2ae90dbf64ed56a",
      add: "2b97e9457c8a0dc49d0e193b77ebc5873b02dcfa0bfcd19934a475958adc6a99",
      sub: "8224e918c0f6b9658ba5c2434272eeff669d1120684e3bcf6f4753dd9e3ebfc5",
      mul: "104caba64d79d06107bacbb41106f12472c3cd663c4d89ae29657d24ee11e076",
      d: 37312106,
      divQ: "000000270f660e9a958e527cf1f66df4658e26790a10e52d838746d2a0fbb1e1",
      divR: 24860677,
    },
    {
      a: "c4b2688099e4a768eb2ecfe40772e9271a792a198e137de8e973494699562a83",
      b: "92abe149dec5a22057c47d89e0db90e895f58ab33434ff67787209c0df8c463d",
      add: "575e49ca78aa498942f34d6de84e7a0fb06eb4ccc2487d5061e5530778e270c0",
      sub: "32068736bb1f0548936a525a2697583e84839f6659de7e8171013f85b9c9e446",
      mul: "cc2be1e6f271a5fc03d69c8716e40dd9cbb61cbb8fc87c8e17242b2775cbf337",
      d: 257539448,
      divQ: "0000000cd04cee5a6d9a9f874299eb9e06f5602689b7b323d138fd50307fb2f5",
      divR: 70149803,
    },
    {
      a: "c14b00517fbc3f1a76975eb672993857c734a2bd7a61324c73bae58bc67fd958",
      b: "a2890139ab4ae2f9d8276a75f9a70a0dc74d027c901b1545069159dd3e9bcdf8",
      add: "63d4018b2b0722144ebec92c6c4042658e81a53a0a7c47917a4c3f69051ba750",
      sub: "1ec1ff17d4715c209e6ff44078f22e49ffe7a040ea461d076d298bae87e40b60",
      mul: "28a3a908dba1f6ec0b4856b3e7b0323f8ec71a61f24b44649659ac60952e0540",
      d: 119175803,
      divQ: "0000001b3611f35265d187b36ea1c39e81ed97407d135001f7aa92545a7524f6",
      divR: 27122470,
    },
    {
      a: "b191773853ff2df8248ae3ed18a940f3ec19bb7d46377af09b560e0f2a1123b1",
      b: "a77b755f3a3ecc71ff8e1b8fb5d9d0a07cf8e446461909073653894cf4acad87",
      add: "590cec978e3dfa6a2418ff7cce83119469129fc38c5083f7d1a9975c1ebdd138",
      sub: "0a1601d919c0618624fcc85d62cf70536f20d737001e71e9650284c23564762a",
      mul: "f2b4c460b03acbade5033982f4257647492d791e02eb8f0389bd948173146f57",
      d: 130292489,
      divQ: "00000016dd5de2562056fd671da1a1de3fe313ecafa79dac003b37eeca4a162d",
      divR: 128687388,
    },
    {
      a: "8d818e81e623ddbb52b72868b5bdf364270175d1825985042854de5676ad0577",
      b: "0d67855ebaacf1c72b2f0fb5c7da6dda27f5c25500c59560179fd1a0cf5014e2",
      add: "9ae913e0a0d0cf827de6381e7d98613e4ef73826831f1a643ff4aff745fd1a59",
      sub: "801a09232b76ebf4278818b2ede38589ff0bb37c8193efa410b50cb5a75cf095",
      mul: "311d0425ec869f29b7f94cf9ca2aafd6d05cb909c3e518a124c89877375c1f0e",
      d: 187828832,
      divQ: "0000000ca3bbb3770b6d081bd340776c2959f7b4656db51320975d4160c483b4",
      divR: 179214839,
    },
    {
      a: "1ebe0633e8bc627505b9c8c4d44562f1de36624ccad4b41cc4fdc4d2e829616a",
      b: "2863c77dcd490db79ace7bcdfaaf2d2c36cbc4a0ad319bf2f901f0388a74d176",
      add: "4721cdb1b605702ca0884492cef4901e150226ed7806500fbdffb50b729e32e0",
      sub: "f65a3eb61b7354bd6aeb4cf6d99635c5a76a9dac1da31829cbfbd49a5db48ff4",
      mul: "ba5c1bcb477bcceea66d419a13bed2b3af60bdcef95fc513eb2b193413a270dc",
      d: 97261493,
      divQ: "000000054d8c28cbb9d4a713e69e5b85e13bb23e722800c61ec4882b700f0406",
      divR: 23527212,
    },
    {
      a: "042534c3d626be1c3d2d3eb4e94b4a771b2a1a7a7d3861ba3e1d788a64cf56d4",
      b: "55c90e60d88b5fce95e963baf02261ea4246b05fda70f85ef52ce646e74a7279",
      add: "59ee4324aeb21dead316a26fd96dac615d70cada57a95a19334a5ed14c19c94d",
      sub: "ae5c2662fd9b5e4da743daf9f928e88cd8e36a1aa2c7695b48f092437d84e45b",
      mul: "dbcf7417ed68e7c5d22270b2b8da054c005c08189eabfcf7ddb80b8e5ff27234",
      d: 110404589,
      divQ: "00000000a1431deb2b117a695b7d8e06c8bd2afe6da6c853f45d8de6c9c0ac13",
      divR: 48492605,
    },
    {
      a: "a097ce03fb9ae762940744bdb0055e1cc144539c3326f6df24ed12267033590f",
      b: "a4c6c5f08d39ae436bd8e471b7b7af421bc49746d93633a25e0d4f7cb39ecfe9",
      add: "455e93f488d495a5ffe0292f67bd0d5edd08eae30c5d2a8182fa61a323d228f8",
      sub: "fbd108136e61391f282e604bf84daedaa57fbc5559f0c33cc6dfc2a9bc948926",
      mul: "469bbaf0629ca951177a7b2ab052295efcd21d7a449b3b019abd84f018012fa7",
      d: 209990619,
      divQ: "0000000cd4a173d947f3783628005ae0ced9372c618041db59cd4a42d663e567",
      divR: 82744562,
    },
    {
      a: "7fbeeaa9a1e330a62e3874922cf596eeea1980803a9d66abace1cd1cff0a8255",
      b: "07de7929419c1d80fc752e0c94ab139f081ce64be11ce4209a84ad9f89fa95dc",
      add: "879d63d2e37f4e272aada29ec1a0aa8df23666cc1bba4acc47667abc89051831",
      sub: "77e071806047132531c34685984a834fe1fc9a345980828b125d1f7d750fec79",
      mul: "c9bd93beb02fe438fb798122b9f21f78d3aa719d7f1ca23da8aa392a0ee57a0c",
      d: 237778692,
      divQ: "000000090374c3d857d34aaf206f567ddb8886265358a03d29e596e9451a8137",
      divR: 23702649,
    },
    {
      a: "3e5e1de394d29e3c8e679b876914b2255ef9ebb7ad37bf466fecfb2b690c41e4",
      b: "e12a3cd54f68a30d28620bb812ebb106b6ac94e663848439d5804e267c017fb0",
      add: "1f885ab8e43b4149b6c9a73f7c00632c15a6809e10bc4380456d4951e50dc194",
      sub: "5d33e10e4569fb2f66058fcf5629011ea84d56d149b33b0c9a6cad04ed0ac234",
      mul: "f01b1f6c01afd72491b176470c62e2e659da1294fcc922b47f79cfc3ff0168c0",
      d: 87733982,
      divQ: "0000000bed2c2f2983acb301cb673271fb027577a51df52179f2e720541a4722",
      divR: 66872936,
    },
    {
      a: "1e58773c0123f1de79b7f2635b0e2dd5bd3c6fae0938474f73d94f0e2a942aa5",
      b: "a23bb51bc8249a461da4f2156358ed65deb0e3dc258f6e84d16312b4ad1cfeaa",
      add: "c0942c57c9488c24975ce478be671b3b9bed538a2ec7b5d4453c61c2d7b1294f",
      sub: "7c1cc22038ff57985c13004df7b5406fde8b8bd1e3a8d8caa2763c597d772bfb",
      mul: "47520982e019f06e2d330d5b2448303507c3d2fa9d969c0b510decb173c00792",
      d: 142845587,
      divQ: "00000003906809f112e7b3adc77ff81b7488cfd80b292a49727959e1349819a6",
      divR: 111791187,
    },
    {
      a: "ec3ba88c0230f0d715690151b3baaa1db85d2914b1d3e31c6aa5510767f98849",
      b: "2393dacaee9883d0151ca109ab6c505da84e63b51a84f49c8145783793e2a551",
      add: "0fcf8356f0c974a72a85a25b5f26fa7b60ab8cc9cc58d7b8ebeac93efbdc2d9a",
      sub: "c8a7cdc113986d07004c6048084e59c0100ec55f974eee7fe95fd8cfd416e2f8",
      mul: "bd05515d1b7626246e868f236714a2491e7022d9813b85f1e7f1fc96f63d2c19",
      d: 119394433,
      divQ: "0000002131fe7b4c2a0616e8c404e308b02d7dd17f4d9cd13a9aa633686c9195",
      divR: 35265588,
    },
    {
      a: "d758b2ca80eba44a8421829b86db63ab4830565ee00b368ea49835e55bc79e33",
      b: "f415f3a7059e3c934bf14e715c55a466b1afeb184d5274816d03020a4512aae9",
      add: "cb6ea6718689e0ddd012d10ce3310811f9e041772d5dab10119b37efa0da491c",
      sub: "e342bf237b4d67b73830342a2a85bf4496806b4692b8c20d379533db16b4f34a",
      mul: "6435f82921640fa201f5dfed72cec3aa13048bae4391c56e34d2325df652da6b",
      d: 178093591,
      divQ: "00000014495ef6379c23a85e3a22a10c939ea87627dc356a476e096dae28435b",
      divR: 137611014,
    },
    {
      a: "02474fb09a64ec27f06de75cd8164361cc1e05835732a5bbdd35e47546830b24",
      b: "bd1ac64d1cc28598d20ad6f1c42589cddabb80dfb9d5c10b16c10bcfe4a4c957",
      add: "bf6215fdb72771c0c278be4e9c3bcd2fa6d98663110866c6f3f6f0452b27d47b",
      sub: "452c89637da2668f1e63106b13f0b993f16284a39d5ce4b0c674d8a561de41cd",
      mul: "da9686881253066fb3deeee8b538103fee26c1777f8e58ae6f3328330d580d3c",
      d: 57661431,
      divQ: "00000000a9b880fd19e46484fe5163a30f32c2b1d6e18db67a8393698fdfe5e9",
      divR: 6195285,
    },
    {
      a: "07990e4b6ba9204d1cceefdeda540f94530d387d9aa8281bdf1164f7ad156558",
      b: "c6fc5e301ccc15f990920b6b672811f94510990c2177b1effa928fe866fe9fc7",
      add: "ce956c7b88753646ad60fb4a417c218d981dd189bc1fda0bd9a3f4e01414051f",
      sub: "409cb01b4edd0a538c3ce473732bfd9b0dfc9f717930762be47ed50f4616c591",
      mul: "1ce1aeae93f8b8ca446a00b7d47e167324b38fefb98da92a9c1f926372e36f68",
      d: 188647829,
      divQ: "00000000acfb509c7c7bb1f149512400dff20e01375d52ac92a6cc851e2a3181",
      divR: 30051395,
    },
    {
      a: "40dcb8008f50d1dfacc729fcdf54eab6d75192f6a35e43cd4f20ac26d1617728",
      b: "8ec21d3dc1278cf1f509cc9cc2db99df44b9ac71bc5cbb7225235a798aa75dd5",
      add: "cf9ed53e50785ed1a1d0f699a23084961c0b3f685fbaff3f744406a05c08d4fd",
      sub: "b21a9ac2ce2944edb7bd5d601c7950d79297e684e701885b29fd51ad46ba1953",
      mul: "723588f925da4ae000e69bedc44ed89e071e573abe003d003c57d914e979ac48",
      d: 77214611,
      divQ: "0000000e17e0f4ec845c13699ff0ac59ece233e2aea4137c94eb0cd0c191f9d3",
      divR: 14416383,
    },
    {
      a: "122a5cfc1913c072f1aef625bae8b51fcf512b8922aee0902170d668462931b2",
      b: "3b377099353a80b5e14ab24f756dee8b8ba1499cb1fa945e82ed46472476e5a8",
      add: "4d61cd954e4e4128d2f9a8753056a3ab5af27525d4a974eea45e1caf6aa0175a",
      sub: "d6f2ec62e3d93fbd106443d6457ac69443afe1ec70b44c319e83902121b24c0a",
      mul: "d349b0f4e0a9d0ed2a88b1ad20619517ee90d292b98c957f7e939188d488d6d0",
      d: 241524794,
      divQ: "000000014308190032fe130af9937dcd96108d8dd2d68cac1a03bd168e621609",
      divR: 203412392,
    },
    {
      a: "92c552da7ad998927b1510ce05c7bf3e611f75cac4015522b8a9319cb3c3c218",
      b: "be1f52f06c65e84b0e7e0d161b514fe6ed5522bdebc9ae9fc06230b19cc98ba8",
      add: "50e4a5cae73f80dd89931de421190f254e749888afcb03c2790b624e508d4dc0",
      sub: "d4a5ffea0e73b0476c9703b7ea766f5773ca530cd837a682f84700eb16fa3670",
      mul: "c740a07ea3126c4796c6b6cc345637bc230cb6206755fe97ca7ac60347b267c0",
      d: 101099544,
      divQ: "000000185b32ebd4b897fceae44f2eed004d2b72c7e569800b311b2292c0ec77",
      divR: 28671728,
    },
    {
      a: "dd01558e39944ce350a5a430bd45f69e2d364ffc921f0f67193573f958b4c97c",
      b: "1c064651317f9696a726d92ad7dfafe977123a2612b086729175e8094991178a",
      add: "f9079bdf6b13e379f7cc7d5b9525a687a4488a22a4cf95d9aaab5c02a245e106",
      sub: "c0fb0f3d0814b64ca97ecb05e56646b4b62415d67f6e88f487bf8bf00f23b1f2",
      mul: "60a968ae18f9bc652e017e9895c45f78b403102f9e1db44f75622c988acac0d8",
      d: 143122050,
      divQ: "00000019e82c37d1693b9b6780fe36bd5b592757585f9308ce03c90617eee4ad",
      divR: 131834786,
    },
    {
      a: "e0948be944690150f0e3171ed64c03558f39e54bdf2190818d0d0d8f40298af6",
      b: "3f86c8d1c95cb953df98eb976eb7ce6812e4bbc9cd6a5b1473e4cd865626dcc6",
      add: "201b54bb0dc5baa4d07c02b64503d1bda21ea115ac8beb9600f1db15965067bc",
      sub: "a10dc3177b0c47fd114a2b87679434ed7c55298211b7356d19284008ea02ae30",
      mul: "7a4aebf46c604dfd85b99ffbd7945aa864d56e116a5b56e991aecd8c9810e244",
      d: 161797317,
      divQ: "00000017499015d15ee4ae01f382121ff7ddec169b3a6f68076f89b1cf20cc85",
      divR: 5899421,
    },
    {
      a: "195647137d41a19fb1f47085657a99e899fde39c563d53a5f4cf623e64d5b804",
      b: "d5b22f4e49ccab81afcedac27b92384b7a5d87711bf591f7716a4157dae7c242",
      add: "ef087661c70e4d2161c34b47e10cd234145b6b0d7232e59d6639a3963fbd7a46",
      sub: "43a417c53374f61e022595c2e9e8619d1fa05c2b3a47c1ae836520e689edf5c2",
      mul: "85220d5e674dd10f28ff1c1b958c55c49f392d0b7472f67b8c18256868287908",
      d: 233914862,
      divQ: "00000001d1381c62b0c0bc1a9cb69ee73504fc213c1cb94969e700c72e20bbdf",
      divR: 46428082,
    },
    {
      a: "7e94067ccdb8ac9cc2b0186444caaee069f2ed88e0376866bb62a7ed6bc3def5",
      b: "670102ec1bc09f80937406fd512e50128a47156ba843b9e6987eeab7b5f3d692",
      add: "e5950968e9794c1d56241f6195f8fef2f43a02f4887b224d53e192a521b7b587",
      sub: "17930390b1f80d1c2f3c1166f39c5ecddfabd81d37f3ae8022e3bd35b5d00863",
      mul: "3f78f5d31c5ae3ad79d2dd0bdd7c06b07960b60d2cf4cdbbe19958300da4f5ba",
      d: 84201424,
      divQ: "000000193888a12cbcb82860949318d829699f2cbeb00c47a033c5861a10b9f6",
      divR: 32955669,
    },
    {
      a: "42541b0683d9f9c2787341f5e25654d3339ae9ead360ca117f757c8b484e4842",
      b: "e774c6c2e4d55d6750aad74aeef3f3b61f0c8d723ee53253886b476d9195ba7c",
      add: "29c8e1c968af5729c91e1940d14a488952a7775d1245fc6507e0c3f8d9e402be",
      sub: "5adf54439f049c5b27c86aaaf362611d148e5c78947b97bdf70a351db6b88dc6",
      mul: "5e2ba0a59547f463f32c53d6135746e168f219607ccd1ade3d60049756d4f3f8",
      d: 219874206,
      divQ: "000000050fa519b56ca7d4ec096433450c0bfc2800ac3c28512024531c29cef7",
      divR: 168208080,
    },
    {
      a: "430d07e9a6fb02b1aa801e40a965323217fc77d68ddca65f1193995ea7928607",
      b: "b708887d5954509d14413b662100d87471af087f17a1640e8a99b953bd687b87",
      add: "fa159067004f534ebec159a6ca660aa689ab8055a57e0a6d9c2d52b264fb018e",
      sub: "8c047f6c4da6b214963ee2da886459bda64d6f57763b425086f9e00aea2a0a80",
      mul: "a9e85a4d091a80b0e905cc3d5f4ac3fa29e7267bf840d9c2773d1f2c62820ab1",
      d: 243120318,
      divQ: "00000004a085b38d9c54b4795572257e154f65332ac3af1e5a56e44ae3612346",
      divR: 116525075,
    },
    {
      a: "78a0a15d34b5b7678f8a3efee7af870ee14f27bcea1cec49ab4f27bc9403a73a",
      b: "be495a71a16a9621c5ef4c1603e34f54f0a3db3127ff3edcb2c2d9259d8602b5",
      add: "36e9fbced6204d8955798b14eb92d663d1f302ee121c2b265e1200e23189a9ef",
      sub: "ba5746eb934b2145c99af2e8e3cc37b9f0ab4c8bc21dad6cf88c4e96f67da485",
      mul: "58646195462bc888b48184632af7749838dfbf0b3246e8d5bbfd9e56c83fb002",
      d: 175308240,
      divQ: "0000000b8b508b251f4dabfa657c62d99a57c390ba534a9957c4a39dc2477905",
      divR: 18702890,
    },
    {
      a: "8131a63e98c5968a6a83ccd4f18249107b7693783c8b59ecc8c9eb64d1d8e067",
      b: "2ce4a86b10e2fdda79b85f650c62b6076923dd4cc6169c31fb05149bc2b51b4a",
      add: "ae164ea9a9a89464e43c2c39fde4ff17e49a70c502a1f61ec3cf0000948dfbb1",
      sub: "544cfdd387e298aff0cb6d6fe51f93091252b62b7674bdbacdc4d6c90f23c51d",
      mul: "3af93652dc5469083edd9362f8a15b7c2bdc5d8e48cfce2d8a5b50083f2ebac6",
      d: 185760873,
      divQ: "0000000bab161817f103cac5149c74ae9849523f5f5026f639d26037e7ea5505",
      divR: 3380570,
    },
    {
      a: "02d20e30eb0e9821ced97ea00837c834a4e45abcb527e4f0dab4f09f73a8fb52",
      b: "faa41d92a6a8b2fb24995da24df07dbbeb305323779a8611e2f2e4c1109b08da",
      add: "fd762bc391b74b1cf372dc42562845f09014ade02cc26b02bda7d5608444042c",
      sub: "082df09e4465e526aa4020fdba474a78b9b407993d8d5edef7c20bde630df278",
      mul: "09a2e58e3239a036b1721c9d3b1c281b8a387379e147c1ce371dfb3d106693d4",
      d: 112023954,
      divQ: "000000006c2367a618f9f769329a981b237101ab585aabc8d579365eebeacca9",
      divR: 40141296,
    },
    {
      a: "5e50c33fb4e0c646e65fa9820f9dcc9bf661f577a96be80592737357c60288c3",
      b: "7fff5c2b7cfe385cf8d364cbbbe347d199059535f14483345c11f035168c2377",
      add: "de501f6b31defea3df330e4dcb81146d8f678aad9ab06b39ee85638cdc8eac3a",
      sub: "de51671437e28de9ed8c44b653ba84ca5d5c6041b82764d136618322af76654c",
      mul: "f321d339617184553a2e327e160746bbdf1600410cd56b6503243f61f0843ba5",
      d: 219247832,
      divQ: "00000007379923638a4773ef48200fd144ed4fb0de724bc7dff6a7ab620ff123",
      divR: 83375931,
    },
    {
      a: "8ec8725cc3397485e32120ee323575f8cf08ebe572276c957f2dc2867db4591d",
      b: "e5f9b469cc99f9aac413b03845263b6aadbe4920ebb53baa718e95de6e31c228",
      add: "74c226c68fd36e30a734d126775bb1637cc735065ddca83ff0bc5864ebe61b45",
      sub: "a8cebdf2f69f7adb1f0d70b5ed0f3a8e214aa2c4867230eb0d9f2ca80f8296f5",
      mul: "a9636ee745b7fcdae14f51eb78282f4be1c174b196806c80c7ab063bd442e688",
      d: 66171786,
      divQ: "000000243384e726ceb4eaee532dff8ab71c7503c63455c2167340e70d3f9c00",
      divR: 55984413,
    },
    {
      a: "16a22b3e9f004af661e8af7db16c1f1759d10bd5ab2f1221d93e786c89b8e54a",
      b: "cfa041bad0c3579d83e410cc2219f077e341ce3f21aa897a9b13bc3e2269cd0a",
      add: "e6426cf96fc3a293e5ccc049d3860f8f3d12da14ccd99b9c745234aaac22b254",
      sub: "4701e983ce3cf358de049eb18f522e9f768f3d96898488a73e2abc2e674f1840",
      mul: "123da7165a83253d73969d9f30286cac709ef667d7102125475689bc502f36e4",
      d: 67499818,
      divQ: "00000005a027026a4c75dcb3c787b51ef332d7cb929742d7aa6c4cf916054d53",
      divR: 10494124,
    },
    {
      a: "00ab32183d075fea3f8b058eff8a764c4b427c965831cbe65247dda33e6bd213",
      b: "3a3c673d60fb998f934dd254339f5fdcc0598a5edccf4d54c362dabb8cd65c34",
      add: "3ae799559e02f979d2d8d7e33329d6290b9c06f53501193b15aab85ecb422e47",
      sub: "c66ecadadc0bc65aac3d333acbeb166f8ae8f2377b627e918ee502e7b19575df",
      mul: "f3d5dca4003aa307c3d23f7c296e736b505df20bd01fda9064c5767c6d477fdc",
      d: 142293532,
      divQ: "00000000142f58796ebf35834d675fc337bf2eae7deb201bf872720d6f007956",
      divR: 42930347,
    },
    {
      a: "ca8dc7debe51b6d19a4385c58ce695cfe78ef374afb742b252d96b43e74c7980",
      b: "b624c8173dd61b2abd24dec4283056b496db1d510df026b200fc32f704571aa1",
      add: "80b28ff5fc27d1fc57686489b516ec847e6a10c5bda7696453d59e3aeba39421",
      sub: "1468ffc7807b9ba6dd1ea70164b63f1b50b3d623a1c71c0051dd384ce2f55edf",
      mul: "56517ccb29f627632cf68ea0a4b336d25e5f9bb925b3881967d6629585ef6980",
      d: 20669688,
      divQ: "000000a468c94732cf26bf9fff80616e195999e1a4c374cd671bfc58b7ea71e7",
      divR: 7529912,
    },
    {
      a: "c230bd286cf04972b3c5af10c8983d6c3b0f871e01b2954dc2318968cbc782dd",
      b: "7d09b0d95df68f50d3e2ba82104c0f67579d356c2a01436e989a333f3a324320",
      add: "3f3a6e01cae6d8c387a86992d8e44cd392acbc8a2bb3d8bc5acbbca805f9c5fd",
      sub: "45270c4f0ef9ba21dfe2f48eb84c2e04e37251b1d7b151df2997562991953fbd",
      mul: "2aad9702bf53028e2dd2059260d0c68d6334f5f4d105f96aa7e7d66f515a32a0",
      d: 104523086,
      divQ: "0000001f2b7e83dacfb8349e7255d80906287f89e608677e0089394f5b3c7c49",
      divR: 94525343,
    },
    {
      a: "8dc6a85461e78b06551c1e39de00be56075a84b0ecdd359d1cd99e6171a7cc58",
      b: "85a500b1c720879cf93ba33c78b159a7a593765542bcf36b60825680d7e59134",
      add: "136ba906290812a34e57c17656b217fdacedfb062f9a29087d5bf4e2498d5d8c",
      sub: "0821a7a29ac703695be07afd654f64ae61c70e5baa204231bc5747e099c23b24",
      mul: "057de90d0c4356e78ef2a94c5993a76e228c80e559eaf57599c3b0e2d38b59e0",
      d: 167294548,
      divQ: "0000000e37d3dc0838ba2e7b15007e0e77aeff3b6effa060cc9dbb2b234386ce",
      divR: 135863488,
    },
    {
      a: "db960e7ebdbeabe4695463b3d57b9f51c111329d6a4af031051b9abb8af964d2",
      b: "11ab3aa720f04adb775a678f618ef3efb24afc4d75dc034bd8a8a01356788eb1",
      add: "ed414925deaef6bfe0aecb43370a9341735c2eeae026f37cddc43acee171f383",
      sub: "c9ead3d79cce6108f1f9fc2473ecab620ec6364ff46eece52c72faa83480d621",
      mul: "14538ad8cbfe94ecc730b9ad13a20bf54f2b6740c98b40ade9d8ab1d3acb3132",
      d: 252560289,
      divQ: "0000000e963800e778d7e3187d1aa4c4269345eae25238c56bc245b71a107593",
      divR: 127498847,
    },
    {
      a: "f7cfbabd3790f244f6075185c70f971fb719b2f38f60bd6a1cca521c9b95d8aa",
      b: "bd3e4154019c979da8bc28266be5f87698ca8432a5a274c23bace9afec7c8c30",
      add: "b50dfc11392d89e29ec379ac32f58f964fe437263503322c58773bcc881264da",
      sub: "3a91796935f45aa74d4b295f5b299ea91e4f2ec0e9be48a7e11d686caf194c7a",
      mul: "a0690902ee202427e4d30f356c8a059bd2539d016d1776f0adfa60fac8ed97e0",
      d: 150611806,
      divQ: "0000001b9aca4e99a8118468c3b3f0924ec1c58b91d026e9d5507020fe7437a4",
      divR: 38235762,
    },
    {
      a: "0e589b951ed0d41bc76e8ad399769413b1fa41c66fb9515d88bd896e63ca5049",
      b: "e90bb839bfb1b054b5d5646c63bf5466722c553b5e0ac034ecfee8d8dde5d596",
      add: "f76453cede8284707d43ef3ffd35e87a24269701cdc4119275bc724741b025df",
      sub: "254ce35b5f1f23c71199266735b73fad3fcdec8b11ae91289bbea09585e47ab3",
      mul: "1ee263d6d24c4b55578d7ee3e8438c6f20a3054e652603ea8e303096a3a4c7c6",
      d: 242863757,
      divQ: "00000000fdb4e27bf4239c570fc7a149c67823b3caedb894b657cd5093c4eed4",
      divR: 233844101,
    },
    {
      a: "25837b6dc8dfeea241c764b2348cf7987c6d740a0ee6a51180e0d8170e262bc4",
      b: "0b547620ea4c1ef96a6bd044bdc193106fea778bd47978daaff7ec61aca75230",
      add: "30d7f18eb32c0d9bac3334f6f24e8aa8ec57eb95e3601dec30d8c478bacd7df4",
      sub: "1a2f054cde93cfa8d75b946d76cb64880c82fc7e3a6d2c36d0e8ebb5617ed994",
      mul: "7f034f66b4bc18ba272b5194b0f4f57d226b63186b1bb7db66d70c6d1e08fcc0",
      d: 89853693,
      divQ: "00000007012240f0f6959187bffaf72d6033a0b18103d6cc582b602997e839bd",
      divR: 55428603,
    },
    {
      a: "57eac6c4eb68ddaafaddca66fc1e6e87b9d73d3489cfc20e4de37f326dce64de",
      b: "a00ef8c90d74ecd60cea4e52a2302812b49d94d1663031f964e443f33a62b750",
      add: "f7f9bf8df8ddca8107c818b99e4e969a6e74d205effff407b2c7c325a8311c2e",
      sub: "b7dbcdfbddf3f0d4edf37c1459ee46750539a863239f9014e8ff3b3f336bad8e",
      mul: "93cf7db9cc94e430ff93e8ef35c530380b4d93e43d7d2ecfe23b70d7c3963760",
      d: 57754616,
      divQ: "000000198a0613114cac8ed4cbe86e4f0fa7e8a44316866fd1004ceeb3240d7f",
      divR: 21632214,
    },
    {
      a: "654586f41f471e3fb05d8499e6c591604cd41f091db0504f38822e9f76f01ef1",
      b: "56340d937ab6951d03b1757a3e0c194e1930adc97cf4601458924ff4f228d04d",
      add: "bb79948799fdb35cb40efa1424d1aaae6604ccd29aa4b06391147e946918ef3e",
      sub: "0f117960a4908922acac0f1fa8b9781233a3713fa0bbf03adfefdeaa84c74ea4",
      mul: "e08bf0df236145b8589f9a2cb8dc68fa90d44aae9f713a41c03f061287051e7d",
      d: 257118301,
      divQ: "000000069baa60bb2a2ff7cd54230628dbc1157a49cfbef6e646638d8785f62b",
      divR: 157761874,
    },
    {
      a: "2b5cf96557ffa3b738937685f4c898ebe056a50b52df4278d938c63638e9ce99",
      b: "e0366752c2beb20213a88f1aa73f29dd07da7085938152d63bf3394423286c7c",
      add: "0b9360b81abe55b94c3c05a09c07c2c8e8311590e660954f152bff7a5c123b15",
      sub: "4b2692129540f1b524eae76b4d896f0ed87c3485bf5defa29d458cf215c1621d",
      mul: "26138e64b20366cc550de9555ce4b5a0fbac4cf3a64939ab18b5afb167509e1c",
      d: 240276820,
      divQ: "00000003071ecc4f54eeb73e1ba213474fb7f03186bb14bd5a78c2344fb982d3",
      divR: 100979293,
    },
    {
      a: "0fc502c5015925b2fe7809fb3b66a4f7ab35a382092be9b38eca203d160e8ef2",
      b: "f3dc37ff93421f900273c72169fa575a8e9f3bc8f1ae708520ae8338afb2d606",
      add: "03a13ac4949b454300ebd11ca560fc5239d4df4afada5a38af78a375c5c164f8",
      sub: "1be8cac56e170622fc0442d9d16c4d9d1c9667b9177d792e6e1b9d04665bb8ec",
      mul: "74fb9ceebf6a0b9449caf06af38d7ce5d5bbdfad2f6c4b4a2b0e36a58219a5ac",
      d: 104098298,
      divQ: "000000028aa21576b116c167f78a4dfcd51562f38b76e2feb484573674027ed5",
      divR: 72701424,
    },
    {
      a: "d97ebc65af41462b2d8aabeb79397eddc7bd2c4de214360e67939b4e8fcb8818",
      b: "fbaa00f7b6d590a0f5952444dd97f880a80e7adfb2e2128a5e1876ad8a09677b",
      add: "d528bd5d6616d6cc231fd03056d1775e6fcba72d94f64898c5ac11fc19d4ef93",
      sub: "ddd4bb6df86bb58a37f587a69ba1865d1faeb16e2f322384097b24a105c2209d",
      mul: "495807bc33d1a9a5d3f608f9072951c977933d3f84c668dd86350856b3640b88",
      d: 10152919,
      divQ: "000001676676daa41f9135ce744dbe390a9951ae88e725c49f94ab11c1e2c36f",
      divR: 2916575,
    },
    {
      a: "472d227da5306a9b5992824b1c842a40a8f3d10726af155b3a61a49e85ccc0d4",
      b: "966bdf31eef89f4903cc48a52b9735fc2d2f1d9ca57d6213e9c253926ff05c1a",
      add: "dd9901af942909e45d5ecaf0481b603cd622eea3cc2c776f2423f830f5bd1cee",
      sub: "b0c1434bb637cb5255c639a5f0ecf4447bc4b36a8131b347509f510c15dc64ba",
      mul: "1093e6abfd3c6d36be4f93fba79252108cd9933e84cb865adba79ca7ded7c588",
      d: 40936889,
      divQ: "0000001d2b971a90c479fdd74e123550d1747361687925fa1db7295029135eea",
      divR: 4216762,
    },
    {
      a: "db127356354967dfa1487beadd1e950b9f02abf212ef40bc314a1a3be99ef988",
      b: "66036571d7a42575a72f0a7d78c9f8b6155d39f55fd469919c968d0b733795d0",
      add: "4115d8c80ced8d554877866855e88dc1b45fe5e772c3aa4dcde0a7475cd68f58",
      sub: "750f0de45da54269fa19716d64549c5589a571fcb31ad72a94b38d30766763b8",
      mul: "26578ea2f6deafe52c3c01c474268372b12799fd89c303c969406bbf0c9ee680",
      d: 33177203,
      divQ: "0000006ec80ebb955e97345f74c9bd7dc652b9ed306b986b1937e9e6f7f39179",
      divR: 13586989,
    },
    {
      a: "c7484e05ba6eb4ae546b8c0fa071a7583d8a1888729a8bdfbd1d61feae99ff8e",
      b: "ab1d287e0f4e3a78c18e213ed319b0870fe42924f24384593995f53960daddfc",
      add: "72657683c9bcef2715f9ad4e738b57df4d6e41ad64de1038f6b357380f74dd8a",
      sub: "1c2b2587ab207a3592dd6ad0cd57f6d12da5ef638057078683876cc54dbf2192",
      mul: "e6b9d462e1e9e6a1889d7614418f0259f165b675703c6efa18628f05b02125c8",
      d: 125678650,
      divQ: "0000001a9a51647ec68ccce649578333bac41492b741a0c17676f3bfbc9b6f54",
      divR: 18331270,
    },
    {
      a: "59e454c364db5d24e3393b8ac804f3b2eb51539d467da7cf6dcc4767a902a26c",
      b: "e0a5b19fa596064a51c381058c3d0572556a5c6cc1217fce949429068fc0d0f6",
      add: "3a8a06630a71636f34fcbc905441f92540bbb00a079f279e0260706e38c37362",
      sub: "793ea323bf4556da9175ba853bc7ee4095e6f730855c2800d9381e611941d176",
      mul: "eca5ffb70d038a003f79117a9f36c898e36be9d2b97a0875a9fb2c2ab17fd3c8",
      d: 222371092,
      divQ: "00000006c835afb26b78df50b120e8b3cd7ab5875e72c8c352745be1fe60b89c",
      divR: 149850684,
    },
    {
      a: "7e68f871771f4b8316326a454fe07cec3d237f99f4daeb2f6e8ea482c969c8cb",
      b: "240f8e77085721308377058e96c5cd82214aeadd7e59dd193747f64719248200",
      add: "a27886e87f766cb399a96fd3e6a64a6e5e6e6a777334c848a5d69ac9e28e4acb",
      sub: "5a5969fa6ec82a5292bb64b6b91aaf6a1bd894bc76810e163746ae3bb04546cb",
      mul: "4c48c51d7374456085da28f0deb7ceecfb120fe40b554f632830d410c7831600",
      d: 110744477,
      divQ: "00000013268511e8ec7f6e0aa9a07fec72e9725633bc1c85d51fbee912b65c27",
      divR: 72359904,
    },
    {
      a: "b408738a8f80eedd8c91faf84d279c0aa05ceabe20beecba1bd2c5e1bd5ca59b",
      b: "e9d233b7a9ca5172d1a3458258f18fecc0c8bfd76e010951ea3fb040f0e3bd31",
      add: "9ddaa742394b40505e35407aa6192bf76125aa958ebff60c06127622ae4062cc",
      sub: "ca363fd2e5b69d6abaeeb575f4360c1ddf942ae6b2bde368319315a0cc78e86a",
      mul: "33269ee5e6d6abe61ea1bae3dc2a665c4772c9f9ee8bc869804a442acd7021ab",
      d: 33436751,
      divQ: "0000005a55547f0757766122ca42558a31c3e8a578ba4e51fe0af4329e2f3fe9",
      divR: 27170996,
    },
    {
      a: "32c3c1121e7c3c0c677f03427835fd14f7eed3d411bb4373ec33656fff285c21",
      b: "ca42d041c492b918b30a48c0a24d15cc1bf8e17b6fa597a964d1ddf22b994bf3",
      add: "fd069153e30ef5251a894c031a8312e113e7b54f8160db1d510543622ac1a814",
      sub: "6880f0d059e982f3b474ba81d5e8e748dbf5f258a215abca8761877dd38f102e",
      mul: "a67f5a1a58bc7c3789464d39e6b4c7024a8e4112a1fcb9dbd9ecf3daa1061e53",
      d: 200348954,
      divQ: "0000000440439c59c11be4d370ab4c5eed071e2c5c7638dbfef2c8fda8ec38bb",
      divR: 91767331,
    },
    {
      a: "226071f5e630530b91af5c964dce69fd4ea3d64c50b47dd4a175e501ef649a90",
      b: "a324eb3963e33caa7135fb7f84e80f085b880b7aef1fa44abff628b5fa297e0b",
      add: "c5855d2f4a138fb602e55815d2b67905aa2be1c73fd4221f616c0db7e98e189b",
      sub: "7f3b86bc824d166120796116c8e65af4f31bcad16194d989e17fbc4bf53b1c85",
      mul: "9f19fb1157f5c3e745502cd11c641c1121377487fd8f4c84788728c62e758430",
      d: 203906792,
      divQ: "00000002d4172a79eb2fa958281e1d5e32ca1944ba71072593b9da0655943062",
      divR: 6735296,
    },
    {
      a: "ef4daa140774848b075ba1b263884eb72632f3052538e4c023cc3d82651b37cf",
      b: "170a7debf58885bf007effaadf832dbaa91555ddd825e88a9b84f68137e68051",
      add: "065827fffcfd0a4a07daa15d430b7c71cf4848e2fd5ecd4abf5134039d01b820",
      sub: "d8432c2811ebfecc06dca207840520fc7d1d9d274d12fc35884747012d34b77e",
      mul: "08deac8652026b93ea40ab5d1d465247917bf7e9e15613adef546190367e287f",
      d: 125251102,
      divQ: "000000200deacf664d682ca41eaa423433dd9bf6eb024211d40dbd211d9f5228",
      divR: 51668767,
    },
    {
      a: "edbf59c93170b24f8aafd90ad68d1ad26b8ca7162753e07e73647adf19538ef3",
      b: "62e208d77ff4cd2710d8a0cdfdef582e03aa454b26952513ec6319cf7f46d6f1",
      add: "50a162a0b1657f769b8879d8d47c73006f36ec614de905925fc794ae989a65e4",
      sub: "8add50f1b17be52879d7383cd89dc2a467e261cb00bebb6a8701610f9a0cb802",
      mul: "f0bc454ad97da665373b7bf7d9704b4a50e130f1c99d23eed65edd73549ab4c3",
      d: 102284243,
      divQ: "00000026ff22ffba38ed00e701354b4f08bf3a2db148af6a628ebd33c7d462aa",
      divR: 88346325,
    },
    {
      a: "1c294008c69413cd24419871edafa76d812caa1d6a919c4fb08fd9f44162d259",
      b: "595d93320260b4c187256253b38c92f195aa6ecc331c6c2b1bc6d146bd297bdb",
      add: "7586d33ac8f4c88eab66fac5a13c3a5f16d718e99dae087acc56ab3afe8c4e34",
      sub: "c2cbacd6c4335f0b9d1c361e3a23147beb823b513775302494c908ad8439567e",
      mul: "13bd00edf4627e8fc82bbc38bd34043e241b1e8575f15eb107c26ad3cfdbb523",
      d: 249015501,
      divQ: "00000001e5b7a3936a569ca8b5fefe5fa90cf45efd0ba9003f8d78abea598b84",
      divR: 169175461,
    },
    {
      a: "12b692f20b2ddddbd8a5be2c99bec0f1f944e022241aaede2475115a1d69de0c",
      b: "294e264dc68dcb70a3c78587c29389044807df02e83c293d0cd3eef4a13a7ebb",
      add: "3c04b93fd1bba94c7c6d43b45c5249f6414cbf250c56d81b3149004ebea45cc7",
      sub: "e9686ca444a0126b34de38a4d72b37edb13d011f3bde85a117a122657c2f5f51",
      mul: "2488ccb4f70db0a422577738025b31180fe7cef9d2c84f68e433115f72571ac4",
      d: 193679608,
      divQ: "000000019ef9fef3e63da68dfafa36840e442449751b7ec0a8bbc6d28dc9dc47",
      divR: 91834692,
    },
    {
      a: "56dae916ad209ba7a0278fa5372ed26193d02b41b451ef12060e065bafe1ca0c",
      b: "51959dd99d3095e4814d2faa87cc90991a11b3136476dd941737cf2c1ca1a56d",
      add: "a87086f04a51318c2174bf4fbefb62faade1de5518c8cca61d45d587cc836f79",
      sub: "05454b3d0ff005c31eda5ffaaf6241c879be782e4fdb117deed6372f9340249f",
      mul: "3daa883a8bf460028ca7fd663f2999b6a4c2d72f508338aaeeba8a8fcbe8c31c",
      d: 241307217,
      divQ: "0000000609e9a807ff06e545478f486dea3b03b395c63d5b2acbea78316201fe",
      divR: 210191534,
    },
    {
      a: "0bc5b16353f541b2e02e8434a9f7720ffbd09b681ecddf5895db7c171fd06738",
      b: "cec348a0ae886bb4aa9ce3e3722b7516288c1b0d2abf09a867785ca5c8540836",
      add: "da88fa04027dad678acb68181c22e726245cb675498ce900fd53d8bce8246f6e",
      sub: "3d0268c2a56cd5fe3591a05137cbfcf9d344805af40ed5b02e631f71577c5f02",
      mul: "4b7c18e89b3d028cf056c05d9f36ae9a60d4a549c36c48a39148cdfcd78f85d0",
      d: 151832662,
      divQ: "000000014d01db1505713b1735c7730af3de292c8c27e5ad89693235a45584fc",
      divR: 56679056,
    },
    {
      a: "42fec6212e2b5b9b00185d591833504c9099fc5806b5f2c25d5333923bf279c7",
      b: "d28d1617f9beb96b8e677ce3c13723502046068d85b14cf43f8e9d7e98ca1681",
      add: "158bdc3927ea15068e7fda3cd96a739cb0e002e58c673fb69ce1d110d4bc9048",
      sub: "7071b009346ca22f71b0e07556fc2cfc7053f5ca8104a5ce1dc49613a3286346",
      mul: "be02e787a732a121b0ff0086b61ae263029db3143b9f351c6dbfce6b4aac7747",
      d: 140363442,
      divQ: "0000000801fadcb33dbb092326b840c4556ca7c5cdd2474c16e68c6403602f4a",
      divR: 10247251,
    },
    {
      a: "ae94d650729d378851500b12665f3c2d8d6177f99f5c2a763dc415a01551adc9",
      b: "5ff711071242a8921f1f39a43c6a20d5261ad9ba1b1607a68c3c9f982d735655",
      add: "0e8be75784dfe01a706f44b6a2c95d02b37c51b3ba72321cca00b53842c5041e",
      sub: "4e9dc549605a8ef63230d16e29f51b5867469e3f844622cfb1877607e7de5774",
      mul: "82f48e6b4f1bdcfe66d79a5c2ced20b64e375568ffdd26b44692eae5eacb39bd",
      d: 263996250,
      divQ: "0000000b1845d9d7f68989e468a96605eb03ea114551250dbc89ff19a4c756f1",
      divR: 58722831,
    },
    {
      a: "216db4228022ae2ab391fa991e9858bb5b5a7a4bab285a208df957b53eb815db",
      b: "b7321c894a69c6ab350580dee3f217848f192597713cef91472724c0a3d80155",
      add: "d89fd0abca8c74d5e8977b78028a703fea739fe31c6549b1d5207c75e2901730",
      sub: "6a3b979935b8e77f7e8c79ba3aa64136cc4154b439eb6a8f46d232f49ae01486",
      mul: "263d6b75695e66c775fedc6c32eb1df4ae055a191bf6517e837e25e96cfd1cb7",
      d: 78728873,
      divQ: "000000071fa82265d0e1cc347f813126705f84cf93d5d77bb3907794646fb96c",
      divR: 46908815,
    },
    {
      a: "2b5134cb3da1682e6660659ec1d0ed4f332be6504f218def9bcf2af271912f68",
      b: "07f86d032fab2eddf8cb778d28d97edcc8f7fbf84eeac25140a3d37411faeaf5",
      add: "3349a1ce6d4c970c5f2bdd2beaaa6c2bfc23e2489e0c5040dc72fe66838c1a5d",
      sub: "2358c7c80df639506d94ee1198f76e726a33ea580036cb9e5b2b577e5f964473",
      mul: "d6beff9d0b2ab9c578f46b192a9dfd3de9b362b23525798ed3e774e398d76e88",
      d: 145723097,
      divQ: "00000004fcb5896c8a638bacaf2ec3591ce505f34d602d2f821e7565536d7dde",
      divR: 53369402,
    },
    {
      a: "55f03a89d121528152590c8bf019fa5acda1b1bc19fa86c36932cf73ec24e8f8",
      b: "6d62450bd596da135e4a83ee5f4664f2b647526a8e585acc456b490e175213cc",
      add: "c3527f95a6b82c94b0a3907a4f605f4d83e90426a852e18fae9e18820376fcc4",
      sub: "e88df57dfb8a786df40e889d90d39568175a5f518ba22bf723c78665d4d2d52c",
      mul: "46c67ea1cda77383ca613d419bc2ad4a61bacc02034909f61f575537d2240da0",
      d: 221818285,
      divQ: "000000067ffc7e76c6057a89bf1a93bb68960437a22311b0842eb000a8a8057a",
      divR: 37077894,
    },
    {
      a: "31bbe306b27fcac3dadeba031fb9b803d3c08732385275ebdf4402b2990f791f",
      b: "adee2138692c80178d1f9c08a18b8bb6209315a5e34f38dc5bc34dfd90b86d11",
      add: "dfaa043f1bac4adb67fe560bc14543b9f4539cd81ba1aec83b0750b029c7e630",
      sub: "83cdc1ce49534aac4dbf1dfa7e2e2c4db32d718c55033d0f8380b4b508570c0e",
      mul: "0dfa4df9d7669d2a8fe4d3bc6c8491cbe1b3e70fb7a355266276f6eb3ee13e0f",
      d: 56024131,
      divQ: "0000000ee4be3790c6b1cc286f607070f7f802ef9bd50103ced0b1e15baa3ff0",
      divR: 32406863,
    },
    {
      a: "3fe30ce0d03a22ac89730f3dd0c6e41e7a48f5c60b9dfb1e2cb4e0521b669ec1",
      b: "bbf218547c480be0ae91a2ff7f660f1eec22c83d4746bf0b72527835e8959da5",
      add: "fbd525354c822e8d3804b23d502cf33d666bbe0352e4ba299f07588803fc3c66",
      sub: "83f0f48c53f216cbdae16c3e5160d4ff8e262d88c4573c12ba62681c32d1011c",
      mul: "06b65f92c46f4e2d999743e5701c3f9b1bd7426103a2852249413847e6d5af65",
      d: 16724239,
      divQ: "0000004016db9b0bba88d13c9ed11b97d60c4ce1bafabcd59da51269ec724dad",
      divR: 8582302,
    },
    {
      a: "ceedb2a5b81f863f8de970a2c6b8fe9c6ca2056d965fbd83a8fcf64969e5d33e",
      b: "a67d250e50ad74820c999a8eea9a97bfdf7a4daada0a86e98bc3985b74a5e32e",
      add: "756ad7b408ccfac19a830b31b153965c4c1c5318706a446d34c08ea4de8bb66c",
      sub: "28708d97677211bd814fd613dc1e66dc8d27b7c2bc55369a1d395dedf53ff010",
      mul: "5cab6d66f7f1d208c798ef6da00a4daef7326c722e6ca54e597da5fb1091ef24",
      d: 251220801,
      divQ: "0000000dd1baaed921a4b6d72df79754ceb712237b8d7b619b99f75544e4b41c",
      divR: 238224418,
    },
    {
      a: "0a124dc4ac2232d45d1f99dc5d9606b4e59bcd7b039201e475f2d0523491da2b",
      b: "e50af320b821371a35531012dfe95e97d238c0624f6f00efb31f52bad017a0fb",
      add: "ef1d40e5644369ee9272a9ef3d7f654cb7d48ddd530102d42912230d04a97b26",
      sub: "25075aa3f400fbba27cc89c97daca81d13630d18b42300f4c2d37d97647a3930",
      mul: "d172c897a6b4e0bdc7afee453dd9ef559162fa1bac5e3eb64f6e25103d38c829",
      d: 112863374,
      divQ: "000000017f443ea64793af5cbcc7a515dc79a07f6a467f1d86862b3e4193682f",
      divR: 6338585,
    },
    {
      a: "2b4e2727518b61df8d86ff910848497c9a169cbb872e760ed4cd21e9f670b01d",
      b: "54f8193c9f02bc427b8a3b27bd58ae9d9a7ab67b8ad84782210cc6f2c4f5a9a5",
      add: "80464063f08e1e2209113ab8c5a0f81a349153371206bd90f5d9e8dcbb6659c2",
      sub: "d6560deab288a59d11fcc4694aef9adeff9be63ffc562e8cb3c05af7317b0678",
      mul: "155ae825654fde42eebcbdeb42e6b3da925d46aa566b29cf464a5994faa5a7b1",
      d: 129702046,
      divQ: "000000059a040b1c125aea9e002dcc144b578ff63d673a55a2a8ad6bcfe0ae31",
      divR: 77960671,
    },
    {
      a: "6695e70f298912fcb34fb55480333328d06feca85b77a7f3a96327b4cdf88d3e",
      b: "0164a692584bc86f141b711a80a6d49617763ae43213cd772be7b4235525f4fc",
      add: "67fa8da181d4db6bc76b266f00da07bee7e6278c8d8b756ad54adbd8231e823a",
      sub: "6531407cd13d4a8d9f344439ff8c5e92b8f9b1c42963da7c7d7b739178d29842",
      mul: "2754c0df03d24dcd05447016547cbe68e8b113c1b5c9702ece359d97a7402108",
      d: 54145476,
      divQ: "0000001fc95df6b42f04598763dfa13bda9765cdcdaa108865eea5cafbc662e3",
      divR: 12149874,
    },
    {
      a: "5d500a2ef88ae7e475d24a2bdf36e72938b39f359955d367d6f65c399a2a27bc",
      b: "06916402b409590256c0a595cbb3cea8d88fc8200f40d9ee7776a5475672bd5e",
      add: "63e16e31ac9440e6cc92efc1aaeab5d211436755a896ad564e6d0180f09ce51a",
      sub: "56bea62c44818ee21f11a496138318806023d7158a14f9795f7fb6f243b76a5e",
      mul: "0d3c457b2d7aca7f753a7b0cbb607cd506b2ba7f63e66f8addf2653a94886308",
      d: 243756447,
      divQ: "000000066c292c6ac4a765e14354054035a4d2afeb1082d3c3ba4e89ba20a872",
      divR: 134938350,
    },
    {
      a: "ba62d46217cead0c78a5e7db03733339080f09869840c9966c9f6587bfc6ee45",
      b: "a10f8b738549f47c70d4a9cbfe95a0eb044fbdb44ffb856a266bd5c621cbe8d8",
      add: "5b725fd59d18a188e97a91a70208d4240c5ec73ae83c4f00930b3b4de192d71d",
      sub: "195348ee9284b89007d13e0f04dd924e03bf4bd24845442c46338fc19dfb056d",
      mul: "58f8294adad57f211dd7d910c878e62d1f9cb1404f69c27cc9d11a29ed7e9238",
      d: 247382877,
      divQ: "0000000ca3f6b32fefdc3f538769927a5667b6a612426d703f1ec717860c223e",
      divR: 21316543,
    },
    {
      a: "a8f88a8e8899eda77d011ad9536e41ed73b5ee804a85a630240423674e7fe49b",
      b: "9732fa158a09708164a9a490e7eb05003b7b1cc998695c496475b09a71c4c1e3",
      add: "402b84a412a35e28e1aabf6a3b5946edaf310b49e2ef02798879d401c044a67e",
      sub: "11c59078fe907d26185776486b833ced383ad1b6b21c49e6bf8e72ccdcbb22b8",
      mul: "e9804f43dfcd184ad4e276f8fc108bfc43bf329f83761ab2f00be9da786c9071",
      d: 229449856,
      divQ: "0000000c5ae37bd7e23dac6589d9bf02062dc8e9ad19600d00cde194de0d659c",
      divR: 78485147,
    },
    {
      a: "7a812be293f210aeb6bb477aa536f453373f49efb952265f9f138e015043713a",
      b: "75824e5475e3178f182b7af09a1c45308553be6938c1c7267d6caaec1a368dbb",
      add: "f0037a3709d5283dcee6c26b3f533983bc930858f213ed861c8038ed6a79fef5",
      sub: "04fedd8e1e0ef91f9e8fcc8a0b1aaf22b1eb8b8680905f3921a6e315360ce37f",
      mul: "d66b6431269d761b9d11794f57e668dc68e8dcc5ff4bb4deecc2215c8cdca75e",
      d: 71650667,
      divQ: "0000001caf4fac3ac0635e7c8d4f256c2e168aee713e960834b1533562c624df",
      divR: 37745925,
    },
    {
      a: "8867845980bbea53210b179d887dd93ef77609f9ab8dd2c1c80b891ade8f31f2",
      b: "cad19bd7b860e848ff2485e00635edb955e1eb73b6b82e58ca5f5b595bf5bde8",
      add: "53392031391cd29c202f9d7d8eb3c6f84d57f56d6246011a926ae4743a84efda",
      sub: "bd95e881c85b020a21e691bd8247eb85a1941e85f4d5a468fdac2dc18299740a",
      mul: "e53bca16e39061617864668597c2bc000940c3e0ab28104555d85f973c3eed50",
      d: 76490261,
      divQ: "0000001deb2cbf697038295e9c8d2ffb90e81c6f7b517ffd8ef531807502e533",
      divR: 63951555,
    },
    {
      a: "5f03e201f47254a35a87b84404f1a37c325e2cf8af59b425da68d330627dac8d",
      b: "1e88012819d19594efef94c62089d5056d5cd5936de6ec4257d2408dd8d021e9",
      add: "7d8be32a0e43ea384a774d0a257b78819fbb028c1d40a068323b13be3b4dce76",
      sub: "407be0d9daa0bf0e6a98237de467ce76c50157654172c7e3829692a289ad8aa4",
      mul: "e83b1acdcca12fadd60f373c6b07c6ee72c411a7f6c02252d810cd1802303955",
      d: 143866792,
      divQ: "0000000b148fcd8978910b2c68a23b3e4268e302d30b9a2054cd31e81ebd9cb1",
      divR: 21957989,
    },
    {
      a: "fe36cdd4d9fd89605eb7b76b3c210785d908bf6a77008eb4b317f40f2724ab88",
      b: "201145f6ca968d78b260cdc378fd4cde07995f555ca177fa576cc8441513b775",
      add: "1e4813cba49416d91118852eb51e5463e0a21ebfd3a206af0a84bc533c3862fd",
      sub: "de2587de0f66fbe7ac56e9a7c323baa7d16f60151a5f16ba5bab2bcb1210f413",
      mul: "131bf13e20d56a9edbf7ee48f119233dd9c6d74a9f2d0596f5df19d2fd789d28",
      d: 6523854,
      divQ: "0000028dc15f13b705f029ddaef5bf63746abfe369a83695fde9196197608b6e",
      divR: 3522308,
    },
    {
      a: "17f88d462ed2ab57faeef41392d83ce1c342ced7da4845ddc8727bad3e78ae18",
      b: "67757f7d3fdeb5f3f30c018f9027143f8b31bb3b6df4899758fe28e954c252ca",
      add: "7f6e0cc36eb1614bedfaf5a322ff51214e748a13483ccf752170a496933b00e2",
      sub: "b0830dc8eef3f56407e2f28402b128a23811139c6c53bc466f7452c3e9b65b4e",
      mul: "30d5be2dc581c08820872c4dc51f9a6e9dd53483475c44b91a963921c12d0ef0",
      d: 133082657,
      divQ: "00000003059c82680a7c3135a7fe7bd4fb258bb6289af510dd999bf8e448508a",
      divR: 68976718,
    },
    {
      a: "e0c723c0f69e2f52995376f9dcd57ca46dd74576ab90b6470108ac901fe0e802",
      b: "072e0d52da5b2cc0dab42772f078b8d08b7e309b8bb45fb188072dcb6e2098f1",
      add: "e7f53113d0f95c1374079e6ccd4e3574f9557612374515f8890fda5b8e0180f3",
      sub: "d999166e1c430291be9f4f86ec5cc3d3e25914db1fdc569579017ec4b1c04f11",
      mul: "03f369731141d19f4b542e7e6e80c7a05b14503113df4a5dd784f9ff68bb99e2",
      d: 126407711,
      divQ: "0000001dd54cf23ee58ba2259864255fd5b8f8151ca599e683bde921fcfc4651",
      divR: 17911859,
    },
    {
      a: "a3ad23d5289f700e7d4af5039f5f53d4b0445b07b85e99bc1da914e8a770d89d",
      b: "e0cf3fbd82a4841903449233ef8ba8506817861008ab4bf678fefba54999330e",
      add: "847c6392ab43f427808f87378eeafc25185be117c109e5b296a8108df10a0bab",
      sub: "c2dde417a5faebf57a0662cfafd3ab84482cd4f7afb34dc5a4aa19435dd7a58f",
      mul: "e24801a668783b9feb577ffccc4ff1aa36193cffb54296b439184a7bde281f96",
      d: 267890542,
      divQ: "0000000a4025ee90d556c09499805be265da99be4edf9332b762107dcac2213f",
      divR: 243498635,
    },
    {
      a: "310a57356ea56014cdc15cb99161e21655a75a4c163404ebb4ec1ce53bb4eac1",
      b: "84785c06e1a352cc8af82325a0add2d2b30bc611d03ceca1ed9179ccd12d0520",
      add: "b582b33c5048b2e158b97fdf320fb4e908b3205de670f18da27d96b20ce1efe1",
      sub: "ac91fb2e8d020d4842c93993f0b40f43a29b943a45f71849c75aa3186a87e5a1",
      mul: "12ba28c7c402016fb9303bd465b8d73aa634e3199d17072a2f8f9412d4201d20",
      d: 57249159,
      divQ: "0000000e5f20536aa386d38497405da5ef05d86ea8b16b7234eac119bce1007f",
      divR: 45135048,
    },
    {
      a: "ebad6c835de754c3a75b40cf3a3a0f71b9e22613b34aa310d2ba6d09ab5d6b2b",
      b: "c23681c5147149905b62a998b0da67cd477c482bcae8c37cfe7bbe1a0e6bd865",
      add: "ade3ee4872589e5402bdea67eb14773f015e6e3f7e33668dd1362b23b9c94390",
      sub: "2976eabe49760b334bf89736895fa7a47265dde7e861df93d43eaeef9cf192c6",
      mul: "89deec6fd2f75d3bcca8b273e8d7bce9332837b0bff8bd886ea6b5ad93408ff7",
      d: 122793455,
      divQ: "0000002033544c7813845eb74154aed04da5504d431adee8b49722dd90e6572a",
      divR: 18917621,
    },
    {
      a: "4778cf59aa5a2fad1fc9c5a7b0de83f2ec1fac9dda4bf60dc3869d2c5069a9ec",
      b: "22f9d36b8acfd23815ef4d77f3027bb62787e235619be39d5e09bbd50ffa68e5",
      add: "6a72a2c5352a01e535b9131fa3e0ffa913a78ed33be7d9ab21905901606412d1",
      sub: "247efbee1f8a5d7509da782fbddc083cc497ca6878b01270657ce157406f4107",
      mul: "d2160abb099c883e40e548f0fde68384732e2ee85a11c4dd659716cfa004e01c",
      d: 211458084,
      divQ: "00000005abae2787409ee45c3304caf6edb28e7b089deec4fc25306cae34e2fd",
      divR: 33654360,
    },
    {
      a: "ec4417099c4d096419d94aff9da8306ac74da8dc55673556815e9bedef164077",
      b: "deaf5880856dbf6dac87b8892fa83360d3a9e3d686f3e07696757eaac174b5f8",
      add: "caf36f8a21bac8d1c6610388cd5063cb9af78cb2dc5b15cd17d41a98b08af66f",
      sub: "0d94be8916df49f66d5192766dfffd09f3a3c505ce7354dfeae91d432da18a7f",
      mul: "0a4370b4787e685ea7983366d811537762577fbf6673952b29dac63f460e9648",
      d: 93823213,
      divQ: "0000002a3f9a6b04bba98b12f508488f0d58d8cd787dd2c3eccadc4f681f0288",
      divR: 43247759,
    },
    {
      a: "ab6db74f6b57a1d5776cae2d36f7b7cac3eb38b7cc0ab4f47f8c5bb9275fbf5b",
      b: "b2353c984cd7868c55a7f83dea8ba86779c2204b0587d5aba6293e807428732e",
      add: "5da2f3e7b82f2861cd14a66b218360323dad5902d1928aa025b59a399b883289",
      sub: "f9387ab71e801b4921c4b5ef4c6c0f634a29186cc682df48d9631d38b3374c2d",
      mul: "355940a930b3cd6debeb9c0409c7ed4ca56003c6b4f28209bafce9203862435a",
      d: 46782881,
      divQ: "0000003d7a3d0c7e27700bbc80b917d3f7c3213a2d9a337d750ab70b5d360f55",
      divR: 27528678,
    },
    {
      a: "29045e1f8c483a77fe028ab3e5ea8c6c4f5837889816f7f9ac96d5c8da8e107d",
      b: "1213b5f4ab60e604e96cd88402740a734d1e2fa8c081b9c8bce9b80086098b3f",
      add: "3b18141437a9207ce76f6337e85e96df9c7667315898b1c269808dc960979bbc",
      sub: "16f0a82ae0e754731495b22fe37681f9023a07dfd7953e30efad1dc85484853e",
      mul: "e78212da46d248ac5bd4a35f0d3edc0daddc1ff944456f82ef478eb8ee4eedc3",
      d: 134282466,
      divQ: "000000051fe9c5e822e02691c51fff0c1370141a5391c0eaf06c7cd43df6ad6a",
      divR: 68460777,
    },
    {
      a: "584e379d7b6f9c37aae3c39c07d811a8daf7e3e1ccb5066f3e306d6bc034e84e",
      b: "2fdcdc6c7f729bf9b1f6fe2087599e2b42f466330acada0b20e1c70f256b4652",
      add: "882b1409fae238315cdac1bc8f31afd41dec4a14d77fe07a5f12347ae5a02ea0",
      sub: "28715b30fbfd003df8ecc57b807e737d98037daec1ea2c641d4ea65c9ac9a1fc",
      mul: "8fc43ceb29fc5c741c10a13f61514c776f1091a96d7e974ec87bbd546711bcfc",
      d: 202797843,
      divQ: "000000074e2f3dae05b28886a514799822b9fb6d5197ac66449db4a601718ec7",
      divR: 143256201,
    },
    {
      a: "3379637a9ce74e53e25e972771acf2204f29f20e1876758ec2fb24ccae5874f0",
      b: "efa27b52205c3f20ce5f53f5e2ce4e83ecbc98049458bcd8012eeb26535c5c07",
      add: "231bdeccbd438d74b0bdeb1d547b40a43be68a12accf3266c42a0ff301b4d0f7",
      sub: "43d6e8287c8b0f3313ff43318edea39c626d5a09841db8b6c1cc39a65afc18e9",
      mul: "132b49f1734a431dd358516526fbe7b8273028ceae89f57033c6919464b17290",
      d: 110023671,
      divQ: "00000007d96283c39f922a060ece6eea322d962bb1e4e2ad959d68746843842f",
      divR: 53423767,
    },
    {
      a: "36c43bf85b0fa232cdd9f12a0ddda616acf13e8573c91f2466ba164a358757e6",
      b: "d1ffbecf86edfe66d8cac000f0141501b1bb85013e6c6ceecde8b9749e1291a0",
      add: "08c3fac7e1fda099a6a4b12afdf1bb185eacc386b2358c1334a2cfbed399e986",
      sub: "64c47d28d421a3cbf50f31291dc99114fb35b984355cb23598d15cd59774c646",
      mul: "42c45f0f190d574a2a5955ff07adb3becfcdb06e3cc985f4df784caf3f8c35c0",
      d: 226255390,
      divQ: "000000040f9fb44fbee2c3c1233b1bd502239e9cc717b9ebf6e0ecf7d117143c",
      divR: 100925662,
    },
    {
      a: "dd26c46b3cd25f6963bb42302717340a9403ba1f1f21dec7a1689d290260aa7d",
      b: "b5780eae910cb02d63cb624e80228d89c573e2b488e127ba9b00fc6b77613305",
      add: "929ed319cddf0f96c786a47ea739c19459779cd3a80306823c69999479c1dd82",
      sub: "27aeb5bcabc5af3bffefdfe1a6f4a680ce8fd76a9640b70d0667a0bd8aff7778",
      mul: "ce05657fb9ab5e56a7274237b1cad6aec27c72438aa768467039616602373b71",
      d: 21075980,
      divQ: "000000b00b54e2bc62cdb0c05060db3756fbda7ccbac887ad2fa38c293148126",
      divR: 1445045,
    },
    {
      a: "d7d650ac284805111b8851a3742c0fd86432ef54e1b3aca1ec25cb5b2e74b39f",
      b: "8958bf259f0822eb9b120361a468675d79dc45d84bdbb5753da821e57b08f592",
      add: "612f0fd1c75027fcb69a550518947735de0f352d2d8f621729cded40a97da931",
      sub: "4e7d9186893fe22580764e41cfc3a87aea56a97c95d7f72cae7da975b36bbe0d",
      mul: "57f7f6095a0217d5de201764a23fa23d93e322a6257d6cd7603befa4306d9bae",
      d: 256920126,
      divQ: "0000000e182d99ef330aff0eb400c9614a8672c62b3921f3db3aeb59970be2b0",
      divR: 51178751,
    },
    {
      a: "2edb673fd498a24a5eb9bf5e38422d8afc348d854e7b9be452b38c02c63db449",
      b: "018e135f01ff39ff336204a3eed0eff3cf9614b9e929c0c5b3863554e0fd4a30",
      add: "30697a9ed697dc49921bc40227131d7ecbcaa23f37a55caa0639c157a73afe79",
      sub: "2d4d53e0d299684b2b57baba49713d972c9e78cb6551db1e9f2d56ade5406a19",
      mul: "9e12a1105748aec53d000c664d7e170e91d9c3b4f99afa27701f3b820dd3e7b0",
      d: 198950214,
      divQ: "00000003f38e948950f1e9885283af0fc61ba9ff2afdcec11cce38065274dba4",
      divR: 47550833,
    },
    {
      a: "2d6f1ee02132fe0fb02b8bc2954c54ba0fc1b569267a1142331c52587d2f3545",
      b: "53b338df8a2abfdfb933f67e58b2318e6ab43028c1844d4b4cce33000b74dd62",
      add: "812257bfab5dbdef695f8240edfe86487a75e591e7fe5e8d7fea855888a412a7",
      sub: "d9bbe60097083e2ff6f795443c9a232ba50d854064f5c3f6e64e1f5871ba57e3",
      mul: "64fd39fe5b0ab00461f27ce2156c1fafefe4c3cd4f06decae28a699fc752f56a",
      d: 66861875,
      divQ: "0000000b668583ffcb3acbb555e0d6c0c18977ac5ee7f4a6df56f9a3f3e7456b",
      divR: 46708724,
    },
    {
      a: "b7e3461eaae3865f96ce555a10d3e191d3a7df83391713bbb980828bf86a5bbe",
      b: "9480a20de63f7ff4d13b3c8a5c3c9ff7b8e758c2ca5770a83cf1de61ce879508",
      add: "4c63e82c91230654680991e46d1081898c8f3846036e8463f67260edc6f1f0c6",
      sub: "2362a410c4a4066ac59318cfb497419a1ac086c06ebfa3137c8ea42a29e2c6b6",
      mul: "fc4cfff7719168a58250400f29aaf570ee262601c4df136d536ea8dcefea73f0",
      d: 79441041,
      divQ: "00000026d5dd39c56b45f05440c99c0868fd3423552dce2c819d9f849b1d1a00",
      divR: 74883518,
    },
    {
      a: "d5ab0dc389aa3777300851cd209d818f281043b0e4b1eaa60d34405e2aafe0ef",
      b: "60997b28f8fdf10fac5665a489bc7c164740f54e855be3828ac38e6ccbd74759",
      add: "364488ec82a82886dc5eb771aa59fda56f5138ff6a0dce2897f7cecaf6872848",
      sub: "7511929a90ac466783b1ec2896e10578e0cf4e625f5607238270b1f15ed89996",
      mul: "57960f0138d1806abbf82232f3e89831aa061129b212044f8cf8467b0c407c17",
      d: 119603913,
      divQ: "0000001df8cecddc9b437a48d0d4cb9b8e701f57ebefb3ccabff1a5fa0062d60",
      divR: 1802383,
    },
    {
      a: "1a32937601c01a9f834d97f95e402ecafa29289a55584c05a289dcf53f7032b7",
      b: "efde581582196e7312e9e86257d6a2b3f3e2b1ebc22ab760d90e1fc866ac67f3",
      add: "0a10eb8b83d989129637805bb616d17eee0bda86178303667b97fcbda61c9aaa",
      sub: "2a543b607fa6ac2c7063af9706698c17064676ae932d94a4c97bbd2cd8c3cac4",
      mul: "b2c0ea36562969fcfa72cd9d41c753d4fbf2ab837ff24b70f79e84e058dbc4b5",
      d: 139423656,
      divQ: "0000000327051caac86c84fc8f904e6c4455f2dd643b519520bfb95a11d56859",
      divR: 128852303,
    },
    {
      a: "ec4529919aa923bdd8a7b77374ce94fad0f646904bde6f69c38c5f2c860890b4",
      b: "61d44456436811d355381d0a65a2d15642517cebc51fbd5b3607b096be6f9795",
      add: "4e196de7de1135912ddfd47dda7166511347c37c10fe2cc4f9940fc344782849",
      sub: "8a70e53b574111ea836f9a690f2bc3a48ea4c9a486beb20e8d84ae95c798f91f",
      mul: "f5bd5ef4ecf5dad10286562478d9162a9f82a99a40046061460baa8d666264c4",
      d: 162628308,
      divQ: "000000185fd3e95d734d0ee1e6461b910d1d38c36ca7f0029225ab592fb0a95b",
      divR: 114367320,
    },
    {
      a: "97eb75b6c17997b54a84b14761dad335d7974811c239ef3ad5ee25bb5f4baa70",
      b: "fd9f759b4c30785b22f5fb8f0929a761e3f70c8978227833de0d1fbc4edff18d",
      add: "958aeb520daa10106d7aacd66b047a97bb8e549b3a5c676eb3fb4577ae2b9bfd",
      sub: "9a4c001b75491f5a278eb5b858b12bd3f3a03b884a177706f7e105ff106bb8e3",
      mul: "4bd56b0d890ff3b8c5b6fc3b192c07f1911160c9c5025fd7e7d5f8014fb04fb0",
      d: 232212174,
      divQ: "0000000af9e39246d5e99dd34d170fc135a2de447af4e5c2c07917663f64cdfc",
      divR: 20382120,
    },
    {
      a: "76b8a58e16d289b9228e5e295b9145e37989a5cad17226dbb8118dc8a4e519fa",
      b: "2a34b0995055c0ddd08ae0a347f49b13d65c8a087a4dff1a0c9e5ce31abd5d35",
      add: "a0ed562767284a96f3193ecca385e0f74fe62fd34bc025f5c4afeaabbfa2772f",
      sub: "4c83f4f4c67cc8db52037d86139caacfa32d1bc2572427c1ab7330e58a27bcc5",
      mul: "3a6e5da3ae2d7dab2450cdc3d16d875e9c1bb07d2e148ae5d6cd20e6ef7032c2",
      d: 186048076,
      divQ: "0000000ab4b60098a6840f42c304428cc5ad6efc8df4113b2d9e31b3affc8e77",
      divR: 119905446,
    },
    {
      a: "804567578875c5f053c0dce5b4b98879b05d357d85c00b573adc61828f481a35",
      b: "46eb71cb622e49cb81945e21e42287491bc6907e41c228f7058f11a122797f1b",
      add: "c730d922eaa40fbbd5553b0798dc0fc2cc23c5fbc782344e406b7323b1c19950",
      sub: "3959f58c26477c24d22c7ec3d09701309496a4ff43fde260354d4fe16cce9b1a",
      mul: "53654d52a270997a03630fcab10e5a6ee946d361d28e91108a0c5abe4ea80e97",
      d: 150755373,
      divQ: "0000000e4666067721223cf7122aa77f1213b147740876c92cbed791f190e5e0",
      divR: 21672405,
    },
    {
      a: "17b03b9c97c320b9d445924ec54ad00fc9a043c5d9f392ea48013181fd48dcec",
      b: "cf5f57b44e4bb15d45e8cfe5b86b12185dc0fc97d6c8e84b0d5a07c65a5cba49",
      add: "e70f9350e60ed2171a2e62347db5e2282761405db0bc7b35555b394857a59735",
      sub: "4850e3e849776f5c8e5cc2690cdfbdf76bdf472e032aaa9f3aa729bba2ec22a3",
      mul: "c7eec3420ce234db791bc23b2f2aeebbb20b297d207a99656f6f867a871a774c",
      d: 148523527,
      divQ: "00000002ad040377f0735717f1aebf73b48c47ffa89a3717edd3ff7dc7d5ab3e",
      divR: 2441786,
    },
    {
      a: "5610ca493ba75f21f3bc5e72651a86d4e0e692a9827fba54aaeb9766d60366b2",
      b: "8a868426c3f8e7d67cd334b855339d445050b0b3fd1ab8c96786e105da3f5ced",
      add: "e0974e6fffa046f8708f932aba4e24193137435d7f9a731e1272786cb042c39f",
      sub: "cb8a462277ae774b76e929ba0fe6e9909095e1f58565018b4364b660fbc409c5",
      mul: "3f7e6d2f28feead18d6d4309e576dbba27b5f3e784c2e9ad459122e133dc0aca",
      d: 163915337,
      divQ: "00000008cf1eea5c06a42c98c0202dbcc3a7dd6b7e7659f61c9d1c79976ead02",
      divR: 87803168,
    },
    {
      a: "5d1e0bc996cb522cbaf9a71d7ef16b310489c25a5fda8ae8d2fa6a959e2a4e0f",
      b: "abe0be72a18b67c78ec856ca161930b031a6e2bf5443f9eddb27dee8e1841bcb",
      add: "08feca3c3856b9f449c1fde7950a9be13630a519b41e84d6ae22497e7fae69da",
      sub: "b13d4d56f53fea652c31505368d83a80d2e2df9b0b9690faf7d28bacbca63244",
      mul: "61ac76263c8e117ebbda0bb0d828d58f35cf430fd3e91087ea49c85650837ae5",
      d: 67723821,
      divQ: "000000171165a0002b274f931b9855948ba671318d3b5f5de6eda9531d7329b8",
      divR: 58427575,
    },
    {
      a: "8324f8c43843b6cdfafed3281a16852c10686c2d07a4182a71146301f0775012",
      b: "4e303c70d4b0e370fc32bd49fa93604a7c1c3e4c0764267bc7172b92a9e6e993",
      add: "d15535350cf49a3ef731907214a9e5768c84aa790f083ea6382b8e949a5e39a5",
      sub: "34f4bc536392d35cfecc15de1f8324e1944c2de1003ff1aea9fd376f4690667f",
      mul: "cfb58e8ab8a4203c4b50f18d8bf03ea84ee264f3cd99d813166b1d4b7e8f5c56",
      d: 42548846,
      divQ: "00000033b5fc3de71ae13aba2df42d72d969c79a79317bd8b4d0c482df5c2cd3",
      divR: 18215784,
    },
    {
      a: "71f6493ab7ce60b588a694231132778746437d2322b334dcc52caf14ba73b21e",
      b: "dd1fddfda07bcb69162f965b3363f556e4928b457772dc10e8876e61e8671fd1",
      add: "4f162738584a2c1e9ed62a7e44966cde2ad608689a2610edadb41d76a2dad1ef",
      sub: "94d66b3d1752954c7276fdc7ddce823061b0f1ddab4058cbdca540b2d20c924d",
      mul: "9e7df30adba30fca00e84f72909c963086b9036ebcf20d09172fb1d615180c7e",
      d: 197100930,
      divQ: "00000009b3501fc2131b2d6ff90c145fe6fee0b7ba5a6a3542cbfe07e25689d1",
      divR: 116990204,
    },
    {
      a: "e70d717b952ec25cabb78da650a650137ceabf3d91130bb44b3ed77d86784331",
      b: "f3841616ce906b275faa5880afde7719998f6ca23121fa20cb7ec4522b12cacd",
      add: "da91879263bf2d840b61e6270084c72d167a2bdfc23505d516bd9bcfb18b0dfe",
      sub: "f3895b64c69e57354c0d3525a0c7d8f9e35b529b5ff111937fc0132b5b657864",
      mul: "7ec0432247c42380508d8e5079c185e60e14d6a06a4b691f26da4d0f87c4783d",
      d: 60199644,
      divQ: "0000004064885028cdf8b38ac33da4ea248bfef3822adf71714fa464207a6691",
      divR: 47410325,
    },
    {
      a: "890c6a32ca1876d1462da5cc533a1e4c08a52873ddd89cba25b701a32c9ed351",
      b: "acaa2b3ddec64204ef4cda9df44d3e4f4650a601043eb5034ab886e0f5c833e3",
      add: "35b69570a8deb8d6357a806a47875c9b4ef5ce74e21751bd706f888422670734",
      sub: "dc623ef4eb5234cc56e0cb2e5eecdffcc2548272d999e7b6dafe7ac236d69f6e",
      mul: "834031ab5d23ba34078cad92f4e2659024162e54dbdf3c6fd1961ec5d13683d3",
      d: 93037358,
      divQ: "00000018b6b16b85d19fb7479538fec6f2c5005b4a5293ec4dade10e489c0646",
      divR: 43327677,
    },
    {
      a: "b56720a130ffbcaae6947ec60a9adb7831fa6a528b4856b4f5411418b5d0327f",
      b: "ed53117dd215e82955a8eb179a43b8658f64a5118bba0b51212860d738a5410a",
      add: "a2ba321f0315a4d43c3d69dda4de93ddc15f0f6417026206166974efee757389",
      sub: "c8140f235ee9d48190eb93ae70572312a295c540ff8e4b63d418b3417d2af175",
      mul: "4c72665c614de6e464ab45f2ea9ff08870b6dea319ee77d67df9d2064acf37f6",
      d: 251679581,
      divQ: "0000000c17ade769eb6bfd9fced61c4c82849fb8003fc284cdb52f3b798256f4",
      divR: 54886363,
    },
    {
      a: "48ad4d4b7d368d659ec05e8be5f8621fee73bb12f8caeffcc45c0767152d0c2c",
      b: "32d04701b9add0565b11d7bf776a173728310f0cb3b4a6b54fcffb3ffc528a7e",
      add: "7b7d944d36e45dbbf9d2364b5d62795716a4ca1fac7f96b2142c02a7117f96aa",
      sub: "15dd0649c388bd0f43ae86cc6e8e4ae8c642ac0645164947748c0c2718da81ae",
      mul: "aec98756957234c8185c1c7c68054a353a696ffb64faea71e5bf7963ead3b5a8",
      d: 23619301,
      divQ: "000000339fae928dfaf0a52a702709f83b6ba929106421b750e14406ee8462d3",
      divR: 11047789,
    },
    {
      a: "42c68abf66228d1b2277da7ed522a88f8faac21619a39f0ab59c017845008642",
      b: "3de99920dd14079c624254d0d7af07538f4ae36cb24029b2b4e14fa813ea94ba",
      add: "80b023e0433694b784ba2f4facd1afe31ef5a582cbe3c8bd6a7d512058eb1afc",
      sub: "04dcf19e890e857ec03585adfd73a13c005fdea96763755800bab1d03115f188",
      mul: "7f89df3b5f3b407d6225bcb51c803ded490a6b771684577443092f080e53b3f4",
      d: 233285525,
      divQ: "00000004cd63c3d99c7de777463a35dfed5072b9cbd5b40ba383bf609bc5a32f",
      divR: 186376935,
    },
    {
      a: "922caea98a82be406581d292bc9c3200071bf8cc10ab1ef63c96ce910162dcfa",
      b: "c60c7633e3db6ed78b6cbd931ec4534c091de4bd7bafe1f8bf501a6eae3410d6",
      add: "583924dd6e5e2d17f0ee9025db60854c1039dd898c5b00eefbe6e8ffaf96edd0",
      sub: "cc203875a6a74f68da1514ff9dd7deb3fdfe140e94fb3cfd7d46b422532ecc24",
      mul: "b018e42186f9e74246b5033202a2fed0e017fea6c8328f0ece6b8f00253c58fc",
      d: 59130055,
      divQ: "0000002979868a0ee0211bc89b4458d219b88cbe00dec29c570fcc84e019e5fb",
      divR: 23090909,
    },
    {
      a: "053ad9d523f9b55de0d94b153f71c8923328ecda7b2c2248d73a5dbe2d4c252e",
      b: "19f26aade180855c6da7952216b98d12e3f0f7dc5ad862247bc95f6ad279510b",
      add: "1f2d4483057a3aba4e80e037562b55a51719e4b6d604846d5303bd28ffc57639",
      sub: "eb486f27427930017331b5f328b83b7f4f37f4fe2053c0245b70fe535ad2d423",
      mul: "4a19a83713439c65c62165ac429380f838854b2d0784816355a88a0a58c726fa",
      d: 118381316,
      divQ: "00000000bdbe90813932bfa3495223b514acd938e04ae09525153aed6c720910",
      divR: 57364718,
    },
    {
      a: "822cd960e9f04f530dece4d5c4187a47e64d51f2fcc648962cf9d6c3aaa209f0",
      b: "7ac9655f2b40e0ce6f044069b6e1143703c9cb8709fcbe9eec8f8d1c61f994ae",
      add: "fcf63ec0153130217cf1253f7af98e7eea171d7a06c30735198963e00c9b9e9e",
      sub: "07637401beaf6e849ee8a46c0d376610e283866bf2c989f7406a49a748a87542",
      mul: "d24a50b6d82773bf4aa5056380bf40b16c0941389cb1c7a3c033bb4342518120",
      d: 124913699,
      divQ: "000000117be02f0174063edb9d9b84bfc196f82be85d094f3677f2d5b09dafe5",
      divR: 10081697,
    },
    {
      a: "c839d9a8b106eed0a814d6757c05fb7d4588ffbeb87fc1fc54573255b48340c4",
      b: "90a27082b5892581f8a09ce96f7b81de58418737d28a2ba49660b032725be37d",
      add: "58dc4a2b66901452a0b5735eeb817d5b9dca86f68b09eda0eab7e28826df2441",
      sub: "37976925fb7dc94eaf74398c0c8a799eed477886e5f59657bdf6822342275d47",
      mul: "ea4f28d8d1674e3112a85b12cdfa4259aab1713296cf09fa2eb896b0d4306bb4",
      d: 136007239,
      divQ: "00000018b2eda7408b268e697be44c11566f927b5e5aa70a0ce053b2992d2bbb",
      divR: 15738343,
    },
    {
      a: "6d0da48ce5fef1f27c57bdccc032170ace6e9e1662205e81488e10b8b1c4e19e",
      b: "750f048583ef913947ceece2a386861118d5cbd0c6b06da6ddc13da7f0178c50",
      add: "e21ca91269ee832bc426aaaf63b89d1be74469e728d0cc28264f4e60a1dc6dee",
      sub: "f7fea007620f60b93488d0ea1cab90f9b598d2459b6ff0da6accd310c1ad554e",
      mul: "6dcd1da4fce812504d3dccccf34bed32becf2e03b5276a04641a9b359e1ae960",
      d: 161518755,
      divQ: "0000000b53d9db123f5dfe864518c3c92aec2ba1555b88bd46f2cd602098470e",
      divR: 16485300,
    },
    {
      a: "1749fafe5a7141e27bbb778d30b7fc1e6d2b9b55250c2781a5005b47614813ef",
      b: "5ecece54bfdaafaa6b463fd9fc084156767306b2c07abe4d2663f636f8b5e221",
      add: "7618c9531a4bf18ce701b7672cc03d74e39ea207e586e5cecb64517e59fdf610",
      sub: "b87b2ca99a969238107537b334afbac7f6b894a2649169347e9c6510689231ce",
      mul: "31285b597daff0aaa8dbd1b1cffff49645c63f49942818503d1f41c4cbde8fcf",
      d: 124325941,
      divQ: "00000003248abc8a73307331bab45f4f68386e6ebce7ecc6686a53dafd57bb5e",
      divR: 114977145,
    },
    {
      a: "1e21a5fa69cbb2a30c390e8b877eaefd7cdff4c5c33965082de89762abdc22cd",
      b: "d0258546f293e38c1e21f4d807f811a49005c3d6b4719fec32d9b3e24c535b65",
      add: "ee472b415c5f962f2a5b03638f76c0a20ce5b89c77ab04f460c24b44f82f7e32",
      sub: "4dfc20b37737cf16ee1719b37f869d58ecda30ef0ec7c51bfb0ee3805f88c768",
      mul: "6957271a3d26ac859f3e6a386de400e8fc062fc706456b8e5907efb332af99e1",
      d: 161050563,
      divQ: "00000003238ef81dd4d71e2ddf9d65afb8a1d1b4bd9d36b7c4b7dfa8e1c8c31d",
      divR: 33616054,
    },
    {
      a: "4561353beac4d7c292b050d2e5dc4bd83a603ff4c1b0381cfe904bbf57f65e03",
      b: "3fc848549e5b3c1b38ad731df1e6e79019e00e0cd61f5dc202567895190c8314",
      add: "85297d90892013ddcb5dc3f0d7c3336854404e0197cf95df00e6c4547102e117",
      sub: "0598ece74c699ba75a02ddb4f3f56448208031e7eb90da5afc39d32a3ee9daef",
      mul: "fb43c3e0b168bff6e404ce198adc3ddebb1d82c3905fd5104010236fa47ee13c",
      d: 248610547,
      divQ: "00000004ae9897645275c5705b4a75f32f5b1853c1065fef1670a754ca0e17ef",
      divR: 11469862,
    },
    {
      a: "98a487eff7ae59b48d946d0bc09f0fe37890040e29b483d2c1d7c68c8d33cfb9",
      b: "5ab3dfc0c4a7d142a1f5d40c5430323d309fad32fbe3b575a6863746cdb0bbcf",
      add: "f35867b0bc562af72f8a411814cf4220a92fb14125983948685dfdd35ae48b88",
      sub: "3df0a82f33068871eb9e98ff6c6edda647f056db2dd0ce5d1b518f45bf8313ea",
      mul: "f02fc2a3f2c3f7ba39404eb13832c384f9b5455c27c1547cd7d75356f9d11997",
      d: 65445046,
      divQ: "00000027217ea46b98574fc9556c36251dbe2c3b9d8f8f4e0faa031550b296eb",
      divR: 35868839,
    },
    {
      a: "676c5bfe15f7a664e17d867f68c73398d72be7df953128f7c1412e25eebb9369",
      b: "6dd3161a9bb7cafc969a2d2d5eb04e70b5b7bb936f50c168bd98223721bca318",
      add: "d53f7218b1af71617817b3acc77782098ce3a3730481ea607ed9505d10783681",
      sub: "f99945e37a3fdb684ae359520a16e52821742c4c25e0678f03a90beeccfef051",
      mul: "ebe912d25881827cdb33773bd6eb44e4490c3238e29b24cea55897df9a8dacd8",
      d: 181806476,
      divQ: "000000098b414e36131be032d5b18a3bae828f46c9f34317058ce17c8ce85828",
      divR: 159225225,
    },
    {
      a: "73498832038f92ca67e0e22a98694bdc5eae2c0afccae47e75197ce4ca665105",
      b: "a9d84c408fcc27e56c70c220726140a916ab1c03dfd4a17f7b5df51e8ea89dbf",
      add: "1d21d472935bbaafd451a44b0aca8c857559480edc9f85fdf0777203590eeec4",
      sub: "c9713bf173c36ae4fb70200a26080b33480310071cf642fef9bb87c63bbdb346",
      mul: "cbaa2df8143a46250406bcf4202fc2a0fa69b46ec02da342575e5a7fb34e83bb",
      d: 86858834,
      divQ: "0000001644af817006ed56ec380f2396a86df3097d9176250bbc11fd5efe91d9",
      divR: 5021059,
    },
    {
      a: "f9ae6dc77504e85ac01e5b79e493c47a2b2fbf488cbc947bd0bf6270414ec8e6",
      b: "80b4972b936689c941c791ceaaec5f49e01b7556d4b691933e7228d5d93226ea",
      add: "7a6304f3086b722401e5ed488f8023c40b4b349f6173260f0f318b461a80efd0",
      sub: "78f9d69be19e5e917e56c9ab39a765304b1449f1b80602e8924d399a681ca1fc",
      mul: "cf2df0adcf0294a99e2540d2aa4e97feb06289b29e8357656932455996c1c63c",
      d: 134862408,
      divQ: "0000001f0f9c3019fef5e889b74c7a8341496cf31d3b2c8980f26fde8724d2c1",
      divR: 100478110,
    },
    {
      a: "dec8d711da0626a2a212abd2b69f36374faed6651edb0bb541998967461ef446",
      b: "3a81294966b28794724b99f133eacd346ce0e9e04da685d1909f95279b485e3d",
      add: "194a005b40b8ae37145e45c3ea8a036bbc8fc0456c819186d2391e8ee1675283",
      sub: "a447adc873539f0e2fc711e182b46902e2cdec84d13485e3b0f9f43faad69609",
      mul: "95b008e5e7b58469bf27e19bf3a325e8699ef81a63b58df9f8e814a028c1e8ae",
      d: 90749037,
      divQ: "000000292ff04aadb1da0d89575798b4a306aed0aeb075a0087f586fb0346254",
      divR: 50640514,
    },
    {
      a: "e9f287098710ff0ae31fa3f196819e2e9194059ab04cd2fda116ee0e4bc7b294",
      b: "2de392bd6c9ef4e6a15e6d162a9620ad17534cd90a12712d9d650b4c0f240ae4",
      add: "17d619c6f3aff3f1847e1107c117bedba8e75273ba5f442b3e7bf95a5aebbd78",
      sub: "bc0ef44c1a720a2441c136db6beb7d817a40b8c1a63a61d003b1e2c23ca3a7b0",
      mul: "04e5d324d3394e7b80a0aae84b57d0882b371383da41312cfa854f2d13a4d3d0",
      d: 168281313,
      divQ: "0000001752eea6d5f912ad64b84f1d5286cc2fa5695cb3b838077f6a80e3416c",
      divR: 67142312,
    },
    {
      a: "c1eb570bf30705fbcdfcbf330ce3d4a856d2a0da3f049706b78c719e4e842f2d",
      b: "8c914404d07839a88b73e10f915a3aaea98cdc48f0eab966423cf70ff09892e6",
      add: "4e7c9b10c37f3fa45970a0429e3e0f57005f7d232fef506cf9c968ae3f1cc213",
      sub: "355a1307228ecc534288de237b8999f9ad45c4914e19dda0754f7a8e5deb9c47",
      mul: "4069cb63eae90442234a9b42fe57f6729138908e06695cb9ac64165b20620c6e",
      d: 76082620,
      divQ: "0000002ac302029f2506249e5c86035185f0f24c431bf730404e9406cc3c5e8c",
      divR: 71771229,
    },
    {
      a: "9fc67b51151bb7247e7169331d57901959e7cb082cae98f5747343410b7ed5a3",
      b: "1471f8ba3aa2fa421bd601ca9c253f0d2be91e13ab30de216a9d4cd688cd1ba4",
      add: "b438740b4fbeb1669a476afdb97ccf2685d0e91bd7df7716df109017944bf147",
      sub: "8b548296da78bce2629b67688132510c2dfeacf4817dbad409d5f66a82b1b9ff",
      mul: "8b5e3e887d381eb3152c35a8db02b5a528294040128c5998f18a823369500d6c",
      d: 114290583,
      divQ: "000000177441343bc29fadfd2ee9d4d6fae7eb8f85ed65b7664792098809a396",
      divR: 63721001,
    },
    {
      a: "e2a9e5ddb7059f1e7cb4eb93c28758bf2f4fc6a26e7cdc73cd88c07d56befe5d",
      b: "dbeb647e84845f17b0b4a9db9d814cf6e15d4ddf6111ddfaa83105ccabb93bbe",
      add: "be954a5c3b89fe362d69956f6008a5b610ad1481cf8eba6e75b9c64a02783a1b",
      sub: "06be815f32814006cc0041b825060bc84df278c30d6afe792557bab0ab05c29f",
      mul: "ed23195379d25761d3f456dd053d776c6b99fba8b862a6987658870e56953806",
      d: 210103114,
      divQ: "0000001219804c2aa79d303959ba0001a8715078e7eb748ed9e70274e5c796f0",
      divR: 147787005,
    },
    {
      a: "54904920f0ed1e6429b43c5953d50b39e6b49b5a2e349975ac76d87ed1968871",
      b: "bc1a6bf52274420cde288934ddc00c17b245c9c3c946f3694a39e09a46e7ae32",
      add: "10aab5161361607107dcc58e3195175198fa651df77b8cdef6b0b919187e36a3",
      sub: "9875dd2bce78dc574b8bb3247614ff22346ed19664eda60c623cf7e48aaeda3f",
      mul: "13b0bf2a8a282c82fe19c6bdd381448529941380e8d1ada05534b757441a7412",
      d: 196570202,
      divQ: "0000000737acf3a830deadb6f10f7aab4a5216a20ac7bb8d018d35502ecd41f7",
      divR: 17310619,
    },
    {
      a: "aa7d1d29f1374d058ca3f49b3ddf2f8e85fc6314d0df6ee960e298c0f81ba2f0",
      b: "a25a60e01c36e07bd7ead73ca36f2cb9d973c48b7b1c787a6faf9c25c7418a67",
      add: "4cd77e0a0d6e2d81648ecbd7e14e5c485f7027a04bfbe763d09234e6bf5d2d57",
      sub: "0822bc49d5006c89b4b91d5e9a7002d4ac889e8955c2f66ef132fc9b30da1889",
      mul: "b449c56c292a35860bff34fc51fe204df8816ab49060946610b8c2bfa7e3ee90",
      d: 9775142,
      divQ: "000001249cbbafd9fe841d6cfbce51d41ebf2b1b45f94c6a662b37c52a1d0c55",
      divR: 6653522,
    },
    {
      a: "955546f3aeb7161a0effac6bc6957162d6592c0fa3f9de8133159a6ade0f8cff",
      b: "45ebd0c6d4917d79d8016057784b527e82a4dc1866f010e953eee9a773edf84a",
      add: "db4117ba83489393e7010cc33ee0c3e158fe08280ae9ef6a8704841251fd8549",
      sub: "4f69762cda2598a036fe4c144e4a1ee453b44ff73d09cd97df26b0c36a2194b5",
      mul: "717b8306bbe310b9efe769442b1817f07dc223628d5a3b496e11cc185628c9b6",
      d: 102553064,
      divQ: "000000186e22e4a37efe3e6f150f9660f49f6cc47af233d6a53476f83bc8f49f",
      divR: 17142247,
    },
    {
      a: "b515217442e992c0749171657d785280932f5e79905a2cc007bfb4ff14b6e2f5",
      b: "d6a103517027522d80c6f47945ecbd497fbf5418650204b3f386ce24ac09e497",
      add: "8bb624c5b310e4edf55865dec3650fca12eeb291f55c3173fb468323c0c0c78c",
      sub: "de741e22d2c24092f3ca7cec378b953713700a612b58280c1438e6da68acfe5e",
      mul: "d9cb2b15d888db8dc90176d8f906dee9db5a06840c202c867dc09c46b09f1283",
      d: 172844453,
      divQ: "0000001193ac669ea89caf20f515b18e5c963431af0c2c432f00167e6167b135",
      divR: 84329164,
    },
    {
      a: "c24243942bf8ec04da5afd251525bc07c7d39a09241c87b56e131a7fc8d2376a",
      b: "048beadfd8cfdab3d315d36955f5cef38657bb91c416f0cde2e6bbca02e59a3d",
      add: "c6ce2e7404c8c6b8ad70d08e6b1b8afb4e2b559ae833788350f9d649cbb7d1a7",
      sub: "bdb658b453291151074529bbbf2fed14417bde77600596e78b2c5eb5c5ec9d2d",
      mul: "2587ad8c0b9af54cc1b2f5ff24711f1ffbcf23bbd18319efcdf49f5fb53ef842",
      d: 248865249,
      divQ: "0000000d188f0d829aa2bb3fbd33f1a583fcaa71d1cb3e36786de9351176d028",
      divR: 155065410,
    },
    {
      a: "4cd4eb61b05e06a5a2aa9abf2c8a17e0d7b8e7d1ab0be95929a8617ab5629f46",
      b: "a38d7f15aae478c7e54cf4eea1df50d1a17e7d1a0c022038d5506063264ac847",
      add: "f0626a775b427f6d87f78fadce6968b2793764ebb70e0991fef8c1dddbad678d",
      sub: "a9476c4c05798dddbd5da5d08aaac70f363a6ab79f09c920545801178f17d6ff",
      mul: "8e658e0544380cc65bada7a9591a2755cebe288cc687748aa2fdd0f5c904dc6a",
      d: 64580453,
      divQ: "00000013f5bef8b35963f00aa1c68ba8e409144b05994f1bada58426c1a2c341",
      divR: 58092449,
    },
    {
      a: "d0b341ae044fbf646db3e3921f176ab9569ed0e7425d57224a105abae8b75088",
      b: "4c1d2ce571c3a309435376a153acf94389b7a6a59fbeef5c26bc174ef8fa8fbd",
      add: "1cd06e937613626db1075a3372c463fce056778ce21c467e70cc7209e1b1e045",
      sub: "849614c8928c1c5b2a606cf0cb6a7175cce72a41a29e67c62354436befbcc0cb",
      mul: "dd5d9d0a21882af82744004dcc32baa6e8f2dc1bddc21cdc30b0fe749a226c68",
      d: 241583091,
      divQ: "0000000e7e5c91b3119c99d12ce023f773ac597bf1b92883d1fadd39fec33ad3",
      divR: 49234239,
    },
    {
      a: "a2f84e800fe0cea5ccaedb83c5ca6bd24cbe8b74270b729aa3ef37b05b510254",
      b: "4335732b70d160e57ec7fa18e87ee8baa30d05791163687efd8977f613f0cf26",
      add: "e62dc1ab80b22f8b4b76d59cae49548cefcb90ed386edb19a178afa66f41d17a",
      sub: "5fc2db549f0f6dc04de6e16add4b8317a9b185fb15a80a1ba665bfba4760332e",
      mul: "0e6ebd6f332ac1bbc884bd873b33a918491bb7fe20322fd2ba87c5da79a84478",
      d: 159472114,
      divQ: "00000011252c20422d97a59d2c280b95edba6425382e44ea269addd5f4a66482",
      divR: 93506928,
    },
    {
      a: "ca3ed89aef4a77548fffac44e2e7f712ce06b95cba9844b87e4d97adf32682ea",
      b: "cff765d589dc5eb19129305c27f659f9f83469d2028ab9f3782258b3a2d7ac64",
      add: "9a363e707926d6062128dca10ade510cc63b232ebd22feabf66ff06195fe2f4e",
      sub: "fa4772c5656e18a2fed67be8baf19d18d5d24f8ab80d8ac5062b3efa504ed686",
      mul: "7e318476e4c06175ca39b86115337a3664acd1595c4c8ae3432fad1ee1865b68",
      d: 82636624,
      divQ: "000000290f88fe9d6a0b67c6d0fdc5368cae0eb2c68c379fddfee25e8a475285",
      divR: 3575386,
    },
    {
      a: "1859f225e2b7893b4fe1e62b0f0118adf03b980289ec4a82247a4e9a2e9f43ab",
      b: "9beb90a3d42ca9c8d9e77c2a5f99fd03556147a0d201c2d89ae04d1947038555",
      add: "b44582c9b6e4330429c962556e9b15b1459cdfa35bee0d5abf5a9bb375a2c900",
      sub: "7c6e61820e8adf7275fa6a00af671baa9ada5061b7ea87a9899a0180e79bbe56",
      mul: "58ad9299bb9b266f8ea8e49e06ee863f360e9057f7ad08d1deb6f5bf710a4ec7",
      d: 188161761,
      divQ: "000000022bd79dbeb46f3bfb75da94a141db31c9da4c543d4146fab0b468dfed",
      divR: 155823710,
    },
    {
      a: "6b19a280f199c43cbc4803f3f4ebae7027b4b4a73b8ae596c336d8b69e605611",
      b: "063c82d75b97797b091f43c8807287d7b7bfb8bf96f7ba6583fc0b78ffe2667d",
      add: "715625584d313db7c56747bc755e3647df746d66d2829ffc4732e42f9e42bc8e",
      sub: "64dd1fa996024ac1b328c02b747926986ff4fbe7a4932b313f3acd3d9e7def94",
      mul: "f83d04d29dbfee4561ef11a4322b4c3236f1f5d1649e14ab31b16e04a156cc4d",
      d: 220189005,
      divQ: "000000082913793b46b807a360a9f285483e85dbff87b9b2ce02556d45a783d7",
      divR: 106047334,
    },
    {
      a: "10b2ed0063236382e1311e57063ae25c2d7a3312f97553cfd583068a031d784c",
      b: "0eeb5422168d3d424301df2416df5342e7c98a4cef2841f25e27c5f68d2080c4",
      add: "1f9e412279b0a0c52432fd7b1d1a359f1543bd5fe89d95c233aacc80903df910",
      sub: "01c798de4c9626409e2f3f32ef5b8f1945b0a8c60a4d11dd775b409375fcf788",
      mul: "7fd131abe58c744a3d6b666fdc72ddc1a66d693273b2bd61b805b73204361a30",
      d: 192002830,
      divQ: "00000001758b0fc3f4d8aa041f02d654e9765b97d35cda8e5aab76ebd55eb97a",
      divR: 161035680,
    },
    {
      a: "5220c9a3f25d1404a1cf9d0491465827d0866fa4a87bbff99231560301a217bd",
      b: "e36e66a717ab6e4fe16d719434fd95fcfdb48aa862808ac5aacc328fada6dd2c",
      add: "358f304b0a088254833d0e98c643ee24ce3afa4d0afc4abf3cfd8892af48f4e9",
      sub: "6eb262fcdab1a5b4c0622b705c48c22ad2d1e4fc45fb3533e765237353fb3a91",
      mul: "b8f63685a2060c032aca97fd7c05933ebc36977a9e7e4e96849326a653e83d7c",
      d: 66325795,
      divQ: "00000014c640f1b7f54bfe49fe8142544be35bcc97a6b234053f64559c668afb",
      divR: 38951020,
    },
    {
      a: "4f6b28bbfe51bcf618bbabac63f70a6b6e5d8a87316dbc608665469d164c8801",
      b: "13964f60c1a1768dd1ae9a075fce8ba0ffb042245b983f918b33fe823a4bc7f7",
      add: "6301781cbff33383ea6a45b3c3c5960c6e0dccab8d05fbf21199451f50984ff8",
      sub: "3bd4d95b3cb04668470d11a504287eca6ead4862d5d57ccefb31481adc00c00a",
      mul: "318186c97f5fb61720d765183b63ca9b8206c4f5b75819d391af2ba413dafff7",
      d: 86656216,
      divQ: "0000000f603f2a9a78fb727d2080170879df40edf1324a092a60512c74607914",
      divR: 58003233,
    },
    {
      a: "a02b756e4d989d508437fc1b6cece67affe9bb0fcbb045c66eba9e0c699b6182",
      b: "bd6cbdf7fcb77f0bea4691eaa7b087692d5fe71be30eba8a6a76a6d5f3784371",
      add: "5d9833664a501c5c6e7e8e06149d6de42d49a22baebf0050d93144e25d13a4f3",
      sub: "e2beb77650e11e4499f16a30c53c5f11d289d3f3e8a18b3c0443f73676231e11",
      mul: "8784ed258643195a9251d0d9c499bf403977e698aa1c5bf2fb3b6eac630b1062",
      d: 225408875,
      divQ: "0000000bebe4bd5469f2497181dce2edc54e43e696c0eb76679b70c479203464",
      divR: 91160502,
    },
    {
      a: "9dd54d74633876d3b8e4b9570e032f7228e362b96d36bf2fdd2d64331db1ba06",
      b: "c762431e1be86434d146ee6b168852ef4b87cfcbabc4fe5049c78acc3f12b7f6",
      add: "653790927f20db088a2ba7c2248b8261746b328518fbbd8026f4eeff5cc471fc",
      sub: "d6730a564750129ee79dcaebf77adc82dd5b92edc171c0df9365d966de9f0210",
      mul: "6a751b801d785aab8d62a0a7a4522b61580a70e78a29e7c464b71f67232f0bc4",
      d: 181026752,
      divQ: "0000000ea0afd21560eaad41d4957891d15df1731e1ec4fbb47778f75caacf35",
      divR: 46548806,
    },
    {
      a: "71be51fd574367812bbd12bb33490784cb11e24a9c4439e956ede4eaff76d17b",
      b: "fb04ea5ab21661e57b01e9dbba17503cb0a6b5db946b91ca62a289700ef12f33",
      add: "6cc33c580959c966a6befc96ed6057c17bb8982630afcbb3b9906e5b0e6800ae",
      sub: "76b967a2a52d059bb0bb28df7931b7481a6b2c6f07d8a81ef44b5b7af085a248",
      mul: "463de49eae1f83ed01e19eb0f32a8c3d867847d8a48d3de1598b36d7a3ec5081",
      d: 192547157,
      divQ: "00000009e92ad3990f67014200e689bdc4e3e82925d8d0cf5fa3862c1527ddfa",
      divR: 189289337,
    },
    {
      a: "8cadd3616121ce4fa4198ba2212d2243791bcb67782d84159b5c8f7b60148d76",
      b: "8c0d21ebf715bfdcfa2f691741bdef26066ddbd0a797959c58515e0845610301",
      add: "18baf54d58378e2c9e48f4b962eb11697f89a7381fc519b1f3aded83a5759077",
      sub: "00a0b1756a0c0e72a9ea228adf6f331d72adef96d095ee79430b31731ab38a75",
      mul: "e2b45e8c32703cbbf85b839ab8111602c0930d5f73e3b7d22e9bb3360572ef76",
      d: 1644383,
      divQ: "0000059b4fc8786fcd7e8f7d5c8314b4f7b6ce11fcfffbbe1edece2a91b42a2d",
      divR: 646083,
    },
    {
      a: "0690ed0b712317a569aa5734761609cc3a5a174563e8219545438d24c28aa8ce",
      b: "eb2bce7f18d6f3e16828a2a3c48044392bae45c8d1980f50394f6c53bd7ce1fc",
      add: "f1bcbb8a89fa0b86d1d2f9d83a964e0566085d0e358030e57e92f97880078aca",
      sub: "1b651e8c584c23c40181b490b195c5930eabd17c925012450bf420d1050dc6d2",
      mul: "8ad87e9a6d9998f80924597003dec490284b5133dc19ac7a96b87bbf38a338c8",
      d: 133156573,
      divQ: "00000000d3ca4ad976cbfbadb2a52f0e320a1e5ceb578fca00d02bbec0a2a858",
      divR: 8422614,
    },
    {
      a: "fdf34853b26678ccdfb7a1990159b4be6a2f2927f694369ec38ed283e0fb4800",
      b: "d20588383c13870f44bf9f79021140db2bd1f2e3ba2ffc16fafaf8e2b410e3f8",
      add: "cff8d08bee79ffdc24774112036af59996011c0bb0c432b5be89cb66950c2bf8",
      sub: "2bedc01b7652f1bd9af8021fff4873e33e5d36443c643a87c893d9a12cea6408",
      mul: "e5d86d390c038e1b1506244ca5ddc8eaaee207ef9e6d3a3b550b2e954445c000",
      d: 117005064,
      divQ: "0000002469e3d34fc38d3c9a23b4006aa4535346d853c31be8f012aa4bf7fee7",
      divR: 15741896,
    },
    {
      a: "368b091ddcb02b0d8462b8a7373dad6b718640f2abebffbb2008a3c45f6b4bb4",
      b: "7e269864d021ac88aec0f0556c4747ee45b0253252570f46a85616ccc527cc02",
      add: "b4b1a182acd1d7963323a8fca384f559b7366624fe430f01c85eba91249317b6",
      sub: "b86470b90c8e7e84d5a1c851caf6657d2bd61bc05994f07477b28cf79a437fb2",
      mul: "e41143e37f9cf4b015b4e990dd6f8e1706e6de0a4747bbf50363a99c4b960768",
      d: 91844860,
      divQ: "00000009f69d6748a4f34735dc038a85f75bc9dffed194f2be403c9e4addaed0",
      divR: 6829812,
    },
    {
      a: "59eab4afed6f0278b27ea03948d368207b1c4eeeb1939bc224e9df947205a150",
      b: "10d709cc13060584d6ea06d646c80f95347cb406507d6fc42eb6219bd0802248",
      add: "6ac1be7c007507fd8968a70f8f9b77b5af9902f502110b8653a001304285c398",
      sub: "4913aae3da68fcf3db949963020b588b469f9ae861162bfdf633bdf8a1857f08",
      mul: "8e193f6489bb529199c82c183e559788329a3af3cc07d7eaaa6a2a367901fe80",
      d: 221941460,
      divQ: "00000006cc0d72baf2433bf03dd32a1bde35d0b7a0dbd552f446bbd9c10f6f98",
      divR: 15132528,
    },
    {
      a: "e22218a92888dbe3cdeee2b3d3f6f06367ca63e66986b392f823a35dff9aa328",
      b: "442f34090be21e02693eb7252ff44de1a5725f671e35fa90a7427af7ff577be6",
      add: "26514cb2346af9e6372d99d903eb3e450d3cc34d87bcae239f661e55fef21f0e",
      sub: "9df2e4a01ca6bde164b02b8ea402a281c258047f4b50b90250e1286600432742",
      mul: "823e005d810e4ed7034954172af87f4f04223ce50b3acf69ae5451ed3beacdf0",
      d: 25326008,
      divQ: "00000095cd4c83dd123cfa8c46e335721df22bc342275dd617b688db36b8ce52",
      divR: 1058360,
    },
    {
      a: "d00f814a613709d87ec55688a24441e32d49c4b6751ae3bfb5a1e304a1a23c2a",
      b: "f844a0512d89d3f5929585aa1b7c9975cbf978915cb13f698c4b9785294dfe5b",
      add: "c854219b8ec0ddce115adc32bdc0db58f9433d47d1cc232941ed7a89caf03a85",
      sub: "d7cae0f933ad35e2ec2fd0de86c7a86d61504c251869a45629564b7f78543dcf",
      mul: "bab6a707890a0e337684b769b833a89c5455b52e516d7dd07925ec453eff0eee",
      d: 219407588,
      divQ: "0000000fe8d896fdec251ffae47eef688e693d7726d91167339697dfe504551d",
      divR: 64068182,
    },
    {
      a: "04a0dc462d37f778e18b0b86600422ff78a26879c816100a7fcbe8eb314018a2",
      b: "e96efeffbbaff4cd407f96b5c474eeef0fd8b5214604336a8ad230efc2a89d63",
      add: "ee0fdb45e8e7ec46220aa23c247911ee887b1d9b0e1a43750a9e19daf3e8b605",
      sub: "1b31dd46718802aba10b74d09b8f341068c9b3588211dc9ff4f9b7fb6e977b3f",
      mul: "6e5a38787fdc5f921951dffbbcfc911349e01ed8a09b028117b794214934e0a6",
      d: 115148553,
      divQ: "00000000aca28933fadc2034e10886847312f843a1d9ec7ec1638eee6d2f49bc",
      divR: 4611334,
    },
    {
      a: "a944c037caf872449cf433f247e97dd5b1e9c6895b7f33e1e95cd6b2257621e3",
      b: "4dcf23728034651c814c8f9933e1be55bb09a6e1a4fa4fa3bbeafdd937affeb0",
      add: "f713e3aa4b2cd7611e40c38b7bcb3c2b6cf36d6b00798385a547d48b5d262093",
      sub: "5b759cc54ac40d281ba7a4591407bf7ff6e01fa7b684e43e2d71d8d8edc62333",
      mul: "40407023f687a99a09eb6f90b2e2a420c46fefb3dfed7ebde1ca6918e6038610",
      d: 101120538,
      divQ: "0000001c1577ee7bd50ce38266e3d069766d2706c27137f49a813027b6d0357f",
      divR: 85503229,
    },
    {
      a: "81bc98badbb27232cc5dfdfe792ca80db3cdc9493fce4bdd2ecb691102623a51",
      b: "1452cfe7ed0e25f4492576e04ef6c4cf2303c37a2fee017e8df4b5683bf3ebd5",
      add: "960f68a2c8c09827158374dec8236cdcd6d18cc36fbc4d5bbcc01e793e562626",
      sub: "6d69c8d2eea44c3e8338871e2a35e33e90ca05cf0fe04a5ea0d6b3a8c66e4e7c",
      mul: "7c82a8e108c2ecfbc16506373a343672b5392f846e588f7cecb9e4ed2d25e065",
      d: 104704177,
      divQ: "00000014c9cd553678abe5ccd14dbfff6d0cce4a78976de2aa02a84c629271ef",
      divR: 6921234,
    },
    {
      a: "a3f98677aeb2c583fc6ba0fda1a131d949efe41e9672cdd3fba4951b02fdd940",
      b: "d5dfca8d4cae74caee4eb7c51835e6d38bf7fd18ff23dbf47c1e37e57f99324b",
      add: "79d95104fb613a4eeaba58c2b9d718acd5e7e1379596a9c877c2cd0082970b8b",
      sub: "ce19bbea620450b90e1ce938896b4b05bdf7e705974ef1df7f865d358364a6f5",
      mul: "43982c8bb53b00dd0ebc63d4d6d7eef185bfa7ae28ca0e5f0e37c43d0c0d25c0",
      d: 191764309,
      divQ: "0000000e588f76c287298a182abfb46d14dd982feb01c2174f60c3033c97695d",
      divR: 88769119,
    },
    {
      a: "63227f5aa011030ae49f6d3ace4c1eac6a960456f245a39184362643b0f4dc96",
      b: "12e7432e6bb0bbef9e7ad6e03f71f9ef75ce42d85cf8e0f76085b11e14a98544",
      add: "7609c2890bc1befa831a441b0dbe189be064472f4f3e8488e4bbd761c59e61da",
      sub: "503b3c2c3460471b4624965a8eda24bcf4c7c17e954cc29a23b075259c4b5752",
      mul: "8e38078982d979f1955320e478f7f9aed3eed6daaac6af04afe9d75f8eaa85d8",
      d: 233805551,
      divQ: "000000071d16955e440f836d87654fe1b4f35d138298e9479cf36c1c1af79e7f",
      divR: 22575621,
    },
    {
      a: "ad363b806aa48d3ed156e62baa5d076d92a7b97e963fb326d130478a40d15bdb",
      b: "d628fdb6d88aa07fa5d782aefccf004e4e59f95b2667a6f470db8705c9c1678e",
      add: "835f3937432f2dbe772e68daa72c07bbe101b2d9bca75a1b420bce900a92c369",
      sub: "d70d3dc99219ecbf2b7f637cad8e071f444dc0236fd80c326054c084770ff44d",
      mul: "8a60d4a66a0949195ace17ae3572b5d42a11cf8bbe71832b018fd6006331107a",
      d: 155750325,
      divQ: "00000012a87c5b9054b51ae9141cff98779ca3d35421bb9c4b2da567b4baf6d8",
      divR: 66989347,
    },
    {
      a: "f258093b42c7cc42e4b54f8e25f10f4838632020eeb37b0fccd7e4e6e7ea87a4",
      b: "51713503609beabc66789fecb7e431513d088aa323c4ebe0bd7b618b7c8017c3",
      add: "43c93e3ea363b6ff4b2def7addd54099756baac4127866f08a534672646a9f67",
      sub: "a0e6d437e22be1867e3cafa16e0cddf6fb5a957dcaee8f2f0f5c835b6b6a6fe1",
      mul: "7b046844f82ab29cf7991ff86624a5a6ee7bfc431a4cbdd5c35673bbfbd50dec",
      d: 254479130,
      divQ: "0000000ffa27adfeb312d5ee4e14f70dfd6316b1c415458fb1c2479fe0ee65a6",
      divR: 74715848,
    },
    {
      a: "3a2ce9b62634ec94064b6b12717d7acb40e23063e9a417eb84f4aa4a5f861ad6",
      b: "1c7661d5636465e284d2a403e492a1169444d6bf5a6bdfae809b186988d8842c",
      add: "56a34b8b899952768b1e0f1656101be1d5270723440ff79a058fc2b3e85e9f02",
      sub: "1db687e0c2d086b18178c70e8cead9b4ac9d59a48f38383d045991e0d6ad96aa",
      mul: "7d46d2d1a1b75828ed129e79ce5890092e82621006f8127733728737e572f4c8",
      d: 10918589,
      divQ: "00000059640eb07d36712c5677c737c8420caafadfadad2ea235d6f06f9073d5",
      divR: 1340565,
    },
    {
      a: "aeba06cf835e2214b08db83f7139dc1ce0b0079108792fc228e4165138da65ae",
      b: "0e696cbc6678f1da924d05e14b471e1113518c64694f5fcc8f667755edf68bd5",
      add: "bd23738be9d713ef42dabe20bc80fa2df40193f571c88f8eb84a8da726d0f183",
      sub: "a0509a131ce5303a1e40b25e25f2be0bcd5e7b2c9f29cff5997d9efb4ae3d9d9",
      mul: "e5a3d8cda7277c5cbbbdde1dc5c773b2dad11ca673e205749caf2238ae2013c6",
      d: 183543109,
      divQ: "0000000ff8a8e3e5f0696e593c4b2f55e48c384f99029ae3ed081899675e1c97",
      divR: 8347131,
    },
    {
      a: "4b56c4b30c043ec37d8efb88b88151f8d22d673198eb13dd1b45d888e4beec42",
      b: "c173726c0c0596c560494ffa0c91313bfd35d1e9c96c8cab4f11a490c84c75df",
      add: "0cca371f1809d588ddd84b82c5128334cf63391b6257a0886a577d19ad0b6221",
      sub: "89e35246fffea7fe1d45ab8eabf020bcd4f79547cf7e8731cc3433f81c727663",
      mul: "c5af2e1d443f6738a183fdcfd8420229d5b39e5ab010882ff2486e2c37e1f77e",
      d: 18508169,
      divQ: "000000444aff72822137d441ed414ef28a85c5bd4322d5adf74296376657119f",
      divR: 12994347,
    },
    {
      a: "27e23e2db1f20a00a522a2e0d464c70a95eb92dd0c22d3f9d37d8b99fa04c265",
      b: "458e39657a6c8e6314b8c992401a34743358dde5d66a46693e3eeef145a359fc",
      add: "6d7077932c5e9863b9db6c73147efb7ec94470c2e28d1a6311bc7a8b3fa81c61",
      sub: "e25404c837857b9d9069d94e944a92966292b4f735b88d90953e9ca8b4616869",
      mul: "9a46b9b5edbc0b624fd993cc8945c4f381c3eb7c0bcba4108e3653ffc393786c",
      d: 250174402,
      divQ: "00000002acb85ac3088354f1570508a88266f3000903cc592ce30e5bf8e3865e",
      divR: 222790953,
    },
    {
      a: "adbfd711d981ddc11162eada970f63e277a5552d97a181a04a460e7066f53952",
      b: "a3bc6aff6a211f4b80c9f77dded57c3417dcbbdc1b1dc1e53cb8c123409a9bbb",
      add: "517c421143a2fd0c922ce25875e4e0168f821109b2bf438586fecf93a78fd50d",
      sub: "0a036c126f60be759098f35cb839e7ae5fc899517c83bfbb0d8d4d4d265a9d97",
      mul: "d9d6ed7676c2bfb03e90f26145953bd2595320c868b337d6d3f38080aa2984e6",
      d: 181770339,
      divQ: "0000001009719380e0a3bb093bbd6bbcde8ad21da73b9583a1253559624284be",
      divR: 173347800,
    },
    {
      a: "b0b59d6f911ea00715e179aa25d4cb1796c6863c07b02294a50b3eb7d97071d8",
      b: "a4be07b7b7a61eba502ef999efd3693e1c16b4ae1d4bc988123d04a2ad8a06ea",
      add: "5573a52748c4bec16610734415a83455b2dd3aea24fbec1cb748435a86fa78c2",
      sub: "0bf795b7d978814cc5b28010360161d97aafd18dea64590c92ce3a152be66aee",
      mul: "d55db44553341903c4312c82e8b17b8fadeff7255c110378d8334161b9e31f70",
      d: 43198853,
      divQ: "00000044a1037e63dc3fa8c66b9c4c387deba28bf9436f62993db1968cf6a5eb",
      divR: 13147073,
    },
    {
      a: "46823fc00dd943196ae2d6d6f1275935c926f60451c53b17fc71ea082a15fa42",
      b: "5f2320904ac9a6aad944c078970700cb2453c6dcc52994149bf61772effc852c",
      add: "a5a5605058a2e9c44427974f882e5a00ed7abce116eecf2c9868017b1a127f6e",
      sub: "e75f1f2fc30f9c6e919e165e5a20586aa4d32f278c9ba703607bd2953a197516",
      mul: "abe46a3477031c9aed9c73ac9357c9bc63dff2db6ef0e01dba2fc8ee9dc34d58",
      d: 223522488,
      divQ: "000000054ad22317cb96b7fa6861e39373e14144af05fb879edffdb6cdcc8e94",
      divR: 113174498,
    },
    {
      a: "796d913d158255f80ad27a39ded99918725b87d4bbf3d402b75f188622ece97f",
      b: "978f76e4bb6f09b78116ab006add161a05372d4e2f4d558b2bbe56c8450e7fde",
      add: "10fd0821d0f15faf8be9253a49b6af327792b522eb41298de31d6f4e67fb695d",
      sub: "e1de1a585a134c4089bbcf3973fc82fe6d245a868ca67e778ba0c1bdddde69a1",
      mul: "c27b05813de5f8b8f617b7249e394a4bf9a142df6382beac312aa8c1d13a7d22",
      d: 194415630,
      divQ: "0000000a7a8c4fe4e91bca26631f69108b34233e2a160b9926cab22002bfb8a1",
      divR: 170050737,
    },
    {
      a: "01f4d43799bde2cc188102598937725ee4205a865eb073e9af47f63cb2d17a39",
      b: "6f08f4c96e54e50fef076c1f1e1bdf2a9f03e989df7447bbcae271cd8e42e91e",
      add: "70fdc9010812c7dc07886e78a7535189832444103e24bba57a2a680a41146357",
      sub: "92ebdf6e2b68fdbc2979963a6b1b9334451c70fc7f3c2c2de465846f248e911b",
      mul: "fb67ccc44030e4ee51e74b8c06a9ac4f1e902ddd5b649899b9666e4fbd7c33ae",
      d: 227218228,
      divQ: "0000000024fadd2ec472a6b4865e5841627a0a2d615057d7866eb2426c4f0f58",
      divR: 131519577,
    },
    {
      a: "6dbd2724a90830ac07cae146ab7d39ed93a22013b68061476975715dad40d603",
      b: "9daef1a27062c9ff761643b50d8233956889c8f53403d2c4205f72dff8127092",
      add: "0b6c18c7196afaab7de124fbb8ff6d82fc2be908ea84340b89d4e43da5534695",
      sub: "d00e358238a566ac91b49d919dfb06582b18571e827c8e834915fe7db52e6571",
      mul: "f5281ff7797e447e9ef112c6a7d8f4c74c917938296616ced4e563b820d15db6",
      d: 115064271,
      divQ: "000000100030257b9d0ba300719870cbeaeaeffad20982ad7caa13d838201aed",
      divR: 11212640,
    },
    {
      a: "3f0615e8f571fe255b78f77e05ee7b3cc1793faceea60b65dd60b5be402ce6cb",
      b: "1b51ee7280692b72f4335f477f59ce254224e6e4eed7ada1c1b30982cf534f35",
      add: "5a58045b75db29984fac56c585484962039e2691dd7db9079f13bf410f803600",
      sub: "23b427767508d2b2674598368694ad177f5458c7ffce5dc41badac3b70d99796",
      mul: "9e802154bbc9e7698b820606e52d70171e9bb2bd4c86cda50589c9741d556d07",
      d: 100430388,
      divQ: "0000000a87401737d39ed7803527bbbe89f1255286d65e97e475c65a16c6bc02",
      divR: 69063267,
    },
    {
      a: "489df12917a6454428a23648087138634d7e53e14df1489b48ea799034720eb8",
      b: "275043f927ece585a2b7ce1f8fb4552be8fb7b3af9925d3a8200b595ec5e738b",
      add: "6fee35223f932ac9cb5a046798258d8f3679cf1c4783a5d5caeb2f2620d08243",
      sub: "214dad2fefb95fbe85ea682878bce3376482d8a6545eeb60c6e9c3fa48139b2d",
      mul: "350eae5cb8a6a1b5cfb740d8268379224c827251a70aeb681a02d966be1aa5e8",
      d: 44968709,
      divQ: "0000001b17a7cd69ef01e29578ca4a2613eb36a29a1a6da90d56f97012938006",
      divR: 16485530,
    },
    {
      a: "a732a769cf57837e0fd389335f9a642f801c45de31f22794e0c628b7366dcb9d",
      b: "c71fee790e9e4001efb6b70b85c4bf726c9f8b2f8cfa295b304ed2fe5dd98b2f",
      add: "6e5295e2ddf5c37fff8a403ee55f23a1ecbbd10dbeec50f01114fbb5944756cc",
      sub: "e012b8f0c0b9437c201cd227d9d5a4bd137cbaaea4f7fe39b07755b8d894406e",
      mul: "82953136d0b359c1f8505d1179f5f028e2b975e83fcd01027a5cca003ccba0d3",
      d: 233713147,
      divQ: "0000000c009c2e123e1b790f8cdb9de96c70957e2a64a0bb4cc9d4b81a4aa18c",
      divR: 78891865,
    },
    {
      a: "f5b5dca738bedb3139e0ec5173b32d3bfcaccb3c87ef2018e2960d89d89a7c10",
      b: "fd3bed5eaf219ac7e9cfbfc942201274b3371cb640a791fb78adc926a0eadf43",
      add: "f2f1ca05e7e075f923b0ac1ab5d33fb0afe3e7f2c896b2145b43d6b079855b53",
      sub: "f879ef48899d406950112c8831931ac74975ae8647478e1d69e8446337af9ccd",
      mul: "526d1eb8986f668e9cb05592695d2f03b5f99c3ec9abb547539823e1a9206830",
      d: 252753592,
      divQ: "000000104f48cd0b5446fad58bbd2d7205025f1df70bb0602461cd17aabe377e",
      divR: 177145216,
    },
    {
      a: "3e338764f44eddbc318364093bdea7a6a499b52fda69180eb854a1157be3d02e",
      b: "61e728fa973fcfa393e06e117dfd7d9f95254f1e5e5e20f98ed2c59b8470d586",
      add: "a01ab05f8b8ead5fc563d21ab9dc254639bf044e38c73908472766b10054a5b4",
      sub: "dc4c5e6a5d0f0e189da2f5f7bde12a070f7466117c0af7152981db79f772faa8",
      mul: "1e4eab62ab1f602afb972334af796d7297a58a8dfa8d6a990f794e3031953e14",
      d: 119844143,
      divQ: "00000008b52a7c138ef7643cf7fcd0a52cea6dee40a1ff82f0d52f1dbd0ae7d4",
      divR: 40434754,
    },
    {
      a: "ebb986251be07e0aa6e976e4e2f8c5a56d98f69f52fa06173f92a7dd5faf5302",
      b: "0ceb09a36a958bbc31fbe30981694e9297bf1c7fc1514759669686fc3ff93646",
      add: "f8a48fc8867609c6d8e559ee646214380558131f144b4d70a6292ed99fa88948",
      sub: "dece7c81b14af24e74ed93db618f7712d5d9da1f91a8bebdd8fc20e11fb61cbc",
      mul: "b2daca665b535dd499f5bc69836312e33ec3bc46a494f238779591a460651e8c",
      d: 194546268,
      divQ: "00000014540e9f4fc320467af04a47a1f46b1984c63aa80fcf72c4625e73b7a3",
      divR: 55801454,
    },
    {
      a: "dc2970ea3cfa209ff88cdeec2f95e9f219782f1bc3e362c4c741421aa140a35d",
      b: "d60863337a9c6876afc3a6aa4fbd340454e946834910798da970936d36a58d21",
      add: "b231d41db7968916a85085967f531df66e61759f0cf3dc5270b1d587d7e6307e",
      sub: "06210db6c25db82948c93841dfd8b5edc48ee8987ad2e9371dd0aead6a9b163c",
      mul: "10da64c3b5e050dd9e91b898abca13b87f0a6b59910be5657e03b6f74c4047fd",
      d: 142460716,
      divQ: "00000019ed891baa5768e5c6bbc69a648aec67b9cf55c3f8ac66f787bbb1c268",
      divR: 63725949,
    },
    {
      a: "66de2508382a459873af7ef3bc0fa9718318c3fae76365003b2c636f74a9ac6a",
      b: "d831011e124bd71a222d02b3194d13e89894e6637b691880282817055e57850c",
      add: "3f0f26264a761cb295dc81a6d55cbd5a1badaa5e62cc7d8063547a74d3013176",
      sub: "8ead23ea25de6e7e51827c40a2c29588ea83dd976bfa4c8013044c6a1652275e",
      mul: "87bc0b4eb87e1dcba43f89345545a1e543974bb8dfdc1a7593d267e0228d26f8",
      d: 267568037,
      divQ: "00000006733842fc3ac2eed27a3ed9cfaffb3459a36ae92e464b2be109b38d22",
      divR: 122343296,
    },
    {
      a: "53b450f789169567e7cc9df1d90f1bfa36df862e0bd21934dae288457cb13ef0",
      b: "5c9ba2918179355306bc7cd3249f369ec3746f578d9afa4c93dd4003de8e8a00",
      add: "b04ff3890a8fcabaee891ac4fdae5298fa53f585996d13816ebfc8495b3fc8f0",
      sub: "f718ae66079d6014e110211eb46fe55b736b16d67e371ee8470548419e22b4f0",
      mul: "a36eabf0e04170d0ffe5960de0c60d1aa349852bf87ccd35e12210ec950d6000",
      d: 8043751,
      divQ: "000000ae9602a8562ce83855cb13b6d1dc62222c8a71fa94e1e4aa2b30d0ae8f",
      divR: 833511,
    },
    {
      a: "ca5e59b4e413535a86e215d9e7da6b14ab51d103b068afc5cafc67fe6f6863c9",
      b: "948a031a2b28de845570413319cfb57f84773800cfe72dcb34bb0c64d8a77e1f",
      add: "5ee85ccf0f3c31dedc52570d01aa20942fc90904804fdd90ffb77463480fe1e8",
      sub: "35d4569ab8ea74d63171d4a6ce0ab59526da9902e08181fa96415b9996c0e5aa",
      mul: "c281c06ebe2943178c38a9bb06532bdea13e1b5f78229cc77601fa738ee00357",
      d: 170121523,
      divQ: "00000013f517478e0956ecf56a54d2b3947dec0216e3ce15d5ca0eca5a5ba7e1",
      divR: 1390838,
    },
    {
      a: "f2f6d7447e3dd108661a9bdba8553dec3995d9c6269518a689497a1d310b966a",
      b: "70bc2e9a14a25ad607b4fd7446e93e5fc5afaf81038239f8b43cda3763ea11ff",
      add: "63b305de92e02bde6dcf994fef3e7c4bff4589472a17529f3d86545494f5a869",
      sub: "823aa8aa699b76325e659e67616bff8c73e62a452312deadd50c9fe5cd21846b",
      mul: "6e3d83303c52b71be0172eceeaef50e7dd3f0dc9321c9196ba5e77de1a6bdd96",
      d: 257710245,
      divQ: "0000000fd1363e80b3e8b506b2e3ae7e055e5487dc3c0fa9708dc953a4751b14",
      divR: 152191622,
    },
    {
      a: "9e6a3c79b9e279a92b105b45cddbb667b57dd1842c4d42075ff949a67c502835",
      b: "d65b731d0ab2bc2d2a305ddf2a89e3e4cfeac772ff9ef2714f9f3da1950122a2",
      add: "74c5af96c49535d65540b924f8659a4c856898f72bec3478af98874811514ad7",
      sub: "c80ec95caf2fbd7c00dffd66a351d282e5930a112cae4f96105a0c04e74f0593",
      mul: "1148aaf0d9e36ef3893006f4b726e32a72e6a972fabe042aa372c5e951457b8a",
      d: 13409482,
      divQ: "000000c633425166d74f720623f1995f128525987f0740a7212095cf062dd76f",
      divR: 6850207,
    },
    {
      a: "e6ff1282ec6f3a20f8efc927d0c58a86ff40ec9f8ff320a96b987093d610d418",
      b: "52567b3c0c994dac588c4df188b4eb275d8bf36ec1700d707d0913946c06452f",
      add: "39558dbef90887cd517c1719597a75ae5ccce00e51632e19e8a1842842171947",
      sub: "94a89746dfd5ec74a0637b3648109f5fa1b4f930ce831338ee8f5cff6a0a8ee9",
      mul: "6afe187bc4b872fe896a6c4c6e3ee311b7b314f440a44d2e076b0795eed16868",
      d: 99916275,
      divQ: "00000026c98845bde230d502e6f274dc852d49ff55aedfb346feaa7844ff30af",
      divR: 32573179,
    },
    {
      a: "6ed898894825df5095dbc1654c72a5371073263cc2be6e4ef9ac68fb29ca3978",
      b: "b9b4a928f9e8b1d1bdfbcd1ab1660694b7f2de67f12a145f62a374129216be6c",
      add: "288d41b2420e912253d78e7ffdd8abcbc86604a4b3e882ae5c4fdd0dbbe0f7e4",
      sub: "b523ef604e3d2d7ed7dff44a9b0c9ea2588047d4d19459ef9708f4e897b37b0c",
      mul: "99cb7c502c1b8ea519941eacfcd349faded914206337d932a7bc099118474ea0",
      d: 91442775,
      divQ: "000000145651b8fd3fd56370de27b3f8ae77c001b2a09dd7a3b5853c72758d34",
      divR: 7693516,
    },
    {
      a: "c76f2e11bfba15c7df34dafc6aace2d8f1c13ddf238c9644393748625bb417e5",
      b: "b9b5637a928f560184d6c2450dba57c9df0bbe7fc3f98ab4043eab253909620a",
      add: "8124918c52496bc9640b9d4178673aa2d0ccfc5ee78620f83d75f38794bd79ef",
      sub: "0db9ca972d2abfc65a5e18b75cf28b0f12b57f5f5f930b9034f89d3d22aab5db",
      mul: "bb6330c3b439fe9bcaf0f5116cdbbde9cd6e81e42dfebd1ac23238b25a3b98f2",
      d: 262928596,
      divQ: "0000000cb9c7ef094acf885228ffc263db707ec554e481670297ee50533c0282",
      divR: 12457021,
    },
    {
      a: "3063f999afc5fd2286f2f8e52e6ae3b1b2a662fba016e4f130a01c612730fbff",
      b: "6aa81838f2343b51967dc637e56d6438b31682a8fda85093cd9425047136a353",
      add: "9b0c11d2a1fa38741d70bf1d13d847ea65bce5a49dbf3584fe34416598679f52",
      sub: "c5bbe160bd91c1d0f07532ad48fd7f78ff8fe052a26e945d630bf75cb5fa58ac",
      mul: "87e75143cc2078c261c164f684892f7343db980d89e87c2e2861be009c1f10ad",
      d: 25283934,
      divQ: "000000201c122c6f63642b19b3e85281b0b340045e02b977672edbf23ac3be0e",
      divR: 17956059,
    },
    {
      a: "446804c4bc9f9207cc74692ecce6a528294dced27ea0bd494752074f3349457c",
      b: "4135b254e9b1d24214ea1af1db8c4ed3d3d52b4d1b9c6a52644639c909b49dd8",
      add: "859db719a6516449e15e8420a872f3fbfd22fa1f9a3d279bab9841183cfde354",
      sub: "0332526fd2edbfc5b78a4e3cf15a56545578a385630452f6e30bcd862994a7a4",
      mul: "a94a7a5ca77ff760b14d8a23dc3b21305a0c9b8479444d006d178a996c9faca0",
      d: 98708259,
      divQ: "0000000ba07a422b4fc41d91cb1d17248da82dd1b2b5e8a0c0ec6f5f94dd8870",
      divR: 3460652,
    },
    {
      a: "0a2f45347be7bc01c63944c281af65eba0a981719854d3e0a1e439949efb1ba0",
      b: "2a11d8577b59c03c4f6f45356e249cfa58798d9bf44d5a495d6896492670e7c4",
      add: "34411d8bf7417c3e15a889f7efd402e5f9230f0d8ca22e29ff4ccfddc56c0364",
      sub: "e01d6cdd008dfbc576c9ff8d138ac8f1482ff3d5a4077997447ba34b788a33dc",
      mul: "ff619b839c6c233d28214b9723c18b4f44ba3c8ae8d50eaaf41aa5d4242e8680",
      d: 25939254,
      divQ: "00000006965a5b00a16628c7a09aec472933cb2791cd059d38ddc3c2a88a67d9",
      divR: 13463258,
    },
    {
      a: "1c097bce52879cedb3fe7dcc243d26c2404445208e72de015dbd5e5e5391e00d",
      b: "be7920be728045f3d43438fff9404e0ada3e4448b977ec2df0a68f97a769a5dc",
      add: "da829c8cc507e2e18832b6cc1d7d74cd1a82896947eaca2f4e63edf5fafb85e9",
      sub: "5d905b0fe00756f9dfca44cc2afcd8b7660600d7d4faf1d36d16cec6ac283a31",
      mul: "a048cb42c8f0c6d1c84adc93e472e613ea3f0e28ceab51111964bf953719ec2c",
      d: 24081107,
      divQ: "000000138886904dadbf7fcdf25b77bcb4f6addccabda33ae9beae3ec491db47",
      divR: 15435400,
    },
    {
      a: "11fa796d20a1d52c9f898910701bf56b9f4da5ee22fdc95e5608f047894a31f7",
      b: "69fa687ab33e55a9e162966e4854e7b2e69256f580174552c043cdd64e8f2f3f",
      add: "7bf4e1e7d3e02ad680ec1f7eb870dd1e85dffce3a3150eb1164cbe1dd7d96136",
      sub: "a80010f26d637f82be26f2a227c70db8b8bb4ef8a2e6840b95c522713abb02b8",
      mul: "4db8afaa9fba0db7f0d5c3d4c5246413af3afe670254f4f655c81ef49367a4c9",
      d: 156058016,
      divQ: "00000001eecb7ca2de68d1fb8f796e85722f187051e9bc8aeaad34f8f07a19d4",
      divR: 61290871,
    },
    {
      a: "e6dec74c4087d29ef894beeed85510f25239e69f600d48c6e05da3fbaf29ec70",
      b: "9bef12e24d57dc127115faaf405a2bc6de7be1d56207f7adfe97c3b99b42475a",
      add: "82cdda2e8ddfaeb169aab99e18af3cb930b5c874c2154074def567b54a6c33ca",
      sub: "4aefb469f32ff68c877ec43f97fae52b73be04c9fe055118e1c5e04213e7a516",
      mul: "32ccd827d79d1cd9289946d6f0963550d17411a6b35241e29dcd2bf6fa302f60",
      d: 268073802,
      divQ: "0000000e72e835ab9a479918fe972edb6427554788f16ce5852a6716d1ccb61f",
      divR: 53895802,
    },
    {
      a: "c9dbf0ebe752fe1875ccd0131ad6b943a8b7c6dd69db5ae4c2ce3ba24630d4f4",
      b: "6f8d4f87b6f97559b010d7342c8c133210d0bf1f87166a518cce66316737b3f1",
      add: "396940739e4c737225dda7474762cc75b98885fcf0f1c5364f9ca1d3ad6888e5",
      sub: "5a4ea164305988bec5bbf8deee4aa61197e707bde2c4f09335ffd570def92103",
      mul: "8798aff1985d2590691ff6039b7b62cffbfcca93306104da627d4fb8254b15b4",
      d: 185404105,
      divQ: "000000124427cf0782522d0ee335e3759b3dcb011c43ad6f0722845f2798f6e1",
      divR: 17118283,
    },
    {
      a: "f1dcd9c81d99726063102ee7f2cdaf954fafcae02c3e26427df774abd79f6608",
      b: "3d584d40c1bc49b879cfc0abc0b041525bc6bb467debd66548a422a9e67beeb3",
      add: "2f352708df55bc18dcdfef93b37df0e7ab768626aa29fca7c69b9755be1b54bb",
      sub: "b4848c875bdd28a7e9406e3c321d6e42f3e90f99ae524fdd35535201f1237755",
      mul: "11ec1cfc2b03f372435ee3c8ae650bed6b9cee73d1412a5db5af91272b27c798",
      d: 134616158,
      divQ: "0000001e24b2f4dd7231df2a8a35a762b6c74c5acd3b43933810add0ebb9267d",
      divR: 62095394,
    },
    {
      a: "155b253a109d6abc4007865825b6e408b3b62d40134d03700dd87a319e36b7a6",
      b: "5ce71b4960cdca16c9e562f23b66391783cf98284d2524ad7a30e8a502bf8403",
      add: "72424083716b34d309ece94a611d1d203785c5686072281d880962d6a0f63ba9",
      sub: "b87409f0afcfa0a576222365ea50aaf12fe69517c627dec293a7918c9b7733a3",
      mul: "283cfb368b0380e0eff2611fb08d5b729dd63ba52025c13d719f4a69622fbef2",
      d: 180456262,
      divQ: "00000001fc49573f877de387f4e30192ff2151b9419480beb3ae24f37634dbe1",
      divR: 163474720,
    },
    {
      a: "d6ff0196ad6121a669b4d8780d2313203cf5ef06957493d8fcdcefdb1b23c6f9",
      b: "28f580de8cbf5559a311802801a961138abac61dd35def99a76be46064c80ce4",
      add: "fff482753a2077000cc658a00ecc7433c7b0b52468d28372a448d43b7febd3dd",
      sub: "ae0980b820a1cc4cc6a358500b79b20cb23b28e8c216a43f55710b7ab65bba15",
      mul: "1f165f904810e3482b706d027e39e915019a6293c168da502d7e73768fb8e1c4",
      d: 128647470,
      divQ: "0000001c09c3d0f10d41811445317fbab7ac204904ce2ae509418d81b30e9638",
      divR: 8818921,
    },
    {
      a: "41ed7b427adeb283bc827012c9f0e4026b7152525d66def2f56d9421e2ee4f28",
      b: "78321aff283eece7bdf507546ee3409df408fe1edc896f04b3c0806a50cc5fb1",
      add: "ba1f9641a31d9f6b7a77776738d424a05f7a507139f04df7a92e148c33baaed9",
      sub: "c9bb6043529fc59bfe8d68be5b0da3647768543380dd6fee41ad13b79221ef77",
      mul: "94b3eea892a5f300f890cb69a79fec21436dc1802824d0df70e813d7ea0492a8",
      d: 263351615,
      divQ: "000000043334a777c1875e32c8fdf60266daa3df1d7fbc61d920131b0a37a13d",
      divR: 2926629,
    },
    {
      a: "e79df1d6defe578adef61df107c0081c7c7d5b961f64828d6f77ea4447d45a01",
      b: "e6bd87ac47c9dc1e65ac0367f4e3fa16bd49dd6667a0e101ba63f2aedc017227",
      add: "ce5b798326c833a944a22158fca4023339c738fc8705638f29dbdcf323d5cc28",
      sub: "00e06a2a97347b6c794a1a8912dc0e05bf337e2fb7c3a18bb513f7956bd2e7da",
      mul: "5f26a6fbcb16cf5e6d2889b53b89746fd164f4407ee86dce1162fc3eb76f2827",
      d: 12430981,
      divQ: "0000013898d81bdf2fa17a681ed1cfcbdd7972f6dc917ed5768e516b43550775",
      divR: 3470392,
    },
    {
      a: "f6134bf111c97f575b1b189e424260879d669dacfb172605bb5a39c2bcfb2da7",
      b: "9fcfeecfd70c64800a0dc36367a366587915fdafabc5c5bb73da5385f28a31c9",
      add: "95e33ac0e8d5e3d76528dc01a9e5c6e0167c9b5ca6dcebc12f348d48af855f70",
      sub: "56435d213abd1ad7510d553ada9efa2f24509ffd4f51604a477fe63cca70fbde",
      mul: "f5b2f0bcc20badd790e8ae5c9fabd7e590b8566bc319016f1c06cd63eef9cf1f",
      d: 231753593,
      divQ: "00000011d062a8b40228f3e867d8404dd7eb802998945271183d746ed7b4f669",
      divR: 231446278,
    },
    {
      a: "ea58fce5d5d381b04a4634b888b2378d9d9e32fc2a5597fa5421781657fbdbc4",
      b: "88e46d35a3e95f1e2e8943aae0892b927f80284dd4e06c0f6859bb5e8ac1860d",
      add: "733d6a1b79bce0ce78cf7863693b63201d1e5b49ff360409bc7b3374e2bd61d1",
      sub: "61748fb031ea22921bbcf10da8290bfb1e1e0aae55752beaebc7bcb7cd3a55b7",
      mul: "ff329546694d86663efd07f72dfd1d8e586de3f6a7771a83adfbc280a396c0f4",
      d: 37943702,
      divQ: "000000679e8b80fef1ce008c6ae05406e03dbf68a46f7e6492086b6febeac255",
      divR: 25121014,
    },
    {
      a: "5393300fc46ea965c02ba553312beca9410408d575bbc245b75ab79cc35658da",
      b: "2b873567807186b914214688fd4e8d30a54cc97bd0834ab1bc3efd080f9b9c69",
      add: "7f1a657744e0301ed44cebdc2e7a79d9e650d251463f0cf77399b4a4d2f1f543",
      sub: "280bfaa843fd22acac0a5eca33dd5f789bb73f59a5387793fb1bba94b3babc71",
      mul: "2ebc9000047ddb0fb3f840bf5de6207153463787000053d8e4c363a14e8d496a",
      d: 139063251,
      divQ: "0000000a15362fe159e5a7ccd9fdd2ce0ce436fc7307495db08f2c7af82f6166",
      divR: 38066120,
    },
    {
      a: "8d23cd0f9f7414803205d56817a91d5e3ff6ab62ef5678ddd6e769befc87b1b4",
      b: "ea6ace3897ece8f37813460d1635b57b6df0634ddfd9363b6cc9f7523bf87057",
      add: "778e9b483760fd73aa191b752dded2d9ade70eb0cf2faf1943b161113880220b",
      sub: "a2b8fed707872b8cb9f28f5b017367e2d20648150f7d42a26a1d726cc08f415d",
      mul: "e89d09a781ed5c93f1be55b3343c032b15c368ea59ae3dc9025fff73d23c242c",
      d: 172420983,
      divQ: "0000000dbbc2e8acef1becb987d806efd1aaa60202b05f1a244b20fb26ccc73a",
      divR: 125562814,
    },
    {
      a: "7589176c6a22fb923d7f5e2d730e7004ffa394475db37406a6c46b1e4b775b7a",
      b: "acd2972d931343d2c3bcefdb706e1fe0fd94e061be0255fbd7b96561dec29b17",
      add: "225bae99fd363f65013c4e08e37c8fe5fd3874a91bb5ca027e7dd0802a39f691",
      sub: "c8b6803ed70fb7bf79c26e5202a05024020eb3e59fb11e0acf0b05bc6cb4c063",
      mul: "93b5f281a5c6474d3686bc1a2ed3fc8389a4e4c92f57ad429b62746b2a9015f6",
      d: 194770571,
      divQ: "0000000a1fd323173eddc0953e28cacad6acfca846b7459c28b8d5f1c45def25",
      divR: 104985699,
    },
    {
      a: "dc83dbc26f46ea2f40fd7685fe96677a41bd190c7d9e9a5c5190a519bafd1b1a",
      b: "fb2988afa191741356eec513aeacd87d6805de933f6073f80d499970319958aa",
      add: "d7ad647210d85e4297ec3b99ad433ff7a9c2f79fbcff0e545eda3e89ec9673c4",
      sub: "e15a5312cdb5761bea0eb1724fe98efcd9b73a793e3e266444470ba98963c270",
      mul: "629439729065d536e9c07989cc0a7ab9aa1bb104ca1464249c52143259eeef44",
      d: 838931,
      divQ: "00001139eeb1779c3e4ecb5ba9f7bfb9009aedd115ae46e8972b994c30282a7f",
      divR: 409773,
    },
    {
      a: "b25cdc35ec6ce876923d4ade7fc46aab227ac97b6901a5c25b0ca5dd42921d2f",
      b: "efae3a3a2c06cf609afb73bc5f129cefec467ba3c316e3e5405b4c585c3f0b2b",
      add: "a20b16701873b7d72d38be9aded7079b0ec1451f2c1889a79b67f2359ed1285a",
      sub: "c2aea1fbc0661915f741d72220b1cdbb36344dd7a5eac1dd1ab15984e6531204",
      mul: "9836ee12ab698a45985124232bda4c18730888af1873d2608e393ea0885cebe5",
      d: 60517712,
      divQ: "00000031727a518fcd4c06f246fe50ff1d419774599038dcb32595dff66b0c1d",
      divR: 6748959,
    },
    {
      a: "dd3b342213eb773d1d3a85f2b3a7de9514c1e2fe56c2d060fe66d6cf3c81b865",
      b: "310011e0f3bcc72cc70fb552c192bf3158c4d1bff4d2084e7bdc226913333fd3",
      add: "0e3b460307a83e69e44a3b45753a9dc66d86b4be4b94d8af7a42f9384fb4f838",
      sub: "ac3b2241202eb010562ad09ff2151f63bbfd113e61f0c812828ab466294e7892",
      mul: "c996844c1fd4310e54abba3960c9f77d764f0bf75b1139dd33e4c6a7066ad63f",
      d: 250987438,
      divQ: "0000000ec9c5754dfb0213400f7cbb36c66da9437ab6d585c5e2d4ca52826737",
      divR: 161328131,
    },
    {
      a: "75c9914bc6f90020e14a5e713facc4de4d11b361360ee6e9a8b94d9ac6d17845",
      b: "13e2d7e855184b8042024f5305d830be6637dad5391bc096268afdbf14f0db6a",
      add: "89ac69341c114ba1234cadc44584f59cb3498e366f2aa77fcf444b59dbc253af",
      sub: "61e6b96371e0b4a09f480f1e39d4941fe6d9d88bfcf32653822e4fdbb1e09cdb",
      mul: "68bbd4bfae1649ce573fe4d4a162ed57a75dee14560e8209a817386ca94ed392",
      d: 51855150,
      divQ: "000000261be2bcfef03d3b6f391050e7596bddeaa9ef9f22e6aa31f25bcfed43",
      divR: 34363707,
    },
    {
      a: "b975dffccd0397adc0fafb6f283e8dc829fa2c210da3a665081b2dd7b9a22ad7",
      b: "d5aff08501ef8573f1ce90f2eda878e1e3bb355952fbaef714ca6601822c0b95",
      add: "8f25d081cef31d21b2c98c6215e706aa0db5617a609f555c1ce593d93bce366c",
      sub: "e3c5ef77cb141239cf2c6a7c3a9614e6463ef6c7baa7f76df350c7d637761f42",
      mul: "028842efda8c6e40c01132b1d0679091630e30e1f65c20a8407c0a008e2e2c23",
      d: 239878854,
      divQ: "0000000cf89ec418e07d85706fd3e8c7c9834f11e886bce2ac9044b6558b8644",
      divR: 48941631,
    },
    {
      a: "8cb7e334ecfd1be700c372deda916d61d0201421fbbe94e8b915f31a1e2d35dd",
      b: "732e765097428c97dd05cede55e250d97a8ae8f6a08fb356b5c02cf8f1f783d6",
      add: "ffe65985843fa87eddc941bd3073be3b4aaafd189c4e483f6ed620131024b9b3",
      sub: "19896ce455ba8f4f23bda40084af1c8855952b2b5b2ee1920355c6212c35b207",
      mul: "5861111a6ef06e554393524758cd0f31a3b8330f8e910602c0296cb261961dbe",
      d: 36760092,
      divQ: "000000403936cdf9edc60bdf33428fba7942cf4e5233657de0317838966f4577",
      divR: 3331801,
    },
    {
      a: "01042f480ce832910d863019ddf77dce88dd8472783e1524a5d5f80ef38ec720",
      b: "89c3d4b9f5fdcbc60c179b156196aa5cd590c1aab87a2a16abc239214b137233",
      add: "8ac8040202e5fe57199dcb2f3f8e282b5e6e461d30b83f3b519831303ea23953",
      sub: "77405a8e16ea66cb016e95047c60d371b34cc2c7bfc3eb0dfa13beeda87b54ed",
      mul: "535fadf62798b0b9aa46a1f68fc77fb16e4ac64d251c22d1928bc67f417deb60",
      d: 223805715,
      divQ: "0000000013811a183adbd541fef54bb6455a680d3fecacecf59ab1b96f198d59",
      divR: 215806085,
    },
    {
      a: "043945b64596f1100b400a9a65c016b7b4fef4932e1a28b282ad2538aef9ef85",
      b: "6dfd5a7565528cc0ed7489d4e6def861d0158f130b880924e9db2fc56fc645a9",
      add: "7236a02baae97dd0f8b4946f4c9f0f19851483a639a231d76c8854fe1ec0352e",
      sub: "963beb40e044644f1dcb80c57ee11e55e4e9658022921f8d98d1f5733f33a9dc",
      mul: "462694c75ea4ea6fe41cd8ca498dd62cbbd896e37f02b361ca214a17cc6bf7cd",
      d: 77713022,
      divQ: "00000000e96eb35f6fa8c629a27563961bb6aa092177b70fbe31aaa6f97941f5",
      divR: 52646639,
    },
    {
      a: "a4945cab468ed20e74098c5df57a75d339f63d5d329b99c449e65c15cc5575c8",
      b: "3ad3ff64f80934ba59e99cc4abe355dd17c7f7b7a6fcf55e36d779d55d6d2e64",
      add: "df685c103e9806c8cdf32922a15dcbb051be3514d9988f2280bdd5eb29c2a42c",
      sub: "69c05d464e859d541a1fef9949971ff6222e45a58b9ea466130ee2406ee84764",
      mul: "bdf0a4efed7df5e7945928612e5070507ebb8ec64168b242e5c976cffab3f220",
      d: 48849647,
      divQ: "000000388630f9e64950c01e464e1154dc892a8cc0fd9f1338431ad402753fc8",
      divR: 23878160,
    },
    {
      a: "36468d1fa5a7c3bdeb99e48272fea5931a67565d9131bfcb21ea75715d12cd99",
      b: "7ebbb5826a69ffee21b312936ab795fd4f5fd3f27c7e50b658cb39018543e561",
      add: "b50242a21011c3ac0d4cf715ddb63b9069c72a500db010817ab5ae72e256b2fa",
      sub: "b78ad79d3b3dc3cfc9e6d1ef08470f95cb07826b14b36f14c91f3c6fd7cee838",
      mul: "5751e44a63d29d37a6db942f901c75264d3e08c9071303356417e78b6214c3f9",
      d: 77904185,
      divQ: "0000000bb04a279bb1deee292091d885d4324d40f1641615f804744c0ab0dea2",
      divR: 50735495,
    },
    {
      a: "39efbc7c2f2357fad5ba5651b62fbceae345d2daa102d3a5c6ce09cfc955d1aa",
      b: "be0700e3a60d6dce65e6ca30229a129ce2c2706b2d50fb3a9940449c7cf9a345",
      add: "f7f6bd5fd530c5c93ba12081d8c9cf87c6084345ce53cee0600e4e6c464f74ef",
      sub: "7be8bb988915ea2c6fd38c219395aa4e0083626f73b1d86b2d8dc5334c5c2e65",
      mul: "69441d7be8abdd35b011b89e82f8c181ddf7d31f07a2becc76e543d22efac0d2",
      d: 114271241,
      divQ: "0000000881958ac519e0eea4c8643089ff5b9278072a28bcf137bc15a46efe5e",
      divR: 75016284,
    },
    {
      a: "2bd6169f420f73665ae850ff7333a0783719d18c9f156e51b23c5889d0107fbe",
      b: "6468331be0db445569bb9b43bf2a8a43e7598c0396cdf93d15258812a6760cef",
      add: "903e49bb22eab7bbc4a3ec43325e2abc1e735d9035e3678ec761e09c76868cad",
      sub: "c76de38361342f10f12cb5bbb40916344fc04589084775149d16d077299a72cf",
      mul: "d170dc5d29c9368ca054d2b28dc6184dc65125124a013736d869a4361af82a62",
      d: 236388565,
      divQ: "000000031c773cb9042ea9799535138a0baa73278d4ed35c83696b685e1bdf08",
      divR: 153611798,
    },
    {
      a: "52098ca5dc886fa708b873a8bc334036e7516b745035c9a2eae5f4b03aefe88c",
      b: "e307f7c47c69143caedd27350e8e4b3c82fef57248241b2eb06851bad4b5ad99",
      add: "3511846a58f183e3b7959addcac18b736a5060e69859e4d19b4e466b0fa59625",
      sub: "6f0194e1601f5b6a59db4c73ada4f4fa645276020811ae743a7da2f5663a3af3",
      mul: "8a86cb5f01a534a991b06d39623c7612e346816eba0e17832ef5ef12b48497ac",
      d: 32871275,
      divQ: "00000029df0299e267c908498c64d112e9024e46b905715cea90a98c0c18a1fe",
      divR: 25778530,
    },
    {
      a: "797b1ce4c7f836033b9d1f5218441c5f6bd0299c03746b2a07be3c00d09b7f72",
      b: "0038bbf3c727e23337f1f9f9e5e52cbd31113245120e6681bbba2b5b441ab84c",
      add: "79b3d8d88f201836738f194bfe29491c9ce15be11582d1abc378675c14b637be",
      sub: "794260f100d053d003ab2558325eefa23abef756f16604a84c0410a58c80c726",
      mul: "288f982f7f90eb40c773df39e9aaf9a68de60518b4f49a267b9b5758eb57c5d8",
      d: 144847368,
      divQ: "0000000e121cd57085a02207df64f207a070eaf5637ddbaa1ed9c0d0a7ab4ad8",
      divR: 32700594,
    },
    {
      a: "7a7f8c6bc295cd6f6bc0fc8986774b3c4335cd342602ec6c7fd3d7ca04d5bf75",
      b: "cc029ee9225b433c332853fac718f5ca0d3a244e2b756699baa915f0f00cb5a9",
      add: "46822b54e4f110ab9ee950844d904106506ff182517853063a7cedbaf4e2751e",
      sub: "ae7ced82a03a8a333898a88ebf5e557235fba8e5fa8d85d2c52ac1d914c909cc",
      mul: "84e50872f9e24f08fbe5711c3cde6c75e89b12159eb2cb2a23c0fdfafaf51d3d",
      d: 247055381,
      divQ: "0000000851964361724a81bb6b717dea85052c2d191b871949eea9952f98160d",
      divR: 118815844,
    },
    {
      a: "f7c53878fe2d4c3c12f6c5a42bca0fdaeb5e91176dde5f35d13446629cfcb5e5",
      b: "be44d0ec19450aa77b472030cd8007701f75889c249e870a1c593b3be3c249ed",
      add: "b60a0965177256e38e3de5d4f94a174b0ad419b3927ce63fed8d819e80beffd2",
      sub: "3980678ce4e8419497afa5735e4a086acbe9087b493fd82bb4db0b26b93a6bf8",
      mul: "7e9aa26903dfea3007b62853827ab856fa44eb2f61286a1c122d07a24c5cb201",
      d: 231516266,
      divQ: "00000011f48158c758b1f95f362528d5354a436a488bb42a2b0f7951d7deb82d",
      divR: 84601667,
    },
    {
      a: "fe1d87906626703fe82ad70da73b5f6b24aa9c4c48c061395108fef5bf1ac98a",
      b: "7d3e9427fb1a9e93c7fb36e634e5c85e5e5465c2122fbff97b48fbce740a1578",
      add: "7b5c1bb861410ed3b0260df3dc2127c982ff020e5af02132cc51fac43324df02",
      sub: "80def3686b0bd1ac202fa0277255970cc656368a3690a13fd5c003274b10b412",
      mul: "0f396b4006cda84c0385a9f35f3a1421b68c902d08063c1c114bc1492e7acab0",
      d: 219878953,
      divQ: "0000001363b7ced5093bb20a3f84d77cca5e6428835370b50bf6531ce06cf742",
      divR: 40993784,
    },
    {
      a: "431a43d230e6591c450e60167404f376a20a448e737454fad21bc4972dddbfc8",
      b: "6f57b540eacfb3c79f4b3ce08fd38218741563b4afc268781b80a8a42b460bae",
      add: "b271f9131bb60ce3e4599cf703d8758f161fa8432336bd72ed9c6d3b5923cb76",
      sub: "d3c28e914616a554a5c32335e431715e2df4e0d9c3b1ec82b69b1bf30297b41a",
      mul: "b262dbf8e295125c7516e67472f76b4ef46bf4518a3e45ec0a4703b2bca5f1f0",
      d: 152071989,
      divQ: "00000007672d85dbbe9acf86125916f45f410e4fee15d2d5e7d3c5683d519767",
      divR: 98811509,
    },
    {
      a: "dfb01910d1a470254534ddddedc257af013f9808d511a4bd034e15c815916766",
      b: "7349c0a16ecf6fa17e5aa4d0002b9436378d4ac07334d5057166d54485273e0d",
      add: "52f9d9b24073dfc6c38f82adededebe538cce2c9484679c274b4eb0c9ab8a573",
      sub: "6c66586f62d50083c6da390ded96c378c9b24d4861dccfb791e74083906a2959",
      mul: "119519f4141f8e52366f3a665cf0c86ff8b6ed58750023454738b9590df6f42e",
      d: 160241272,
      divQ: "000000176b88efa104f32598225c4e841bded8d1a1f872149b36505e8a72b5b1",
      divR: 145884782,
    },
    {
      a: "21431727865dee3655415ee94a0129287f12480b85a24319a51302087372c6b9",
      b: "76fef402d6b9e4eef5c4ae6668f5330745eec67895103e95b34c737ba7ecbbca",
      add: "98420b2a5d17d3254b060d4fb2f65c2fc5010e841ab281af585f75841b5f8283",
      sub: "aa442324afa409475f7cb082e10bf62139238192f0920483f1c68e8ccb860aef",
      mul: "a5c960805abd06643c67ed191ed2bd23bbc2da0a03260649e7ecaa54d145f0fa",
      d: 133733107,
      divQ: "000000042c3e50d2253ec9701f764810bcd2c89761bbad88cbd3c820b5c17627",
      divR: 83110324,
    },
    {
      a: "80bc25711a580b1aa4116b3c16854413899cc902139eae590e80087054806a93",
      b: "6615fea69c058c89392f6916b9f1436cb49669568a27b8718dd3eb240cc15293",
      add: "e6d22417b65d97a3dd40d452d07687803e3332589dc666ca9c53f3946141bd26",
      sub: "1aa626ca7e527e916ae202255c9400a6d5065fab8976f5e780ac1d4c47bf1800",
      mul: "ede313719e6a00d56c60756d5c7e876a2de0b6012e56f37f88eb7b0ce4b34869",
      d: 22084616,
      divQ: "00000061cc1677526d1634daede94b6e75779d0ba4e34d15d15e25f884bb7082",
      divR: 21294723,
    },
    {
      a: "1e2d60a26d8aa99ed9b61840c2df8dd06ac7c9ec706c6a5eb45c2c0df5d0ccff",
      b: "7452134002f3c39043b0577e39fd5394ef9ff51b79f2535ce806874944415482",
      add: "927f73e2707e6d2f1d666fbefcdce1655a67bf07ea5ebdbb9c62b3573a122181",
      sub: "a9db4d626a96e60e9605c0c288e23a3b7b27d4d0f67a1701cc55a4c4b18f787d",
      mul: "b654fc0cbdd840f1a104fb1c2bac88907daa94d2e614a04cd4b8c1ee200ac57e",
      d: 214544734,
      divQ: "000000025c1e32817d1ce7fb5cb1ee24c09f2e0a49091fb3ac6e243b82fd4fea",
      divR: 30583571,
    },
    {
      a: "9bbdd4be4005e66f3064574f4ff398c98b39c4721ad561771177b16021992c0f",
      b: "7fc1e84095d732b584ec6d6fa8b8eedfc82423c7b61c691f61f9c3ebadb91d0c",
      add: "1b7fbcfed5dd1924b550c4bef8ac87a9535de839d0f1ca967371754bcf52491b",
      sub: "1bfbec7daa2eb3b9ab77e9dfa73aa9e9c315a0aa64b8f857af7ded7473e00f03",
      mul: "4c789dd49dd89fa85fbed40951c3398126f302d8dc5ed24193a2dd8be702c3b4",
      d: 61390488,
      divQ: "0000002a8fe7054aa5914b3a1005ba67fca59db50450e4839c73339a775c30e9",
      divR: 44512183,
    },
    {
      a: "cc43aa249f698746248ff99d78c4b051cb591f6d6399da7cc479e3a1824159b4",
      b: "b1ef8967a7a61ec6630b16cca3066ebecce1dfd13747e5a1a1e975983b11c049",
      add: "7e33338c470fa60c879b106a1bcb1f10983aff3e9ae1c01e66635939bd5319fd",
      sub: "1a5420bcf7c3687fc184e2d0d5be4192fe773f9c2c51f4db22906e09472f996b",
      mul: "654b2a2129cadfc0a7d3f584ddef6fabe14922e119e41203d5da47a298dd9454",
      d: 188777916,
      divQ: "00000012274e1448ab74b22fd916feacf0844c7b989974c3aa876542f8dd6f9e",
      divR: 52841388,
    },
    {
      a: "949201b86b815f63d003e3b7a842b18405a03c00a5eb9a8acc3933a4c1823c90",
      b: "8f344392ca933d0d22890e0a54abc840865bfa5f46dfa0fe74237a0591df0f11",
      add: "23c6454b36149c70f28cf1c1fcee79c48bfc365feccb3b89405cadaa53614ba1",
      sub: "055dbe25a0ee2256ad7ad5ad5396e9437f4441a15f0bf98c5815b99f2fa32d7f",
      mul: "cf20d50c6ab7de65860c2c0dfbb1626540967ea58cb9c6d2980a38d7cca27590",
      d: 159061620,
      divQ: "0000000fabaec426c26aa72379bc320816b678409e3d82055dcbafeb334adae1",
      divR: 28096668,
    },
    {
      a: "cf5055137e03e27fb0f1e13be12fa46f078a25206124f9ee722329e351c2b55b",
      b: "9160ad80aaacf38fd0d2c02631b0bb077c82736184bd8448d0a9254bb69dc304",
      add: "60b1029428b0d60f81c4a16212e05f76840c9881e5e27e3742cc4f2f0860785f",
      sub: "3defa792d356eeefe01f2115af7ee9678b07b1bedc6775a5a17a04979b24f257",
      mul: "dd779431081d4f6f9d031eb86c4b9924a8640f4c8ea4c2e89f52a8d581fe266c",
      d: 28276316,
      divQ: "0000007b01765108fe95a1b1f9e71a75917cce3c5cc7f8326a0c6ed62c51126d",
      divR: 10410031,
    },
    {
      a: "397d11b01f8df6153c2cb64ea9a3257c5ce88bf23e0909447bf47477d590b692",
      b: "7a97a084aed76cb8dd3f6066ab1ccdb44633d46d3b6fbe0aec8808155c3a7394",
      add: "b414b234ce6562ce196c16b554bff330a31c605f7978c74f687c7c8d31cb2a26",
      sub: "bee5712b70b6895c5eed55e7fe8657c816b4b78502994b398f6c6c62795642fe",
      mul: "0f73bdaae1e5f4a03f1b4beac144ff90d33b38315824b5e88daf18974ec12268",
      d: 127823073,
      divQ: "000000078baa6bf9dbb86c5973c1e258d80df2f2e45f107724aacf0ec42ac344",
      divR: 27420622,
    },
    {
      a: "5e439e58ce776140a6244fc0b5944a30f7fa106d7e07a92ed8f14a3ff0212c38",
      b: "62ea62f7dab7d0d50c083b07c00cdf97dc1216ed2bbadaeecdf195cb2d7ca8c8",
      add: "c12e0150a92f3215b22c8ac875a129c8d40c275aa9c2841da6e2e00b1d9dd500",
      sub: "fb593b60f3bf906b9a1c14b8f5876a991be7f980524cce400affb474c2a48370",
      mul: "b2517dc1e8281e5296e93156e1b38624767e3906440ded0f3b2cc4c8a20f4bc0",
      d: 33876105,
      divQ: "0000002eaf3ccd5bb1cd6b54501b4df04a53f69f86354c95e12a2152f33dba74",
      divR: 21972004,
    },
    {
      a: "3ab257986e7b9834c8d37ecf9c35e9f70d27b079ecd4ea49f5c9ad866927ce2d",
      b: "38280de068c2ea0b49f478d1b3adb59eb8cd557f373c4d0b7452330166bab356",
      add: "72da6578d73e824012c7f7a14fe39f95c5f505f9241137556a1be087cfe28183",
      sub: "028a49b805b8ae297edf05fde8883458545a5afab5989d3e81777a85026d1ad7",
      mul: "c17dac945b807a1ad8d095f6a683df73787083703c57ecf4fd484eece33aba1e",
      d: 240408184,
      divQ: "0000000418a24bd200861cff74fa8a3b7c96e86827a020e94c26e61edd9f72f2",
      divR: 40149181,
    },
    {
      a: "b3a0a56ee8e74aea76380675d4b0c3e65449d0296cfe0fab0a94b6c4102420c3",
      b: "480a4fc5b3448ba9b61ec3143a89a05fccd9881988e3ce172052ef5763c30dc8",
      add: "fbaaf5349c2bd6942c56c98a0f3a644621235842f5e1ddc22ae7a61b73e72e8b",
      sub: "6b9655a935a2bf40c01943619a2723868770480fe41a4193ea41c76cac6112fb",
      mul: "d356293ea53c6d5ca55409c8510984c7941a7a0dc82a3201f0603173cf6c7f58",
      d: 177278023,
      divQ: "00000010ffe3ad373c40e6b4232af3cc2baf028e65c734e3eac5ef1efe01d2b7",
      divR: 135994370,
    },
    {
      a: "76354d946f796137ee7729e35c897bf90ba8369bdee3db791906867ad0650724",
      b: "5259548eb81b0d39b8cc16fb88c2fcadcf4210c4be8641ad087a83f33709c3e4",
      add: "c88ea22327946e71a74340dee54c78a6daea47609d6a1d2621810a6e076ecb08",
      sub: "23dbf905b75e53fe35ab12e7d3c67f4b3c6625d7205d99cc108c0287995b4340",
      mul: "2def82f691825a5cd7024541a3d2ed6865736c7bc3b9ecf3690b8d608aaec810",
      d: 318264,
      divQ: "0000185751dcaf4eae3cecab3a5faf2f6719d87528c652b1127b60998433777b",
      divR: 43836,
    },
    {
      a: "fdcfcd3236d18de8e189199aa40520e54dd79faad1fdfd3f89f5d7ecc6d3dba4",
      b: "9940acd5140c5803d79a2d472021b1782c7421093b782599614cb7815ff4b4f8",
      add: "97107a074adde5ecb92346e1c426d25d7a4bc0b40d7622d8eb428f6e26c8909c",
      sub: "648f205d22c535e509eeec5383e36f6d21637ea19685d7a628a9206b66df26ac",
      mul: "886b1f585f9db6adaa2acd0992d749af03127d9340fa129528e5b340c7fc16e0",
      d: 163323815,
      divQ: "0000001a128cf014efcf6e5d28f87ccc1a3230e9b9e0f1a6ba437c498ac5aa40",
      divR: 155454436,
    },
    {
      a: "62d10b7c89eeaa1993e4bc0b0c38088b382fb9bc87cc235dd836377949a0414d",
      b: "57faf1d78f3f9b2b38de7caf5b8d1c88505c68d029071df2643e75c85ef383c9",
      add: "bacbfd54192e4544ccc338ba67c52513888c228cb0d341503c74ad41a893c516",
      sub: "0ad619a4faaf0eee5b063f5bb0aaec02e7d350ec5ec5056b73f7c1b0eaacbd84",
      mul: "9679583cd6c084af4e840f29d7125d1a9b386c9a7daf95ab59cf8f281254ac75",
      d: 189683318,
      divQ: "00000008bd7cb5a201a35f5a74451cae8157fc7723530f118e00ab72ab7e0df7",
      divR: 110286707,
    },
    {
      a: "e9da79bd92e5aeb0eca8808d140e40558a9f07cbdefc2b4f1df5132029ef69f3",
      b: "a60b93ae4bdd28e55ffbaf9bb75324972011937896864af9f4be9eaf6fe580e3",
      add: "8fe60d6bdec2d7964ca43028cb6164ecaab09b447582764912b3b1cf99d4ead6",
      sub: "43cee60f470885cb8cacd0f15cbb1bbe6a8d74534875e05529367470ba09e910",
      mul: "4980170cf8137ad1e94f07b1e3b1dbf4cddc3e0646e28e8cd43bc3b407a37279",
      d: 140095333,
      divQ: "0000001c015a2d545ff83071e109cc3357ffdeed1b31508da6f0953d18f7f7d4",
      divR: 83670863,
    },
    {
      a: "f1e93a1eab6e97460297fc34cb68e68e16bcf7f727ae5c0cd0b14349110e8da5",
      b: "50a5c7f0ccc952aec3a316779036f2396e40bc6aa3cbfdf2650a7563a5349451",
      add: "428f020f7837e9f4c63b12ac5b9fd8c784fdb461cb7a59ff35bbb8acb64321f6",
      sub: "a143722ddea544973ef4e5bd3b31f454a87c3b8c83e25e1a6ba6cde56bd9f954",
      mul: "343d6cefc87c86c53be0aa1dcde648f0326bc1ab5ff6f68f26a19009ee023535",
      d: 261079948,
      divQ: "0000000f8b9fbc5c870b5d29ff3b50162c1aeb765e8c526f33c6d91dec612c24",
      divR: 53411317,
    },
    {
      a: "d86fc4c16b3931c2087dc7589eafada2e54775a6329708e8e0c5dc492eeac4de",
      b: "f93d06d748bfa4d7454d191539dd2a979a847bbc8554c8beaa622d0df2f00662",
      add: "d1accb98b3f8d6994dcae06dd88cd83a7fcbf162b7ebd1a78b28095721dacb40",
      sub: "df32bdea22798ceac330ae4364d2830b4ac2f9e9ad42402a3663af3b3bfabe7c",
      mul: "be7a343a2a6bf8c81ef408bc0313a2880a323b80b0a9187bd160fa95e29c90fc",
      d: 227009730,
      divQ: "0000000ffeed1e75dd7ccc1ba85c4a48319c1bf68b07645593af5044c805c473",
      divR: 133200312,
    },
    {
      a: "24608cae7cd1496e5a41b3060f89e3422e807c2aca386f378aa9e2af1bf389c5",
      b: "c06f3aeb44eda82c0c4e81ce70e27df1a7ef733efb57158580a0a5afeeea03a9",
      add: "e4cfc799c1bef19a669034d4806c6133d66fef69c58f84bd0b4a885f0add8d6e",
      sub: "63f151c337e3a1424df331379ea76550869108ebcee159b20a093cff2d09861c",
      mul: "de88612c39289112225876a8798c447761417d4871ac8e7c3641d0496275420d",
      d: 30994005,
      divQ: "00000013b0ee74a35da832eb6d83d16fc2f4041e2f3774e94888dab2ee0f2934",
      divR: 12354433,
    },
    {
      a: "6aae1848bebe7c9f7d28b74424ec76815ff883fdbf6555881d0475cd72d590a7",
      b: "492662fc3a3c35e3a3f767d56485a56690f0fe38e357a122b05dc849340dee24",
      add: "b3d47b44f8fab28321201f1989721be7f0e98236a2bcf6aacd623e16a6e37ecb",
      sub: "2187b54c848246bbd9314f6ec066d11acf0785c4dc0db4656ca6ad843ec7a283",
      mul: "836d07fb966efaf12f4d1686b99fd2a69ca9b21db88dd4c8e57b7f7ff6fe997c",
      d: 106010657,
      divQ: "00000010e21675d49a5ec341dc9b46d95862cab2b8f5416e2dabf7784edcc4fa",
      divR: 72465517,
    },
    {
      a: "597e0b36433579cf743b0c5ea5d1ca2d2410ad8e79b408a71ba00512a96e3047",
      b: "beb875510ce4e7a8ec33f30d68c0b488f9f9dd3bb3c3b4a9b84ea554826c81af",
      add: "18368087501a6178606eff6c0e927eb61e0a8aca2d77bd50d3eeaa672bdab1f6",
      sub: "9ac595e536509226880719513d1115a42a16d052c5f053fd63515fbe2701ae98",
      mul: "81a5771e54f7e57cc98fa7f8a658dc1032352c9c54f757b57dc2e86ec49ac789",
      d: 1492040,
      divQ: "000003ee4b8f981b8734f30e8699f375c7783a14bf812b488f3589c6c6c59ca2",
      divR: 137911,
    },
    {
      a: "b1b4a0f9e64101543e4fcf80f209e15180063c3ae1279a95bca9835e00565fc4",
      b: "74a1bc74a5c1fa624cd9c17e649f4d6120ce19f51f86c2bb934486e86e228eb9",
      add: "26565d6e8c02fbb68b2990ff56a92eb2a0d4563000ae5d514fee0a466e78ee7d",
      sub: "3d12e485407f06f1f1760e028d6a93f05f382245c1a0d7da2964fc759233d10b",
      mul: "17141e8bf028eead386c0b8fad5e8cd6d4bfa657b0201749b4769d5d1791eca4",
      d: 52236691,
      divQ: "00000039132de8d234cab7e1111cf33702c093cbd87009afc17becdba18a4940",
      divR: 47255556,
    },
    {
      a: "7333bb9de99fff258c35555ed9d54135c115e7bc00bf9de741436ec529e2f61a",
      b: "56622fef8588b530426de4210236c990fad887740f4a492b4dbe803a88553dfd",
      add: "c995eb8d6f28b455cea3397fdc0c0ac6bbee6f301009e7128f01eeffb2383417",
      sub: "1cd18bae641749f549c7713dd79e77a4c63d6047f17554bbf384ee8aa18db81d",
      mul: "4eb4533c95d44b6d4697226c83ccf9840f3c71bf1ddc6ec88885b0d3009369b2",
      d: 139353337,
      divQ: "0000000dde9bd4b2a5eb8010642b85645f6baf5a1bee8bd040e09351de21459e",
      divR: 6125420,
    },
    {
      a: "6826d8186cab7f87a061a664c89d5acfa2dec78f7ed41e8a3766ea4608bfbbe9",
      b: "f38deeae355256d122dfe4d067ed7616e76f1cb2616530f7fce68b57555c389d",
      add: "5bb4c6c6a1fdd658c3418b35308ad0e68a4de441e0394f82344d759d5e1bf486",
      sub: "7498e96a375928b67d81c19460afe4b8bb6faadd1d6eed923a805eeeb363834c",
      mul: "e65c4a4a07c7eff2b5d99d21d80d3d0b3e68b44ffdb3474032f62c58336d35e5",
      d: 161892934,
      divQ: "0000000acb1ca683b34b018bdc03c9d95d6acaa5874f19754ee60db21d9bfc26",
      divR: 43109765,
    },
    {
      a: "9ac2082aeb2ed34cfdd9e68901360a69eae0c703230135bf12f7429d6600f37b",
      b: "4cb0b383998a463521c69a67b00d6589d184a09281d9ecd3abc737ad19e24a3b",
      add: "e772bbae84b919821fa080f0b1436ff3bc656795a4db2292bebe7a4a7fe33db6",
      sub: "4e1154a751a48d17dc134c215128a4e0195c2670a12748eb67300af04c1ea940",
      mul: "a28b778723e354fe40ef0e6d275a2f66843fc178b3bf575896b8f57fbe2fab59",
      d: 221116110,
      divQ: "0000000bbe0614a811a941a9375d0ff0becb81779763c05b85fe6e9033e46d74",
      divR: 27224099,
    },
    {
      a: "fb4424df3d7abe4a4929ff24cd27ca1212110dab2c0350b649f50c1739689e98",
      b: "779a70e0ad3375de0aed0685f31607fd1d696ff814e16c8793b7b4d78ebcd91c",
      add: "72de95bfeaae3428541705aac03dd20f2f7a7da340e4bd3dddacc0eec82577b4",
      sub: "83a9b3fe9047486c3e3cf89eda11c214f4a79db31721e42eb63d573faaabc57c",
      mul: "2d52419cd3fb84be56426bc397be07f3258fa2801335f02bfdfb44a8bd8030a0",
      d: 236622054,
      divQ: "00000011d0c684e4a7446a7aaadb0aa4b067bd24e89faca15c9331a99c5e03ad",
      divR: 88998186,
    },
    {
      a: "9fa988ec17b202d5f0155b392fd32e1ac25e9be4e871d42362d92ab83378eaf8",
      b: "f066c890de189aa86fbb59d21d63adc3422fa3a92190d7c3cc9577683a7e4882",
      add: "9010517cf5ca9d7e5fd0b50b4d36dbde048e3f8e0a02abe72f6ea2206df7337a",
      sub: "af42c05b3999682d805a0167126f8057802ef83bc6e0fc5f9643b34ff8faa276",
      mul: "9844d461bf7c02a21b793370cfbe5d2d6af2c3082288169e894ef783fb8d11f0",
      d: 85814980,
      divQ: "0000001f36f5e8fdb695d4edc9a9a8c11bc56475bf4940248850e2e965558eee",
      divR: 60242112,
    },
    {
      a: "f83cc7efb87a15d756c8d2f2049c418af464e75da1db46c39248bdde2bbd6f9d",
      b: "28d6f3470470772ded4931d0577e2c785e47c8040ddcbe3a5f15b7e877471f67",
      add: "2113bb36bcea8d05441204c25c1a6e0352acaf61afb804fdf15e75c6a3048f04",
      sub: "cf65d4a8b4099ea9697fa121ad1e1512961d1f5993fe8889333305f5b4765036",
      mul: "10f0ed4e90dddeb02e157680bfa142a1eab3b0ee32d11ef9128cdd637946eb2b",
      d: 70987364,
      divQ: "0000003aab2cbcd31acdc8a9546423b515edc45a5a4a2ffe2b395f59c3563582",
      divR: 58535125,
    },
    {
      a: "d416c670eff8694ac2bbbd1197498bb26563b29b3f0b8eddeb8e78543fb05afc",
      b: "fb7abe9021b48e7d9d6626505508eceb45e0781e67a808ca43b71599022b4bb4",
      add: "cf91850111acf7c86021e361ec52789dab442ab9a6b397a82f458ded41dba6b0",
      sub: "d89c07e0ce43dacd255596c142409ec71f833a7cd7638613a7d762bb3d850f48",
      mul: "0dba5cbc9c36a0716d025ea8f3ba212864d12050d8625337c21469d6b2fbcd30",
      d: 147434421,
      divQ: "0000001822716a4bc8dd923d65e9fbd0d5c54b10eebbd5fee53fea9db9e88263",
      divR: 125372925,
    },
    {
      a: "8f359e9212b45e4d443ca524f9a9b4dcec7b2dc87bb3a059f7436f99f1923892",
      b: "fd13954a286736426fdd16525e1e3e6cf47ec8ffb40c15fbc88c02d2806895a4",
      add: "8c4933dc3b1b948fb419bb7757c7f349e0f9f6c82fbfb655bfcf726c71face36",
      sub: "92220947ea4d280ad45f8ed29b8b766ff7fc64c8c7a78a5e2eb76cc77129a2ee",
      mul: "ff294d94ca4f408fdc07b1ef43e1beb52fe1d431bc89cb3944b6e3acd7e93788",
      d: 109933035,
      divQ: "00000015db0aa8931553544032fb3922c759e775a9b729a66b7542cba92c9215",
      divR: 94100043,
    },
    {
      a: "61c32f41e8862ee3ecfbc5019d2dd155cb6b5c2ca0759dcd0dc70edb7a24a7ea",
      b: "75d86a870d0f6f0011667643cb3834724d710ed86e44cebaa5fe16fe25449e81",
      add: "d79b99c8f5959de3fe623b45686605c818dc6b050eba6c87b3c525d99f69466b",
      sub: "ebeac4badb76bfe3db954ebdd1f59ce37dfa4d543230cf1267c8f7dd54e00969",
      mul: "cabd1081bfbed6d96a8ae26f3871ec2cc063d85c5e4b37b93a666628984308ea",
      d: 45479014,
      divQ: "0000002410885c1cf5fb2933373dac142add121aa09b54cf826ab1182fd152b7",
      divR: 8668928,
    },
    {
      a: "8f9f54ab258005f5c9943c2901f75646c1d535c202cff27c79a094892ec6b1e8",
      b: "4930102d5d11246e160e30ad36a88fdc895a389d2d4e087257eb70f71c4dcf25",
      add: "d8cf64d882912a63dfa26cd6389fe6234b2f6e5f301dfaeed18c05804b14810d",
      sub: "466f447dc86ee187b3860b7bcb4ec66a387afd24d581ea0a21b523921278e2c3",
      mul: "d62f81f500d78ddfa2abbf7c4a60d2c0cbc65839b4581ce0523458b74f5a4e88",
      d: 147653407,
      divQ: "0000001051b6570cffb252eac0dfc8aad6c1f7df8d87ac4a202e42d0fc7b6dc8",
      divR: 6491824,
    },
    {
      a: "746d6c7c05bf156d2895b5d6b3eb33cc99ac71862e7f901ddad01683c85bd2f3",
      b: "e8458ed12d0952178e60101e01ae6580f6c3ce973c4e64ace0359514ad09cab5",
      add: "5cb2fb4d32c86784b6f5c5f4b599994d9070401d6acdf4cabb05ab9875659da8",
      sub: "8c27ddaad8b5c3559a35a5b8b23cce4ba2e8a2eef2312b70fa9a816f1b52083e",
      mul: "4301e8e7dfc11abda25e32f12dadab1388da2276a9ebb510252eea09beeae3cf",
      d: 76813553,
      divQ: "000000196df202c13ec6772a789e74cf6d00e04f247f99863303ab2639018bcb",
      divR: 27221208,
    },
    {
      a: "fd5368bc0f45266b0f03e6cfe2c9589b08cf608b967daf225a1066db70111112",
      b: "57d3a3230937ee4d884869603a88650767e651073c07b89033386476a5079076",
      add: "55270bdf187d14b8974c50301d51bda270b5b192d28567b28d48cb521518a188",
      sub: "a57fc599060d381d86bb7d6fa840f393a0e90f845a75f69226d80264cb09809c",
      mul: "b51a78018bc6cd73f71ce6204200cf96abf80f581edcaa6ba11ecef352f5fe4c",
      d: 26617581,
      divQ: "0000009fac38568c25f9160665df10afcb8a7ec3f53cfdcaa0917921aceefb80",
      divR: 8207250,
    },
    {
      a: "03eaebd99874f250256730c6f11660d2bee63c88b26e636602fd8afb2d6908a6",
      b: "f83ef57a33d10fbab279af0593d1c939fda50c106c86798e5d59b75635f5259f",
      add: "fc29e153cc46020ad7e0dfcc84e82a0cbc8b48991ef4dcf460574251635e2e45",
      sub: "0babf65f64a3e29572ed81c15d449798c141307845e7e9d7a5a3d3a4f773e307",
      mul: "c09465b57f4ca0b620586edcbdc4d1b2251fa5bf3ac246ca298665a5075a5d1a",
      d: 171483152,
      divQ: "00000000621f2b0e71a3124fd490ba3efc6a62b065f3a62b62ba9dabeae2c84b",
      divR: 61187062,
    },
    {
      a: "189f35db4ed51f5193e71bd99900cb725038503909504973b70e9351dbda7242",
      b: "31da8ecee33a73df8daec9fa94f03fe4108b2f3d1a3778970e1bc2537bb16e46",
      add: "4a79c4aa320f93312195e5d42df10b5660c37f762387c20ac52a55a5578be088",
      sub: "e6c4a70c6b9aab72063851df04108b8e3fad20fbef18d0dca8f2d0fe602903fc",
      mul: "b606d3b7b7e23ae591e1d40dee4969cc5e1f18d62a15a385fce37b2eb0759a0c",
      d: 183409571,
      divQ: "00000002409486276ff8fe206f39cf944455268aaca1b4e718e7227c3fe5f8c4",
      divR: 9855350,
    },
    {
      a: "d69a096d226231d5453de24c422e825c4484f555688ee52531fee55163ebf916",
      b: "377d9a4573d1cdc92c3cfd7fe6eb8565ff5229676b43adb473fecec979d6f5f4",
      add: "0e17a3b29633ff9e717adfcc291a07c243d71ebcd3d292d9a5fdb41addc2ef0a",
      sub: "9f1c6f27ae90640c1900e4cc5b42fcf64532cbedfd4b3770be001687ea150322",
      mul: "a7e28553aec510e6ac25777e3faae528496c3c0e1b86f7911f37cc77b0af76f8",
      d: 73898065,
      divQ: "00000030b8af7103cf33b339cd8a19f2639439ddfc8eaedb55f0b78e638e0144",
      divR: 14758546,
    },
    {
      a: "8cfedd6efc5c5f2ef28da2766eb07df12e5293977d797b2358e7dc6c9aaa9a64",
      b: "9a975f9475181faa28fd6cd3a2b4b1e6423f446fe71d2d0061a3fe1ad183f65d",
      add: "27963d0371747ed91b8b0f4a11652fd77091d8076496a823ba8bda876c2e90c1",
      sub: "f2677dda87443f84c99035a2cbfbcc0aec134f27965c4e22f743de51c926a407",
      mul: "8b6f45f3653e562a8c6599d48017ac5d55b1ac707a9a547dbc12c394c5822e54",
      d: 135453623,
      divQ: "0000001176b0fef985688acc76a52634e75507f07ad15cc239beafb2d6e53427",
      divR: 108459395,
    },
    {
      a: "a9a150cc6cf2eb7804234202c1af97945aa037ef04b45ed38c883da6cc56cc30",
      b: "7534997c30e9a931847c0e8921b474eb341c2dcaa6f78fe4ce778d8360c77164",
      add: "1ed5ea489ddc94a9889f508be3640c7f8ebc65b9ababeeb85affcb2a2d1e3d94",
      sub: "346cb7503c0942467fa733799ffb22a926840a245dbcceeebe10b0236b8f5acc",
      mul: "986149226b766c2575ae8f0b5261846dc7a1b887efc5aaff6ae905f4db58f2c0",
      d: 182483030,
      divQ: "0000000f9875578f2009c7f831d0ab6be227a98b33dcf3dd41b8fba7f27afeaf",
      divR: 8598886,
    },
    {
      a: "d7cd741c2f9621f6aa4d6fdb97b9f7a8827c0ecb5bc44ac78d0cfe2f10e9b9a9",
      b: "b4eb6ff0c3ac7de656fb4ccf3efb18cb125e32429fd2059a5fe7dd05b8b17cc9",
      add: "8cb8e40cf3429fdd0148bcaad6b5107394da410dfb965061ecf4db34c99b3672",
      sub: "22e2042b6be9a4105352230c58bededd701ddc88bbf2452d2d25212958383ce0",
      mul: "632756cb543ffed84e1553c62ac40aa29f65378d0ffbcfa8f55b937d5349a1b1",
      d: 19363430,
      divQ: "000000bafac5dff1b33262f6fbcd22761d5360aab38311b84c9c3be388769017",
      divR: 12629631,
    },
    {
      a: "61ddc2e7e127a4f196d1893553172d3464007faa34d03030288e54ba763325ff",
      b: "7ba4034fb12793a3f612fa927148a9a9f024ed5d881ea33c69c46e4da008c944",
      add: "dd81c637924f38958ce483c7c45fd6de54256d07bceed36c9252c308163bef43",
      sub: "e639bf983000114da0be8ea2e1ce838a73db924cacb18cf3bec9e66cd62a5cbb",
      mul: "56b7b9472c924c2b2bab2091b42ea96820186ab6fd822f6bebfa91611e634ebc",
      d: 856558,
      divQ: "0000077ce298b2b7a369aa541f74695fd59c08a4bb8b0c2233eb2cc3d2e5c790",
      divR: 200223,
    },
    {
      a: "24a2f8b577341a94267f67dd4262e89e79ea9370dcc4817841c065f1e9de9cd1",
      b: "cabfab95637f8e9957a7f5840746cb3f9e6f6c13fd0363cc31b4729a1b0d5d71",
      add: "ef62a44adab3a92d7e275d6149a9b3de1859ff84d9c7e5447374d88c04ebfa42",
      sub: "59e34d2013b48bfaced772593b1c1d5edb7b275cdfc11dac100bf357ced13f60",
      mul: "c5ed09c15ad0732abd5e839a584e4f7b1e21db62264c5b3fb19ca4501bd82541",
      d: 255922755,
      divQ: "0000000266d88658f77503283aa83ba979b2d1fb7fe5c0aff5f34a42fd64ee65",
      divR: 218898018,
    },
    {
      a: "225076eb1a86293e27ec3a75cd345dd05525fc9e66958d2c6cd2bb8f9ead9115",
      b: "d0dd9dd92a88144b72bb22f84e8e05db45dbec9c802689264cd5acd8a797debb",
      add: "f32e14c4450e3d899aa75d6e1bc263ab9b01e93ae6bc1652b9a8686846456fd0",
      sub: "5172d911effe14f2b531177d7ea657f50f4a1001e66f04061ffd0eb6f715b25a",
      mul: "3866f3ac5a20d7a07961f3e24ebc83613743d5ed72cf61de0134e540b2fc3057",
      d: 101672288,
      divQ: "00000005a98c47d406b27071558e4fa69bc5e17091410c42149cd85b378f2c9d",
      divR: 19916085,
    },
    {
      a: "9a5e7c0ce4ae41a4edcd4213c3d2d82f868a5f5759a7f579558c9ef04c511a6c",
      b: "5cef57ece2ba451ab9c7410b88295821390b7696f403467922dbc04c3b8dcdda",
      add: "f74dd3f9c76886bfa794831f4bfc3050bf95d5ee4dab3bf278685f3c87dee846",
      sub: "3d6f242001f3fc8a340601083ba9800e4d7ee8c065a4af0032b0dea410c34c92",
      mul: "2cf7699e23658fea97b0a137ee57f5ffc7e740b6409f366ccf3f579060b4fbf8",
      d: 9234718,
      divQ: "0000011873630b6237d2e1bd7ec830d3f90a628a4e86b261db68cb6a4b0b4d32",
      divR: 6524048,
    },
    {
      a: "b71af8cac599790b2855c1d18a702440bd0fce675d2be7a1d6550aac278f0253",
      b: "6106a6e0151f017b2c5e3d6e2c0d1455da1e4673122a73aeb9f35045c386cfc0",
      add: "18219faadab87a8654b3ff3fb67d3896972e14da6f565b5090485af1eb15d213",
      sub: "561451eab07a778ffbf784635e630feae2f187f44b0173f31c61ba6664083293",
      mul: "e5dccbbd202ec20de568dca3d1e7766591c761022150fceec5b66919be94db40",
      d: 126062576,
      divQ: "000000185e6bfddc43497ae0f4cdd5ce9d8665d6c136dddd18486475fecb8313",
      divR: 47416195,
    },
    {
      a: "78073e7f842a9079f926d1a2a793d5c268cfb4a724fb663f2094e970e0c60837",
      b: "1b7745b2697172ab3ab577c610f231fa2e828c01a1c1c9dfddc9c25ba8e630a0",
      add: "937e8431ed9c032533dc4968b88607bc975240a8c6bd301efe5eabcc89ac38d7",
      sub: "5c8ff8cd1ab91dcebe7159dc96a1a3c83a4d28a583399c5f42cb271537dfd797",
      mul: "1b1c5c540f78db3928eb2c5c45153c2e6553dc6dc552097efe90918e16b97260",
      d: 194541841,
      divQ: "0000000a59e7f66afab508f30da85eb876b726772801cbf542107393914af390",
      divR: 2935719,
    },
    {
      a: "a292a819bc498e68a0cd4facee20d612b201dee75266bea976e15e2c7d4d67ae",
      b: "06a01d065e2ca41d48a253a79036187164f2989965ffe0ea4b17db33f1fac160",
      add: "a932c5201a763285e96fa3547e56ee8416f47780b8669f93c1f939606f48290e",
      sub: "9bf28b135e1cea4b582afc055deabda14d0f464dec66ddbf2bc982f88b52a64e",
      mul: "b8d6d4b47841213122ef67cb242c1e92be4f7a4c3fa34a58ceaa9902661d0f40",
      d: 142605559,
      divQ: "000000132056d7661a09cce6a7159de39dc5671fc874839da6d96e38910c3816",
      divR: 6529652,
    },
  ] as const;

  const BOUNDARY_VECTORS = [
    {
      label: "l0(0,0)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000000000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(0,1)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000001",
      add: "0000000000000000000000000000000000000000000000000000000000000001",
      sub: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(0,B-2)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "000000000000000000000000000000000000000000000000000000000ffffffe",
      add: "000000000000000000000000000000000000000000000000000000000ffffffe",
      sub: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000002",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(0,B-1)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "000000000000000000000000000000000000000000000000000000000fffffff",
      add: "000000000000000000000000000000000000000000000000000000000fffffff",
      sub: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000001",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(1,0)",
      a: "0000000000000000000000000000000000000000000000000000000000000001",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000000000000000000000000000000001",
      sub: "0000000000000000000000000000000000000000000000000000000000000001",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(1,1)",
      a: "0000000000000000000000000000000000000000000000000000000000000001",
      b: "0000000000000000000000000000000000000000000000000000000000000001",
      add: "0000000000000000000000000000000000000000000000000000000000000002",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000001",
    },
    {
      label: "l0(1,B-2)",
      a: "0000000000000000000000000000000000000000000000000000000000000001",
      b: "000000000000000000000000000000000000000000000000000000000ffffffe",
      add: "000000000000000000000000000000000000000000000000000000000fffffff",
      sub: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000003",
      mul: "000000000000000000000000000000000000000000000000000000000ffffffe",
    },
    {
      label: "l0(1,B-1)",
      a: "0000000000000000000000000000000000000000000000000000000000000001",
      b: "000000000000000000000000000000000000000000000000000000000fffffff",
      add: "0000000000000000000000000000000000000000000000000000000010000000",
      sub: "fffffffffffffffffffffffffffffffffffffffffffffffffffffffff0000002",
      mul: "000000000000000000000000000000000000000000000000000000000fffffff",
    },
    {
      label: "l0(B-2,0)",
      a: "000000000000000000000000000000000000000000000000000000000ffffffe",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "000000000000000000000000000000000000000000000000000000000ffffffe",
      sub: "000000000000000000000000000000000000000000000000000000000ffffffe",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(B-2,1)",
      a: "000000000000000000000000000000000000000000000000000000000ffffffe",
      b: "0000000000000000000000000000000000000000000000000000000000000001",
      add: "000000000000000000000000000000000000000000000000000000000fffffff",
      sub: "000000000000000000000000000000000000000000000000000000000ffffffd",
      mul: "000000000000000000000000000000000000000000000000000000000ffffffe",
    },
    {
      label: "l0(B-2,B-2)",
      a: "000000000000000000000000000000000000000000000000000000000ffffffe",
      b: "000000000000000000000000000000000000000000000000000000000ffffffe",
      add: "000000000000000000000000000000000000000000000000000000001ffffffc",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "00000000000000000000000000000000000000000000000000ffffffc0000004",
    },
    {
      label: "l0(B-2,B-1)",
      a: "000000000000000000000000000000000000000000000000000000000ffffffe",
      b: "000000000000000000000000000000000000000000000000000000000fffffff",
      add: "000000000000000000000000000000000000000000000000000000001ffffffd",
      sub: "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      mul: "00000000000000000000000000000000000000000000000000ffffffd0000002",
    },
    {
      label: "l0(B-1,0)",
      a: "000000000000000000000000000000000000000000000000000000000fffffff",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "000000000000000000000000000000000000000000000000000000000fffffff",
      sub: "000000000000000000000000000000000000000000000000000000000fffffff",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l0(B-1,1)",
      a: "000000000000000000000000000000000000000000000000000000000fffffff",
      b: "0000000000000000000000000000000000000000000000000000000000000001",
      add: "0000000000000000000000000000000000000000000000000000000010000000",
      sub: "000000000000000000000000000000000000000000000000000000000ffffffe",
      mul: "000000000000000000000000000000000000000000000000000000000fffffff",
    },
    {
      label: "l0(B-1,B-2)",
      a: "000000000000000000000000000000000000000000000000000000000fffffff",
      b: "000000000000000000000000000000000000000000000000000000000ffffffe",
      add: "000000000000000000000000000000000000000000000000000000001ffffffd",
      sub: "0000000000000000000000000000000000000000000000000000000000000001",
      mul: "00000000000000000000000000000000000000000000000000ffffffd0000002",
    },
    {
      label: "l0(B-1,B-1)",
      a: "000000000000000000000000000000000000000000000000000000000fffffff",
      b: "000000000000000000000000000000000000000000000000000000000fffffff",
      add: "000000000000000000000000000000000000000000000000000000001ffffffe",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "00000000000000000000000000000000000000000000000000ffffffe0000001",
    },
    {
      label: "l4(0,0)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000000000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(0,1)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000010000000000000000000000000000",
      add: "0000000000000000000000000000000000010000000000000000000000000000",
      sub: "ffffffffffffffffffffffffffffffffffff0000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(0,B-2)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      add: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      sub: "fffffffffffffffffffffffffffff00000020000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(0,B-1)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "00000000000000000000000000000fffffff0000000000000000000000000000",
      add: "00000000000000000000000000000fffffff0000000000000000000000000000",
      sub: "fffffffffffffffffffffffffffff00000010000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(1,0)",
      a: "0000000000000000000000000000000000010000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000010000000000000000000000000000",
      sub: "0000000000000000000000000000000000010000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(1,1)",
      a: "0000000000000000000000000000000000010000000000000000000000000000",
      b: "0000000000000000000000000000000000010000000000000000000000000000",
      add: "0000000000000000000000000000000000020000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000100000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(1,B-2)",
      a: "0000000000000000000000000000000000010000000000000000000000000000",
      b: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      add: "00000000000000000000000000000fffffff0000000000000000000000000000",
      sub: "fffffffffffffffffffffffffffff00000030000000000000000000000000000",
      mul: "0ffffffe00000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(1,B-1)",
      a: "0000000000000000000000000000000000010000000000000000000000000000",
      b: "00000000000000000000000000000fffffff0000000000000000000000000000",
      add: "0000000000000000000000000000100000000000000000000000000000000000",
      sub: "fffffffffffffffffffffffffffff00000020000000000000000000000000000",
      mul: "0fffffff00000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-2,0)",
      a: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      sub: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-2,1)",
      a: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      b: "0000000000000000000000000000000000010000000000000000000000000000",
      add: "00000000000000000000000000000fffffff0000000000000000000000000000",
      sub: "00000000000000000000000000000ffffffd0000000000000000000000000000",
      mul: "0ffffffe00000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-2,B-2)",
      a: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      b: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      add: "00000000000000000000000000001ffffffc0000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "c000000400000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-2,B-1)",
      a: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      b: "00000000000000000000000000000fffffff0000000000000000000000000000",
      add: "00000000000000000000000000001ffffffd0000000000000000000000000000",
      sub: "ffffffffffffffffffffffffffffffffffff0000000000000000000000000000",
      mul: "d000000200000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-1,0)",
      a: "00000000000000000000000000000fffffff0000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "00000000000000000000000000000fffffff0000000000000000000000000000",
      sub: "00000000000000000000000000000fffffff0000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-1,1)",
      a: "00000000000000000000000000000fffffff0000000000000000000000000000",
      b: "0000000000000000000000000000000000010000000000000000000000000000",
      add: "0000000000000000000000000000100000000000000000000000000000000000",
      sub: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      mul: "0fffffff00000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-1,B-2)",
      a: "00000000000000000000000000000fffffff0000000000000000000000000000",
      b: "00000000000000000000000000000ffffffe0000000000000000000000000000",
      add: "00000000000000000000000000001ffffffd0000000000000000000000000000",
      sub: "0000000000000000000000000000000000010000000000000000000000000000",
      mul: "d000000200000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l4(B-1,B-1)",
      a: "00000000000000000000000000000fffffff0000000000000000000000000000",
      b: "00000000000000000000000000000fffffff0000000000000000000000000000",
      add: "00000000000000000000000000001ffffffe0000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "e000000100000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(0,0)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000000000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(0,1)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "1000000000000000000000000000000000000000000000000000000000000000",
      add: "1000000000000000000000000000000000000000000000000000000000000000",
      sub: "f000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(0,14)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "e000000000000000000000000000000000000000000000000000000000000000",
      add: "e000000000000000000000000000000000000000000000000000000000000000",
      sub: "2000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(0,15)",
      a: "0000000000000000000000000000000000000000000000000000000000000000",
      b: "f000000000000000000000000000000000000000000000000000000000000000",
      add: "f000000000000000000000000000000000000000000000000000000000000000",
      sub: "1000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(1,0)",
      a: "1000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "1000000000000000000000000000000000000000000000000000000000000000",
      sub: "1000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(1,1)",
      a: "1000000000000000000000000000000000000000000000000000000000000000",
      b: "1000000000000000000000000000000000000000000000000000000000000000",
      add: "2000000000000000000000000000000000000000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(1,14)",
      a: "1000000000000000000000000000000000000000000000000000000000000000",
      b: "e000000000000000000000000000000000000000000000000000000000000000",
      add: "f000000000000000000000000000000000000000000000000000000000000000",
      sub: "3000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(1,15)",
      a: "1000000000000000000000000000000000000000000000000000000000000000",
      b: "f000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000000000000000000000000000000000",
      sub: "2000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(14,0)",
      a: "e000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "e000000000000000000000000000000000000000000000000000000000000000",
      sub: "e000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(14,1)",
      a: "e000000000000000000000000000000000000000000000000000000000000000",
      b: "1000000000000000000000000000000000000000000000000000000000000000",
      add: "f000000000000000000000000000000000000000000000000000000000000000",
      sub: "d000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(14,14)",
      a: "e000000000000000000000000000000000000000000000000000000000000000",
      b: "e000000000000000000000000000000000000000000000000000000000000000",
      add: "c000000000000000000000000000000000000000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(14,15)",
      a: "e000000000000000000000000000000000000000000000000000000000000000",
      b: "f000000000000000000000000000000000000000000000000000000000000000",
      add: "d000000000000000000000000000000000000000000000000000000000000000",
      sub: "f000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(15,0)",
      a: "f000000000000000000000000000000000000000000000000000000000000000",
      b: "0000000000000000000000000000000000000000000000000000000000000000",
      add: "f000000000000000000000000000000000000000000000000000000000000000",
      sub: "f000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(15,1)",
      a: "f000000000000000000000000000000000000000000000000000000000000000",
      b: "1000000000000000000000000000000000000000000000000000000000000000",
      add: "0000000000000000000000000000000000000000000000000000000000000000",
      sub: "e000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(15,14)",
      a: "f000000000000000000000000000000000000000000000000000000000000000",
      b: "e000000000000000000000000000000000000000000000000000000000000000",
      add: "d000000000000000000000000000000000000000000000000000000000000000",
      sub: "1000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
    {
      label: "l9(15,15)",
      a: "f000000000000000000000000000000000000000000000000000000000000000",
      b: "f000000000000000000000000000000000000000000000000000000000000000",
      add: "e000000000000000000000000000000000000000000000000000000000000000",
      sub: "0000000000000000000000000000000000000000000000000000000000000000",
      mul: "0000000000000000000000000000000000000000000000000000000000000000",
    },
  ] as const;

  describe("Frozen fuzz vectors (500 random pairs)", () => {
    for (const [i, v] of FUZZ_VECTORS.entries()) {
      it(`fuzz[${i}] add`, () => {
        const a = BigInt("0x" + v.a);
        const b = BigInt("0x" + v.b);
        expect(toHex256(a + b)).toBe(v.add);
      });

      it(`fuzz[${i}] sub`, () => {
        const a = BigInt("0x" + v.a);
        const b = BigInt("0x" + v.b);
        expect(toHex256(a - b)).toBe(v.sub);
      });

      it(`fuzz[${i}] mul`, () => {
        const a = BigInt("0x" + v.a);
        const b = BigInt("0x" + v.b);
        expect(toHex256(a * b)).toBe(v.mul);
      });

      it(`fuzz[${i}] div (short, d=${v.d})`, () => {
        const a = BigInt("0x" + v.a);
        const d = BigInt(v.d);
        expect(toHex256(a / d)).toBe(v.divQ);
        expect(Number(a % d)).toBe(v.divR);
      });
    }
  });

  describe("Near-boundary sweep (l0/l4/l9 limb positions)", () => {
    for (const [i, v] of BOUNDARY_VECTORS.entries()) {
      it(`boundary[${i}] ${v.label} add`, () => {
        const a = BigInt("0x" + v.a);
        const b = BigInt("0x" + v.b);
        expect(toHex256(a + b)).toBe(v.add);
      });

      it(`boundary[${i}] ${v.label} sub`, () => {
        const a = BigInt("0x" + v.a);
        const b = BigInt("0x" + v.b);
        expect(toHex256(a - b)).toBe(v.sub);
      });

      it(`boundary[${i}] ${v.label} mul`, () => {
        const a = BigInt("0x" + v.a);
        const b = BigInt("0x" + v.b);
        expect(toHex256(a * b)).toBe(v.mul);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Per-limb comparison (l1 through l8)
  // -------------------------------------------------------------------------
  describe("Per-limb comparison", () => {
    const B = 1n << 28n;
    for (let i = 1; i <= 8; i++) {
      it(`values differing only at l${i}`, () => {
        const val1 = 1n * B ** BigInt(i);
        const val2 = 2n * B ** BigInt(i);
        expect(val1 < val2).toBe(true);
        expect(val2 > val1).toBe(true);
        expect(val1 !== val2).toBe(true);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Multiplication associativity
  // -------------------------------------------------------------------------
  describe("Multiplication associativity", () => {
    it("(a*b)*c == a*(b*c) for deadbeef pattern", () => {
      const a = BigInt("0xdeadbeefcafebabe1234567890abcdef0011223344556677fedcba9876543210");
      const b = 0xffn;
      const c = 0x10001n;
      const lhs = toHex256(((a * b) % (1n << 256n)) * c);
      const rhs = toHex256(a * ((b * c) % (1n << 256n)));
      expect(lhs).toBe(rhs);
      expect(lhs).toBe(VECTORS.mulAssocResult1);
    });

    it("(a*b)*c == a*(b*c) for a5 pattern with 2^128+1", () => {
      const a = BigInt("0xa5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5a5");
      const b = (1n << 128n) + 1n;
      const c = 3n;
      const lhs = toHex256(((a * b) % (1n << 256n)) * c);
      const rhs = toHex256(a * ((b * c) % (1n << 256n)));
      expect(lhs).toBe(rhs);
      expect(lhs).toBe(VECTORS.mulAssocResult2);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: a*2 == a+a
  // -------------------------------------------------------------------------
  describe("Double equals add-to-self", () => {
    const cases: [string, bigint][] = [
      ["oneEth", 10n ** 18n],
      ["pow128", 1n << 128n],
      ["limbMax", (1n << 28n) - 1n],
      ["pow255", 1n << 255n],
      ["maxDiv2", (1n << 255n) - 1n],
      ["patA", BigInt("0x" + "aa".repeat(32))],
    ];
    for (const [label, v] of cases) {
      it(`${label}: v*2 == v+v`, () => {
        expect(toHex256(v * 2n)).toBe(toHex256(v + v));
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Squaring
  // -------------------------------------------------------------------------
  describe("Squaring", () => {
    it("(2^64)^2 = 2^128", () => {
      expect(toHex256((1n << 64n) ** 2n)).toBe(VECTORS.pow128);
    });
    it("(0xdeadbeef)^2", () => {
      expect(toHex256(0xdeadbeefn ** 2n)).toBe(VECTORS.squareDeadbeef);
    });
    it("(2^192+1)^2", () => {
      expect(toHex256(((1n << 192n) + 1n) ** 2n)).toBe(VECTORS.square2p192p1);
    });
    it("(2^64-1)^2", () => {
      expect(toHex256(((1n << 64n) - 1n) ** 2n)).toBe(VECTORS.square2p64m1);
    });
    it("(2^255-1)^2 mod 2^256 = 1", () => {
      expect(toHex256(((1n << 255n) - 1n) ** 2n)).toBe(VECTORS.one);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Additive inverse
  // -------------------------------------------------------------------------
  describe("Additive inverse a + (0-a) == 0", () => {
    const cases: [string, bigint][] = [
      ["oneEth", 10n ** 18n],
      ["pow128", 1n << 128n],
      ["patA", BigInt("0x" + "aa".repeat(32))],
      ["max", UINT256_MAX],
    ];
    for (const [label, v] of cases) {
      it(`${label}`, () => {
        const neg = ((1n << 256n) - v) % (1n << 256n);
        expect(toHex256(v + neg)).toBe(VECTORS.zero);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Left distributivity
  // -------------------------------------------------------------------------
  describe("Left distributivity (b+c)*a == b*a + c*a", () => {
    it("a=7, b=oneEth, c=pow128", () => {
      const a = 7n;
      const b = 10n ** 18n;
      const c = 1n << 128n;
      const lhs = toHex256((b + c) * a);
      const rhs = toHex256(b * a + c * a);
      expect(lhs).toBe(rhs);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Checked vs unchecked consistency
  // -------------------------------------------------------------------------
  describe("Checked vs unchecked consistency", () => {
    it("add: overflow case and non-overflow produce same mod result", () => {
      // max + 1 = 0
      expect(toHex256(UINT256_MAX + 1n)).toBe(VECTORS.zero);
      // 1 + 1 = 2
      expect(toHex256(1n + 1n)).toBe(VECTORS.two);
    });
    it("sub: underflow and non-underflow produce same mod result", () => {
      expect(toHex256(0n - 1n)).toBe(VECTORS.max);
      expect(toHex256(5n - 3n)).toBe(VECTORS.two);
    });
    it("mul: overflow and non-overflow produce same mod result", () => {
      expect(toHex256(UINT256_MAX * UINT256_MAX)).toBe(VECTORS.one);
      expect(toHex256(3n * 7n)).toBe(VECTORS.twentyOne);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Carry/borrow at all limb boundaries
  // -------------------------------------------------------------------------
  describe("Carry/borrow at all limb boundaries", () => {
    const boundaries = [84, 112, 168, 196, 224];
    for (const bits of boundaries) {
      it(`carry: (2^${bits}-1) + 1 = 2^${bits}`, () => {
        expect(toHex256((1n << BigInt(bits)) - 1n + 1n)).toBe(toHex256(1n << BigInt(bits)));
      });
      it(`borrow: 2^${bits} - 1 = 2^${bits}-1`, () => {
        const val = (1n << BigInt(bits)) - 1n;
        expect(BigInt("0x" + toHex256(val))).toBe(val);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: AddChecked boundary precision
  // -------------------------------------------------------------------------
  describe("AddChecked boundary precision", () => {
    it("(2^255-1) + 2^255 = max, no overflow", () => {
      const sum = (1n << 255n) - 1n + (1n << 255n);
      expect(sum).toBe(UINT256_MAX);
      expect(sum <= UINT256_MAX).toBe(true);
    });
    it("2^255 + 2^255 = 0, overflow", () => {
      const sum = (1n << 255n) + (1n << 255n);
      expect(sum > UINT256_MAX).toBe(true);
      expect(toHex256(sum)).toBe(VECTORS.zero);
    });
    it("s9=15 via carry from l8 (no overflow)", () => {
      const a = BigInt("0x" + VECTORS.addCheckedS15CarryA);
      const b = BigInt("0x" + VECTORS.addCheckedS15CarryB);
      expect(a + b <= UINT256_MAX).toBe(true);
      expect(toHex256(a + b)).toBe(VECTORS.addCheckedS15CarryR);
    });
    it("s9=16 via carry from l8 (overflow)", () => {
      const a = BigInt("0x" + VECTORS.addCheckedS15CarryA);
      const b = BigInt("0x" + VECTORS.addCheckedS16CarryB);
      expect(a + b > UINT256_MAX).toBe(true);
      expect(toHex256(a + b)).toBe(VECTORS.zero);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Division extended
  // -------------------------------------------------------------------------
  describe("Division extended", () => {
    it("dividend < divisor: 3/7 = (0, 3)", () => {
      expect(3n / 7n).toBe(0n);
      expect(3n % 7n).toBe(3n);
    });
    it("dividend < divisor: 99/100 = (0, 99)", () => {
      expect(99n / 100n).toBe(0n);
      expect(99n % 100n).toBe(99n);
    });
    it("max/3: exact quotient 0x555...5, r=0", () => {
      expect(toHex256(UINT256_MAX / 3n)).toBe(VECTORS.divMaxBy3Q);
      expect(UINT256_MAX % 3n).toBe(0n);
    });
    it("max/17: exact quotient 0x0f0f...0f, r=0", () => {
      expect(toHex256(UINT256_MAX / 17n)).toBe(VECTORS.divMaxBy17Q);
      expect(UINT256_MAX % 17n).toBe(0n);
    });
    it("max/255: exact quotient 0x0101...01, r=0", () => {
      expect(toHex256(UINT256_MAX / 255n)).toBe(VECTORS.divMaxBy255Q);
      expect(UINT256_MAX % 255n).toBe(0n);
    });
    it("max/10: r=5", () => {
      expect(toHex256(UINT256_MAX / 10n)).toBe(VECTORS.divMaxBy10Q);
      expect(UINT256_MAX % 10n).toBe(5n);
    });
    it("max/100: r=35", () => {
      expect(toHex256(UINT256_MAX / 100n)).toBe(VECTORS.divMaxBy100Q);
      expect(UINT256_MAX % 100n).toBe(35n);
    });
    it("pow252/3: r=1", () => {
      expect(toHex256((1n << 252n) / 3n)).toBe(VECTORS.divPow252By3Q);
      expect((1n << 252n) % 3n).toBe(1n);
    });
    it("pow252/7: r=1", () => {
      expect(toHex256((1n << 252n) / 7n)).toBe(VECTORS.divPow252By7Q);
      expect((1n << 252n) % 7n).toBe(1n);
    });
    it("pow252/(2^28-1): r=1", () => {
      const d = (1n << 28n) - 1n;
      expect(toHex256((1n << 252n) / d)).toBe(VECTORS.divPow252ByLimbMaxQ);
      expect((1n << 252n) % d).toBe(1n);
    });
    it("1e18/2: r=0", () => {
      expect(toHex256(10n ** 18n / 2n)).toBe(VECTORS.div1e18By2Q);
    });
    it("1e18/10: r=0", () => {
      expect(toHex256(10n ** 18n / 10n)).toBe(VECTORS.div1e18By10Q);
    });
    it("powers of 2 sweep", () => {
      for (const [k, rExpected] of [
        [2, 3],
        [3, 7],
        [5, 31],
        [8, 255],
      ] as [number, number][]) {
        const d = 1n << BigInt(k);
        const q = UINT256_MAX / d;
        const r = UINT256_MAX % d;
        expect(r).toBe(BigInt(rExpected));
        expect(q * d + r).toBe(UINT256_MAX);
      }
    });
    it("reconstruction: max/10", () => {
      const q = UINT256_MAX / 10n;
      const r = UINT256_MAX % 10n;
      expect(q * 10n + r).toBe(UINT256_MAX);
    });
    it("reconstruction: max/100", () => {
      const q = UINT256_MAX / 100n;
      const r = UINT256_MAX % 100n;
      expect(q * 100n + r).toBe(UINT256_MAX);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: MulChecked extended
  // -------------------------------------------------------------------------
  describe("MulChecked extended", () => {
    it("2^127 * 2^128 = 2^255, no overflow", () => {
      const full = (1n << 127n) * (1n << 128n);
      expect(full <= UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.pow255);
    });
    it("(2^255-1)*3 overflows", () => {
      const full = ((1n << 255n) - 1n) * 3n;
      expect(full > UINT256_MAX).toBe(true);
      expect(toHex256(full)).toBe(VECTORS.mulHalfMaxTimes3);
    });
    it("max*3 = max-2", () => {
      expect(toHex256(UINT256_MAX * 3n)).toBe(VECTORS.maxTimes3);
    });
    it("max*7 = max-6", () => {
      expect(toHex256(UINT256_MAX * 7n)).toBe(VECTORS.maxTimes7);
    });
    it("max*255 = max-254", () => {
      expect(toHex256(UINT256_MAX * 255n)).toBe(VECTORS.maxTimes255);
    });
    it("patA * patB", () => {
      const a = BigInt("0x" + "aa".repeat(32));
      const b = BigInt("0x" + "55".repeat(32));
      expect(toHex256(a * b)).toBe(VECTORS.patAxPatB);
    });
    it("patA squared", () => {
      const a = BigInt("0x" + "aa".repeat(32));
      expect(toHex256(a * a)).toBe(VECTORS.patASquared);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Euler expansion (a+b)^2 = a^2 + 2ab + b^2
  // -------------------------------------------------------------------------
  describe("Euler expansion", () => {
    it("(oneEth + pow128)^2 = oneEth^2 + 2*oneEth*pow128 + pow128^2", () => {
      const a = 10n ** 18n;
      const b = 1n << 128n;
      const lhs = (a + b) ** 2n;
      const rhs = a ** 2n + 2n * a * b + b ** 2n;
      expect(toHex256(lhs)).toBe(toHex256(rhs));
      expect(toHex256(lhs)).toBe(VECTORS.eulerResult);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: SubChecked boundary
  // -------------------------------------------------------------------------
  describe("SubChecked boundary", () => {
    it("0 - max = 1 (underflow)", () => {
      expect(toHex256(0n - UINT256_MAX)).toBe(VECTORS.one);
    });
    it("max - oneEth", () => {
      expect(toHex256(UINT256_MAX - 10n ** 18n)).toBe(VECTORS.maxMinusOneEth);
    });
    it("2^224 - 1 (borrow through l0..l7)", () => {
      expect(toHex256((1n << 224n) - 1n)).toBe(VECTORS.pow224MinusOne);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Hex round-trip at all limb boundaries
  // -------------------------------------------------------------------------
  describe("Hex round-trip at all limb boundaries", () => {
    const boundaries = [28, 56, 84, 112, 140, 168, 196, 224, 252];
    for (const bits of boundaries) {
      it(`2^${bits} round-trips`, () => {
        const val = 1n << BigInt(bits);
        expect(BigInt("0x" + toHex256(val))).toBe(val);
      });
      it(`2^${bits}-1 round-trips`, () => {
        const val = (1n << BigInt(bits)) - 1n;
        expect(BigInt("0x" + toHex256(val))).toBe(val);
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Compare fallthrough (anchors Daml section 53)
  // -------------------------------------------------------------------------
  describe("Compare fallthrough", () => {
    it("max vs max-1 (differ at l0 only)", () => {
      expect(UINT256_MAX > UINT256_MAX - 1n).toBe(true);
      expect(toHex256(UINT256_MAX - 1n)).toBe(VECTORS.maxMinusOne);
    });
    it("upper limb dominates lower", () => {
      const a = BigInt("0x" + VECTORS.cmpUpperDominatesA);
      const b = BigInt("0x" + VECTORS.cmpUpperDominatesB);
      expect(a < b).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: IsZero anchors (Daml sections 20, 55)
  // -------------------------------------------------------------------------
  describe("IsZero anchors", () => {
    it("single non-zero limb values are non-zero", () => {
      expect(BigInt("0x" + VECTORS.limbL1Only)).toBe(1n << 28n);
      expect(BigInt("0x" + VECTORS.limbL3Only)).toBe(1n << 84n);
      expect(BigInt("0x" + VECTORS.limbL5Only)).toBe(1n << 140n);
      expect(BigInt("0x" + VECTORS.limbL7Only)).toBe(1n << 196n);
      expect(BigInt("0x" + VECTORS.limbL8Only)).toBe(1n << 224n);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Single-bit boundaries (Daml section 33)
  // -------------------------------------------------------------------------
  describe("Single-bit boundaries", () => {
    it("2^28 * 2^27 = 2^55", () => {
      expect(toHex256((1n << 28n) * (1n << 27n))).toBe(VECTORS.pow55);
    });
    it("2^255 + 2^255 = 0 (overflow)", () => {
      expect(toHex256((1n << 255n) + (1n << 255n))).toBe(VECTORS.zero);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Sub simple anchors (Daml section 8)
  // -------------------------------------------------------------------------
  describe("Sub simple anchors", () => {
    it("5 - 3 = 2", () => expect(toHex256(5n - 3n)).toBe(VECTORS.two));
    it("7 - 1 = 6", () => expect(toHex256(7n - 1n)).toBe(VECTORS.six));
  });

  // -------------------------------------------------------------------------
  // Audit v2: Mul small anchors (Daml section 14)
  // -------------------------------------------------------------------------
  describe("Mul small anchors", () => {
    it("2 * 5 = 10", () => expect(toHex256(2n * 5n)).toBe(VECTORS.ten));
  });

  // -------------------------------------------------------------------------
  // Audit v2: Simultaneous carry anchors (Daml section 63)
  // -------------------------------------------------------------------------
  describe("Simultaneous carry anchors", () => {
    it("simultaneous carry no overflow", () => {
      const a = BigInt("0x" + VECTORS.simultCarryInput);
      expect(a + a <= UINT256_MAX).toBe(true);
      expect(toHex256(a + a)).toBe(VECTORS.simultCarryResult);
    });
    it("simultaneous carry overflow", () => {
      const a = BigInt("0x" + VECTORS.simultCarryOvInput);
      expect(a + a > UINT256_MAX).toBe(true);
      expect(toHex256(a + a)).toBe(VECTORS.simultCarryOvResult);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: SubChecked boundary anchors (Daml section 64)
  // -------------------------------------------------------------------------
  describe("SubChecked boundary anchors", () => {
    it("full borrow chain: (2^252+1) - 2 = 2^252-1", () => {
      const a = BigInt("0x" + VECTORS.subFullBorrowA);
      expect(toHex256(a - 2n)).toBe(VECTORS.subFullBorrowResult);
      expect(a >= 2n).toBe(true); // no underflow
    });
    it("d9=0 borrow absorbed", () => {
      const a = BigInt("0x" + VECTORS.subD9AbsorbedA);
      const b = BigInt("0x" + VECTORS.subD9AbsorbedB);
      expect(a >= b).toBe(true); // no underflow
      expect(toHex256(a - b)).toBe(VECTORS.subD9AbsorbedResult);
    });
    it("d9=-1 underflow", () => {
      const a = BigInt("0x" + VECTORS.subD9UnderflowA);
      const b = BigInt("0x" + VECTORS.subD9UnderflowB);
      expect(a < b).toBe(true); // underflow
      expect(toHex256(a - b)).toBe(VECTORS.max); // wraps to max
    });
    it("only l9 borrows", () => {
      const a = BigInt("0x" + VECTORS.subOnlyL9A);
      const b = BigInt("0x" + VECTORS.subOnlyL9B);
      expect(a < b).toBe(true); // underflow
      expect(toHex256(a - b)).toBe(VECTORS.subOnlyL9Result2);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Boundary l0 inline anchors (Daml section 49)
  // -------------------------------------------------------------------------
  describe("Boundary l0 inline anchors", () => {
    it("(B-2)+(B-1) carry into l1", () => {
      const B = 1n << 28n;
      expect(toHex256(B - 2n + (B - 1n))).toBe(VECTORS.bndL0BmTwoPlusBmOne);
    });
    it("(B-1)^2", () => {
      const B = 1n << 28n;
      expect(toHex256((B - 1n) ** 2n)).toBe(VECTORS.bndL0BmOneSquared);
    });
  });

  // -------------------------------------------------------------------------
  // Audit v2: Division quotient anchors (Daml section 66)
  // -------------------------------------------------------------------------
  describe("Division quotient anchors", () => {
    it("pow252/2", () => expect(toHex256((1n << 252n) / 2n)).toBe(VECTORS.divPow252By2Q));
    it("max/4", () => expect(toHex256(UINT256_MAX / 4n)).toBe(VECTORS.divMax4Q));
    it("max/8", () => expect(toHex256(UINT256_MAX / 8n)).toBe(VECTORS.divMax8Q));
    it("max/32", () => expect(toHex256(UINT256_MAX / 32n)).toBe(VECTORS.divMax32Q));
    it("max/256", () => expect(toHex256(UINT256_MAX / 256n)).toBe(VECTORS.divMaxBy256Q));
  });

  // -------------------------------------------------------------------------
  // Audit v2: Squaring sweep (2^k-1)^2 at limb boundaries
  // -------------------------------------------------------------------------
  describe("Squaring sweep", () => {
    // CPython test_long.py checks (2^k-1)^2 == 2^(2k) - 2^(k+1) + 1 for k=1..399
    // We check at every limb boundary (28n multiples) plus key positions
    const kValues = [
      1, 4, 14, 27, 28, 32, 56, 64, 84, 96, 112, 127, 128, 140, 168, 192, 196, 224, 252, 255,
    ];
    for (const k of kValues) {
      it(`(2^${k}-1)^2 identity`, () => {
        const val = (1n << BigInt(k)) - 1n;
        const squared = val * val;
        // Verify identity: (2^k-1)^2 = 2^(2k) - 2^(k+1) + 1
        const expected = (1n << BigInt(2 * k)) - (1n << BigInt(k + 1)) + 1n;
        expect(squared).toBe(expected);
        // Verify mod 2^256 matches
        expect(toHex256(squared)).toBe(toHex256(expected));
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Karatsuba identity sweep
  // -------------------------------------------------------------------------
  describe("Karatsuba identity sweep", () => {
    // (2^a-1)*(2^b-1) = 2^(a+b) - 2^a - 2^b + 1
    const pairs: [number, number][] = [
      [64, 64],
      [64, 192],
      [128, 128],
      [192, 64],
      [252, 4],
      [140, 112],
    ];
    for (const [a, b] of pairs) {
      it(`(2^${a}-1)*(2^${b}-1)`, () => {
        const va = (1n << BigInt(a)) - 1n;
        const vb = (1n << BigInt(b)) - 1n;
        const product = va * vb;
        const expected = (1n << BigInt(a + b)) - (1n << BigInt(a)) - (1n << BigInt(b)) + 1n;
        expect(product).toBe(expected);
        expect(toHex256(product)).toBe(toHex256(expected));
      });
    }
  });

  // -------------------------------------------------------------------------
  // Audit v2: Token decimal scaling
  // -------------------------------------------------------------------------
  describe("Token decimal scaling", () => {
    it("USDC upscale: 1e6 * 1e12 = 1e18", () => {
      expect(toHex256(10n ** 6n * 10n ** 12n)).toBe(toHex256(10n ** 18n));
    });
    it("WBTC upscale: 1e8 * 1e10 = 1e18", () => {
      expect(toHex256(10n ** 8n * 10n ** 10n)).toBe(toHex256(10n ** 18n));
    });
    it("large token balance * price", () => {
      // 1000 ETH * 3500 USD (both in 18 decimals)
      const balance = 1000n * 10n ** 18n;
      const price = 3500n * 10n ** 18n;
      const value = balance * price;
      expect(value <= UINT256_MAX).toBe(true);
      expect(BigInt("0x" + toHex256(value))).toBe(value);
    });
  });
});
