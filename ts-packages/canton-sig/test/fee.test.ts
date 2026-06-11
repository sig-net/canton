import { describe, it, expect, vi } from "vitest";

import {
  selectInputHoldings,
  holdingInputsFromEvents,
  parsePriceConfig,
  isPriceConfigInWindow,
  getFeeCollectorContext,
  getTransferFactoryForFee,
  assembleFeeChoiceArgs,
  collectFeeDisclosures,
  EMPTY_TRANSFER_CONTEXT,
  TRANSFER_FACTORY_REGISTRY_PATH,
  PRICE_CONFIG_CONTEXT_KEY,
  TRANSFER_FACTORY_CONTEXT_KEY,
  FEE_COLLECTOR_ENDPOINT_PATH,
  type HoldingInput,
} from "canton-sig";
import type {
  CreatedEvent,
  DisclosedContract,
  FeeCollectorContext,
  ResolvedTransferFactory,
} from "canton-sig";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FA = "sigNetworkFA::fa";
const DSO = "dso::abc";
const NOW = Date.parse("2026-06-10T12:00:00Z");

/** A FeePriceConfig payload (Daml Decimal/Int/Time fields travel as JSON strings). */
function priceConfigPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sigNetworkFA: FA,
    feeReceiver: FA,
    instrumentAdmin: DSO,
    instrumentId: "Amulet",
    feeAmount: "1.5",
    validFrom: "2026-06-10T00:00:00Z",
    validUntil: "2026-06-11T00:00:00Z",
    version: "0",
    meta: { values: {} },
    ...overrides,
  };
}

function priceConfigEvent(
  contractId: string,
  overrides: Record<string, unknown> = {},
): CreatedEvent {
  return {
    contractId,
    templateId: "#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig",
    createArgument: priceConfigPayload(overrides),
  } as CreatedEvent;
}

function registrationEvent(contractId: string, collector: string): CreatedEvent {
  return {
    contractId,
    templateId: "#signet-api-fee-v1:Signet.Api.Fee.V1:FeeCollectorRegistration",
    createArgument: { sigNetworkFA: FA, collector, meta: { values: {} } },
  } as CreatedEvent;
}

function disclosure(contractId: string): DisclosedContract {
  return {
    contractId,
    templateId: "stub",
    createdEventBlob: `blob-${contractId}`,
    synchronizerId: "sync::1",
  } as DisclosedContract;
}

function holding(contractId: string, amount: string, locked = false): HoldingInput {
  return { contractId, amount, locked };
}

// ---------------------------------------------------------------------------
// Fee endpoint contract (wire-pinned constants)
// ---------------------------------------------------------------------------

describe("fee endpoint contract", () => {
  it("pins the collector endpoint path and context keys", () => {
    expect(FEE_COLLECTOR_ENDPOINT_PATH).toBe("/fee/v1/collector");
    expect(PRICE_CONFIG_CONTEXT_KEY).toBe("signet.network/fee/price-config");
    expect(TRANSFER_FACTORY_CONTEXT_KEY).toBe("signet.network/fee/transfer-factory");
  });
});

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
    const r = selectInputHoldings(
      [holding("locked", "100.0", true), holding("free", "1.0")],
      "1.0",
    );
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
// parsePriceConfig + isPriceConfigInWindow
// ---------------------------------------------------------------------------

describe("parsePriceConfig", () => {
  it("decodes a well-formed FeePriceConfig payload", () => {
    const cfg = parsePriceConfig(priceConfigPayload());
    expect(cfg.feeAmount).toBe("1.5");
    expect(cfg.sigNetworkFA).toBe(FA);
    expect(cfg.version).toBe("0");
  });

  it("throws on a malformed payload", () => {
    expect(() => parsePriceConfig({ nope: true })).toThrow();
  });
});

