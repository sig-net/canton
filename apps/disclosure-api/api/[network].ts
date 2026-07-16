/**
 * Public, read-only endpoint serving Canton disclosed-contract blobs.
 *
 *   GET /api/<network>   →   { network, signer, vault, fee }   for public networks (testnet)
 *
 * Routing is purely Vercel's filesystem convention — no rewrites or aliases exist, so the
 * explicit per-network path is the only URL (the bare root deliberately 404s).
 *
 * Non-public networks are not served here — they live under `api/internal/` and are not
 * part of the integrator surface.
 *
 * An MPC-vault integrator attaches these to a `RequestDeposit` / `RequestWithdrawal`
 * submission so a requester who cannot read the `sigNetwork`-only `Signer` from its own
 * ACS can still disclose it: `[signer, vault, ...fee]`.
 *
 * Data source: `disclosures.<network>.ts` — generated modules written by
 * `test/src/scripts/deploy.ts` (step 6) on each (re)deploy of that network and compiled
 * into the function by Vercel's Node builder (a plain module import is reliably traced and
 * bundled; a JSON import is not). The endpoint needs no ledger access, no OIDC secrets, and
 * no Daml-generated code at runtime — it just returns committed, ledger-public payloads. A
 * `createdEventBlob` grants no authority (submitting with it still requires on-ledger
 * authorization), so these are safe to serve publicly.
 *
 * NOTE(prod): the `fee` entry is a convenience snapshot. `FeePriceConfig` reprices
 * (`UpdateFee` archives + recreates it), so a static snapshot goes stale, and a
 * non-stakeholder requester can't read it from the ledger anyway. In production this
 * endpoint must resolve the fee live (read as `sigNetworkFA` via `getFeeCollectorContext`)
 * rather than serve the baked-in module. `Signer`/`Vault` are stable singletons, so serving
 * those from the snapshot stays correct.
 */
import testnet from "../disclosures.testnet.js";
import { makeDisclosureHandler } from "../lib/handler.js";

export default makeDisclosureHandler({ testnet });
