/**
 * CC signature-fee reprice cron entrypoint
 * (`docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md` §11).
 *
 * Bootstraps and then periodically reprices the sigNetworkFA-signed `FeePriceConfig`:
 * reads the current market inputs, prices via `computeFeeCc`, and posts via create
 * / `UpdateFee` on a fresh overlapping validity window.
 *
 * Run (after `pnpm install`): `pnpm --filter canton-sig reprice`
 * (or `pnpm dlx tsx scripts/reprice-fee.ts`). All configuration is via env.
 *
 * ⚠️ Market-input seam: `amuletPriceUsdPerCc` — and ideally the extra-traffic
 * price and the measured post-back `bytes` — should be read live from Scan / the
 * current `OpenMiningRound`. This entrypoint reads them from env so it is runnable
 * today without binding an unverified Scan wire shape; for production, replace
 * {@link RepriceConfig.getMarketInputs} with a real Scan/OMR reader (spec §11).
 * The fee math itself stays off-ledger — only the CC number is posted.
 *
 * @module
 */

import {
  CantonClient,
  runRepriceLoop,
  type MarketInputs,
  type RepriceConfig,
} from "../src/index.js";

/** Read a required env var, failing loudly when missing — a misconfigured cron must not post garbage. */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === "") {
    throw new Error(`reprice-fee: missing required env ${name}`);
  }
  return value;
}

/** Read a required numeric env var. */
function numberEnv(name: string): number {
  const raw = requireEnv(name);
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`reprice-fee: env ${name} must be a finite number, got "${raw}"`);
  }
  return parsed;
}

/** Read an optional numeric env var, falling back to `fallback` when unset. */
function optionalNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new Error(`reprice-fee: env ${name} must be a finite number, got "${raw}"`);
  }
  return parsed;
}

async function main(): Promise<void> {
  const baseUrl = requireEnv("CANTON_JSON_API_URL");
  const token = process.env.CANTON_TOKEN;
  const client = new CantonClient(baseUrl, token ? { getToken: () => Promise.resolve(token) } : {});

  // Market inputs: read from env today. Replace with a live Scan / OpenMiningRound
  // reader for production (see the module note above).
  const getMarketInputs = (): Promise<MarketInputs> =>
    Promise.resolve({
      bytes: numberEnv("REPRICE_BYTES"),
      extraTrafficPriceUsdPerMb: numberEnv("REPRICE_EXTRA_TRAFFIC_USD_PER_MB"),
      amuletPriceUsdPerCc: numberEnv("REPRICE_AMULET_USD_PER_CC"),
    });

  const cfg: RepriceConfig = {
    userId: requireEnv("CANTON_USER_ID"),
    sigNetworkFA: requireEnv("SIG_NETWORK_FA_PARTY"),
    feeReceiver: requireEnv("FEE_RECEIVER_PARTY"),
    instrumentAdmin: requireEnv("CC_INSTRUMENT_ADMIN"),
    instrumentId: process.env.CC_INSTRUMENT_ID ?? "Amulet",
    coverage: optionalNumberEnv("REPRICE_COVERAGE", 0.15),
    profit: optionalNumberEnv("REPRICE_PROFIT", 0.1),
    windowMinutes: optionalNumberEnv("REPRICE_WINDOW_MINUTES", 30),
    getMarketInputs,
  };

  const intervalMs = optionalNumberEnv("REPRICE_INTERVAL_MS", 10 * 60 * 1000);

  console.log(
    `[reprice-fee] starting: sigNetworkFA=${cfg.sigNetworkFA} feeReceiver=${cfg.feeReceiver} ` +
      `interval=${intervalMs}ms window=${cfg.windowMinutes}min`,
  );
  await runRepriceLoop(client, cfg, {
    intervalMs,
    onTick: (r) =>
      console.log(
        `[reprice-fee] ${r.action} v${r.version} fee=${r.feeAmount} CC ` +
          `valid=[${r.validFrom}, ${r.validUntil}] cid=${r.contractId}`,
      ),
    onError: (e) =>
      console.error("[reprice-fee] reprice step failed (will retry next interval):", e),
  });
}

main().catch((e) => {
  console.error("[reprice-fee] fatal:", e);
  process.exitCode = 1;
});