describe("isPriceConfigInWindow", () => {
  it("is true inside the window and false outside", () => {
    const cfg = parsePriceConfig(priceConfigPayload());
    expect(isPriceConfigInWindow(cfg, NOW)).toBe(true);
    expect(isPriceConfigInWindow(cfg, Date.parse("2026-06-12T00:00:00Z"))).toBe(false);
    expect(isPriceConfigInWindow(cfg, Date.parse("2026-06-09T00:00:00Z"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getFeeCollectorContext
// ---------------------------------------------------------------------------

describe("getFeeCollectorContext", () => {
  function mkReader(registrations: CreatedEvent[], priceConfigs: CreatedEvent[]) {
    return {
      getActiveContracts: (_parties: string[], templateId: string) =>
        Promise.resolve(
          templateId.includes("FeeCollectorRegistration") ? registrations : priceConfigs,
        ),
      getDisclosedContract: (_parties: string[], _templateId: string, contractId: string) =>
        Promise.resolve(disclosure(contractId)),
    };
  }

  it("returns registration, collector, price config and the context key", async () => {
    const reader = mkReader([registrationEvent("reg::1", "coll::1")], [priceConfigEvent("cfg::1")]);
    const r = await getFeeCollectorContext(reader, FA, {
      nowMs: NOW,
      collectorTemplateId: "#signet-fee-amulet:Signet.Fee.Amulet:CcFeeCollector",
    });
    expect(r.registrationCid).toBe("reg::1");
    expect(r.collectorCid).toBe("coll::1");
    expect(r.priceConfigCid).toBe("cfg::1");
    expect(r.priceConfig.feeAmount).toBe("1.5");
    expect(r.choiceContextData.values[PRICE_CONFIG_CONTEXT_KEY]).toEqual({
      tag: "AV_ContractId",
      value: "cfg::1",
    });
    expect(r.disclosedContracts.map((d) => d.contractId)).toEqual(["reg::1", "coll::1", "cfg::1"]);
  });

  it("picks the in-window config with the highest version on overlap", async () => {
    const reader = mkReader(
      [registrationEvent("reg::1", "coll::1")],
      [
        priceConfigEvent("cfg::old", { version: "3" }),
        priceConfigEvent("cfg::new", { version: "4" }),
      ],
    );
    const r = await getFeeCollectorContext(reader, FA, {
      nowMs: NOW,
      collectorTemplateId: "tpl::collector",
    });
    expect(r.priceConfigCid).toBe("cfg::new");
  });

  it("throws when no registration exists", async () => {
    const reader = mkReader([], [priceConfigEvent("cfg::1")]);
    await expect(
      getFeeCollectorContext(reader, FA, { nowMs: NOW, collectorTemplateId: "tpl::collector" }),
    ).rejects.toThrow(/no FeeCollectorRegistration/);
  });

  it("throws on multiple active registrations (ambiguous rotation state)", async () => {
    const reader = mkReader(
      [registrationEvent("reg::1", "coll::1"), registrationEvent("reg::2", "coll::2")],
      [priceConfigEvent("cfg::1")],
    );
    await expect(
      getFeeCollectorContext(reader, FA, { nowMs: NOW, collectorTemplateId: "tpl::collector" }),
    ).rejects.toThrow(/multiple active FeeCollectorRegistration/);
  });

  it("throws when no in-window price config exists", async () => {
    const reader = mkReader(
      [registrationEvent("reg::1", "coll::1")],
      [
        priceConfigEvent("cfg::stale", {
          validFrom: "2026-06-10T00:00:00Z",
          validUntil: "2026-06-10T01:00:00Z",
        }),
      ],
    );
    await expect(
      getFeeCollectorContext(reader, FA, { nowMs: NOW, collectorTemplateId: "tpl::collector" }),
    ).rejects.toThrow(/no in-window FeePriceConfig/);
  });
});

// ---------------------------------------------------------------------------
// getTransferFactoryForFee
// ---------------------------------------------------------------------------

describe("getTransferFactoryForFee", () => {
  const details = {
    sender: "requester::1",
    feeReceiver: FA,
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
        {
          templateId: "#splice:AmuletRules",
          contractId: "ar::1",
          createdEventBlob: "b1",
          synchronizerId: "s",
        },
        {
          templateId: "#splice:OpenMiningRound",
          contractId: "omr::1",
          createdEventBlob: "b2",
          synchronizerId: "s",
        },
      ],
      choiceContextData: { values: { k: "v" } },
    },
  };

  function fetchStub(response: unknown, ok = true, status = 200) {
    return vi.fn((_url: string, _init: RequestInit) =>
      Promise.resolve({
        ok,
        status,
        json: () => Promise.resolve(response),
        text: () => Promise.resolve(JSON.stringify(response)),
      } as unknown as Response),
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
    const body = JSON.parse(init.body as string) as {
      choiceArguments: {
        expectedAdmin: string;
        transfer: {
          sender: string;
          receiver: string;
          amount: string;
          instrumentId: { admin: string; id: string };
          inputHoldingCids: string[];
          requestedAt: string;
          executeBefore: string;
        };
        extraArgs: { context: unknown };
      };
      excludeDebugFields: boolean;
    };
    expect(body.choiceArguments.expectedAdmin).toBe(DSO);
    expect(body.choiceArguments.transfer.sender).toBe("requester::1");
    expect(body.choiceArguments.transfer.receiver).toBe(FA);
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
  const collector: FeeCollectorContext = {
    registrationCid: "reg::1",
    collectorCid: "coll::1",
    priceConfigCid: "cfg::1",
    priceConfig: parsePriceConfig(priceConfigPayload()),
    choiceContextData: {
      values: { [PRICE_CONFIG_CONTEXT_KEY]: { tag: "AV_ContractId", value: "cfg::1" } },
    },
    disclosedContracts: [disclosure("reg::1"), disclosure("coll::1"), disclosure("cfg::1")],
  };
  const factory: ResolvedTransferFactory = {
    transferFactoryCid: "factory::1",
    transferContext: { values: { "splice.lfdecentralizedtrust.org/open-round": "round::7" } },
    disclosedContracts: [disclosure("factory::1"), disclosure("rules::1")],
  };
  const selection = { inputHoldingCids: ["h::1", "h::2"], total: "2.0" };

  it("builds the three choice args with a merged context", () => {
    const args = assembleFeeChoiceArgs(collector, factory, selection);
    expect(args.feeRegistrationCid).toBe("reg::1");
    expect(args.feeInputs).toEqual(["h::1", "h::2"]);
    expect(args.feeExtraArgs.meta).toEqual({ values: {} });
    expect(args.feeExtraArgs.context.values[PRICE_CONFIG_CONTEXT_KEY]).toEqual({
      tag: "AV_ContractId",
      value: "cfg::1",
    });
    expect(args.feeExtraArgs.context.values[TRANSFER_FACTORY_CONTEXT_KEY]).toEqual({
      tag: "AV_ContractId",
      value: "factory::1",
    });
    expect(args.feeExtraArgs.context.values["splice.lfdecentralizedtrust.org/open-round"]).toBe(
      "round::7",
    );
  });

  it("collects fee-endpoint + registry disclosures, plus extras", () => {
    const ds = collectFeeDisclosures(collector, factory);
    expect(ds.map((d) => d.contractId)).toEqual([
      "reg::1",
      "coll::1",
      "cfg::1",
      "factory::1",
      "rules::1",
    ]);
    const extra = disclosure("extra::1");
    expect(collectFeeDisclosures(collector, factory, [extra]).at(-1)).toBe(extra);
  });
});
