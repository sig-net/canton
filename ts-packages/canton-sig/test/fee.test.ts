import { describe, it, expect, vi } from "vitest";

import {
  selectInputHoldings,
  holdingInputsFromEvents,
  parseFeeConfig,
  isFeeConfigInWindow,
  getCurrentFeeDisclosure,
  getTransferFactoryForFee,
  assembleFeeChoiceArgs,
  collectFeeDisclosures,
  EMPTY_TRANSFER_CONTEXT,
  TRANSFER_FACTORY_REGISTRY_PATH,
  type FeeLedgerReader,
  type HoldingInput,
} from "canton-sig";
import type { CreatedEvent, DisclosedContract } from "canton-sig";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SIG = "sigNetwork::abc";
const DSO = "dso::abc";

function feeConfig(over: Record<string, unknown> = {}) {
  return {
    sigNetwork: SIG,
    feeReceiver: SIG,
    instrumentAdmin: DSO,
    instrumentId: "Amulet",
    feeAmount: "1.0",
    validFrom: "1970-01-01T00:00:00Z",
    validUntil: "2099-12-31T00:00:00Z",
    version: "0",
    ...over,
  };
}

function createdEvent(contractId: string, createArgument: unknown): CreatedEvent {
  return {
    contractId,
    templateId: "#daml-signer:SignerFee:SignerFeeConfig",
    createArgument,
    createdEventBlob: `blob-${contractId}`,
  } as unknown as CreatedEvent;
}

function holding(contractId: string, amount: string, locked = false): HoldingInput {
  return { contractId, amount, locked };
}

// ---------------------------------------------------------------------------
// selectInputHoldings
// ---------------------------------------------------------------------------

describe("selectInputHoldings", () => {
  it("selects a single holding that exactly covers the fee", () => {
    const r = selectInputHoldings([holding("h1", "1.0")], "1.0");
    expect(r.inputHoldingCids).toEqual(["h1"]);
    expect(r.total).toBe("1");
  });

  it("greedily picks the fewest (largest-first) holdings to cover the fee", () => {
    const hs = [holding("small", "0.4"), holding("big", "5.0"), holding("mid", "1.0")];
    const r = selectInputHoldings(hs, "1.0");
    // "big" alone (5.0) covers 1.0 — one input, not three
    expect(r.inputHoldingCids).toEqual(["big"]);
  });

  it("accumulates multiple holdings when no single one covers the fee", () => {
    const hs = [holding("a", "0.6"), holding("b", "0.6"), holding("c", "0.6")];
    const r = selectInputHoldings(hs, "1.0");
    // largest-first: 0.6 + 0.6 = 1.2 ≥ 1.0 → two inputs
    expect(r.inputHoldingCids).toHaveLength(2);
    expect(r.total).toBe("1.2");
  });

  it("throws when the unlocked balance is insufficient (fail-closed)", () => {
    expect(() => selectInputHoldings([holding("a", "0.3")], "1.0")).toThrow(/insufficient/);
  });

  it("excludes locked holdings from selection", () => {
    expect(() => selectInputHoldings([holding("locked", "100.0", true)], "1.0")).toThrow(
      /insufficient/,
    );
    const r = selectInputHoldings([holding("locked", "100.0", true), holding("free", "1.0")], "1.0");
    expect(r.inputHoldingCids).toEqual(["free"]);
  });

  it("ignores zero-amount holdings", () => {
    const r = selectInputHoldings([holding("zero", "0.0"), holding("real", "2.0")], "1.0");
    expect(r.inputHoldingCids).toEqual(["real"]);
  });

  it("throws on a negative fee amount", () => {
    expect(() => selectInputHoldings([holding("a", "1.0")], "-1.0")).toThrow(/negative/);
  });

  it("throws when covering the fee would exceed the input cap", () => {
    const hs = [holding("a", "0.4"), holding("b", "0.4"), holding("c", "0.4")];
    // need 3 inputs (0.4*3=1.2) but cap is 2
    expect(() => selectInputHoldings(hs, "1.0", { maxInputs: 2 })).toThrow(/transfer cap/);
  });

  it("handles a zero fee with no inputs", () => {
    const r = selectInputHoldings([holding("a", "1.0")], "0.0");
    expect(r.inputHoldingCids).toEqual([]);
    expect(r.total).toBe("0");
  });

  it("sums sub-unit decimals exactly (no float drift)", () => {
    // 0.0000000001 is the smallest CC unit (scale 10). Three of them = 0.0000000003.
    const hs = [
      holding("a", "0.0000000001"),
      holding("b", "0.0000000001"),
      holding("c", "0.0000000001"),
    ];
    const r = selectInputHoldings(hs, "0.0000000003");
    expect(r.inputHoldingCids).toHaveLength(3);
    expect(r.total).toBe("0.0000000003");
  });

  it("is deterministic for a fixed input", () => {
    const hs = [holding("a", "0.6"), holding("b", "0.6"), holding("c", "0.6")];
    const a = selectInputHoldings(hs, "1.0");
    const b = selectInputHoldings(hs, "1.0");
    expect(a).toEqual(b);
  });
});

