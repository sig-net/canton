/**
 * Deterministic fuzz-vector generator for UInt256 test suite.
 *
 * Uses keccak256-based PRNG seeded with a fixed string so output is
 * perfectly reproducible across runs. Writes:
 *   - ../signet-uint256-tests/daml/TestFuzz.daml (complete Daml module with forA_ loops)
 *   - uint256-ts-fragment.txt (TS fragment for manual insertion)
 *
 * Usage: npx tsx test/scripts/generate-uint256-vectors.ts
 */

import { keccak256, toHex } from "viem";
import { writeFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MOD = 1n << 256n;
const UINT256_MAX = MOD - 1n;
const B = 1n << 28n; // limb base
const SEED = "uint256-fuzz-vectors-v1";

// ---------------------------------------------------------------------------
// Deterministic PRNG: keccak256 chain
// ---------------------------------------------------------------------------

let state: `0x${string}` = keccak256(toHex(SEED, { size: 32 }));

function nextBytes32(): bigint {
  state = keccak256(state);
  return BigInt(state);
}

/** Random uint256. */
function randU256(): bigint {
  return nextBytes32() & UINT256_MAX;
}

/** Random int in [1, max] inclusive, where max < 2^28. */
function randSmallDivisor(max: bigint): number {
  const raw = nextBytes32() & UINT256_MAX;
  return Number((raw % max) + 1n);
}

// ---------------------------------------------------------------------------
// Hex helpers
// ---------------------------------------------------------------------------

function toHex256(n: bigint): string {
  return ((n % MOD) + MOD).toString(16).padStart(64, "0").slice(-64);
}

// ---------------------------------------------------------------------------
// 1. Random fuzz pairs (500)
// ---------------------------------------------------------------------------

interface FuzzVector {
  idx: number;
  a: string;
  b: string;
  add: string;
  sub: string;
  mul: string;
  d: number;
  divQ: string;
  divR: number;
}

function generateFuzzVectors(count: number): FuzzVector[] {
  const vectors: FuzzVector[] = [];
  for (let i = 0; i < count; i++) {
    const a = randU256();
    const bVal = randU256();
    const add = (a + bVal) % MOD;
    const sub = (((a - bVal) % MOD) + MOD) % MOD;
    const mul = (a * bVal) % MOD;
    const d = randSmallDivisor(B - 1n); // d in [1, 2^28-1]
    const divQ = a / BigInt(d);
    const divR = Number(a % BigInt(d));
    vectors.push({
      idx: i,
      a: toHex256(a),
      b: toHex256(bVal),
      add: toHex256(add),
      sub: toHex256(sub),
      mul: toHex256(mul),
      d,
      divQ: toHex256(divQ),
      divR,
    });
  }
  return vectors;
}

// ---------------------------------------------------------------------------
// 2. Near-boundary sweep
// ---------------------------------------------------------------------------

interface BoundaryVector {
  label: string;
  a: string;
  b: string;
  add: string;
  sub: string;
  mul: string;
}

function generateBoundarySweep(): BoundaryVector[] {
  const vals = [0n, 1n, B - 2n, B - 1n];
  const labels = ["0", "1", "B-2", "B-1"];
  const vectors: BoundaryVector[] = [];

  // l0 position (no shift)
  for (const [i, av] of vals.entries()) {
    for (const [j, bv] of vals.entries()) {
      vectors.push({
        label: `l0(${labels[i]},${labels[j]})`,
        a: toHex256(av),
        b: toHex256(bv),
        add: toHex256((av + bv) % MOD),
        sub: toHex256((((av - bv) % MOD) + MOD) % MOD),
        mul: toHex256((av * bv) % MOD),
      });
    }
  }

  // l4 position (shift by B^4 = 2^112)
  const shift4 = B ** 4n;
  for (const [i, av] of vals.entries()) {
    for (const [j, bv] of vals.entries()) {
      const a = av * shift4;
      const bVal = bv * shift4;
      vectors.push({
        label: `l4(${labels[i]},${labels[j]})`,
        a: toHex256(a),
        b: toHex256(bVal),
        add: toHex256((a + bVal) % MOD),
        sub: toHex256((((a - bVal) % MOD) + MOD) % MOD),
        mul: toHex256((a * bVal) % MOD),
      });
    }
  }

  // l9 position (shift by B^9 = 2^252, but clamp to 0-15 for the 4-bit top limb)
  const shift9 = B ** 9n; // = 2^252
  const topVals = [0n, 1n, 14n, 15n]; // clamped to [0,15]
  const topLabels = ["0", "1", "14", "15"];
  for (const [i, tv] of topVals.entries()) {
    for (const [j, tu] of topVals.entries()) {
      const a = tv * shift9;
      const bVal = tu * shift9;
      vectors.push({
        label: `l9(${topLabels[i]},${topLabels[j]})`,
        a: toHex256(a),
        b: toHex256(bVal),
        add: toHex256((a + bVal) % MOD),
        sub: toHex256((((a - bVal) % MOD) + MOD) % MOD),
        mul: toHex256((a * bVal) % MOD),
      });
    }
  }

  return vectors;
}

// ---------------------------------------------------------------------------
// Build TS fragment
// ---------------------------------------------------------------------------

function buildTsFragment(fuzz: FuzzVector[], boundary: BoundaryVector[]): string {
  const lines: string[] = [];

  lines.push(`
// ---------------------------------------------------------------------------
// Frozen fuzz vectors (generated by generate-uint256-vectors.ts)
// Seed: keccak256("${SEED}") -- deterministic, do not edit
// ---------------------------------------------------------------------------

const FUZZ_VECTORS = [`);
  for (const v of fuzz) {
    lines.push(
      `  { a: "${v.a}", b: "${v.b}", add: "${v.add}", sub: "${v.sub}", mul: "${v.mul}", d: ${v.d}, divQ: "${v.divQ}", divR: ${v.divR} },`,
    );
  }
  lines.push(`] as const;

const BOUNDARY_VECTORS = [`);
  for (const v of boundary) {
    lines.push(
      `  { label: "${v.label}", a: "${v.a}", b: "${v.b}", add: "${v.add}", sub: "${v.sub}", mul: "${v.mul}" },`,
    );
  }
  lines.push(`] as const;

describe("Frozen fuzz vectors (500 random pairs)", () => {
  for (const [i, v] of FUZZ_VECTORS.entries()) {
    it(\`fuzz[\${i}] add\`, () => {
      const a = BigInt("0x" + v.a);
      const b = BigInt("0x" + v.b);
      expect(toHex256(a + b)).toBe(v.add);
    });

    it(\`fuzz[\${i}] sub\`, () => {
      const a = BigInt("0x" + v.a);
      const b = BigInt("0x" + v.b);
      expect(toHex256(a - b)).toBe(v.sub);
    });

    it(\`fuzz[\${i}] mul\`, () => {
      const a = BigInt("0x" + v.a);
      const b = BigInt("0x" + v.b);
      expect(toHex256(a * b)).toBe(v.mul);
    });

    it(\`fuzz[\${i}] div (short, d=\${v.d})\`, () => {
      const a = BigInt("0x" + v.a);
      const d = BigInt(v.d);
      expect(toHex256(a / d)).toBe(v.divQ);
      expect(Number(a % d)).toBe(v.divR);
    });
  }
});

describe("Near-boundary sweep (l0/l4/l9 limb positions)", () => {
  for (const [i, v] of BOUNDARY_VECTORS.entries()) {
    it(\`boundary[\${i}] \${v.label} add\`, () => {
      const a = BigInt("0x" + v.a);
      const b = BigInt("0x" + v.b);
      expect(toHex256(a + b)).toBe(v.add);
    });

    it(\`boundary[\${i}] \${v.label} sub\`, () => {
      const a = BigInt("0x" + v.a);
      const b = BigInt("0x" + v.b);
      expect(toHex256(a - b)).toBe(v.sub);
    });

    it(\`boundary[\${i}] \${v.label} mul\`, () => {
      const a = BigInt("0x" + v.a);
      const b = BigInt("0x" + v.b);
      expect(toHex256(a * b)).toBe(v.mul);
    });
  }
});`);

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Build complete TestFuzz.daml file with forA_ loops
// ---------------------------------------------------------------------------

function buildDamlFile(fuzz: FuzzVector[]): string {
  const lines: string[] = [];

  lines.push(`module TestFuzz where`);
  lines.push(``);
  lines.push(`import Daml.Script`);
  lines.push(`import DA.Foldable (forA_)`);
  lines.push(`import qualified DA.Text`);
  lines.push(`import DA.Crypto.Text (BytesHex)`);
  lines.push(`import UInt256`);
  lines.push(``);
  lines.push(`-- Generated by generate-uint256-vectors.ts — do not edit manually`);
  lines.push(`-- Seed: keccak256("${SEED}")`);
  lines.push(``);
  lines.push(`data FV = FV with`);
  lines.push(`  a : BytesHex; b : BytesHex`);
  lines.push(`  addExp : BytesHex; subExp : BytesHex; mulExp : BytesHex`);
  lines.push(`  d : Int; divQExp : BytesHex; divRExp : Int`);
  lines.push(``);
  lines.push(`fuzzVectors : [FV]`);
  lines.push(`fuzzVectors =`);

  for (const [i, v] of fuzz.entries()) {
    const prefix = i === 0 ? "  [ " : "  , ";
    lines.push(
      `${prefix}FV "${v.a}" "${v.b}" "${v.add}" "${v.sub}" "${v.mul}" ${v.d} "${v.divQ}" ${v.divR}`,
    );
  }
  lines.push(`  ]`);
  lines.push(``);
  lines.push(`testFuzzAdd : Script ()`);
  lines.push(`testFuzzAdd = forA_ fuzzVectors $ \\v ->`);
  lines.push(`  assertMsg ("fuzz add " <> DA.Text.take 8 v.a) (hexAddUint256 v.a v.b == v.addExp)`);
  lines.push(``);
  lines.push(`testFuzzSub : Script ()`);
  lines.push(`testFuzzSub = forA_ fuzzVectors $ \\v ->`);
  lines.push(`  assertMsg ("fuzz sub " <> DA.Text.take 8 v.a) (hexSubUint256 v.a v.b == v.subExp)`);
  lines.push(``);
  lines.push(`testFuzzMul : Script ()`);
  lines.push(`testFuzzMul = forA_ fuzzVectors $ \\v ->`);
  lines.push(`  assertMsg ("fuzz mul " <> DA.Text.take 8 v.a) (hexMulUint256 v.a v.b == v.mulExp)`);
  lines.push(``);
  lines.push(`testFuzzDiv : Script ()`);
  lines.push(`testFuzzDiv = forA_ fuzzVectors $ \\v -> do`);
  lines.push(`  let (q, r) = uint256DivInt (uint256FromHex v.a) v.d`);
  lines.push(`  assertMsg ("fuzz divQ " <> DA.Text.take 8 v.a) (uint256ToHex q == v.divQExp)`);
  lines.push(`  assertMsg ("fuzz divR " <> DA.Text.take 8 v.a) (r == v.divRExp)`);

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

const fuzz = generateFuzzVectors(500);
const boundary = generateBoundarySweep();

const tsFragment = buildTsFragment(fuzz, boundary);
const damlFile = buildDamlFile(fuzz);

import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "../../../..");

const testFuzzPath = resolve(projectRoot, "daml-packages/signet-uint256-tests/daml/TestFuzz.daml");
writeFileSync(resolve(projectRoot, "uint256-ts-fragment.txt"), tsFragment);
writeFileSync(testFuzzPath, damlFile);

console.log(`Generated ${fuzz.length} fuzz vectors and ${boundary.length} boundary vectors.`);
console.log(`Wrote ${resolve(projectRoot, "uint256-ts-fragment.txt")}`);
console.log(`Wrote ${testFuzzPath}`);
