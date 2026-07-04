/**
 * Deploy a fresh Erc20Vault on DevNet, built from the CURRENT signet-vault-v1 source
 * (the one with the `caip2 = "eip155:1"` test-mode change), with the correct
 * MPC response-verification key.
 *
 * The vault is created pinned to the freshly-built package id (not the `#signet-vault-v1`
 * name ref) so it runs THIS code even though older vault packages are still vetted.
 *
 * Dry-run by default (derives + prints everything, mutates nothing).
 * Set DEPLOY_CONFIRM=1 to upload the DAR (if needed) and create the Vault.
 *
 *   pnpm exec tsx src/scripts/deploy-vault.ts                    # dry-run
 *   DEPLOY_CONFIRM=1 pnpm exec tsx src/scripts/deploy-vault.ts   # deploy
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { keccak256 } from "viem";
import { utils as signetUtils } from "signet.js";
import {
  CantonClient,
  findCreated,
  deriveDepositAddress,
  deriveResponseVerificationPublicKey,
} from "canton-sig";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const JSON_API_URL = reqEnv("MPC_CANTON_JSON_API_URL");
const PARTY = reqEnv("MPC_CANTON_PARTY_ID");
const USER_ID = reqEnv("MPC_CANTON_LEDGER_API_USER");
const ROOT_PUBLIC_KEY = reqEnv("MPC_CANTON_ROOT_PUBLIC_KEY");
const VAULT_ID = process.env.VAULT_ID ?? "canton-mpc-vault";
const OIDC_TOKEN_URL = reqEnv("MPC_CANTON_OIDC_TOKEN_URL");
const OIDC_CLIENT_ID = reqEnv("MPC_CANTON_OIDC_CLIENT_ID");
const OIDC_CLIENT_SECRET = reqEnv("MPC_CANTON_OIDC_CLIENT_SECRET");
const OIDC_AUDIENCE = reqEnv("MPC_CANTON_OIDC_AUDIENCE");
const OIDC_SCOPE = process.env.MPC_CANTON_OIDC_SCOPE;

const CONFIRM = process.env.DEPLOY_CONFIRM === "1";

// Fresh package name signet-vault-v1 (sidesteps any SCU conflict with the legacy
// daml-vault / daml-vault-poc 0.0.1 packages still vetted on DevNet, whose schemas
// differ). Keeps mpcResponseVerifyKey + eip155:1.
const LOCAL_PKG_ID = "7078d1d1b66d15451613184450105816e651f04061df97419aa2107fcd9ea6ca";
const VAULT_TEMPLATE_ID = `${LOCAL_PKG_ID}:Erc20Vault:Vault`;
const DAR_PATH = fileURLToPath(
  new URL(
    "../../../daml-packages/signet-vault-v1/.daml/dist/signet-vault-v1-0.0.2.dar",
    import.meta.url,
  ),
);

// DER/SPKI header for an secp256k1 SubjectPublicKeyInfo, up to (but not incl.) the
// `04` uncompressed-point marker — which is the first byte of the derived pubkey hex.
const SPKI_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";

function makeTokenProvider(): () => Promise<string> {
  let cached: { token: string; refreshAfter: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.refreshAfter) return cached.token;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
      audience: OIDC_AUDIENCE,
    });
    if (OIDC_SCOPE) body.set("scope", OIDC_SCOPE);
    const res = await fetch(OIDC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`OIDC token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("OIDC token response missing access_token");
    cached = {
      token: json.access_token,
      refreshAfter: Date.now() + Math.max((json.expires_in ?? 3600) * 1000 - 60_000, 0),
    };
    return json.access_token;
  };
}

/** keccak256(concat (map (keccak256 . toHex) (sort operators))) — matches Daml computeOperatorsHash. */
function computeOperatorsHash(operators: string[]): string {
  const sorted = [...operators].sort();
  const individualHashes = sorted.map((op) => keccak256(Buffer.from(op, "utf8")).slice(2));
  return keccak256(`0x${individualHashes.join("")}`).slice(2);
}

async function listPackageIds(token: string): Promise<string[]> {
  const res = await fetch(`${JSON_API_URL}/v2/packages`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`GET /v2/packages failed: ${res.status} ${await res.text()}`);
  const json = (await res.json()) as { packageIds?: string[] } | string[];
  return Array.isArray(json) ? json : (json.packageIds ?? []);
}

