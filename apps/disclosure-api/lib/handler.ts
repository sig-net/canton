/**
 * Shared handler for the per-network disclosure routes. The public route
 * (`api/[network].ts`) and the internal route (`api/internal/[network].ts`) differ only
 * in which `disclosures.<network>.ts` modules they serve — everything else (CORS,
 * caching, method handling, 404 shape) is identical and lives here.
 */

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

export function makeDisclosureHandler(
  disclosures: Record<string, object>,
): (req: HandlerRequest, res: HandlerResponse) => void {
  // Precompute each network's response body once (payloads are tiny + immutable per deploy).
  const bodies: Record<string, string> = Object.fromEntries(
    Object.entries(disclosures).map(([network, data]) => [
      network,
      JSON.stringify({ network, ...data }),
    ]),
  );

  return (req, res) => {
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
    const body = network ? bodies[network] : undefined;

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    if (!body) {
      res.statusCode = 404;
      res.end(
        JSON.stringify({
          error: `Unknown network '${network ?? ""}'`,
          networks: Object.keys(bodies),
        }),
      );
      return;
    }
    res.statusCode = 200;
    res.end(body);
  };
}
