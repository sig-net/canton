import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import {
  CantonClient,
  DAR_PATH,
  Signer,
  SignBidirectionalEvent,
  Vault,
  Erc20Holding,
} from "canton-sig";

describe("package exports (ESM)", () => {
  it("exports CantonClient class", () => {
    expect(CantonClient).toBeDefined();
    expect(typeof CantonClient).toBe("function");
  });

  it("exports DAR_PATH as a string", () => {
    expect(typeof DAR_PATH).toBe("string");
    expect(DAR_PATH).toContain("daml-vault-poc-0.0.1.dar");
  });

  it("CantonClient can be instantiated with default URL", () => {
    expect(new CantonClient()).toBeInstanceOf(CantonClient);
  });
});

describe("daml template re-exports", () => {
  it("exports Signer with templateId", () => {
    expect(Signer.templateId).toMatch(/Signer/);
  });

  it("exports SignBidirectionalEvent with templateId", () => {
    expect(SignBidirectionalEvent.templateId).toMatch(/SignBidirectionalEvent/);
  });

  it("exports Vault with templateId", () => {
    expect(Vault.templateId).toMatch(/Vault/);
  });

  it("exports Erc20Holding with templateId", () => {
    expect(Erc20Holding.templateId).toMatch(/Erc20Holding/);
  });
});

describe("package exports (CJS via dist)", () => {
  it("can be required and DAR exists at resolved path", async () => {
    const { createRequire } = await import("node:module");
    const require = createRequire(import.meta.url);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const cjs: Record<string, unknown> = require("canton-sig");

    expect(typeof cjs.CantonClient).toBe("function");
    expect(typeof cjs.DAR_PATH).toBe("string");
    expect(existsSync(cjs.DAR_PATH as string)).toBe(true);
  });
});