// ---------------------------------------------------------------------------
// holdingInputsFromEvents
// ---------------------------------------------------------------------------

describe("holdingInputsFromEvents", () => {
  function holdingEvent(contractId: string, amount: string, lock: unknown = null): CreatedEvent {
    return {
      contractId,
      templateId: "#splice-amulet:Splice.Amulet:Amulet",
      createArgument: {},
      interfaceViews: [{ interfaceId: "#h:Holding", viewStatus: {}, viewValue: { amount, lock } }],
    } as unknown as CreatedEvent;
  }

  it("maps interface views to holding inputs (amount + lock from the standard view)", () => {
    const inputs = holdingInputsFromEvents([
      holdingEvent("h1", "1.5"),
      holdingEvent("h2", "2.0", { holders: ["x"] }), // non-null lock ⇒ locked
    ]);
    expect(inputs).toEqual([
      { contractId: "h1", amount: "1.5", locked: false },
      { contractId: "h2", amount: "2.0", locked: true },
    ]);
  });

  it("composes with selectInputHoldings", () => {
    const inputs = holdingInputsFromEvents([holdingEvent("h1", "0.4"), holdingEvent("h2", "5.0")]);
    expect(selectInputHoldings(inputs, "1.0").inputHoldingCids).toEqual(["h2"]);
  });

  it("throws when an event lacks a computed Holding view amount", () => {
    const noView = { contractId: "bad", interfaceViews: [] } as unknown as CreatedEvent;
    expect(() => holdingInputsFromEvents([noView])).toThrow(/missing Holding view/);
  });
});

// ---------------------------------------------------------------------------
// parseFeeConfig + isFeeConfigInWindow
// ---------------------------------------------------------------------------

describe("parseFeeConfig", () => {
  it("decodes a well-formed SignerFeeConfig payload", () => {
    const cfg = parseFeeConfig(feeConfig({ feeAmount: "2.5", version: "7" }));
    expect(cfg.sigNetwork).toBe(SIG);
    expect(cfg.feeAmount).toBe("2.5");
    expect(cfg.version).toBe("7");
    expect(cfg.instrumentId).toBe("Amulet");
  });

  it("throws on a malformed payload (missing field)", () => {
    const bad = feeConfig();
    delete (bad as Record<string, unknown>).feeAmount;
    expect(() => parseFeeConfig(bad)).toThrow();
  });
});

