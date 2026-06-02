import { keccak256, toHex, toBytes, pad, concat, type Hex } from "viem";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { cantonHexToHex } from "./evm/hex.js";
import type { CantonEvmAccessListEntry, CantonEvmType2Params } from "./evm/tx-builder.js";

export type TxParams = { tag: "EvmType2TxParams"; value: CantonEvmType2Params };

// ---------------------------------------------------------------------------
// EIP-712 primitive encoding — mirrors Daml's Eip712.daml
// ---------------------------------------------------------------------------

const EMPTY_BYTES_HASH = keccak256("0x");

const eip712EncodeString = (text: string): Hex => keccak256(toHex(text));

/** EIP-712 word encoding: Canton-format hex (no 0x) left-padded to 32 bytes (viem's pad default). */
const eip712EncodeWord = (cantonHex: string): Hex => pad(`0x${cantonHex}`);

const hashOptionalAddress = (address: string | null): Hex =>
  address === null ? EMPTY_BYTES_HASH : eip712EncodeWord(address);

const hashStorageKeys = (storageKeys: string[]): Hex =>
  storageKeys.length === 0 ? EMPTY_BYTES_HASH : keccak256(concat(storageKeys.map(cantonHexToHex)));

const hashAccessListEntry = (entry: CantonEvmAccessListEntry): Hex =>
  keccak256(concat([eip712EncodeWord(entry.address), hashStorageKeys(entry.storageKeys)]));

const hashAccessList = (accessList: CantonEvmAccessListEntry[]): Hex =>
  accessList.length === 0
    ? EMPTY_BYTES_HASH
    : keccak256(concat(accessList.map(hashAccessListEntry)));

// ---------------------------------------------------------------------------
// Flat keccak256(concat(encoded fields)) — mirrors Daml's RequestId.daml
// ---------------------------------------------------------------------------

function hashTxParams(cp: TxParams): Hex {
  switch (cp.tag) {
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- exhaustive switch for future BTC/SOL variants
    case "EvmType2TxParams":
      return hashEvmType2Params(cp.value);
  }
}

export function hashEvmType2Params(p: CantonEvmType2Params): Hex {
  return keccak256(
    concat([
      eip712EncodeWord(p.chainId),
      eip712EncodeWord(p.nonce),
      eip712EncodeWord(p.maxPriorityFeePerGas),
      eip712EncodeWord(p.maxFeePerGas),
      eip712EncodeWord(p.gasLimit),
      hashOptionalAddress(p.to),
      eip712EncodeWord(p.value),
      keccak256(cantonHexToHex(p.calldata)),
      hashAccessList(p.accessList),
    ]),
  );
}

/**
 * Compute request_id using flat keccak256(concat(encoded fields)).
 * Three-way consistency required: must match Daml RequestId.daml and Rust indexer_canton::generate_request_id() byte-for-byte.
 */
export function computeRequestId(
  sender: string, // operatorsHash, set on-ledger by SignRequest.Execute (NOT user-supplied)
  txParams: TxParams,
  caip2Id: string,
  keyVersion: number,
  path: string,
  algo: string,
  dest: string,
  params: string,
): Hex {
  return keccak256(
    concat([
      eip712EncodeString(sender),
      hashTxParams(txParams),
      eip712EncodeString(caip2Id),
      pad(toHex(keyVersion)),
      eip712EncodeString(path),
      eip712EncodeString(algo),
      eip712EncodeString(dest),
      eip712EncodeString(params),
    ]),
  );
}

/**
 * Compute response_hash = keccak256(requestId ‖ mpcOutput).
 * Matches MPC node (respond_bidirectional.rs) and Solana (erc20_vault.rs); mirrored by Daml RequestId.daml.
 */
export function computeResponseHash(requestId: string, mpcOutput: string): Hex {
  return keccak256(concat([cantonHexToHex(requestId), cantonHexToHex(mpcOutput)]));
}

// ---------------------------------------------------------------------------
// Key encoding
// ---------------------------------------------------------------------------

/**
 * Derive the SPKI-encoded public key from an uncompressed secp256k1 public key.
 * Matches the format used by Canton's Signer.mpcPublicKey field.
 */
export function toSpkiPublicKey(uncompressedPubKey: string): string {
  const pubKeyBytes = toBytes(`0x${uncompressedPubKey}`);

  // secp256k1 SPKI header: SEQUENCE { SEQUENCE { OID ecPublicKey, OID secp256k1 }, BIT STRING }
  const spkiHeader = new Uint8Array([
    0x30,
    0x56, // SEQUENCE (86 bytes)
    0x30,
    0x10, // SEQUENCE (16 bytes)
    0x06,
    0x07,
    0x2a,
    0x86,
    0x48,
    0xce,
    0x3d,
    0x02,
    0x01, // OID ecPublicKey
    0x06,
    0x05,
    0x2b,
    0x81,
    0x04,
    0x00,
    0x0a, // OID secp256k1
    0x03,
    0x42,
    0x00, // BIT STRING (66 bytes, 0 unused bits)
    0x04, // uncompressed point marker
  ]);

  // Remove the 0x04 prefix from pubKeyBytes since spkiHeader already includes it
  const rawPoint = pubKeyBytes.slice(1);
  const spki = new Uint8Array(spkiHeader.length + rawPoint.length);
  spki.set(spkiHeader);
  spki.set(rawPoint, spkiHeader.length);

  return toHex(spki).slice(2);
}

/**
 * Derive the uncompressed public key from a private key.
 */
export function derivePublicKey(privateKey: Hex): string {
  const pubKeyBytes = secp256k1.getPublicKey(toBytes(privateKey), false);
  return toHex(pubKeyBytes).slice(2);
}
