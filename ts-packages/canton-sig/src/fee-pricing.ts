/**
 * Off-ledger CC fee pricing (sigNetwork reprice automation).
 *
 * Implements the `fee_cc` computation from `proposals/cc-signature-fee.md` §6.3.
 * sigNetwork's ~10-minute reprice job calls {@link computeFeeCc} with the
 * current Scan / `OpenMiningRound` inputs and posts the result via
 * `SignerFeeConfig.UpdateFee`. `Execute` reads only the resulting flat CC value,
 * so none of this math runs on-ledger.
 *
 * ```text
 * cost_usd = bytes / 1e6 * extraTrafficPrice            # gross traffic cost (USD)
 * fee_cc   = (cost_usd / amuletPrice) * (1 + coverage + profit)
 * ```
 *
 * The fee covers sigNetwork's gross traffic cost of submitting the two evidence
 * post-backs (`Respond` + `RespondBidirectional`), plus a `coverage` buffer
 * (absorbs `amuletPrice` moves over one re-peg interval) and a `profit` margin.
 * Featured-app rewards on those same post-backs are upside, never netted in.
 *
 * @module
 */

/** Inputs to the §6.3 `fee_cc` formula. All prices are point-in-time reads. */
export interface FeePricingInputs {
  /**
   * Measured billable bytes of `Respond` + `RespondBidirectional` (Scan
   * CIP-0104 traffic API or a `MemberTraffic` delta — measured, never hand-calc).
   */
  bytes: number;
  /** Extra-traffic price in USD per MB (Scan / current `OpenMiningRound`). */
  extraTrafficPriceUsdPerMb: number;
  /** Amulet price in USD per CC (Scan / current `OpenMiningRound`). */
  amuletPriceUsdPerCc: number;
  /**
   * Coverage buffer (fraction, e.g. `0.15`). Tuned to the worst `amuletPrice`
   * move over one re-peg interval + post-back latency. Guarantees coverage.
   */
  coverage: number;
  /** Profit margin (fraction, e.g. `0.10`), separate from `coverage`. */
  profit: number;
}

/** The computed fee and the intermediate gross USD cost (for observability). */
export interface FeePricingResult {
  /** Gross traffic cost in USD (`bytes / 1e6 * extraTrafficPrice`). */
  costUsd: number;
  /** The fee to post, as a Daml `Decimal` string (scale 10). */
  feeCc: string;
}

/** Daml `Decimal` scale (`Numeric 10`); the posted `feeAmount` is rounded to this. */
const CC_SCALE = 10;

/**
 * Compute the CC fee per §6.3.
 *
 * Float math is intentional — these are point-in-time price estimates re-pegged
 * every ~10 min with a coverage buffer, not exact ledger amounts. The result is
 * rounded to scale 10 (a Daml `Decimal`); the `coverage` buffer, not the 10th
 * decimal, is what guarantees the fee never under-collects.
 *
 * @throws If any input is non-finite/negative, or `amuletPriceUsdPerCc <= 0`,
 *   or `coverage`/`profit` are negative — a misconfigured reprice must fail
 *   loudly, never post a garbage fee.
 */
export function computeFeeCc(inputs: FeePricingInputs): FeePricingResult {
  const { bytes, extraTrafficPriceUsdPerMb, amuletPriceUsdPerCc, coverage, profit } = inputs;

  const finiteNonNeg = (n: number) => Number.isFinite(n) && n >= 0;
  if (![bytes, extraTrafficPriceUsdPerMb, coverage, profit].every(finiteNonNeg)) {
    throw new Error(`computeFeeCc: inputs must be finite and non-negative: ${JSON.stringify(inputs)}`);
  }
  if (!Number.isFinite(amuletPriceUsdPerCc) || amuletPriceUsdPerCc <= 0) {
    throw new Error(`computeFeeCc: amuletPriceUsdPerCc must be positive, got ${amuletPriceUsdPerCc}`);
  }

  const costUsd = (bytes / 1_000_000) * extraTrafficPriceUsdPerMb;
  const feeCcRaw = (costUsd / amuletPriceUsdPerCc) * (1 + coverage + profit);
  return { costUsd, feeCc: feeCcRaw.toFixed(CC_SCALE) };
}
