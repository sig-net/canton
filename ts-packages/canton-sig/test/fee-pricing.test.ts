import { describe, it, expect } from "vitest";

import { computeFeeCc, type FeePricingInputs } from "canton-sig";

const base: FeePricingInputs = {
  bytes: 400_000,
  extraTrafficPriceUsdPerMb: 1,
  amuletPriceUsdPerCc: 0.005,
  coverage: 0.15,
  profit: 0.1,
};

describe("computeFeeCc (fee-formula golden)", () => {
  it("matches a hand-computed reference: 400KB @ $1/MB, $0.005/CC, 0.15+0.10", () => {
    // cost_usd = 400000/1e6 * 1 = 0.4
    // fee_cc   = (0.4 / 0.005) * (1 + 0.15 + 0.10) = 80 * 1.25 = 100
    const r = computeFeeCc(base);
    expect(r.costUsd).toBeCloseTo(0.4, 12);
    expect(r.feeCc).toBe("100.0000000000");
  });

  it("matches a second reference: 1MB @ $2/MB, $0.01/CC, 0.10+0.10", () => {
    // cost_usd = 1 * 2 = 2 ; fee_cc = (2/0.01) * 1.20 = 200 * 1.2 = 240
    const r = computeFeeCc({
      bytes: 1_000_000,
      extraTrafficPriceUsdPerMb: 2,
      amuletPriceUsdPerCc: 0.01,
      coverage: 0.1,
      profit: 0.1,
    });
    expect(r.costUsd).toBeCloseTo(2, 12);
    expect(r.feeCc).toBe("240.0000000000");
  });

  it("keeps coverage and profit as separate additive terms", () => {
    // If profit were ignored (only 1+coverage), this would be 80*1.15 = 92, not 100.
    expect(computeFeeCc(base).feeCc).toBe("100.0000000000");
    // Bumping only profit by 0.10 adds exactly 80*0.10 = 8 CC → 108.
    expect(computeFeeCc({ ...base, profit: 0.2 }).feeCc).toBe("108.0000000000");
    // Bumping only coverage by 0.10 also adds 8 CC → 108 (symmetry of the two terms).
    expect(computeFeeCc({ ...base, coverage: 0.25 }).feeCc).toBe("108.0000000000");
  });

  it("scales linearly with bytes", () => {
    const half = computeFeeCc({ ...base, bytes: 200_000 });
    expect(half.feeCc).toBe("50.0000000000"); // half the traffic → half the fee
  });

  it("rounds the fee to scale 10 without spurious float drift", () => {
    // (2/0.01)*1.2 = 240 exactly in math, but 239.9999.../240.0000...3 in float —
    // must land on a clean scale-10 "240.0000000000", not 240.0000000001.
    const r = computeFeeCc({
      bytes: 1_000_000,
      extraTrafficPriceUsdPerMb: 2,
      amuletPriceUsdPerCc: 0.01,
      coverage: 0.1,
      profit: 0.1,
    });
    expect(r.feeCc).toBe("240.0000000000");
  });

  it("always emits a scale-10 decimal string", () => {
    const r = computeFeeCc({
      bytes: 123_456,
      extraTrafficPriceUsdPerMb: 1.5,
      amuletPriceUsdPerCc: 0.0073,
      coverage: 0.12,
      profit: 0.1,
    });
    expect(r.feeCc).toMatch(/^\d+\.\d{10}$/);
    // posted fee equals the exact fee rounded to scale 10 (within half a ulp)
    const exact = (((123_456 / 1e6) * 1.5) / 0.0073) * 1.22;
    expect(Number.parseFloat(r.feeCc)).toBeCloseTo(exact, 9);
  });

  it("returns zero fee for zero traffic", () => {
    expect(computeFeeCc({ ...base, bytes: 0 }).feeCc).toBe("0.0000000000");
  });

  it("throws on a non-positive amulet price (would divide by zero)", () => {
    expect(() => computeFeeCc({ ...base, amuletPriceUsdPerCc: 0 })).toThrow(/amuletPrice/);
    expect(() => computeFeeCc({ ...base, amuletPriceUsdPerCc: -1 })).toThrow(/amuletPrice/);
  });

  it("throws on negative or non-finite inputs (fail loud, never post garbage)", () => {
    expect(() => computeFeeCc({ ...base, bytes: -1 })).toThrow();
    expect(() => computeFeeCc({ ...base, coverage: -0.1 })).toThrow();
    expect(() => computeFeeCc({ ...base, extraTrafficPriceUsdPerMb: Infinity })).toThrow();
    expect(() => computeFeeCc({ ...base, profit: NaN })).toThrow();
  });
});
