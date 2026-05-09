import { secp256k1 } from "@noble/curves/secp256k1.js";
import { DER } from "@noble/curves/abstract/weierstrass.js";
import { keccak256, toBytes, numberToHex, type Hex } from "viem";
import { sign } from "viem/accounts";
import { computeResponseHash } from "../mpc/crypto.js";
import { CANTON_RESPONSE_KEY_PATH, KEY_VERSION } from "../mpc/address-derivation.js";

import { constants } from "signet.js";

const EPSILON_DERIVATION_PREFIX_V1 = "sig.network v1.0.0 epsilon derivation";
const EPSILON_DERIVATION_PREFIX_V2 = "sig.network v2.0.0 epsilon derivation";
// KDF binds to SOURCE chain (canton:global), NOT destination EVM — must match Chain::Canton.caip2_chain_id() in Rust MPC node
const KDF_CHAIN_ID = constants.KDF_CHAIN_IDS.CANTON;

/** secp256k1 curve order (n). */
const CURVE_ORDER = secp256k1.Point.Fn.ORDER;

/**
 * Derive a child private key for signing EVM transactions.
 * childKey = (rootPrivateKey + epsilon) mod n
 * where epsilon follows Rust MPC's derive_epsilon_canton key-version dispatch.
 */
export function deriveChildPrivateKey(
  rootPrivateKey: Hex,
  predecessorId: string,
  path: string,
  keyVersion = KEY_VERSION,
): Hex {
  const derivationPath =
    keyVersion === 0
      ? `${EPSILON_DERIVATION_PREFIX_V1},${KDF_CHAIN_ID},${predecessorId},${path}`
      : `${EPSILON_DERIVATION_PREFIX_V2}:${KDF_CHAIN_ID}:${predecessorId}:${path}`;
  const epsilon = keccak256(toBytes(derivationPath));

  const rootKey = BigInt(rootPrivateKey);
  const eps = BigInt(epsilon);
  const childKey = (((rootKey + eps) % CURVE_ORDER) + CURVE_ORDER) % CURVE_ORDER;

  return numberToHex(childKey, { size: 32 });
}

/**
 * Sign an EVM transaction hash with a secp256k1 private key.
 * Returns { r, s, v } as bare hex (no 0x) for Canton's EcdsaSignature; v is the recovery id (0 or 1).
 */
export async function signEvmTxHash(
  privateKey: Hex,
  txHash: Hex,
): Promise<{ r: string; s: string; v: number }> {
  const sig = await sign({ hash: txHash, privateKey });
  return { r: sig.r.slice(2), s: sig.s.slice(2), v: sig.yParity ?? 0 };
}

/** Canton Signature union type */
type CantonSignature = { tag: "EcdsaSig"; value: { der: string; recoveryId: number } };

/**
 * Sign the MPC response with the Canton response child key.
 * responseHash = keccak256(requestId ‖ mpcOutput).
 */
export async function signMpcResponse(
  rootPrivateKey: Hex,
  predecessorId: string,
  requestId: string,
  mpcOutput: string,
  keyVersion = KEY_VERSION,
): Promise<CantonSignature> {
  const responsePrivateKey = deriveChildPrivateKey(
    rootPrivateKey,
    predecessorId,
    CANTON_RESPONSE_KEY_PATH,
    keyVersion,
  );
  const sig = await sign({
    hash: computeResponseHash(requestId, mpcOutput),
    privateKey: responsePrivateKey,
  });
  // DER: Daml's secp256k1WithEcdsaOnly builtin only accepts DER-encoded sigs (no (r,s) variant)
  const der = DER.hexFromSig({ r: BigInt(sig.r), s: BigInt(sig.s) });
  return { tag: "EcdsaSig", value: { der, recoveryId: sig.yParity ?? 0 } };
}
