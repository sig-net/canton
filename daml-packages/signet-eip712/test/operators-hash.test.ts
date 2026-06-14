import { describe, expect, it } from "vitest";
import { keccak256, toHex } from "viem";

/**
 * Reference implementation matching Daml's computeOperatorsHash:
 * sort operators, keccak256 each as UTF-8 hex, concat, then keccak256 all.
 */
function computeOperatorsHash(operators: string[]): string {
  const sorted = [...operators].sort();
  const individualHashes = sorted.map((op) => keccak256(toHex(op)).slice(2));
  return keccak256(`0x${individualHashes.join("")}`).slice(2);
}

describe("computeOperatorsHash cross-language parity", () => {
  it("matches golden vector", () => {
    expect(computeOperatorsHash(["Alice", "Bob"])).toBe(
      "9b1a0a45cfdc60f45820808958c1895d44da61c8f804f5560020a373b23ad51e",
    );
  });

  it("is deterministic", () => {
    const h1 = computeOperatorsHash(["Alice", "Bob"]);
    const h2 = computeOperatorsHash(["Alice", "Bob"]);
    expect(h1).toBe(h2);
    expect(h1.length).toBe(64);
  });

  it("is order-independent", () => {
    const h1 = computeOperatorsHash(["Alice", "Bob"]);
    const h2 = computeOperatorsHash(["Bob", "Alice"]);
    expect(h1).toBe(h2);
  });

  it("different operators produce different hash", () => {
    const h1 = computeOperatorsHash(["Alice", "Bob"]);
    const h2 = computeOperatorsHash(["Alice", "Charlie"]);
    expect(h1).not.toBe(h2);
  });

  it("single operator produces 32 bytes", () => {
    const h = computeOperatorsHash(["Alice"]);
    expect(h.length).toBe(64);
  });

  it("three operators order-independent", () => {
    const h1 = computeOperatorsHash(["Op1", "Op2", "Op3"]);
    const h2 = computeOperatorsHash(["Op3", "Op1", "Op2"]);
    expect(h1).toBe(h2);
  });
});
