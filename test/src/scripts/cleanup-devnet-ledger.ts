/**
 * One-off DevNet ledger cleanup.
 *
 * Archives every Erc20Vault contract and every Signer sign-event / request contract
 * visible to our party. The Signer singleton (#daml-signer:Signer:Signer) is the MPC
 * infrastructure entry point and is intentionally LEFT UNTOUCHED.
 *
 * Dry-run by default (lists what WOULD be archived, mutates nothing).
 * Set CLEANUP_CONFIRM=1 to actually archive.
 *
 *   pnpm exec tsx src/scripts/cleanup-devnet-ledger.ts                    # dry-run
 *   CLEANUP_CONFIRM=1 pnpm exec tsx src/scripts/cleanup-devnet-ledger.ts  # archive
 *
 * DevNet only — this mutates the live ledger when confirmed.
 */
import "dotenv/config";
import { CantonClient, type CreatedEvent } from "canton-sig";

function reqEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

const JSON_API_URL = reqEnv("MPC_CANTON_JSON_API_URL");
const PARTY = reqEnv("MPC_CANTON_PARTY_ID");
const USER_ID = reqEnv("MPC_CANTON_LEDGER_API_USER");
const OIDC_TOKEN_URL = reqEnv("MPC_CANTON_OIDC_TOKEN_URL");
const OIDC_CLIENT_ID = reqEnv("MPC_CANTON_OIDC_CLIENT_ID");
const OIDC_CLIENT_SECRET = reqEnv("MPC_CANTON_OIDC_CLIENT_SECRET");
const OIDC_AUDIENCE = reqEnv("MPC_CANTON_OIDC_AUDIENCE");
const OIDC_SCOPE = process.env.MPC_CANTON_OIDC_SCOPE;

const CONFIRM = process.env.CLEANUP_CONFIRM === "1";

// Package-name refs — Canton resolves to the vetted DevNet package version.
// NOTE: #daml-signer:Signer:Signer (the MPC infra singleton) is deliberately omitted.
const TARGETS = [
  "#daml-vault:Erc20Vault:Vault",
  "#daml-vault:Erc20Vault:VaultProposal",
  "#daml-vault:Erc20Vault:PendingDeposit",
  "#daml-vault:Erc20Vault:PendingWithdrawal",
  "#daml-vault:Erc20Vault:Erc20Holding",
  "#daml-signer:Signer:SignRequest",
  "#daml-signer:Signer:SignBidirectionalEvent",
  "#daml-signer:Signer:SignatureRespondedEvent",
  "#daml-signer:Signer:RespondBidirectionalEvent",
];

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

async function main(): Promise<void> {
  const canton = new CantonClient(JSON_API_URL, { getToken: makeTokenProvider() });
  console.log(`[cleanup] Target ledger: ${JSON_API_URL}`);
  console.log(`[cleanup] Party:         ${PARTY}`);
  console.log(`[cleanup] Mode:          ${CONFIRM ? "ARCHIVE (live mutate)" : "DRY-RUN (no changes)"}`);
  await canton.getLedgerEnd(); // preflight: OIDC auth + reachability

  // 1) Enumerate every target template.
  const found: { template: string; events: CreatedEvent[] }[] = [];
  for (const template of TARGETS) {
    const events = await canton.getActiveContracts([PARTY], template);
    found.push({ template, events });
    console.log(`[cleanup] ${String(events.length).padStart(4)}  ${template}`);
    for (const e of events) console.log(`             ${e.contractId}`);
  }
  const total = found.reduce((n, f) => n + f.events.length, 0);
  console.log(`[cleanup] Total active target contracts: ${total}`);

  if (total === 0) {
    console.log("[cleanup] Nothing to archive.");
    return;
  }
  if (!CONFIRM) {
    console.log("[cleanup] DRY-RUN — re-run with CLEANUP_CONFIRM=1 to archive the contracts listed above.");
    return;
  }

  // 2) Archive each contract via the standard `Archive` choice (our party is signatory).
  let ok = 0;
  let failed = 0;
  for (const { template, events } of found) {
    for (const e of events) {
      try {
        await canton.exerciseChoice(USER_ID, [PARTY], e.templateId, e.contractId, "Archive", {});
        ok++;
        console.log(`[cleanup] archived  ${e.contractId}  (${template})`);
      } catch (err) {
        failed++;
        console.error(`[cleanup] FAILED    ${e.contractId}  (${template}): ${(err as Error).message}`);
      }
    }
  }
  console.log(`[cleanup] Archived ${ok}, failed ${failed}.`);

  // 3) Verify the active set is empty for every target template.
  let remaining = 0;
  for (const template of TARGETS) {
    const events = await canton.getActiveContracts([PARTY], template);
    remaining += events.length;
    if (events.length > 0) console.log(`[cleanup] REMAINING ${events.length}  ${template}`);
  }
  console.log(`[cleanup] Remaining target contracts after cleanup: ${remaining}`);
  if (remaining > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
