/**
 * Deploy the fee-enabled MPC stack to Canton DevNet — free mode (feeAmount = 0) by
 * default, or PAID mode when MPC_CANTON_FEE_AMOUNT > 0 (a real CC transfer is charged).
 *
 * Creates, as the single DevNet party (operators = requester = sigNetwork = fee
 * admin on this network):
 *   1. A `signet-signer-v1` `Signer` (via the SignerProposal -> AcceptSigner ceremony).
 *   2. The CC fee infra: `CcFeeCollector` + `FeeCollectorRegistration` +
 *      `FeePriceConfig` (feeAmount = 0.0, wide validity window).
 *   3. A `signet-vault-v1` `Erc20Vault.Vault` (with the derived MPC response-verify key).
 *
 * Why free mode needs no payment rails: in `Signet.Fee.Amulet`,
 * `feeCollector_chargeImpl` validates the price config and RETURNS before reading
 * `arg.inputs` or the transfer-factory context when `feeAmount == 0.0`. So no
 * Canton Coin, `TransferPreapproval`, `FeaturedAppRight`, or CC registry is required —
 * only the registration + an in-window zero-fee `FeePriceConfig` must be live.
 *
 * Idempotent: reuses an existing Signer / collector / registration / price config /
 * vault for the party instead of duplicating (`getFeeCollectorContext` requires
 * exactly one registration).
 *
 * Dry-run by default. DEPLOY_CONFIRM=1 uploads the DARs, creates the contracts, and
 * writes the resulting ids into test/.env (backing up test/.env.bak first).
 *
 *   pnpm exec tsx src/scripts/deploy-devnet.ts                                  # dry-run (free)
 *   DEPLOY_CONFIRM=1 pnpm exec tsx src/scripts/deploy-devnet.ts                 # deploy (free)
 *   DEPLOY_CONFIRM=1 MPC_CANTON_FEE_AMOUNT=0.01 pnpm exec tsx src/scripts/deploy-devnet.ts  # paid
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { keccak256 } from "viem";
import { utils as signetUtils } from "signet.js";
import {
  CantonClient,
  findCreated,
  deriveDepositAddress,
  deriveResponseVerificationPublicKey,
  getFeeCollectorContext,
} from "canton-sig";

// ── Template ids (package-NAME refs) ─────────────────────────────────────────────
// The JSON Ledger API active-contracts query rejects package-id hashes ("expected a
// package name"), and these names are unique to the freshly-vetted packages, so a
// name ref resolves unambiguously to THIS deployed code for queries and creates alike.
const SIGNER_PROPOSAL_TID = "#signet-signer-v1:Signer:SignerProposal";
const SIGNER_TID = "#signet-signer-v1:Signer:Signer";
const REGISTRATION_TID = "#signet-api-fee-v1:Signet.Api.Fee.V1:FeeCollectorRegistration";
const COLLECTOR_TID = "#signet-fee-amulet:Signet.Fee.Amulet:CcFeeCollector";
const PRICE_CONFIG_TID = "#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig";
const VAULT_TID = "#signet-vault-v1:Erc20Vault:Vault";

// DER/SPKI header for an secp256k1 SubjectPublicKeyInfo (matches deploy-vault.ts).
const SPKI_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";

const dar = (rel: string): string =>
  fileURLToPath(new URL(`../../../daml-packages/${rel}`, import.meta.url));
// Upload order is not significant (each DAR carries its own dependency closure);
// these three together vet signer + api-fee + fee-amulet + vault + splice deps.
const DARS = [
  dar("signet-signer-v1/.daml/dist/signet-signer-v1-0.0.1.dar"),
  dar("signet-fee-amulet/.daml/dist/signet-fee-amulet-0.0.1.dar"),
  dar("signet-vault-v1/.daml/dist/signet-vault-v1-0.0.1.dar"),
];

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const JSON_API_URL = reqEnv("MPC_CANTON_JSON_API_URL");
const PARTY = reqEnv("MPC_CANTON_PARTY_ID");
const USER_ID = reqEnv("MPC_CANTON_LEDGER_API_USER");
const ROOT_PUBLIC_KEY = reqEnv("MPC_CANTON_ROOT_PUBLIC_KEY");
const VAULT_ID = process.env.VAULT_ID ?? "canton-mpc-poc";
const FEE_ADMIN = process.env.MPC_CANTON_SIG_NETWORK_FA_PARTY_ID ?? PARTY;
const OIDC_TOKEN_URL = reqEnv("MPC_CANTON_OIDC_TOKEN_URL");
const OIDC_CLIENT_ID = reqEnv("MPC_CANTON_OIDC_CLIENT_ID");
const OIDC_CLIENT_SECRET = reqEnv("MPC_CANTON_OIDC_CLIENT_SECRET");
const OIDC_AUDIENCE = reqEnv("MPC_CANTON_OIDC_AUDIENCE");
const OIDC_SCOPE = process.env.MPC_CANTON_OIDC_SCOPE;
const CONFIRM = process.env.DEPLOY_CONFIRM === "1";

// Fee mode: free (feeAmount 0, default) or paid (feeAmount > 0). Paid charges a real CC
// transfer, so it needs the actual instrument admin (the CC DSO party) and, at submission
// time, the token-standard registry (the validator scan-proxy — the SV scan is IP-locked).
const FEE_AMOUNT = process.env.MPC_CANTON_FEE_AMOUNT ?? "0.0";
const WANT_PAID = Number(FEE_AMOUNT) > 0;
const CC_DSO_PARTY =
  process.env.CC_DSO_PARTY ??
  "DSO::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a";
const CC_REGISTRY_URL =
  process.env.MPC_CANTON_CC_REGISTRY_URL ??
  "https://wallet.dev.sig.network/api/validator/v0/scan-proxy";

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
  const hashes = sorted.map((op) => keccak256(Buffer.from(op, "utf8")).slice(2));
  return keccak256(`0x${hashes.join("")}`).slice(2);
}

/** Set or append `KEY=VALUE` lines in a .env file, leaving every other line untouched. */
function upsertEnv(path: string, updates: Record<string, string>): void {
  copyFileSync(path, `${path}.bak`);
  const lines = readFileSync(path, "utf8").split("\n");
  for (const [k, v] of Object.entries(updates)) {
    const idx = lines.findIndex((l) => l.startsWith(`${k}=`));
    if (idx >= 0) lines[idx] = `${k}=${v}`;
    else lines.push(`${k}=${v}`);
  }
  writeFileSync(path, lines.join("\n"));
}

