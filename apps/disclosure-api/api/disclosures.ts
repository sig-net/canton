/**
 * Public, read-only endpoint serving the Canton DevNet disclosed-contract blobs an
 * MPC-vault integrator must attach to a `RequestDeposit` / `RequestWithdrawal`
 * submission: the `Signer`, the `Vault`, and the CC fee trio
 * (`FeeCollectorRegistration` + `CcFeeCollector` + `FeePriceConfig`). It exists so a
 * requester who cannot read the `sigNetwork`-only `Signer` in their own ACS can
 * still obtain its disclosure envelope.
 *
 * Data source: `disclosures.devnet.ts` (this package) — a generated module written by
 * `test/src/scripts/deploy-devnet.ts` (step 6) on each DevNet (re)deploy and compiled
 * into the function by Vercel's Node builder (a plain module import, unlike a JSON file,
 * is reliably traced + bundled). The endpoint needs no ledger access, no OIDC
 * credentials, and no Daml-generated code at runtime — it just returns committed,
 * ledger-public disclosure payloads. A `createdEventBlob` grants no authority:
 * submitting with it still requires on-ledger authorization, so these are safe to serve
 * publicly.
 *
 * NOTE(prod): the `fee` entry is a DevNet convenience. The `FeePriceConfig` reprices
 * (`UpdateFee` archives it and creates a new version), so a static snapshot of it goes
 * stale; and a real, non-stakeholder requester can't read it from the ledger anyway. In
 * production this endpoint must resolve the fee LIVE — reading as `sigNetworkFA` via
 * `getFeeCollectorContext` — instead of serving the baked-in module. `Signer`/`Vault` are
 * stable singletons, so serving those from the snapshot stays correct.
 */
import disclosures from "../disclosures.devnet.js";

// Response = the disclosure envelopes for one RequestDeposit / RequestWithdrawal, kept as
// named fields ({ signer, vault, fee }). No flattened `disclosedContracts` copy — it would
// just duplicate these blobs; a client attaches them all with [signer, vault, ...fee].
const body = JSON.stringify({ network: "devnet", ...disclosures });

// Minimal structural types for the Node-style Vercel handler. Keeps this package
// dependency-free; the real VercelRequest/VercelResponse (Node http req/res) satisfy them.
interface HandlerRequest {
  method?: string;
}
interface HandlerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

export default function handler(req: HandlerRequest, res: HandlerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  // Disclosures change only on a DevNet redeploy; cache hard and let a redeploy purge it.
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== undefined && req.method !== "GET") {
    res.statusCode = 405;
    res.end("Method Not Allowed");
    return;
  }

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.statusCode = 200;
  res.end(body);
}