async function main(): Promise<void> {
  const getToken = makeTokenProvider();
  const canton = new CantonClient(JSON_API_URL, { getToken });
  console.log(`[deploy] Target ledger: ${JSON_API_URL}`);
  console.log(`[deploy] Party:         ${PARTY}`);
  console.log(
    `[deploy] Mode:          ${CONFIRM ? "DEPLOY (live mutate)" : "DRY-RUN (no changes)"}`,
  );
  await canton.getLedgerEnd(); // preflight auth

  // Is our freshly-built signet-vault-v1 package already vetted?
  const token = await getToken();
  const vetted = await listPackageIds(token);
  const localVetted = vetted.includes(LOCAL_PKG_ID);
  console.log(`[deploy] Local package ${LOCAL_PKG_ID} vetted on DevNet? ${localVetted}`);

  // Derive vault params from the MPC root key.
  const rootPub = signetUtils.cryptography.normalizeToUncompressedPubKey(
    ROOT_PUBLIC_KEY as Parameters<typeof signetUtils.cryptography.normalizeToUncompressedPubKey>[0],
  );
  const predecessorId = computeOperatorsHash([PARTY]);
  const vaultAddress = deriveDepositAddress(rootPub, predecessorId, `${VAULT_ID},root`);
  const evmVaultAddressSlot = vaultAddress.slice(2).toLowerCase().padStart(64, "0");
  const responsePub = deriveResponseVerificationPublicKey(rootPub, predecessorId);
  const mpcResponseVerifyKey = `${SPKI_PREFIX}${responsePub}`;

  const payload = {
    operators: [PARTY],
    evmVaultAddress: evmVaultAddressSlot,
    mpcResponseVerifyKey,
    vaultId: VAULT_ID,
  };

  console.log(`[deploy] vaultId:               ${VAULT_ID}`);
  console.log(`[deploy] predecessorId:         ${predecessorId}`);
  console.log(`[deploy] derived vaultAddress:  ${vaultAddress}`);
  console.log(`[deploy] evmVaultAddress slot:  ${evmVaultAddressSlot}`);
  console.log(`[deploy] mpcResponseVerifyKey:  ${mpcResponseVerifyKey}`);
  console.log(`[deploy] templateId:            ${VAULT_TEMPLATE_ID}`);

  if (!CONFIRM) {
    console.log(
      `[deploy] DRY-RUN — re-run with DEPLOY_CONFIRM=1 to ${localVetted ? "" : "upload the DAR and "}create the Vault.`,
    );
    return;
  }

  // Upload the freshly-built DAR if the package isn't vetted yet, then verify it landed.
  // Raw upload (not canton.uploadDar) so we SEE Canton's response — uploadDar silently
  // swallows KNOWN_PACKAGE_VERSION / NOT_VALID_UPGRADE, which we must not hide here.
  if (!localVetted) {
    console.log(`[deploy] Uploading DAR: ${DAR_PATH}`);
    const { readFileSync } = await import("node:fs");
    const upRes = await fetch(`${JSON_API_URL}/v2/dars?vetAllPackages=true`, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        Authorization: `Bearer ${await getToken()}`,
      },
      body: readFileSync(DAR_PATH),
    });
    console.log(`[deploy] Upload response: ${upRes.status} ${await upRes.text()}`);
    const after = await listPackageIds(await getToken());
    if (!after.includes(LOCAL_PKG_ID)) {
      throw new Error(
        `Upload did not vet ${LOCAL_PKG_ID}. If the response says KNOWN_PACKAGE_VERSION, ` +
          `another package already occupies signet-vault-v1 0.0.1 → bump the version. If it says ` +
          `NOT_VALID_UPGRADE, the deployed schema differs → rename the package.`,
      );
    }
    console.log(`[deploy] Package ${LOCAL_PKG_ID} is now vetted.`);
  }

  // Create the Vault, pinned to our package id.
  const result = await canton.createContract(USER_ID, [PARTY], VAULT_TEMPLATE_ID, payload);
  const created = findCreated(result.transaction.events, "Vault");
  console.log(`[deploy] ✅ Vault created.`);
  console.log(`[deploy] contractId: ${created.contractId}`);
  console.log(`[deploy] templateId: ${created.templateId}`);
  console.log(`\n[deploy] Add to test/.env:`);
  console.log(`MPC_CANTON_VAULT_CONTRACT_ID=${created.contractId}`);
  console.log(`MPC_CANTON_VAULT_TEMPLATE_ID=${created.templateId}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
