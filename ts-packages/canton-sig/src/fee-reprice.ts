/**
 * CC signature-fee reprice automation — the off-ledger pricing writer.
 *
 * {@link computeFeeCc} *prices* the fee off-ledger; this module is what actually
 * *posts* that price on-ledger and keeps it fresh. It owns the two write paths:
 *
 * 1. **Bootstrap** — when no `FeePriceConfig` exists yet for `sigNetworkFA`
 *    (the featured-app party administers fees), create the first one
 *    (`version = 0`).
 * 2. **Reprice** — otherwise roll the latest config forward with `UpdateFee`
 *    (archives the old, creates `version + 1`) on a fresh `[validFrom, validUntil]`
 *    window that overlaps the previous one. The payee is re-stamped from
 *    {@link RepriceConfig.feeReceiver} on every roll, so re-pointing it is just
 *    a config change picked up on the next tick.
 *
 * {@link repriceOnce} performs one idempotent compute→post step (safe to run on a
 * cron); {@link runRepriceLoop} drives it on the ~10-min cadence (≈ one
 * `OpenMiningRound` cycle).
 *
 * The fast-moving market inputs (`amuletPrice`, extra-traffic price, measured
 * post-back bytes) are read off-ledger and supplied via
 * {@link RepriceConfig.getMarketInputs} — the Scan / `OpenMiningRound` seam — so
 * this module needs no `splice-amulet` dependency and is fully unit-testable
 * without a live ledger or Scan.
 *
 * @module
 */

import { computeFeeCc } from "./fee-pricing.js";
import { parsePriceConfig } from "./fee.js";
import { findCreated } from "./infra/canton-helpers.js";
import type {
  CreatedEvent,
  DisclosedContract,
  TransactionResponse,
} from "./infra/canton-client.js";

import { FeePriceConfig } from "@daml.js/signet-fee-amulet-0.0.1/lib/Signet/Fee/Amulet/module.js";

/** Number of milliseconds in a minute (window arithmetic). */
const MS_PER_MINUTE = 60_000;

/** The fast-moving inputs read off-ledger from Scan / the current `OpenMiningRound`. */
export interface MarketInputs {
  /** Measured billable bytes of `Respond` + `RespondBidirectional` (measure it, never hand-calc). */
  bytes: number;
  /** Extra-traffic price, USD per MB. */
  extraTrafficPriceUsdPerMb: number;
  /** Amulet price, USD per CC. */
  amuletPriceUsdPerCc: number;
}

/** Static reprice configuration plus the off-ledger market-input provider. */
export interface RepriceConfig {
  /** Ledger API user submitting as `sigNetworkFA`. */
  userId: string;
  /** The featured-app party that signs (and administers) the `FeePriceConfig`. */
  sigNetworkFA: string;
  /** Who is paid (typically sigNetworkFA; re-stamped on every roll) — enforced on every bootstrap and reprice. */
  feeReceiver: string;
  /** CC instrument admin / DSO party. */
  instrumentAdmin: string;
  /** CC instrument id (e.g. `"Amulet"`). */
  instrumentId: string;
  /** Coverage buffer fraction (e.g. `0.15`); kept separate from `profit`. */
  coverage: number;
  /** Profit margin fraction (e.g. `0.10`). */
  profit: number;
  /** Validity-window length in minutes; ~30 (≈3× the reprice interval) is a sensible default. */
  windowMinutes: number;
  /** Reads the current off-ledger market inputs (the Scan / `OpenMiningRound` seam). */
  getMarketInputs: () => Promise<MarketInputs>;
}

/**
 * The minimal ledger surface the reprice job needs — satisfied structurally by
 * {@link CantonClient}, and trivially stubbable in tests.
 */
export interface FeeRepriceClient {
  getActiveContracts(
    parties: string[],
    templateId: string,
    includeCreatedEventBlob?: boolean,
  ): Promise<CreatedEvent[]>;
  createContract(
    userId: string,
    actAs: string[],
    templateId: string,
    payload: Record<string, unknown>,
  ): Promise<TransactionResponse>;
  exerciseChoice(
    userId: string,
    actAs: string[],
    templateId: string,
    contractId: string,
    choice: string,
    choiceArgument: Record<string, unknown>,
    readAs?: string[],
    disclosedContracts?: DisclosedContract[],
  ): Promise<TransactionResponse>;
}

/** Outcome of one {@link repriceOnce} step. */
export interface RepriceResult {
  /** Whether the config was bootstrapped (`created`) or rolled forward (`updated`). */
  action: "created" | "updated";
  /** Contract id of the new `FeePriceConfig`. */
  contractId: string;
  /** The posted CC fee, as a Daml `Decimal` string. */
  feeAmount: string;
  /** Version of the new config (`0` on bootstrap, else previous + 1). */
  version: number;
  /** Validity-window start (RFC3339). */
  validFrom: string;
  /** Validity-window end (RFC3339). */
  validUntil: string;
}

/**
 * Compute the `[validFrom, validUntil]` window for a config posted at `nowMs`.
 * `nowMs` is injected so the result is deterministic in tests.
 *
 * @throws If `nowMs` is non-finite or `windowMinutes` is not positive.
 */
export function repriceWindow(
  nowMs: number,
  windowMinutes: number,
): { validFrom: string; validUntil: string } {
  if (!Number.isFinite(nowMs)) {
    throw new Error(`repriceWindow: nowMs must be finite, got ${nowMs}`);
  }
  if (!Number.isFinite(windowMinutes) || windowMinutes <= 0) {
    throw new Error(`repriceWindow: windowMinutes must be positive, got ${windowMinutes}`);
  }
  return {
    validFrom: new Date(nowMs).toISOString(),
    validUntil: new Date(nowMs + windowMinutes * MS_PER_MINUTE).toISOString(),
  };
}

