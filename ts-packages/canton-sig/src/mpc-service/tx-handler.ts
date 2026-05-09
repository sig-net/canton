import { keccak256, createPublicClient, http, encodeAbiParameters, type Hex } from "viem";
import { DER } from "@noble/curves/abstract/weierstrass.js";
import { privateKeyToAddress } from "viem/accounts";
import { sepolia } from "viem/chains";
import {
  serializeUnsignedTx,
  reconstructSignedTx,
  type CantonEvmType2Params,
} from "../evm/tx-builder.js";
import { cantonHexToHex } from "../evm/hex.js";
import { deriveChildPrivateKey, signEvmTxHash, signMpcResponse } from "./signer.js";
import {
  CantonClient,
  type CreatedEvent,
  type TransactionResponse,
} from "../infra/canton-client.js";
import { computeRequestId } from "../mpc/crypto.js";
import { chainIdHexToCaip2 } from "../mpc/address-derivation.js";
import { type SignBidirectionalEvent, Signer } from "@daml.js/daml-signer-0.0.1/lib/Signer/module";

const sepoliaClient = (rpcUrl: string) =>
  createPublicClient({ chain: sepolia, transport: http(rpcUrl) });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SIGNER_TEMPLATE = Signer.templateId;

export interface MpcServiceConfig {
  canton: CantonClient;
  signerCid: string;
  userId: string;
  actAs: string[];
  rootPrivateKey: Hex;
  rpcUrl: string;
}

export interface PendingTx {
  requestId: string;
  signEventCid: string;
  predecessorId: string;
  keyVersion: number;
  signedTxHash: Hex;
  fromAddress: Hex;
  nonce: bigint;
  checkCount: number;
  evmParams: CantonEvmType2Params;
}

type CheckResult = "pending" | "done" | "failed";

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

function isTransientError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message;
  return (
    msg.includes("fetch failed") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ECONNRESET") ||
    msg.includes("ETIMEDOUT") ||
    msg.includes("socket hang up") ||
    msg.includes("500") ||
    msg.includes("502") ||
    msg.includes("503") ||
    msg.includes("504")
  );
}

// ---------------------------------------------------------------------------
// Retry wrapper for Canton exerciseChoice
// ---------------------------------------------------------------------------

