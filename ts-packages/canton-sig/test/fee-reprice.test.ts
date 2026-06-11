import { describe, it, expect, vi } from "vitest";

import {
  repriceWindow,
  findLatestPriceConfig,
  repriceOnce,
  runRepriceLoop,
  type MarketInputs,
  type RepriceConfig,
  type FeeRepriceClient,
} from "canton-sig";
import type { CreatedEvent, TransactionResponse } from "canton-sig";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FA = "sigNetworkFA::abc";
const DSO = "dso::abc";

/** A `FeePriceConfig` payload (Daml `Decimal`/`Int`/`Time` fields are JSON strings). */
function feeConfig(over: Record<string, unknown> = {}) {
  return {
    sigNetworkFA: FA,
    feeReceiver: FA,
    instrumentAdmin: DSO,
    instrumentId: "Amulet",
    feeAmount: "1.0",
    validFrom: "1970-01-01T00:00:00Z",
    validUntil: "2099-12-31T00:00:00Z",
    version: "0",
    meta: { values: {} },
    ...over,
  };
}

function cfgEvent(contractId: string, version: string, sigNetworkFA = FA): CreatedEvent {
  return {
    contractId,
    templateId: "#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig",
    createArgument: feeConfig({ version, sigNetworkFA }),
    createdEventBlob: `blob-${contractId}`,
  } as unknown as CreatedEvent;
}

/** A submission response carrying one created `FeePriceConfig`. */
function txWithCreated(contractId: string): TransactionResponse {
  return {
    transaction: {
      events: [
        {
          CreatedEvent: {
            contractId,
            templateId: "#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig",
            createArgument: {},
            createdEventBlob: "",
          },
        },
      ],
    },
  } as unknown as TransactionResponse;
}

// Fee-formula golden: 400KB @ $1/MB, $0.005/CC, coverage 0.15 + profit 0.10 → 100 CC.
const MARKET: MarketInputs = {
  bytes: 400_000,
  extraTrafficPriceUsdPerMb: 1,
  amuletPriceUsdPerCc: 0.005,
};
const EXPECTED_FEE = "100.0000000000";
const NOW = Date.parse("2024-01-01T00:00:00Z");

function baseConfig(over: Partial<RepriceConfig> = {}): RepriceConfig {
  return {
    userId: "u",
    sigNetworkFA: FA,
    feeReceiver: FA,
    instrumentAdmin: DSO,
    instrumentId: "Amulet",
    coverage: 0.15,
    profit: 0.1,
    windowMinutes: 30,
    getMarketInputs: () => Promise.resolve(MARKET),
    ...over,
  };
}

function fakeClient(active: CreatedEvent[] = []) {
  const getActiveContracts = vi.fn<FeeRepriceClient["getActiveContracts"]>(() =>
    Promise.resolve(active),
  );
  const createContract = vi.fn<FeeRepriceClient["createContract"]>(() =>
    Promise.resolve(txWithCreated("cfg-created")),
  );
  const exerciseChoice = vi.fn<FeeRepriceClient["exerciseChoice"]>(() =>
    Promise.resolve(txWithCreated("cfg-updated")),
  );
  const client: FeeRepriceClient = { getActiveContracts, createContract, exerciseChoice };
  return { client, getActiveContracts, createContract, exerciseChoice };
}

// ---------------------------------------------------------------------------
// repriceWindow
// ---------------------------------------------------------------------------

describe("repriceWindow", () => {
  it("computes validFrom=now and validUntil=now+windowMinutes (RFC3339)", () => {
    const w = repriceWindow(NOW, 30);
    expect(w.validFrom).toBe("2024-01-01T00:00:00.000Z");
    expect(w.validUntil).toBe("2024-01-01T00:30:00.000Z");
  });

  it("rejects a non-positive window and a non-finite now", () => {
    expect(() => repriceWindow(NOW, 0)).toThrow(/windowMinutes/);
    expect(() => repriceWindow(NOW, -5)).toThrow(/windowMinutes/);
    expect(() => repriceWindow(NaN, 30)).toThrow(/nowMs/);
  });
});

// ---------------------------------------------------------------------------
// findLatestPriceConfig
// ---------------------------------------------------------------------------