/**
 * Find the latest `FeePriceConfig` for `sigNetworkFA` (highest `version`, any
 * window), or `null` if none exists yet. Drives the bootstrap-vs-reprice decision
 * and targets `UpdateFee`. Unlike `getFeeCollectorContext` (which serves the
 * in-window config to requesters), this deliberately ignores the window so the
 * job can always roll the newest config forward — even just after one expired.
 */
export async function findLatestPriceConfig(
  client: Pick<FeeRepriceClient, "getActiveContracts">,
  sigNetworkFA: string,
  opts: { templateId?: string } = {},
): Promise<{ contractId: string; version: number } | null> {
  const templateId = opts.templateId ?? FeePriceConfig.templateId;
  const events = await client.getActiveContracts([sigNetworkFA], templateId, false);
  const configs = events
    .map((ev) => ({ ev, config: parsePriceConfig(ev.createArgument) }))
    .filter(({ config }) => config.sigNetworkFA === sigNetworkFA)
    .sort((a, b) => (BigInt(a.config.version) < BigInt(b.config.version) ? 1 : -1));
  const top = configs[0];
  return top ? { contractId: top.ev.contractId, version: Number(top.config.version) } : null;
}

/**
 * One idempotent compute→post step: price the fee off the current market inputs,
 * then bootstrap (create) or reprice (`UpdateFee`) the `FeePriceConfig`. Safe to
 * run on a cron — re-running simply rolls the config forward another version.
 *
 * @param opts.nowMs - Override "now" for the validity window (defaults to `Date.now()`).
 * @throws If pricing inputs are invalid (see {@link computeFeeCc}) or the
 *   submission fails — a misconfigured reprice fails loudly rather than posting garbage.
 */
export async function repriceOnce(
  client: FeeRepriceClient,
  cfg: RepriceConfig,
  opts: { nowMs?: number } = {},
): Promise<RepriceResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const market = await cfg.getMarketInputs();
  const { feeCc } = computeFeeCc({
    bytes: market.bytes,
    extraTrafficPriceUsdPerMb: market.extraTrafficPriceUsdPerMb,
    amuletPriceUsdPerCc: market.amuletPriceUsdPerCc,
    coverage: cfg.coverage,
    profit: cfg.profit,
  });
  const { validFrom, validUntil } = repriceWindow(nowMs, cfg.windowMinutes);
  const templateId = FeePriceConfig.templateId;

  const latest = await findLatestPriceConfig(client, cfg.sigNetworkFA, { templateId });
  if (latest) {
    const res = await client.exerciseChoice(
      cfg.userId,
      [cfg.sigNetworkFA],
      templateId,
      latest.contractId,
      "UpdateFee",
      {
        newAmount: feeCc,
        newFeeReceiver: cfg.feeReceiver,
        newValidFrom: validFrom,
        newValidUntil: validUntil,
      },
    );
    const created = findCreated(res.transaction.events, "FeePriceConfig");
    return {
      action: "updated",
      contractId: created.contractId,
      feeAmount: feeCc,
      version: latest.version + 1,
      validFrom,
      validUntil,
    };
  }

  // Daml `Decimal`/`Int`/`Time` fields travel as JSON strings over the Ledger API.
  const res = await client.createContract(cfg.userId, [cfg.sigNetworkFA], templateId, {
    sigNetworkFA: cfg.sigNetworkFA,
    feeReceiver: cfg.feeReceiver,
    instrumentAdmin: cfg.instrumentAdmin,
    instrumentId: cfg.instrumentId,
    feeAmount: feeCc,
    validFrom,
    validUntil,
    version: "0",
    meta: { values: {} },
  });
  const created = findCreated(res.transaction.events, "FeePriceConfig");
  return {
    action: "created",
    contractId: created.contractId,
    feeAmount: feeCc,
    version: 0,
    validFrom,
    validUntil,
  };
}

/** Options controlling {@link runRepriceLoop}; the injectable seams keep it testable. */
export interface RepriceLoopOptions {
  /** Delay between reprice steps in ms (e.g. 10 min). */
  intervalMs: number;
  /** Loop guard — return `false` to stop. Defaults to running forever. */
  shouldContinue?: () => boolean;
  /** Sleep implementation (injected in tests). Defaults to `setTimeout`. */
  sleep?: (ms: number) => Promise<void>;
  /** Clock (injected in tests). Defaults to `Date.now`. */
  now?: () => number;
  /** Called after each successful reprice (heartbeat / observability). */
  onTick?: (result: RepriceResult) => void;
  /** Called when a reprice step throws; the loop continues (fail-soft). */
  onError?: (error: unknown) => void;
}

/**
 * Drive {@link repriceOnce} on a fixed cadence. A failing step is reported via
 * `onError` and does **not** stop the loop — a transient ledger/registry blip must
 * not silently halt repricing, and the overlapping window keeps the previous
 * config valid meanwhile. Stop by returning `false` from `shouldContinue`.
 */
export async function runRepriceLoop(
  client: FeeRepriceClient,
  cfg: RepriceConfig,
  opts: RepriceLoopOptions,
): Promise<void> {
  const shouldContinue = opts.shouldContinue ?? (() => true);
  const sleep =
    opts.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = opts.now ?? Date.now;

  while (shouldContinue()) {
    try {
      const result = await repriceOnce(client, cfg, { nowMs: now() });
      opts.onTick?.(result);
    } catch (error) {
      opts.onError?.(error);
    }
    if (!shouldContinue()) break;
    await sleep(opts.intervalMs);
  }
}