async function exerciseChoiceWithRetry(
  canton: CantonClient,
  userId: string,
  actAs: string[],
  templateId: string,
  contractId: string,
  choice: string,
  choiceArgument: Record<string, unknown>,
  maxAttempts = 3,
): Promise<TransactionResponse> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await canton.exerciseChoice(
        userId,
        actAs,
        templateId,
        contractId,
        choice,
        choiceArgument,
      );
    } catch (err) {
      if (!isTransientError(err) || attempt === maxAttempts) throw err;
      const delay = 1000 * 2 ** (attempt - 1);
      console.warn(
        `[MPC] Canton transient error (${choice}), retry ${attempt}/${maxAttempts} in ${delay}ms`,
      );
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Phase 1: Sign and enqueue (tx-type agnostic)
// ---------------------------------------------------------------------------

export async function signAndEnqueue(
  config: MpcServiceConfig,
  event: CreatedEvent,
): Promise<PendingTx> {
  const { canton, signerCid, userId, actAs, rootPrivateKey } = config;
  const arg = event.createArgument as SignBidirectionalEvent;
  const {
    requester,
    sender,
    operators,
    txParams,
    keyVersion,
    algo,
    dest,
    params,
    path: requestPath,
  } = arg;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- guard for future BTC/SOL variants
  if (txParams.tag !== "EvmType2TxParams") {
    // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
    throw new Error(`Unsupported chain params: ${txParams.tag}`);
  }
  const evmTxParams = txParams.value;

  // sender is operatorsHash, computed on-ledger by SignRequest.Execute from the actual operator signatories — feeds KDF + requestId
  const predecessorId = sender;

  // ---------------------------------------------------------------------------
  // Validate Canton transaction metadata (defense-in-depth).
  // WHY validate here: MPC signs + tx lands on EVM BEFORE any Canton-side claim —
  // damage happens at signing time, not claim time, so we must catch forgery up front.
  // In single-participant mode a malicious participant could forge both payload
  // AND metadata. In multi-participant mode, signatories are populated from the
  // actual confirmation protocol (each signatory's CPN must confirm), making
  // forgery detectable.
  // ---------------------------------------------------------------------------

  // 1. Check CreatedEvent.signatories — operators must be actual signatories
  const onLedgerSignatories = new Set(event.signatories ?? []);
  for (const op of operators) {
    if (!onLedgerSignatories.has(op)) {
      throw new Error(
        `Operator ${op} is in contract payload but not in ` +
          `CreatedEvent.signatories — possible forgery`,
      );
    }
  }

  // 2. Cross-reference: requester must also be a signatory (SignBidirectionalEvent
  //    has signatory operators, requester)
  if (!onLedgerSignatories.has(requester)) {
    throw new Error(`Requester ${requester} is not in CreatedEvent.signatories — possible forgery`);
  }

  // Validate requestId via re-computation
  // caip2Id is the DESTINATION chain (used in requestId); KDF uses SOURCE (canton:global) — they differ
  const caip2Id = chainIdHexToCaip2(evmTxParams.chainId);
  const computedRequestId = computeRequestId(
    sender,
    txParams,
    caip2Id,
    Number(keyVersion),
    requestPath,
    algo,
    dest,
    params,
  );

  console.log(`[MPC] Processing SignBidirectionalEvent requestId=${computedRequestId.slice(2)}`);
  const requestId = computedRequestId.slice(2);

  // Derive child key and sender address
  const numericKeyVersion = Number(keyVersion);
  const childPrivateKey = deriveChildPrivateKey(
    rootPrivateKey,
    predecessorId,
    requestPath,
    numericKeyVersion,
  );
  const fromAddress = privateKeyToAddress(childPrivateKey);
  const txNonce = BigInt(`0x${evmTxParams.nonce}`);

  // Sign EVM transaction
  const serializedUnsigned = serializeUnsignedTx(evmTxParams);
  const txHash = keccak256(serializedUnsigned);
  const { r, s, v } = await signEvmTxHash(childPrivateKey, txHash);

  // DER-encode the ECDSA signature for the Respond choice
  const derSignature = DER.hexFromSig({ r: BigInt(`0x${r}`), s: BigInt(`0x${s}`) });

  console.log(`[MPC] Signing EVM tx, exercising Respond`);
  await exerciseChoiceWithRetry(canton, userId, actAs, SIGNER_TEMPLATE, signerCid, "Respond", {
    signEventCid: event.contractId,
    requestId,
    signature: { tag: "EcdsaSig", value: { der: derSignature, recoveryId: v } },
  });
  console.log(`[MPC] Respond exercised`);

  // Compute signed tx hash for monitoring
  const signedTx = reconstructSignedTx(evmTxParams, { r: `0x${r}`, s: `0x${s}`, v });
  const signedTxHash = keccak256(signedTx);

  return {
    requestId,
    signEventCid: event.contractId,
    predecessorId,
    keyVersion: numericKeyVersion,
    signedTxHash,
    fromAddress,
    nonce: txNonce,
    checkCount: 0,
    evmParams: evmTxParams,
  };
}

// ---------------------------------------------------------------------------
// Return data helpers
// ---------------------------------------------------------------------------

async function extractReturnData(
  rpcUrl: string,
  tx: PendingTx,
  receipt: { blockNumber: bigint },
): Promise<string> {
  if (tx.evmParams.to === null) return encodeBoolOutput(true);

  const result = await sepoliaClient(rpcUrl).call({
    to: `0x${tx.evmParams.to}`,
    data: cantonHexToHex(tx.evmParams.calldata),
    account: tx.fromAddress,
    blockNumber: receipt.blockNumber - 1n,
  });
  const returnData = result.data ?? "0x";
  return returnData === "0x" ? encodeBoolOutput(true) : returnData.slice(2);
}

function encodeBoolOutput(value: boolean): string {
  return encodeAbiParameters([{ type: "bool" }], [value]).slice(2);
}

function encodeErrorOutput(): string {
  return "deadbeef" + encodeBoolOutput(true);
}

// ---------------------------------------------------------------------------
// Phase 2: Monitor — check receipt and report outcome (tx-type agnostic)
// ---------------------------------------------------------------------------

export async function checkPendingTx(
  config: MpcServiceConfig,
  tx: PendingTx,
): Promise<CheckResult> {
  const client = sepoliaClient(config.rpcUrl);

  let mpcOutput: string | null = null;

  try {
    const receipt = await client.getTransactionReceipt({ hash: tx.signedTxHash });

    if (receipt.status === "success") {
      mpcOutput = await extractReturnData(config.rpcUrl, tx, receipt);
    } else {
      mpcOutput = encodeErrorOutput();
      console.warn(`[MPC] Tx reverted: status=${receipt.status}, requestId=${tx.requestId}`);
    }
    console.log(`[MPC] Receipt found for requestId=${tx.requestId}, status=${receipt.status}`);
  } catch {
    // No receipt yet — check if nonce was consumed (tx replaced)
    try {
      const currentNonce = await client.getTransactionCount({ address: tx.fromAddress });
      if (BigInt(currentNonce) > tx.nonce) {
        // Double-check: maybe the receipt just appeared
        try {
          await client.getTransactionReceipt({ hash: tx.signedTxHash });
          // Receipt appeared in the race — let the next poll cycle handle it
          return "pending";
        } catch {
          console.warn(
            `[MPC] Nonce consumed but no receipt — tx replaced. requestId=${tx.requestId}`,
          );
          mpcOutput = encodeErrorOutput();
        }
      }
    } catch {
      // RPC error during nonce check — try again next cycle
      return "pending";
    }
  }

  if (mpcOutput === null) return "pending";

  // Report outcome to Canton
  return reportOutcome(config, tx, mpcOutput);
}

async function reportOutcome(
  config: MpcServiceConfig,
  tx: PendingTx,
  mpcOutput: string,
): Promise<CheckResult> {
  const signature = await signMpcResponse(
    config.rootPrivateKey,
    tx.predecessorId,
    tx.requestId,
    mpcOutput,
    tx.keyVersion,
  );

  try {
    console.log(`[MPC] Exercising RespondBidirectional for requestId=${tx.requestId}`);
    await exerciseChoiceWithRetry(
      config.canton,
      config.userId,
      config.actAs,
      SIGNER_TEMPLATE,
      config.signerCid,
      "RespondBidirectional",
      {
        signEventCid: tx.signEventCid,
        requestId: tx.requestId,
        serializedOutput: mpcOutput,
        signature,
      },
    );
    console.log(
      `[MPC] RespondBidirectional exercised for requestId=${tx.requestId} (output=${mpcOutput})`,
    );
    return "done";
  } catch (err) {
    if (isTransientError(err)) {
      console.warn(
        `[MPC] Transient error reporting outcome, will retry. requestId=${tx.requestId}`,
      );
      return "pending";
    }
    console.error(
      `[MPC] Fatal error reporting outcome for requestId=${tx.requestId}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return "failed";
  }
}
