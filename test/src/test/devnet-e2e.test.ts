/**
 * Canton DevNet e2e — ERC-20 Vault deposit + withdraw against the MPC.
 *
 * We run as a pure client against the live network:
 *   - the Canton DevNet JSON Ledger API (OIDC client-credentials auth → Bearer JWT);
 *   - the Vault + Signer — the Signer injected from its configured disclosure
 *     envelope (.env), the way a requester (who can't read the sigNetwork-only Signer)
 *     is handed it; the Vault disclosed by its configured contract id;
 *   - the MPC cluster — it watches the Signer events, threshold-signs, and
 *     publishes the response events. We never run any MPC; we only poll for its output
 *     and broadcast the signed EVM tx it produced.
 *
 * caip2 vs chainId: the Vault hardcodes `caip2 = "eip155:1"` (test mode, Erc20Vault.daml)
 * because the MPC accepts ONLY that caip2 (mpc primitives `from_caip2_chain_id`).
 * caip2 is NOT part of the signing-key derivation, so it can differ from the tx's EIP-155
 * chainId. We therefore sign each tx with the Sepolia chainId (11155111) — valid
 * on-chain — while computing the requestId with caip2 `eip155:1` to match the Vault, then
 * broadcast to Sepolia (MPC_CANTON_ETH_RPC_URL), which the MPC's `eip155:1` indexer watches.
 *
 * THIS MUTATES THE LIVE LEDGER AND SPENDS DEVNET FUNDS. It only runs when the
 * MPC_CANTON_* + funding env is present AND MPC_CANTON_LIVE_MUTATE=1; otherwise it
 * is skipped.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll } from "vitest";
import * as z from "zod";
import {
  createPublicClient,
  createWalletClient,
  http,
  encodeAbiParameters,
  parseAbi,
  parseAbiParameters,
  keccak256,
  getAddress,
  recoverAddress,
  serializeSignature,
  type Hex,
} from "viem";
import { sepolia } from "viem/chains"; // chainId 11155111 — txs are signed for Sepolia
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";
import { DER } from "@noble/curves/abstract/weierstrass.js";
import { utils as signetUtils } from "signet.js";
import {
  CantonClient,
  findCreated,
  computeRequestId,
  deriveDepositAddress,
  serializeUnsignedTx,
  reconstructSignedTx,
  submitRawTransaction,
  toCantonHex,
  KEY_VERSION,
  getFeeCollectorContext,
  getTransferFactoryForFee,
  selectInputHoldings,
  holdingInputsFromEvents,
  assembleFeeChoiceArgs,
  collectFeeDisclosures,
  HOLDING_INTERFACE_ID,
} from "canton-sig";
import type {
  CreatedEvent,
  DisclosedContract,
  FeeChoiceArgs,
  CantonEvmType2Params,
  Vault,
  PendingDeposit,
  PendingWithdrawal,
  Erc20Holding,
  SignatureRespondedEvent,
  RespondBidirectionalEvent,
} from "canton-sig";

// ── Template references (package-name refs; Canton resolves to the vetted DevNet
//    package, which may differ from the locally-generated package hash) ──────────
const SIGNATURE_RESPONDED_T = "#signet-signer-v1:Signer:SignatureRespondedEvent";
const RESPOND_BIDIRECTIONAL_T = "#signet-signer-v1:Signer:RespondBidirectionalEvent";
const VAULT_T = "#signet-vault-v1:Erc20Vault:Vault";

// ── Constants ───────────────────────────────────────────────────────────────────
const SEPOLIA_CHAIN_ID = 11155111n; // signed into every tx; valid on Sepolia
// The Vault hardcodes caip2 `eip155:1` (test mode); the client recomputes the requestId
// with the SAME value, decoupled from the signed chainId above.
const VAULT_CAIP2 = "eip155:1";
const GAS_LIMIT = 100_000n;
const DEPOSIT_AMOUNT = 1_000_000_000_000_000n; // 0.001 token (18 decimals)
const ERC20_TRANSFER_SELECTOR = "a9059cbb";
const BOOL_SCHEMA = '[{"name":"","type":"bool"}]';
const ABI_BOOL_TRUE = `${"0".repeat(63)}1`;
const ALGO = "ECDSA";
const DEST = "ethereum";

const POLL_INTERVAL_MS = 5_000;
const SIGN_TIMEOUT_MS = 180_000; // wait for the MPC to threshold-sign
// The outcome leg waits for on-chain *finality*, which can exceed 15 min — bump
// MPC_CANTON_RESPOND_TIMEOUT_MS (the spec budget below tracks it) accordingly.
const RESPOND_TIMEOUT_MS = Number(process.env.MPC_CANTON_RESPOND_TIMEOUT_MS ?? 300_000);
// Prime the MPC's outcome-watcher before the tx lands (guards a broadcast-before-watch race).
const BROADCAST_DELAY_MS = Number(process.env.MPC_CANTON_BROADCAST_DELAY_MS ?? 20_000);
// Per-spec vitest budget must outlast sign + broadcast delay + the finality-gated respond wait
// (plus slack for funding and the on-ledger exercises); otherwise the spec times out before
// RESPOND_TIMEOUT_MS can elapse and the respond knob is capped at the old hardcoded 15 min.
const SPEC_TIMEOUT_MS = SIGN_TIMEOUT_MS + BROADCAST_DELAY_MS + RESPOND_TIMEOUT_MS + 180_000;

// ── Env ───────────────────────────────────────────────────────────────────────--
const EnvSchema = z.object({
  // Canton DevNet JSON Ledger API + OIDC client-credentials auth.
  MPC_CANTON_JSON_API_URL: z.url(),
  MPC_CANTON_OIDC_TOKEN_URL: z.url(),
  MPC_CANTON_OIDC_CLIENT_ID: z.string().min(1),
  MPC_CANTON_OIDC_CLIENT_SECRET: z.string().min(1),
  MPC_CANTON_OIDC_AUDIENCE: z.string().min(1),
  MPC_CANTON_OIDC_SCOPE: z.string().optional(),
  MPC_CANTON_LEDGER_API_USER: z.string().min(1),
  // On DevNet a single party is operators + requester + sigNetwork (the MPC's own party).
  MPC_CANTON_PARTY_ID: z.string().min(1),
  // Fee admin: the featured-app party that signs the fee infra (the
  // FeeCollectorRegistration, the collector, and the FeePriceConfig). Defaults
  // to MPC_CANTON_PARTY_ID for the single-party DevNet setup.
  MPC_CANTON_SIG_NETWORK_FA_PARTY_ID: z.string().min(1).optional(),
  // The deployed apps/disclosure-api endpoint. The e2e fetches the Signer + Vault
  // disclosures from it — the way a real integrator obtains the sigNetwork-only contracts
  // it can't read in its own ACS — so no MPC_CANTON_SIGNER_* / MPC_CANTON_VAULT_* needed.
  MPC_CANTON_DISCLOSURE_API_URL: z.url(),
  // MPC cluster root pubkey — NAJ (`secp256k1:base58…`) or uncompressed SEC1.
  MPC_CANTON_ROOT_PUBLIC_KEY: z
    .string()
    .regex(
      /^(secp256k1:[1-9A-HJ-NP-Za-km-z]+|04[0-9a-fA-F]{128})$/,
      "NAJ (secp256k1:base58) or uncompressed SEC1 (04 + 128 hex)",
    ),
  // CC token-standard registry base URL — resolves the TransferFactory + its
  // disclosures (AmuletRules/OpenMiningRound) for the signature fee. Required:
  // the Daml charges the fee on every RequestDeposit/RequestWithdrawal, and the
  // fee registration/collector/price config + receiver preapproval must already
  // be standing.
  // Optional: only the paid fee path (feeAmount > 0) resolves a transfer factory
  // from the registry. In free mode (feeAmount = 0.0) the charge never touches it.
  MPC_CANTON_CC_REGISTRY_URL: z.url().optional(),
  // Sepolia RPC — we fund derived addresses and broadcast the MPC-signed txs here.
  MPC_CANTON_ETH_RPC_URL: z.url(),
  FAUCET_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/, "0x + 64 hex"),
  ERC20_ADDRESS: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/)
    .default("0xB4F1737Af37711e9A5890D9510c9bB60e170CB0D"),
});
type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
const env: Env | null = parsed.success ? parsed.data : null;
const mutate = process.env.MPC_CANTON_LIVE_MUTATE === "1";
// Gated: needs full config AND the explicit live-mutate opt-in (spends funds).
const describeIf = env && mutate ? describe : describe.skip;

// ── Local helpers ─────────────────────────────────────────────────────────────--
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** keccak256(concat (map (keccak256 . toHex) (sort operators))) — matches Daml computeOperatorsHash. */
function computeOperatorsHash(operators: string[]): string {
  const sorted = [...operators].sort();
  const individualHashes = sorted.map((op) => keccak256(Buffer.from(op, "utf8")).slice(2));
  return keccak256(`0x${individualHashes.join("")}`).slice(2);
}

