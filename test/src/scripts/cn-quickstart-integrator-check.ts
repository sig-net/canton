/**
 * Cross-participant integrator rehearsal against a local CN Quickstart (SETUP.md).
 *
 * Validates the own-node integrator path from INTEGRATORS.md end-to-end on a real
 * multi-participant Canton topology, with the MPC simulated from a locally-generated
 * root key (no MPC cluster, no EVM chain):
 *
 *   app-provider participant (:3975)  = the operator node — sigNetwork + sigNetworkFA,
 *                                       Signer ceremony, zero-fee CC fee infra,
 *                                       and the simulated MPC responder;
 *   app-user participant     (:2975)  = the INTEGRATOR's own node — its DARs vetted
 *                                       there, its operator + requester parties, its
 *                                       Vault, and every consumer-side exercise.
 *
 * Flow: vet DARs on both nodes → allocate parties → Signer + fee bootstrap (provider)
 * → Vault create (integrator node; sigNetwork observer makes it cross-participant)
 * → RequestDeposit with disclosed Signer + fee contracts (cross-participant exercise)
 * → simulated MPC Respond / RespondBidirectional (provider, signed with derived child
 * keys) → ClaimDeposit (integrator node; on-ledger secp256k1 verification of the
 * simulated outcome signature) → Erc20Holding minted.
 *
 * Run while `make start` (cn-quickstart, AUTH_MODE=oauth2) is up:
 *   cd test && pnpm exec tsx src/scripts/cn-quickstart-integrator-check.ts
 *
 * All endpoints/credentials default to the quickstart's committed dev values;
 * override via CNQS_* env vars if your quickstart config differs.
 */
import { keccak256, recoverAddress, serializeSignature, getAddress } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import {
  CantonClient,
  findCreated,
  computeRequestId,
  computeResponseHash,
  deriveDepositAddress,
  deriveResponseVerificationPublicKey,
  serializeUnsignedTx,
  toCantonHex,
  getFeeCollectorContext,
  canActAsRight,
  canReadAsRight,
  KEY_VERSION,
  CANTON_RESPONSE_KEY_PATH,
  type DisclosedContract,
  type CreatedEvent,
  type CantonEvmType2Params,
  type PendingDeposit,
  type Erc20Holding,
} from "canton-sig";

// ── Template ids (package-name refs) ──────────────────────────────────────────
const SIGNER_PROPOSAL_T = "#signet-signer-v1:Signer:SignerProposal";
const SIGNER_T = "#signet-signer-v1:Signer:Signer";
const SIGN_EVENT_T = "#signet-signer-v1:Signer:SignBidirectionalEvent";
const SIGNATURE_RESPONDED_T = "#signet-signer-v1:Signer:SignatureRespondedEvent";
const RESPOND_BIDIRECTIONAL_T = "#signet-signer-v1:Signer:RespondBidirectionalEvent";
const COLLECTOR_T = "#signet-fee-amulet:Signet.Fee.Amulet:CcFeeCollector";
const REGISTRATION_T = "#signet-api-fee-v1:Signet.Api.Fee.V1:FeeCollectorRegistration";
const PRICE_CONFIG_T = "#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig";
const VAULT_T = "#signet-vault-v1:Erc20Vault:Vault";

// ── Quickstart endpoints + committed dev credentials (override via env) ───────
const KEYCLOAK = process.env.CNQS_KEYCLOAK_URL ?? "http://keycloak.localhost:8082";
const PROVIDER_API = process.env.CNQS_PROVIDER_JSON_API ?? "http://localhost:3975";
const USER_API = process.env.CNQS_USER_JSON_API ?? "http://localhost:2975";
const PROVIDER_CLIENT_ID = process.env.CNQS_PROVIDER_CLIENT_ID ?? "app-provider-validator";
const PROVIDER_CLIENT_SECRET =
  process.env.CNQS_PROVIDER_CLIENT_SECRET ?? "AL8648b9SfdTFImq7FV56Vd0KHifHBuC";
