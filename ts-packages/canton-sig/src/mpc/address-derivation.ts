import { type Hex } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { utils, constants } from "signet.js";

const { deriveChildPublicKey } = utils.cryptography;
const KDF_CHAIN_ID = constants.KDF_CHAIN_IDS.CANTON;

export const KEY_VERSION = 1;
export const CANTON_RESPONSE_KEY_PATH = "canton response key";

/**
 * Derive an uncompressed secp256k1 child public key from MPC root key + Canton KDF params.
 */
export function deriveCantonPublicKey(
  rootPubKey: string, // "04..." uncompressed secp256k1 (no 0x)
  predecessorId: string,
  path: string,
  keyVersion = KEY_VERSION,
): string {
  return deriveChildPublicKey(
    rootPubKey as `04${string}`,
    predecessorId,
    path,
    KDF_CHAIN_ID,
    keyVersion,
  );
}

/**
 * Derive the public key that verifies RespondBidirectionalEvent outcome signatures.
 */
export function deriveResponseVerificationPublicKey(
  rootPubKey: string,
  predecessorId: string,
  keyVersion = KEY_VERSION,
): string {
  return deriveCantonPublicKey(rootPubKey, predecessorId, CANTON_RESPONSE_KEY_PATH, keyVersion);
}

/**
 * Derive an Ethereum deposit address from MPC root key + derivation params.
 * Uses canton:global for KDF (Canton source chain ID).
 */
export function deriveDepositAddress(
  rootPubKey: string, // "04..." uncompressed secp256k1 (no 0x)
  predecessorId: string,
  path: string,
  keyVersion = KEY_VERSION,
): Hex {
  const childPubKey = deriveCantonPublicKey(rootPubKey, predecessorId, path, keyVersion);
  return publicKeyToAddress(`0x${childPubKey}`);
}

/**
 * Convert chainId hex (with or without left padding) to CAIP-2 text.
 * Example: "000...aa36a7" -> "eip155:11155111".
 */
export function chainIdHexToCaip2(chainIdHex: string): string {
  const normalized = chainIdHex.replace(/^0+/, "") || "0";
  return `eip155:${BigInt(`0x${normalized}`).toString()}`;
}