async function main(): Promise<void> {
  const canton = new CantonClient(JSON_API_URL, { getToken: makeTokenProvider() });
  console.log(`[deploy] Ledger:    ${JSON_API_URL}`);
  console.log(`[deploy] Party:     ${PARTY}`);
  console.log(`[deploy] Fee admin: ${FEE_ADMIN}`);
  console.log(
    `[deploy] Fee mode:  ${WANT_PAID ? `PAID (feeAmount=${FEE_AMOUNT}, admin=DSO)` : "free (feeAmount=0.0)"}`,
  );
  console.log(`[deploy] Mode:      ${CONFIRM ? "DEPLOY (live mutate)" : "DRY-RUN (no changes)"}`);
  await canton.getLedgerEnd(); // preflight: OIDC auth + ledger reachable
  console.log(`[deploy] OK auth + ledger reachable.`);

  if (!CONFIRM) {
    console.log(
      `[deploy] DRY-RUN — re-run with DEPLOY_CONFIRM=1 to upload DARs + create contracts.`,
    );
    console.log(`[deploy] Would upload:\n  ${DARS.join("\n  ")}`);
    console.log(`[deploy] Would create: Signer, CcFeeCollector, FeeCollectorRegistration,`);
    console.log(
      `[deploy]               FeePriceConfig(feeAmount=${WANT_PAID ? FEE_AMOUNT : "0.0"}), Vault — then write ids to test/.env.`,
    );
    return;
  }

  // 1. Upload DARs (idempotent; vets each DAR's full dependency closure).
  for (const d of DARS) {
    console.log(`[deploy] Uploading ${d.split("/").pop()} …`);
    await canton.uploadDar(d);
  }
  console.log(`[deploy] OK DARs vetted.`);

  const create = async (tid: string, payload: Record<string, unknown>, frag: string) => {
    const res = await canton.createContract(USER_ID, [PARTY], tid, payload);
    return findCreated(res.transaction.events, frag);
  };

  // 2. Signer — reuse if present, else SignerProposal -> AcceptSigner.
  let signerCid: string;
  const signers = await canton.getActiveContracts([PARTY], SIGNER_TID);
  if (signers.length > 0) {
    signerCid = signers[0]!.contractId;
    console.log(`[deploy] Reusing Signer ${signerCid}`);
  } else {
    const proposal = await create(
      SIGNER_PROPOSAL_TID,
      { sigNetwork: PARTY, sigNetworkFA: FEE_ADMIN },
      "SignerProposal",
    );
    const accepted = await canton.exerciseChoice(
      USER_ID,
      [PARTY],
      SIGNER_PROPOSAL_TID,
      proposal.contractId,
      "AcceptSigner",
      {},
    );
    // AcceptSigner is consuming, so the only CreatedEvent in this tx is the Signer.
    signerCid = findCreated(accepted.transaction.events, ":Signer:Signer").contractId;
    console.log(`[deploy] OK Signer created ${signerCid}`);
  }
  const signerDisc = await canton.getDisclosedContract([PARTY], SIGNER_TID, signerCid);

  // 3. CC fee infra (all signatory FEE_ADMIN).
  let collectorCid: string;
  const collectors = await canton.getActiveContracts([PARTY], COLLECTOR_TID);
  if (collectors.length > 0) {
    collectorCid = collectors[0]!.contractId;
    console.log(`[deploy] Reusing CcFeeCollector ${collectorCid}`);
  } else {
    collectorCid = (
      await create(
        COLLECTOR_TID,
        { sigNetworkFA: FEE_ADMIN, feeReceiver: FEE_ADMIN, meta: { values: {} } },
        "CcFeeCollector",
      )
    ).contractId;
    console.log(`[deploy] OK CcFeeCollector ${collectorCid}`);
  }

  let registrationCid: string;
  const regs = await canton.getActiveContracts([PARTY], REGISTRATION_TID);
  if (regs.length > 1) {
    throw new Error(
      `Multiple FeeCollectorRegistration for ${FEE_ADMIN}; archive extras ` +
        `(getFeeCollectorContext requires exactly one).`,
    );
  }
  if (regs.length === 1) {
    registrationCid = regs[0]!.contractId;
    console.log(`[deploy] Reusing FeeCollectorRegistration ${registrationCid}`);
  } else {
    registrationCid = (
      await create(
        REGISTRATION_TID,
        { sigNetworkFA: FEE_ADMIN, collector: collectorCid, meta: { values: {} } },
        "FeeCollectorRegistration",
      )
    ).contractId;
    console.log(`[deploy] OK FeeCollectorRegistration ${registrationCid}`);
  }

  // getFeeCollectorContext selects the highest-version in-window config, so ensure the
  // current top version matches the wanted mode (free: feeAmount 0; paid: feeAmount > 0
  // with the real DSO instrumentAdmin). Switching modes appends a new top version.
  let priceConfigCid: string;
  const configs = (await canton.getActiveContracts([PARTY], PRICE_CONFIG_TID))
    .map((c) => ({
      cid: c.contractId,
      cfg: c.createArgument as { feeAmount: string; instrumentAdmin: string; version: string },
    }))
    .sort((a, b) => Number(b.cfg.version) - Number(a.cfg.version));
  const top = configs[0];
  const topMatches =
    top != null &&
    (WANT_PAID
      ? Number(top.cfg.feeAmount) > 0 && top.cfg.instrumentAdmin === CC_DSO_PARTY
      : Number(top.cfg.feeAmount) === 0);
  if (topMatches) {
    priceConfigCid = top.cid;
    console.log(
      `[deploy] Reusing ${WANT_PAID ? "paid" : "free"} FeePriceConfig v${top.cfg.version} ${priceConfigCid}`,
    );
  } else {
    const now = Date.now();
    const version = String((top ? Number(top.cfg.version) : -1) + 1);
    priceConfigCid = (
      await create(
        PRICE_CONFIG_TID,
        {
          sigNetworkFA: FEE_ADMIN,
          feeReceiver: FEE_ADMIN,
          // Paid: the CC DSO backs the Amulet transfer. Free: FEE_ADMIN is unused (no transfer).
          instrumentAdmin: WANT_PAID ? CC_DSO_PARTY : FEE_ADMIN,
          instrumentId: "Amulet",
          feeAmount: WANT_PAID ? FEE_AMOUNT : "0.0",
          validFrom: new Date(now - 24 * 3600 * 1000).toISOString(),
          validUntil: new Date(now + 10 * 365 * 24 * 3600 * 1000).toISOString(),
          version,
          meta: { values: {} },
        },
        "FeePriceConfig",
      )
    ).contractId;
    console.log(
      `[deploy] OK FeePriceConfig v${version} (feeAmount=${WANT_PAID ? FEE_AMOUNT : "0.0"}${WANT_PAID ? ", admin=DSO" : ""}) ${priceConfigCid}`,
    );
  }

  // 4. Vault — reuse a matching one for this party, else create.
  const rootPub = signetUtils.cryptography.normalizeToUncompressedPubKey(
    ROOT_PUBLIC_KEY as Parameters<typeof signetUtils.cryptography.normalizeToUncompressedPubKey>[0],
  );
  const predecessorId = computeOperatorsHash([PARTY]);
  const vaultAddress = deriveDepositAddress(rootPub, predecessorId, `${VAULT_ID},root`);
  const evmVaultAddressSlot = vaultAddress.slice(2).toLowerCase().padStart(64, "0");
  const responsePub = deriveResponseVerificationPublicKey(rootPub, predecessorId);
  const mpcResponseVerifyKey = `${SPKI_PREFIX}${responsePub}`;

  let vaultCid: string;
  let vaultTemplateId: string;
  const vaults = (await canton.getActiveContracts([PARTY], VAULT_TID)).filter(
    (v) =>
      (v.createArgument as { evmVaultAddress?: string }).evmVaultAddress?.toLowerCase() ===
      evmVaultAddressSlot,
  );
  if (vaults.length > 0) {
    vaultCid = vaults[0]!.contractId;
    vaultTemplateId = vaults[0]!.templateId;
    console.log(`[deploy] Reusing Vault ${vaultCid}`);
  } else {
    const created = await create(
      VAULT_TID,
      {
        operators: [PARTY],
        sigNetwork: PARTY,
        evmVaultAddress: evmVaultAddressSlot,
        mpcResponseVerifyKey,
        vaultId: VAULT_ID,
      },
      "Vault",
    );
    vaultCid = created.contractId;
    vaultTemplateId = created.templateId;
    console.log(`[deploy] OK Vault ${vaultCid}`);
  }

  // 5. Self-check: the test's fee path (getFeeCollectorContext) must resolve this infra in
  // the wanted mode (it selects the highest-version in-window config for the fee admin).
  const ctx = await getFeeCollectorContext(canton, FEE_ADMIN);
  const ctxPaid = Number(ctx.priceConfig.feeAmount) > 0;
  if (ctxPaid !== WANT_PAID) {
    throw new Error(
      `Self-check failed: wanted ${WANT_PAID ? "paid" : "free"} mode but getFeeCollectorContext ` +
        `resolved feeAmount=${ctx.priceConfig.feeAmount}`,
    );
  }
  console.log(
    `[deploy] OK getFeeCollectorContext resolves (feeAmount=${ctx.priceConfig.feeAmount}, ${ctxPaid ? "PAID" : "free"} mode).`,
  );

  // 6. Save the DURABLE disclosures (signer, vault, fee infra: registration + collector +
  // current FeePriceConfig) in the JSON Ledger API DisclosedContract shape to a generated
  // .ts module that apps/disclosure-api serves. In paid mode the per-submission CC registry
  // disclosures (TransferFactory, AmuletRules, OpenMiningRound) are intentionally NOT saved
  // here — they are time-bound (the open mining round rotates) and must be re-resolved from
  // the registry at each submission.
  //
  // NOTE(prod): the FeePriceConfig snapshot is a DevNet convenience. It is the only one of
  // these that mutates — reprice (`UpdateFee`) archives it and creates a new version — so the
  // static fee blob goes stale once repricing runs. On DevNet it's stable (10yr window, no
  // reprice cron). In production the disclosure server must resolve the fee LIVE as
  // sigNetworkFA (getFeeCollectorContext); requesters aren't fee stakeholders and can't read it.
  const vaultDisc = await canton.getDisclosedContract([PARTY], VAULT_TID, vaultCid);
  const discPath = fileURLToPath(
    new URL("../../../apps/disclosure-api/disclosures.devnet.ts", import.meta.url),
  );
  const discData = { signer: signerDisc, vault: vaultDisc, fee: ctx.disclosedContracts };
  writeFileSync(
    discPath,
    `// Generated by test/src/scripts/deploy-devnet.ts - do not edit by hand.\n` +
      `export default ${JSON.stringify(discData, null, 2)};\n`,
  );
  console.log(
    `[deploy] Wrote disclosures (DisclosedContract shape) to apps/disclosure-api/disclosures.devnet.ts`,
  );

  // 7. Persist ids into test/.env (back up first; secret lines are left untouched).
  const envPath = fileURLToPath(new URL("../../.env", import.meta.url));
  upsertEnv(envPath, {
    // Signer + Vault disclosures are served by apps/disclosure-api (written to
    // disclosures.devnet.ts in step 6), so the e2e sources them from there, not from .env.
    // VAULT_* below are kept as deployment bookkeeping (the e2e no longer reads them).
    MPC_CANTON_VAULT_CONTRACT_ID: vaultCid,
    MPC_CANTON_VAULT_TEMPLATE_ID: vaultTemplateId,
    MPC_CANTON_SIG_NETWORK_FA_PARTY_ID: FEE_ADMIN,
    // Paid mode: the e2e resolves the CC TransferFactory from this registry at submission.
    ...(WANT_PAID ? { MPC_CANTON_CC_REGISTRY_URL: CC_REGISTRY_URL } : {}),
  });

  console.log(
    `\n[deploy] === DEPLOYED (${WANT_PAID ? "PAID" : "free"} mode, feeAmount=${WANT_PAID ? FEE_AMOUNT : "0.0"}) ===`,
  );
  console.log(`[deploy] Signer:               ${signerCid}`);
  console.log(`[deploy] Vault:                ${vaultCid}`);
  console.log(`[deploy] FeeCollectorRegistration: ${registrationCid}`);
  console.log(`[deploy] CcFeeCollector:       ${collectorCid}`);
  console.log(`[deploy] FeePriceConfig:       ${priceConfigCid}`);
  console.log(`[deploy] Wrote ids to test/.env (backup: test/.env.bak).`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