const USER_CLIENT_ID = process.env.CNQS_USER_CLIENT_ID ?? "app-user-validator";
const USER_CLIENT_SECRET =
  process.env.CNQS_USER_CLIENT_SECRET ?? "6m12QyyGl81d9nABWQXMycZdXho6ejEX";

// The exact DARs an integrator downloads from the GitHub release. Built locally here;
// byte-identical to the release assets (CI/tag discipline — see CLAUDE.md "Releasing").
const DARS = [
  "../daml-packages/signet-signer-v1/.daml/dist/signet-signer-v1-0.0.1.dar",
  "../daml-packages/signet-fee-amulet/.daml/dist/signet-fee-amulet-0.0.1.dar",
  "../daml-packages/signet-vault-v1/.daml/dist/signet-vault-v1-0.0.1.dar",
];

// ── Simulated MPC root key (throwaway; local rehearsal only) ──────────────────
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n; // secp256k1 order
const ROOT_PRIV = BigInt(keccak256(Buffer.from("cn-quickstart integrator rehearsal root key"))) % N;
const ROOT_PUB = Buffer.from(secp256k1.getPublicKey(toBytes32(ROOT_PRIV), false)).toString("hex");
const SPKI_PREFIX = "3056301006072a8648ce3d020106052b8104000a034200";
const EPSILON_PREFIX = "sig.network v2.0.0 epsilon derivation";
const KDF_CHAIN_ID = "canton:global";

const VAULT_ID = "cnqs-rehearsal-vault";
const ABI_BOOL_TRUE = `${"0".repeat(63)}1`;
const BOOL_SCHEMA = '[{"name":"","type":"bool"}]';
const CAIP2 = "eip155:1"; // the Vault pins this (test mode)

function toBytes32(x: bigint): Uint8Array {
  return Uint8Array.from(Buffer.from(x.toString(16).padStart(64, "0"), "hex"));
}

/** childPriv = (rootPriv + keccak256(prefix:chainId:predecessorId:path)) mod n — mirrors signet.js. */
function deriveChildPrivateKey(predecessorId: string, path: string): bigint {
  const derivationPath = `${EPSILON_PREFIX}:${KDF_CHAIN_ID}:${predecessorId}:${path}`;
  const eps = BigInt(keccak256(Buffer.from(derivationPath, "utf8")));
  return (ROOT_PRIV + eps) % N;
}

/** ECDSA over the raw 32-byte digest (what secp256k1WithEcdsaOnly verifies), DER + recovery bit. */
function signDigest(digestHex: string, priv: bigint): { der: string; recoveryId: string } {
  const sig = secp256k1.sign(Uint8Array.from(Buffer.from(digestHex, "hex")), toBytes32(priv), {
    prehash: false,
    format: "recovered",
  });
  const parsed = secp256k1.Signature.fromBytes(sig, "recovered");
  return {
    der: Buffer.from(parsed.toBytes("der")).toString("hex"),
    recoveryId: String(parsed.recovery),
  };
}

/** keccak256(concat (map (keccak256 . utf8) (sort operators))) — mirrors Daml computeOperatorsHash. */
function computeOperatorsHash(operators: string[]): string {
  const sorted = [...operators].sort();
  const each = sorted.map((op) => keccak256(Buffer.from(op, "utf8")).slice(2));
  return keccak256(`0x${each.join("")}`).slice(2);
}