describe("isFeeConfigInWindow", () => {
  const cfg = parseFeeConfig(
    feeConfig({ validFrom: "2026-01-01T00:00:00Z", validUntil: "2026-01-01T01:00:00Z" }),
  );
  const from = Date.parse("2026-01-01T00:00:00Z");
  const until = Date.parse("2026-01-01T01:00:00Z");

  it("is true strictly inside the window", () => {
    expect(isFeeConfigInWindow(cfg, from + 1000)).toBe(true);
  });
  it("is true on both inclusive boundaries", () => {
    expect(isFeeConfigInWindow(cfg, from)).toBe(true);
    expect(isFeeConfigInWindow(cfg, until)).toBe(true);
  });
  it("is false before validFrom and after validUntil", () => {
    expect(isFeeConfigInWindow(cfg, from - 1)).toBe(false);
    expect(isFeeConfigInWindow(cfg, until + 1)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getCurrentFeeDisclosure
// ---------------------------------------------------------------------------

function stubReader(events: CreatedEvent[]): {
  reader: FeeLedgerReader;
  disclosedFor: ReturnType<typeof vi.fn>;
} {
  const disclosedFor = vi.fn(
    async (parties: string[], templateId: string, contractId: string): Promise<DisclosedContract> =>
      ({
        templateId,
        contractId,
        createdEventBlob: `blob-${contractId}`,
        synchronizerId: "sync::1",
      }) as DisclosedContract,
  );
  const reader: FeeLedgerReader = {
    getActiveContracts: async () => events,
    getDisclosedContract: disclosedFor,
  };
  return { reader, disclosedFor };
}

describe("getCurrentFeeDisclosure", () => {
  const NOW = Date.parse("2026-03-01T00:00:00Z");

  it("selects the in-window config and returns its disclosure", async () => {
    const events = [
      createdEvent(
        "expired",
        feeConfig({ validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-02-01T00:00:00Z" }),
      ),
      createdEvent(
        "current",
        feeConfig({ validFrom: "2026-02-01T00:00:00Z", validUntil: "2026-04-01T00:00:00Z" }),
      ),
    ];
    const { reader, disclosedFor } = stubReader(events);
    const r = await getCurrentFeeDisclosure(reader, SIG, { nowMs: NOW });
    expect(r.contractId).toBe("current");
    expect(r.disclosure.createdEventBlob).toBe("blob-current");
    expect(disclosedFor).toHaveBeenCalledWith([SIG], expect.any(String), "current");
  });

  it("picks the highest version when windows overlap (pre-published next config)", async () => {
    const events = [
      createdEvent(
        "v1",
        feeConfig({
          version: "1",
          validFrom: "2026-02-01T00:00:00Z",
          validUntil: "2026-04-01T00:00:00Z",
        }),
      ),
      createdEvent(
        "v2",
        feeConfig({
          version: "2",
          validFrom: "2026-02-15T00:00:00Z",
          validUntil: "2026-05-01T00:00:00Z",
        }),
      ),
    ];
    const { reader } = stubReader(events);
    const r = await getCurrentFeeDisclosure(reader, SIG, { nowMs: NOW });
    expect(r.contractId).toBe("v2");
    expect(r.config.version).toBe("2");
  });

  it("ignores a config belonging to a different sigNetwork", async () => {
    const events = [
      createdEvent(
        "foreign",
        feeConfig({
          sigNetwork: "other::xyz",
          validFrom: "2026-02-01T00:00:00Z",
          validUntil: "2026-04-01T00:00:00Z",
        }),
      ),
    ];
    const { reader } = stubReader(events);
    await expect(getCurrentFeeDisclosure(reader, SIG, { nowMs: NOW })).rejects.toThrow(
      /no in-window/,
    );
  });

  it("throws when no config is in window", async () => {
    const events = [
      createdEvent(
        "expired",
        feeConfig({ validFrom: "2020-01-01T00:00:00Z", validUntil: "2020-02-01T00:00:00Z" }),
      ),
    ];
    const { reader } = stubReader(events);
    await expect(getCurrentFeeDisclosure(reader, SIG, { nowMs: NOW })).rejects.toThrow(
      /no in-window/,
    );
  });
});

// ---------------------------------------------------------------------------
// getTransferFactoryForFee
// ---------------------------------------------------------------------------

describe("getTransferFactoryForFee", () => {
  const details = {
    sender: "requester::1",
    feeReceiver: SIG,
    instrumentAdmin: DSO,
    instrumentId: "Amulet",
    amount: "1.5",
    inputHoldingCids: ["h1", "h2"],
  };

  const okResponse = {
    factoryId: "factory::cid",
    transferKind: "direct",
    choiceContext: {
      disclosedContracts: [
        { templateId: "#splice:AmuletRules", contractId: "ar::1", createdEventBlob: "b1", synchronizerId: "s" },
        { templateId: "#splice:OpenMiningRound", contractId: "omr::1", createdEventBlob: "b2", synchronizerId: "s" },
      ],
      choiceContextData: { values: { "k": "v" } },
    },
  };

  function fetchStub(response: unknown, ok = true, status = 200) {
    return vi.fn(async (_url: string, _init: RequestInit) =>
      ({
        ok,
        status,
        json: async () => response,
        text: async () => JSON.stringify(response),
      }) as unknown as Response,
    );
  }

  it("builds the registry request body per the token-standard shape", async () => {
    const fetchImpl = fetchStub(okResponse);
    const now = new Date("2026-03-01T00:00:00Z");
    await getTransferFactoryForFee("https://registry.example", details, {
      now,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`https://registry.example${TRANSFER_FACTORY_REGISTRY_PATH}`);
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.choiceArguments.expectedAdmin).toBe(DSO);
    expect(body.choiceArguments.transfer.sender).toBe("requester::1");
    expect(body.choiceArguments.transfer.receiver).toBe(SIG);
    expect(body.choiceArguments.transfer.amount).toBe("1.5");
    expect(body.choiceArguments.transfer.instrumentId).toEqual({ admin: DSO, id: "Amulet" });
    expect(body.choiceArguments.transfer.inputHoldingCids).toEqual(["h1", "h2"]);
    expect(body.choiceArguments.transfer.requestedAt).toBe("2026-03-01T00:00:00.000Z");
    expect(body.choiceArguments.transfer.executeBefore).toBe("2026-03-02T00:00:00.000Z");
    expect(body.choiceArguments.extraArgs.context).toEqual(EMPTY_TRANSFER_CONTEXT);
    expect(body.excludeDebugFields).toBe(true);
  });

  it("maps the registry response to factory cid, context, and disclosures", async () => {
    const fetchImpl = fetchStub(okResponse);
    const r = await getTransferFactoryForFee("https://registry.example", details, {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(r.transferFactoryCid).toBe("factory::cid");
    expect(r.transferContext).toEqual({ values: { k: "v" } });
    expect(r.disclosedContracts).toHaveLength(2);
    expect(r.disclosedContracts.map((d) => d.contractId)).toEqual(["ar::1", "omr::1"]);
  });

  it("throws on a non-2xx registry response", async () => {
    const fetchImpl = fetchStub({ error: "boom" }, false, 503);
    await expect(
      getTransferFactoryForFee("https://registry.example", details, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/503/);
  });

  it("throws on a malformed registry response", async () => {
    const fetchImpl = fetchStub({ notAFactory: true });
    await expect(
      getTransferFactoryForFee("https://registry.example", details, {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      }),
    ).rejects.toThrow(/malformed/);
  });
});

// ---------------------------------------------------------------------------
// assembleFeeChoiceArgs + collectFeeDisclosures
// ---------------------------------------------------------------------------

describe("assembleFeeChoiceArgs + collectFeeDisclosures", () => {
  const fee = {
    config: parseFeeConfig(feeConfig()),
    contractId: "feecfg::1",
    disclosure: {
      templateId: "#daml-signer:SignerFee:SignerFeeConfig",
      contractId: "feecfg::1",
      createdEventBlob: "feeblob",
      synchronizerId: "s",
    } as DisclosedContract,
  };
  const factory = {
    transferFactoryCid: "factory::1",
    transferContext: { values: { a: "b" } },
    disclosedContracts: [
      { templateId: "#splice:AmuletRules", contractId: "ar::1", createdEventBlob: "b1", synchronizerId: "s" } as DisclosedContract,
    ],
  };
  const selection = { inputHoldingCids: ["h1", "h2"], total: "2.0" };

  it("folds resolved inputs into the choice arguments", () => {
    const args = assembleFeeChoiceArgs(fee, factory, selection);
    expect(args).toEqual({
      feeConfigCid: "feecfg::1",
      transferFactoryCid: "factory::1",
      inputHoldingCids: ["h1", "h2"],
      transferContext: { values: { a: "b" } },
    });
  });

  it("collects fee + factory disclosures (fee config first)", () => {
    const ds = collectFeeDisclosures(fee, factory);
    expect(ds.map((d) => d.contractId)).toEqual(["feecfg::1", "ar::1"]);
  });

  it("appends extra disclosures when provided", () => {
    const extra = [
      { templateId: "#splice:Amulet", contractId: "hold::1", createdEventBlob: "hb", synchronizerId: "s" } as DisclosedContract,
    ];
    const ds = collectFeeDisclosures(fee, factory, extra);
    expect(ds.map((d) => d.contractId)).toEqual(["feecfg::1", "ar::1", "hold::1"]);
  });
});