describe("findLatestPriceConfig", () => {
  it("returns the highest-version config for the sigNetwork", async () => {
    const { client } = fakeClient([cfgEvent("a", "1"), cfgEvent("c", "5"), cfgEvent("b", "3")]);
    expect(await findLatestPriceConfig(client, FA)).toEqual({ contractId: "c", version: 5 });
  });

  it("ignores configs belonging to a different sigNetworkFA", async () => {
    const { client } = fakeClient([cfgEvent("x", "9", "other::zzz")]);
    expect(await findLatestPriceConfig(client, FA)).toBeNull();
  });

  it("returns null when no config exists", async () => {
    const { client } = fakeClient([]);
    expect(await findLatestPriceConfig(client, FA)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// repriceOnce
// ---------------------------------------------------------------------------

describe("repriceOnce", () => {
  it("bootstraps (create, version 0) when no config exists, posting the golden fee", async () => {
    const { client, createContract, exerciseChoice } = fakeClient([]);
    const r = await repriceOnce(client, baseConfig(), { nowMs: NOW });

    expect(r).toMatchObject({
      action: "created",
      version: 0,
      feeAmount: EXPECTED_FEE,
      contractId: "cfg-created",
    });
    expect(exerciseChoice).not.toHaveBeenCalled();
    expect(createContract).toHaveBeenCalledTimes(1);

    const [, actAs, , payload] = createContract.mock.calls[0]!;
    expect(actAs).toEqual([FA]);
    expect(payload).toMatchObject({
      sigNetworkFA: FA,
      feeReceiver: FA,
      instrumentAdmin: DSO,
      instrumentId: "Amulet",
      feeAmount: EXPECTED_FEE,
      version: "0",
      meta: { values: {} },
      validFrom: "2024-01-01T00:00:00.000Z",
      validUntil: "2024-01-01T00:30:00.000Z",
    });
  });

  it("reprices via UpdateFee (version + 1) when a config already exists", async () => {
    const { client, createContract, exerciseChoice } = fakeClient([cfgEvent("old", "2")]);
    const r = await repriceOnce(client, baseConfig(), { nowMs: NOW });

    expect(r).toMatchObject({
      action: "updated",
      version: 3,
      feeAmount: EXPECTED_FEE,
      contractId: "cfg-updated",
    });
    expect(createContract).not.toHaveBeenCalled();
    expect(exerciseChoice).toHaveBeenCalledTimes(1);

    const [, actAs, , contractId, choice, arg] = exerciseChoice.mock.calls[0]!;
    expect(actAs).toEqual([FA]);
    expect(contractId).toBe("old");
    expect(choice).toBe("UpdateFee");
    expect(arg).toMatchObject({
      newAmount: EXPECTED_FEE,
      newFeeReceiver: FA,
      newValidFrom: "2024-01-01T00:00:00.000Z",
      newValidUntil: "2024-01-01T00:30:00.000Z",
    });
  });

  it("re-points feeReceiver on reprice when the configured payee changes", async () => {
    const TREASURY = "treasury::abc";
    const { client, exerciseChoice } = fakeClient([cfgEvent("old", "2")]);
    await repriceOnce(client, baseConfig({ feeReceiver: TREASURY }), { nowMs: NOW });

    const [, , , , , arg] = exerciseChoice.mock.calls[0]!;
    expect(arg).toMatchObject({ newFeeReceiver: TREASURY });
  });

  it("targets the highest-version config when several are active", async () => {
    const { client, exerciseChoice } = fakeClient([
      cfgEvent("v1", "1"),
      cfgEvent("v7", "7"),
      cfgEvent("v3", "3"),
    ]);
    const r = await repriceOnce(client, baseConfig(), { nowMs: NOW });

    expect(r.version).toBe(8);
    expect(exerciseChoice.mock.calls[0]![3]).toBe("v7");
  });

  it("propagates pricing errors (fail-closed) from bad market inputs", async () => {
    const { client, createContract, exerciseChoice } = fakeClient([]);
    await expect(
      repriceOnce(
        client,
        baseConfig({
          getMarketInputs: () => Promise.resolve({ ...MARKET, amuletPriceUsdPerCc: 0 }),
        }),
      ),
    ).rejects.toThrow(/amuletPrice/);
    expect(createContract).not.toHaveBeenCalled();
    expect(exerciseChoice).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// runRepriceLoop
// ---------------------------------------------------------------------------

describe("runRepriceLoop", () => {
  it("reprices until shouldContinue() is false, reporting each tick and sleeping between", async () => {
    const { client, createContract } = fakeClient([]);
    let completed = 0;
    const onTick = vi.fn(() => {
      completed += 1;
    });
    const sleep = vi.fn(async () => {});
    await runRepriceLoop(client, baseConfig(), {
      intervalMs: 1000,
      shouldContinue: () => completed < 3,
      sleep,
      now: () => NOW,
      onTick,
    });

    expect(onTick).toHaveBeenCalledTimes(3);
    expect(createContract).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledTimes(2); // no sleep after the final tick
    expect(sleep).toHaveBeenCalledWith(1000);
  });

  it("reports a failed step via onError and keeps going (fail-soft)", async () => {
    const { client } = fakeClient([]);
    const getMarketInputs = vi
      .fn<() => Promise<MarketInputs>>()
      .mockRejectedValueOnce(new Error("scan down"))
      .mockResolvedValue(MARKET);
    let completed = 0;
    const onTick = vi.fn(() => {
      completed += 1;
    });
    const onError = vi.fn();
    await runRepriceLoop(client, baseConfig({ getMarketInputs }), {
      intervalMs: 1,
      shouldContinue: () => completed < 1,
      sleep: async () => {},
      now: () => NOW,
      onTick,
      onError,
    });

    expect(onError).toHaveBeenCalledTimes(1); // first step threw
    expect(onTick).toHaveBeenCalledTimes(1); // second step succeeded
  });
});
