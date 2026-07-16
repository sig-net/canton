/**
 * Internal-only mirror of `api/[network].ts` for networks that are not part of the
 * integrator surface (integrators use the public route — see that file for the full
 * contract). Same response shape, same safe-to-serve payload properties.
 *
 *   GET /api/internal/<network>   →   { network, signer, vault, fee }
 */
import devnet from "../../disclosures.devnet.js";
import { makeDisclosureHandler } from "../../lib/handler.js";

export default makeDisclosureHandler({ devnet });
