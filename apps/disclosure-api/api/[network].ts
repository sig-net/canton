/**
 * Public, read-only endpoint serving Canton disclosed-contract blobs, split per network.
 *
 *   GET /api/<network>   →   { network, signer, vault, fee }   for network ∈ {devnet, testnet}
 *
 * Back-compat + pretty aliases live in vercel.json:
 *   /            → /api/devnet   (the historical root URL keeps serving DevNet)
 *   /devnet      → /api/devnet
 *   /testnet     → /api/testnet
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
import devnet from "../disclosures.devnet.js";
import testnet from "../disclosures.testnet.js";

// Precompute each network's response body once (payloads are tiny + immutable per deploy).
const BODIES: Record<string, string> = {
  devnet: JSON.stringify({ network: "devnet", ...devnet }),
  testnet: JSON.stringify({ network: "testnet", ...testnet }),
};

// Minimal structural types for the Node-style Vercel handler (keeps this package
// dependency-free; the real VercelRequest/VercelResponse satisfy them). `query.network`
// is the `[network]` path segment, populated by Vercel for dynamic API routes.
interface HandlerRequest {
  method?: string;
  query?: Record<string, string | string[] | undefined>;
}
interface HandlerResponse {
  statusCode: number;
  setHeader(name: string, value: string): void;
  end(chunk?: string): void;
}

export default function handler(req: HandlerRequest, res: HandlerResponse): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  // Disclosures change only on a (re)deploy; cache hard and let a redeploy purge it.
  res.setHeader("Cache-Control", "public, s-maxage=300, stale-while-revalidate=86400");

  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.end();
    return;
  }
  if (req.method !== undefined && req.method !== "GET") {
    res.statusCode = 405;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
    return;
  }

  const raw = req.query?.network;
  const network = Array.isArray(raw) ? raw[0] : raw;
  const body = network ? BODIES[network] : undefined;

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (!body) {
    res.statusCode = 404;
    res.end(
      JSON.stringify({
        error: `Unknown network '${network ?? ""}'`,
        networks: Object.keys(BODIES),
      }),
    );
    return;
  }
  res.statusCode = 200;
  res.end(body);
}