/** Daml `Signature` union as it arrives over the JSON API. */
type CantonSignature = { tag: "EcdsaSig"; value: { der: string; recoveryId: string } };

/** Parse a Canton DER signature into EVM {r, s, v} (v = yParity ∈ {0,1}). */
function parseDerSignature(signature: CantonSignature): { r: Hex; s: Hex; v: number } {
  const { der, recoveryId } = signature.value;
  const { r, s } = DER.toSig(Uint8Array.from(Buffer.from(der, "hex")));
  return {
    r: `0x${r.toString(16).padStart(64, "0")}`,
    s: `0x${s.toString(16).padStart(64, "0")}`,
    v: Number(recoveryId),
  };
}

/**
 * OIDC client-credentials token provider with in-memory caching, mirroring the MPC
 * node's auth: POST the token endpoint with grant_type=client_credentials + audience,
 * reuse the access_token until ~60s before expiry.
 */
function makeTokenProvider(e: Env): () => Promise<string> {
  let cached: { token: string; refreshAfter: number } | null = null;
  return async () => {
    if (cached && Date.now() < cached.refreshAfter) return cached.token;
    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: e.MPC_CANTON_OIDC_CLIENT_ID,
      client_secret: e.MPC_CANTON_OIDC_CLIENT_SECRET,
      audience: e.MPC_CANTON_OIDC_AUDIENCE,
    });
    if (e.MPC_CANTON_OIDC_SCOPE) body.set("scope", e.MPC_CANTON_OIDC_SCOPE);
    const res = await fetch(e.MPC_CANTON_OIDC_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
    });
    if (!res.ok) throw new Error(`OIDC token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!json.access_token) throw new Error("OIDC token response missing access_token");
    const ttlMs = (json.expires_in ?? 3600) * 1000;
    cached = { token: json.access_token, refreshAfter: Date.now() + Math.max(ttlMs - 60_000, 0) };
    return json.access_token;
  };
}

/**
 * Fetch the disclosure envelopes the apps/disclosure-api endpoint serves
 * (`{ signer, vault, fee }`). Lets the e2e exercise the deployed endpoint as a real
 * integrator would — sourcing the sigNetwork-only Signer blob it cannot read itself.
 */
async function fetchEndpointDisclosures(
  apiUrl: string,
): Promise<{ signer: DisclosedContract; vault: DisclosedContract; fee: DisclosedContract[] }> {
  const res = await fetch(apiUrl);
  if (!res.ok) {
    throw new Error(`disclosure API ${apiUrl} returned ${res.status} ${await res.text()}`);
  }
  const body = (await res.json()) as {
    signer?: DisclosedContract;
    vault?: DisclosedContract;
    fee?: DisclosedContract[];
  };
  if (!body.signer?.createdEventBlob) {
    throw new Error(`disclosure API ${apiUrl} returned no signer disclosure`);
  }
  if (!body.vault?.createdEventBlob) {
    throw new Error(`disclosure API ${apiUrl} returned no vault disclosure`);
  }
  return { signer: body.signer, vault: body.vault, fee: body.fee ?? [] };
}

// ── Shared DevNet context (populated in beforeAll) ───────────────────────────────
let canton: CantonClient;
let getAuthToken: () => Promise<string>;
let party: string;
let userId: string;
let rootPubKey: string;
let predecessorId: string;
let vaultId: string;
let operators: string[];
let vaultAddress: Hex;
let signerDisclosure: DisclosedContract;
let vaultDisclosure: DisclosedContract;
let vaultContractId: string;

const ethPublicClient = () =>
  createPublicClient({ chain: sepolia, transport: http(env!.MPC_CANTON_ETH_RPC_URL) });

/** Poll the ACS until a contract of `templateId` visible to `party` matches `predicate`. */
async function pollForContract(
  templateId: string,
  predicate: (args: Record<string, unknown>) => boolean,
  label: string,
  timeoutMs: number,
): Promise<CreatedEvent> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const contracts = await canton.getActiveContracts([party], templateId);
    const match = contracts.find((c) => predicate(c.createArgument as Record<string, unknown>));
    if (match) return match;
    await sleep(POLL_INTERVAL_MS);
  }
  throw new Error(`Timed out waiting for ${label} (${timeoutMs / 1000}s)`);
}

/** Latest EIP-1559 gas params from the DevNet chain. */
async function fetchGasParams(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const block = await ethPublicClient().getBlock({ blockTag: "latest" });
  const baseFee = block.baseFeePerGas ?? 1_000_000_000n;
  const maxPriorityFeePerGas = 1_000_000_000n;
  return { maxFeePerGas: baseFee * 2n + maxPriorityFeePerGas, maxPriorityFeePerGas };
}

async function erc20BalanceOf(address: Hex): Promise<bigint> {
  return ethPublicClient().readContract({
    address: env!.ERC20_ADDRESS as Hex,
    abi: parseAbi(["function balanceOf(address) view returns (uint256)"]),
    functionName: "balanceOf",
    args: [address],
  });
}

/** Top up `target` from the faucet on the DevNet chain: ETH for gas, ERC-20 up to `erc20Amount`. */
async function fundFromFaucet(target: Hex, erc20Amount: bigint): Promise<void> {
  const account = privateKeyToAccount(env!.FAUCET_PRIVATE_KEY as Hex);
  const publicClient = ethPublicClient();
  const walletClient = createWalletClient({
    account,
    chain: sepolia,
    transport: http(env!.MPC_CANTON_ETH_RPC_URL),
  });
  // The EVM reserves `gasLimit × maxFeePerGas` up front to broadcast from `target`, so fund that
  // (×2 for headroom against gas drift between funding and the tx) instead of a fixed amount —
  // a higher base fee otherwise under-funds the address and the broadcast is rejected.
  const ethReserve = GAS_LIMIT * (await fetchGasParams()).maxFeePerGas * 2n;
  if ((await publicClient.getBalance({ address: target })) < ethReserve) {
    const hash = await walletClient.sendTransaction({ to: target, value: ethReserve });
    await publicClient.waitForTransactionReceipt({ hash });
  }
  if ((await erc20BalanceOf(target)) < erc20Amount) {
    const hash = await walletClient.writeContract({
      address: env!.ERC20_ADDRESS as Hex,
      abi: parseAbi(["function transfer(address,uint256) returns (bool)"]),
      functionName: "transfer",
      args: [target, erc20Amount],
    });
    await publicClient.waitForTransactionReceipt({ hash });
  }
}

/** Build the canonical ERC-20 `transfer(to, amount)` EIP-1559 params (Sepolia chainId). */
async function buildTransferParams(
  fromAddress: Hex,
  to: Hex,
  amount: bigint,
): Promise<CantonEvmType2Params> {
  const nonce = await ethPublicClient().getTransactionCount({ address: fromAddress });
  const { maxFeePerGas, maxPriorityFeePerGas } = await fetchGasParams();
  const encodedArgs = encodeAbiParameters(parseAbiParameters("address, uint256"), [
    to,
    amount,
  ]).slice(2);
  return {
    chainId: toCantonHex(SEPOLIA_CHAIN_ID, 32),
    nonce: toCantonHex(BigInt(nonce), 32),
    maxPriorityFeePerGas: toCantonHex(maxPriorityFeePerGas, 32),
    maxFeePerGas: toCantonHex(maxFeePerGas, 32),
    gasLimit: toCantonHex(GAS_LIMIT, 32),
    to: env!.ERC20_ADDRESS.slice(2).toLowerCase(),
    value: toCantonHex(0n, 32),
    calldata: `${ERC20_TRANSFER_SELECTOR}${encodedArgs}`,
    accessList: [],
  };
}

/**
 * Wait for the MPC's request signature, assert it was made with the key for
 * `expectedSigner`, then broadcast the reconstructed tx to the DevNet chain.
 * Returns the SignatureRespondedEvent cid.
 */
async function signAndBroadcast(
  evmTxParams: CantonEvmType2Params,
  requestId: string,
  expectedSigner: Hex,
  label: string,
): Promise<string> {
  const sigEvent = await pollForContract(
    SIGNATURE_RESPONDED_T,
    (a) => a.requestId === requestId,
    `SignatureRespondedEvent (${label})`,
    SIGN_TIMEOUT_MS,
  );
  const sigArgs = sigEvent.createArgument as SignatureRespondedEvent;
  const sig = parseDerSignature(sigArgs.signature);

  // The MPC must have signed with the child key for `expectedSigner`.
  const signingHash = keccak256(serializeUnsignedTx(evmTxParams));
  const recovered = await recoverAddress({
    hash: signingHash,
    signature: serializeSignature({ r: sig.r, s: sig.s, yParity: sig.v }),
  });
  expect(getAddress(recovered)).toBe(getAddress(expectedSigner));

  if (BROADCAST_DELAY_MS > 0) await sleep(BROADCAST_DELAY_MS);
  const signedTx = reconstructSignedTx(evmTxParams, sig);
  await submitRawTransaction(env!.MPC_CANTON_ETH_RPC_URL, signedTx);
  return sigEvent.contractId;
}

/**
 * Assemble the CC signature-fee inputs for one RequestDeposit / RequestWithdrawal.
 *
 * On DevNet a single party is requester = sigNetwork = feeReceiver — and, unless
 * MPC_CANTON_SIG_NETWORK_FA_PARTY_ID says otherwise, also the fee admin — so the
 * sigNetworkFA-signed fee contracts are readable directly (the reader is their
 * stakeholder) and the fee transfer is a self-transfer settled via the party's
 * own `TransferPreapproval`. Requires the fee infra to be standing
 * (CcFeeCollector + FeeCollectorRegistration + FeePriceConfig posted,
 * preapproval + featured-app right live) and the CC token-standard registry.
 *
 * Returns the three fee choice args (spread into the choice record) and the
 * disclosures to append to the submission (registration/collector/price config
 * + factory/rules/round).
 */
async function prepareFeeInputs(): Promise<{
  args: FeeChoiceArgs;
  disclosures: DisclosedContract[];
}> {
  const feeAdmin = env!.MPC_CANTON_SIG_NETWORK_FA_PARTY_ID ?? party;
  const collector = await getFeeCollectorContext(canton, feeAdmin);

  // Free mode (feeAmount = 0.0): the Daml charge validates the price config and
  // returns BEFORE reading any holdings or transfer factory (Signet.Fee.Amulet),
  // so no CC holdings, transfer factory, or registry are needed — pass empty
  // inputs plus just the price-config context the charge reads.
  if (Number(collector.priceConfig.feeAmount) === 0) {
    return {
      args: {
        feeRegistrationCid: collector.registrationCid,
        feeInputs: [],
        feeExtraArgs: { context: collector.choiceContextData, meta: { values: {} } },
      },
      disclosures: collector.disclosedContracts,
    };
  }

  // Paid mode: cover the fee from holdings and resolve the CC transfer factory.
  const registryUrl = env!.MPC_CANTON_CC_REGISTRY_URL;
  if (!registryUrl) {
    throw new Error("Paid fee mode (feeAmount > 0) requires MPC_CANTON_CC_REGISTRY_URL");
  }
  const holdingEvents = await canton.getInterfaceContracts([party], HOLDING_INTERFACE_ID);
  const selection = selectInputHoldings(
    holdingInputsFromEvents(holdingEvents),
    collector.priceConfig.feeAmount,
  );
  const factory = await getTransferFactoryForFee(
    registryUrl,
    {
      sender: party,
      feeReceiver: collector.priceConfig.feeReceiver,
      instrumentAdmin: collector.priceConfig.instrumentAdmin,
      instrumentId: collector.priceConfig.instrumentId,
      amount: collector.priceConfig.feeAmount,
      inputHoldingCids: selection.inputHoldingCids,
    },
    {
      // DevNet's CC registry is the validator scan-proxy, gated by the same OIDC
      // bearer as the ledger; getTransferFactoryForFee sends none by default.
      fetchImpl: async (input, init = {}) => {
        const headers = new Headers(init.headers);
        headers.set("Authorization", `Bearer ${await getAuthToken()}`);
        return fetch(input, { ...init, headers });
      },
    },
  );
  return {
    args: assembleFeeChoiceArgs(collector, factory, selection),
    disclosures: collectFeeDisclosures(collector, factory),
  };
}

/**
 * Submit a fee-bearing Vault request: assemble the CC fee inputs, fill the
 * shared request envelope (key version, algo/dest, schemas), and attach the
 * Vault + Signer + fee disclosures. `args` carries the choice-specific fields.
 */
async function submitVaultRequest(
  choice: "RequestDeposit" | "RequestWithdrawal",
  args: Record<string, unknown>,
) {
  const fee = await prepareFeeInputs();
  return canton.exerciseChoice(
    userId,
    [party],
    VAULT_T,
    vaultContractId,
    choice,
    {
      requester: party,
      // Use the resolved disclosure's cid so the choice matches the attached Signer
      // (endpoint-sourced or config-sourced — same contract on a current deployment).
      signerCid: signerDisclosure.contractId!,
      keyVersion: String(KEY_VERSION), // Daml `Int` is wire-encoded as a string over JSON API v2
      algo: ALGO,
      dest: DEST,
      params: "",
      outputDeserializationSchema: BOOL_SCHEMA,
      respondSerializationSchema: BOOL_SCHEMA,
      ...args,
      ...fee.args, // feeRegistrationCid, feeInputs, feeExtraArgs
    },
    undefined,
    [vaultDisclosure, signerDisclosure, ...fee.disclosures],
  );
}

// ── Specs ─────────────────────────────────────────────────────────────────────--
describeIf("Canton DevNet ERC-20 vault lifecycle", () => {
  let holdingCid: string | undefined;

  beforeAll(async () => {
    party = env!.MPC_CANTON_PARTY_ID;
    userId = env!.MPC_CANTON_LEDGER_API_USER;
    getAuthToken = makeTokenProvider(env!);
    canton = new CantonClient(env!.MPC_CANTON_JSON_API_URL, { getToken: getAuthToken });

    // Preflight: OIDC auth + ledger reachability.
    await canton.getLedgerEnd();

    // Signer + Vault disclosures come from the deployed disclosure-api endpoint — the way a
    // real integrator obtains the sigNetwork-only contracts it can't read in its own ACS.
    const api = await fetchEndpointDisclosures(env!.MPC_CANTON_DISCLOSURE_API_URL);
    signerDisclosure = api.signer;
    vaultDisclosure = api.vault;
    vaultContractId = vaultDisclosure.contractId!;
    console.log(
      `[e2e] disclosures from ${env!.MPC_CANTON_DISCLOSURE_API_URL} ` +
        `(signer ${signerDisclosure.contractId}, vault ${vaultContractId})`,
    );

    // Read the Vault's args live (we're a stakeholder on DevNet) to drive key derivation.
    const vaults = await canton.getActiveContracts([party], VAULT_T);
    const vaultContract = vaults.find((c) => c.contractId === vaultContractId);
    if (!vaultContract) throw new Error("Configured Vault not visible to party");
    const vaultArgs = vaultContract.createArgument as Vault;
    operators = vaultArgs.operators;
    vaultId = vaultArgs.vaultId;

    rootPubKey = signetUtils.cryptography.normalizeToUncompressedPubKey(
      env!.MPC_CANTON_ROOT_PUBLIC_KEY as Parameters<
        typeof signetUtils.cryptography.normalizeToUncompressedPubKey
      >[0],
    );
    predecessorId = computeOperatorsHash(operators);
    vaultAddress = deriveDepositAddress(rootPubKey, predecessorId, `${vaultId},root`);

    // The derived vault address must match the Vault's on-ledger evmVaultAddress slot.
    expect(vaultAddress.slice(2).toLowerCase().padStart(64, "0")).toBe(
      vaultArgs.evmVaultAddress.toLowerCase(),
    );
  }, 120_000);

  it(
    "deposits ERC-20 into the vault via the MPC",
    async () => {
      const subPath = `devnet-e2e,${Date.now()}`; // unique → fresh deposit address (nonce 0)
      const fullPath = `${vaultId},${party},${subPath}`; // matches Vault: vaultId,<requester>,<path>
      const depositAddress = deriveDepositAddress(rootPubKey, predecessorId, fullPath);

      // Fund the derived deposit address on the DevNet chain (ETH for gas + ERC-20 to deposit).
      await fundFromFaucet(depositAddress, DEPOSIT_AMOUNT);

      const evmTxParams = await buildTransferParams(depositAddress, vaultAddress, DEPOSIT_AMOUNT);

      // RequestDeposit (Vault + Signer + fee contracts disclosed) → PendingDeposit
      // + SignBidirectionalEvent. The fee is charged atomically inside Signer.RequestSignature.
      const depositResult = await submitVaultRequest("RequestDeposit", {
        path: subPath,
        evmTxParams,
      });
      const pending = findCreated(depositResult.transaction.events, "PendingDeposit");
      const { requestId } = pending.createArgument as PendingDeposit;

      // caip2 is hardcoded `eip155:1` in the Vault (test mode) and is decoupled from the
      // signed Sepolia chainId; the requestId must use it to match the ledger (invariant below).
      const caip2Id = VAULT_CAIP2;
      const tsRequestId = computeRequestId(
        predecessorId,
        { tag: "EvmType2TxParams", value: evmTxParams },
        caip2Id,
        KEY_VERSION,
        fullPath,
        ALGO,
        DEST,
        "",
      );
      expect(tsRequestId.slice(2)).toBe(requestId);

      // The MPC signs; we verify the signer and broadcast the deposit tx.
      const signatureRespondedEventCid = await signAndBroadcast(
        evmTxParams,
        requestId,
        depositAddress,
        "deposit",
      );

      // The MPC observes the on-chain outcome → RespondBidirectionalEvent.
      const respondEvent = await pollForContract(
        RESPOND_BIDIRECTIONAL_T,
        (a) => a.requestId === requestId,
        "RespondBidirectionalEvent (deposit)",
        RESPOND_TIMEOUT_MS,
      );
      expect((respondEvent.createArgument as RespondBidirectionalEvent).serializedOutput).toBe(
        ABI_BOOL_TRUE,
      );

      // ClaimDeposit → Erc20Holding (ledger verifies the MPC outcome signature).
      const claimResult = await canton.exerciseChoice(
        userId,
        [party],
        VAULT_T,
        vaultContractId,
        "ClaimDeposit",
        {
          requester: party,
          pendingDepositCid: pending.contractId,
          respondBidirectionalEventCid: respondEvent.contractId,
          signatureRespondedEventCid,
        },
        undefined,
        [vaultDisclosure],
      );
      const holding = findCreated(claimResult.transaction.events, "Erc20Holding");
      const holdingArgs = holding.createArgument as Erc20Holding;
      expect(holdingArgs.owner).toBe(party);
      expect(holdingArgs.operators).toEqual(operators);
      expect(holdingArgs.amount).toBe(toCantonHex(DEPOSIT_AMOUNT, 32));

      holdingCid = holding.contractId;
    },
    SPEC_TIMEOUT_MS,
  );

  it(
    "withdraws the vault holding back out via the MPC",
    async () => {
      if (!holdingCid)
        throw new Error("withdrawal requires the deposit test to have produced a holding");

      // The vault address holds the deposited ERC-20 on-chain; ensure it also has gas ETH.
      await fundFromFaucet(vaultAddress, 0n);

      const recipient = privateKeyToAddress(env!.FAUCET_PRIVATE_KEY as Hex); // send tokens back to faucet
      const recipientPadded = recipient.slice(2).toLowerCase().padStart(64, "0");
      const balanceBefore = await erc20BalanceOf(recipient);

      const evmTxParams = await buildTransferParams(vaultAddress, recipient, DEPOSIT_AMOUNT);

      // RequestWithdrawal (Vault + Signer + fee contracts disclosed) →
      // PendingWithdrawal + SignBidirectionalEvent. Fee charged inside Signer.RequestSignature.
      const wdlResult = await submitVaultRequest("RequestWithdrawal", {
        evmTxParams,
        recipientAddress: recipientPadded,
        balanceCid: holdingCid,
      });
      const pendingWdl = findCreated(wdlResult.transaction.events, "PendingWithdrawal");
      const { requestId } = pendingWdl.createArgument as PendingWithdrawal;

      // Withdrawal derivation path is the vault root: `${vaultId},root`. caip2 = eip155:1 (see deposit).
      const caip2Id = VAULT_CAIP2;
      const tsRequestId = computeRequestId(
        predecessorId,
        { tag: "EvmType2TxParams", value: evmTxParams },
        caip2Id,
        KEY_VERSION,
        `${vaultId},root`,
        ALGO,
        DEST,
        "",
      );
      expect(tsRequestId.slice(2)).toBe(requestId);

      // The MPC signs (with the vault's child key); broadcast from the vault address.
      const signatureRespondedEventCid = await signAndBroadcast(
        evmTxParams,
        requestId,
        vaultAddress,
        "withdrawal",
      );

      const respondEvent = await pollForContract(
        RESPOND_BIDIRECTIONAL_T,
        (a) => a.requestId === requestId,
        "RespondBidirectionalEvent (withdrawal)",
        RESPOND_TIMEOUT_MS,
      );
      expect((respondEvent.createArgument as RespondBidirectionalEvent).serializedOutput).toBe(
        ABI_BOOL_TRUE,
      );

      // CompleteWithdrawal: on success returns None — no refund Erc20Holding is created.
      const completeResult = await canton.exerciseChoice(
        userId,
        [party],
        VAULT_T,
        vaultContractId,
        "CompleteWithdrawal",
        {
          requester: party,
          pendingWithdrawalCid: pendingWdl.contractId,
          respondBidirectionalEventCid: respondEvent.contractId,
          signatureRespondedEventCid,
        },
        undefined,
        [vaultDisclosure],
      );
      const refund = completeResult.transaction.events.find(
        (e) => "CreatedEvent" in e && e.CreatedEvent.templateId.includes("Erc20Holding"),
      );
      expect(refund).toBeUndefined();

      // Recipient received the withdrawn amount on-chain.
      const balanceAfter = await erc20BalanceOf(recipient);
      expect(balanceAfter).toBe(balanceBefore + DEPOSIT_AMOUNT);
    },
    SPEC_TIMEOUT_MS,
  );
});