async function keycloakToken(realm: string, clientId: string, clientSecret: string) {
  const res = await fetch(`${KEYCLOAK}/realms/${realm}/protocol/openid-connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });
  if (!res.ok) throw new Error(`Keycloak token (${realm}): ${res.status} ${await res.text()}`);
  const { access_token } = (await res.json()) as { access_token: string };
  const sub = (
    JSON.parse(Buffer.from(access_token.split(".")[1]!, "base64url").toString()) as {
      sub: string;
    }
  ).sub;
  return { token: access_token, sub };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function pollForContract(
  canton: CantonClient,
  readAs: string[],
  templateId: string,
  match: (args: Record<string, unknown>) => boolean,
  label: string,
  timeoutMs = 60_000,
): Promise<CreatedEvent> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const contracts = await canton.getActiveContracts(readAs, templateId);
    const hit = contracts.find((c) => match(c.createArgument as Record<string, unknown>));
    if (hit) return hit;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await sleep(1_000);
  }
}

const step = (msg: string) => console.log(`\n[check] ${msg}`);

async function main() {
  // ── 0. Auth: one ParticipantAdmin service user per participant ──────────────
  step("Authenticating against Keycloak (both realms)");
  const provider = await keycloakToken("AppProvider", PROVIDER_CLIENT_ID, PROVIDER_CLIENT_SECRET);
  const user = await keycloakToken("AppUser", USER_CLIENT_ID, USER_CLIENT_SECRET);
  const providerCanton = new CantonClient(PROVIDER_API, {
    getToken: () => Promise.resolve(provider.token),
  });
  const userCanton = new CantonClient(USER_API, { getToken: () => Promise.resolve(user.token) });
  await providerCanton.getLedgerEnd();
  await userCanton.getLedgerEnd();
  console.log(`  provider participant ${PROVIDER_API} (user ${provider.sub})`);
  console.log(`  integrator participant ${USER_API} (user ${user.sub})`);

  // ── 1. Vet the release DARs on BOTH participants ─────────────────────────────
  step("Uploading + vetting DARs on both participants");
  for (const dar of DARS) {
    await providerCanton.uploadDar(dar);
    await userCanton.uploadDar(dar);
    console.log(`  vetted ${dar.split("/").pop()} on both`);
  }

  // ── 2. Parties: operator side on provider, integrator side on its own node ──
  step("Allocating parties");
  const sigNetwork = await providerCanton.allocateParty("sigNetworkLocal");
  const sigNetworkFA = await providerCanton.allocateParty("sigNetworkFALocal");
  await providerCanton.grantUserRights(provider.sub, [
    canActAsRight(sigNetwork),
    canReadAsRight(sigNetwork),
    canActAsRight(sigNetworkFA),
    canReadAsRight(sigNetworkFA),
  ]);
  const integratorOp = await userCanton.allocateParty("integratorOperator");
  const requester = await userCanton.allocateParty("integratorRequester");
  await userCanton.grantUserRights(user.sub, [
    canActAsRight(integratorOp),
    canReadAsRight(integratorOp),
    canActAsRight(requester),
    canReadAsRight(requester),
  ]);
  console.log(`  sigNetwork   ${sigNetwork}\n  sigNetworkFA ${sigNetworkFA}`);
  console.log(`  integratorOp ${integratorOp}\n  requester    ${requester}`);

  // ── 3. Signer ceremony on the provider node (reuse if present) ───────────────
  step("Signer ceremony (SignerProposal → AcceptSigner)");
  let signerCid: string;
  const signers = (await providerCanton.getActiveContracts([sigNetwork], SIGNER_T)).filter((c) => {
    const a = c.createArgument as { sigNetwork: string; sigNetworkFA: string };
    return a.sigNetwork === sigNetwork && a.sigNetworkFA === sigNetworkFA;
  });
  if (signers.length > 0) {
    signerCid = signers[0]!.contractId;
    console.log(`  reusing Signer ${signerCid}`);
  } else {
    const proposal = await providerCanton.createContract(
      provider.sub,
      [sigNetwork],
      SIGNER_PROPOSAL_T,
      {
        sigNetwork,
        sigNetworkFA,
      },
    );
    const accepted = await providerCanton.exerciseChoice(
      provider.sub,
      [sigNetworkFA],
      SIGNER_PROPOSAL_T,
      findCreated(proposal.transaction.events, "SignerProposal").contractId,
      "AcceptSigner",
      {},
    );
    signerCid = findCreated(accepted.transaction.events, ":Signer:Signer").contractId;
    console.log(`  Signer created ${signerCid}`);
  }
  const signerDisclosure = await providerCanton.getDisclosedContract(
    [sigNetwork],
    SIGNER_T,
    signerCid,
  );

  // ── 4. Zero-fee CC fee infra on the provider node (signatory sigNetworkFA) ───
  step("Fee bootstrap (CcFeeCollector + Registration + free FeePriceConfig)");
  const reuseOrCreate = async (tid: string, frag: string, payload: Record<string, unknown>) => {
    const existing = await providerCanton.getActiveContracts([sigNetworkFA], tid);
    if (existing.length > 0) return existing[0]!.contractId;
    const res = await providerCanton.createContract(provider.sub, [sigNetworkFA], tid, payload);
    return findCreated(res.transaction.events, frag).contractId;
  };
  const collectorCid = await reuseOrCreate(COLLECTOR_T, "CcFeeCollector", {
    sigNetworkFA,
    feeReceiver: sigNetworkFA,
    meta: { values: {} },
  });
  await reuseOrCreate(REGISTRATION_T, "FeeCollectorRegistration", {
    sigNetworkFA,
    collector: collectorCid,
    meta: { values: {} },
  });
  await reuseOrCreate(PRICE_CONFIG_T, "FeePriceConfig", {
    sigNetworkFA,
    feeReceiver: sigNetworkFA,
    instrumentAdmin: sigNetworkFA, // unused in free mode (no transfer happens)
    instrumentId: "Amulet",
    feeAmount: "0.0",
    validFrom: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
    validUntil: new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString(),
    version: "0",
    meta: { values: {} },
  });
  // What the FA fee endpoint would serve; free mode → empty inputs + context only.
  const collector = await getFeeCollectorContext(providerCanton, sigNetworkFA);
  if (Number(collector.priceConfig.feeAmount) !== 0)
    throw new Error("expected free mode (feeAmount 0.0)");
  const feeArgs = {
    feeRegistrationCid: collector.registrationCid,
    feeInputs: [] as string[],
    feeExtraArgs: { context: collector.choiceContextData, meta: { values: {} } },
  };
  const feeDisclosures = collector.disclosedContracts;
  console.log(
    `  fee context ready (registration ${collector.registrationCid.slice(0, 12)}…, free mode)`,
  );

  // ── 5. Vault on the INTEGRATOR node (sigNetwork observer → cross-participant) ─
  step("Creating the integrator Vault on the integrator participant");
  const operators = [integratorOp];
  const operatorsHash = computeOperatorsHash(operators);
  const responsePub = deriveResponseVerificationPublicKey(ROOT_PUB, operatorsHash);
  // Self-check: public derivation (signet.js) must match our private-side derivation.
  const responsePriv = deriveChildPrivateKey(operatorsHash, CANTON_RESPONSE_KEY_PATH);
  const responsePubFromPriv = Buffer.from(
    secp256k1.getPublicKey(toBytes32(responsePriv), false),
  ).toString("hex");
  if (responsePub !== responsePubFromPriv) throw new Error("KDF mismatch: pub vs priv derivation");
  const vaultEvmAddress = deriveDepositAddress(ROOT_PUB, operatorsHash, `${VAULT_ID},root`);
  const evmVaultAddressSlot = vaultEvmAddress.slice(2).toLowerCase().padStart(64, "0");

  let vaultCid: string;
  const vaults = (await userCanton.getActiveContracts([integratorOp], VAULT_T)).filter(
    (v) => (v.createArgument as { vaultId?: string }).vaultId === VAULT_ID,
  );
  if (vaults.length > 0) {
    vaultCid = vaults[0]!.contractId;
    console.log(`  reusing Vault ${vaultCid}`);
  } else {
    const vaultRes = await userCanton.createContract(user.sub, [integratorOp], VAULT_T, {
      operators,
      sigNetwork,
      evmVaultAddress: evmVaultAddressSlot,
      mpcResponseVerifyKey: `${SPKI_PREFIX}${responsePub}`,
      vaultId: VAULT_ID,
    });
    vaultCid = findCreated(vaultRes.transaction.events, ":Erc20Vault:Vault").contractId;
    console.log(`  Vault created ${vaultCid} (evm ${vaultEvmAddress})`);
  }
  // The integrator serves its own Vault disclosure to its users (requester ≠ stakeholder).
  const vaultDisclosure: DisclosedContract = await userCanton.getDisclosedContract(
    [integratorOp],
    VAULT_T,
    vaultCid,
  );

  // ── 6. RequestDeposit from the integrator node (the cross-participant exercise) ─
  step("RequestDeposit (disclosed Signer + fee contracts, cross-participant)");
  const subPath = `rehearsal,${Date.now()}`;
  const fullPath = `${VAULT_ID},${requester},${subPath}`;
  const depositAddress = deriveDepositAddress(ROOT_PUB, operatorsHash, fullPath);
  const amount = 1_000_000_000_000_000n;
  const erc20 = "b4f1737af37711e9a5890d9510c9bb60e170cb0d";
  const evmTxParams: CantonEvmType2Params = {
    chainId: toCantonHex(11155111n, 32),
    nonce: toCantonHex(0n, 32),
    maxPriorityFeePerGas: toCantonHex(1_000_000_000n, 32),
    maxFeePerGas: toCantonHex(8_000_000_000n, 32),
    gasLimit: toCantonHex(100_000n, 32),
    to: erc20,
    value: toCantonHex(0n, 32),
    calldata: `a9059cbb${evmVaultAddressSlot}${toCantonHex(amount, 32)}`,
    accessList: [],
  };
  const depositRes = await userCanton.exerciseChoice(
    user.sub,
    [requester],
    VAULT_T,
    vaultCid,
    "RequestDeposit",
    {
      requester,
      signerCid,
      path: subPath,
      evmTxParams,
      keyVersion: String(KEY_VERSION),
      algo: "ECDSA",
      dest: "ethereum",
      params: "",
      outputDeserializationSchema: BOOL_SCHEMA,
      respondSerializationSchema: BOOL_SCHEMA,
      ...feeArgs,
    },
    undefined,
    [vaultDisclosure, signerDisclosure, ...feeDisclosures],
  );
  const pending = findCreated(depositRes.transaction.events, "PendingDeposit");
  const { requestId, signEventCid } = pending.createArgument as PendingDeposit & {
    signEventCid: string;
  };
  console.log(
    `  PendingDeposit ${pending.contractId.slice(0, 12)}… requestId ${requestId.slice(0, 16)}…`,
  );

  // Cross-language check: the TS mirror must reproduce the on-ledger requestId.
  const tsRequestId = computeRequestId(
    operatorsHash,
    { tag: "EvmType2TxParams", value: evmTxParams },
    CAIP2,
    KEY_VERSION,
    fullPath,
    "ECDSA",
    "ethereum",
    "",
  );
  if (tsRequestId.slice(2) !== requestId)
    throw new Error("requestId mismatch (TS mirror vs ledger)");
  console.log("  requestId TS mirror matches the ledger ✓");

  // ── 7. Simulated MPC on the provider node: Respond + RespondBidirectional ────
  step("Simulated MPC responds (provider node, derived child keys)");
  // The event is visible to sigNetwork (observer) on the provider participant.
  await pollForContract(
    providerCanton,
    [sigNetwork],
    SIGN_EVENT_T,
    (a) => a.sender === operatorsHash,
    "SignBidirectionalEvent on provider participant",
  );
  // Request leg: sign the EIP-1559 signing hash with the request child key, and
  // prove the derived signer matches the deposit address (full KDF loop check).
  const requestPriv = deriveChildPrivateKey(operatorsHash, fullPath);
  const signingHash = keccak256(serializeUnsignedTx(evmTxParams));
  const requestSig = signDigest(signingHash.slice(2), requestPriv);
  const parsedSig = secp256k1.Signature.fromBytes(
    Uint8Array.from(Buffer.from(requestSig.der, "hex")),
    "der",
  );
  const recovered = await recoverAddress({
    hash: signingHash,
    signature: serializeSignature({
      r: `0x${parsedSig.r.toString(16).padStart(64, "0")}`,
      s: `0x${parsedSig.s.toString(16).padStart(64, "0")}`,
      yParity: Number(requestSig.recoveryId),
    }),
  });
  if (getAddress(recovered) !== getAddress(depositAddress))
    throw new Error("request child key does not recover to the deposit address");
  console.log("  request-leg signature recovers to the derived deposit address ✓");

  await providerCanton.exerciseChoice(provider.sub, [sigNetwork], SIGNER_T, signerCid, "Respond", {
    signEventCid,
    requestId,
    signature: {
      tag: "EcdsaSig",
      value: { der: requestSig.der, recoveryId: requestSig.recoveryId },
    },
  });
  // Outcome leg: sign keccak256(requestId ‖ output) with the response child key.
  const responseHash = computeResponseHash(requestId, ABI_BOOL_TRUE);
  const outcomeSig = signDigest(responseHash.slice(2), responsePriv);
  await providerCanton.exerciseChoice(
    provider.sub,
    [sigNetwork],
    SIGNER_T,
    signerCid,
    "RespondBidirectional",
    {
      signEventCid,
      requestId,
      serializedOutput: ABI_BOOL_TRUE,
      signature: {
        tag: "EcdsaSig",
        value: { der: outcomeSig.der, recoveryId: outcomeSig.recoveryId },
      },
    },
  );
  console.log("  SignatureRespondedEvent + RespondBidirectionalEvent published");

  // ── 8. ClaimDeposit on the integrator node (on-ledger signature verification) ─
  step("ClaimDeposit (integrator node verifies the outcome signature on-ledger)");
  const sigEvent = await pollForContract(
    userCanton,
    [requester],
    SIGNATURE_RESPONDED_T,
    (a) => a.requestId === requestId,
    "SignatureRespondedEvent on integrator participant",
  );
  const outcomeEvent = await pollForContract(
    userCanton,
    [requester],
    RESPOND_BIDIRECTIONAL_T,
    (a) => a.requestId === requestId,
    "RespondBidirectionalEvent on integrator participant",
  );
  const claimRes = await userCanton.exerciseChoice(
    user.sub,
    [requester],
    VAULT_T,
    vaultCid,
    "ClaimDeposit",
    {
      requester,
      pendingDepositCid: pending.contractId,
      respondBidirectionalEventCid: outcomeEvent.contractId,
      signatureRespondedEventCid: sigEvent.contractId,
    },
    undefined,
    [vaultDisclosure],
  );
  const holding = findCreated(claimRes.transaction.events, "Erc20Holding");
  const holdingArgs = holding.createArgument as Erc20Holding;
  if (holdingArgs.owner !== requester) throw new Error("holding owner mismatch");
  if (holdingArgs.amount !== toCantonHex(amount, 32)) throw new Error("holding amount mismatch");

  console.log(
    `\n[check] PASS — Erc20Holding ${holding.contractId.slice(0, 12)}… minted for ${requester}`,
  );
  console.log("[check] Cross-participant integrator path validated:");
  console.log("  • release DARs vetted on both participants");
  console.log("  • Signer + zero-fee infra on the operator node; Vault on the integrator node");
  console.log("  • RequestDeposit via disclosed Signer/Vault/fee contracts across participants");
  console.log("  • MPC evidence events delivered to the integrator participant");
  console.log("  • outcome signature verified on-ledger in ClaimDeposit (secp256k1WithEcdsaOnly)");
}

main().catch((e) => {
  console.error(`\n[check] FAIL: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
