import { fileURLToPath } from "node:url";

// MPC Service
export { MpcServer } from "./mpc-service/server.js";
export type { MpcServerConfig } from "./mpc-service/server.js";
export { deriveChildPrivateKey, signEvmTxHash, signMpcResponse } from "./mpc-service/signer.js";

// Canton infrastructure
export { CantonClient } from "./infra/canton-client.js";
export type {
  CreatedEvent,
  Event,
  UserRight,
  DisclosedContract,
  TransactionResponse,
  JsGetUpdatesResponse,
} from "./infra/canton-client.js";
export { canActAsRight, canReadAsRight } from "./infra/canton-client.js";
export { getCreatedEvent, findCreated, firstCreated } from "./infra/canton-helpers.js";
export { createLedgerStream } from "./infra/ledger-stream.js";
export type { StreamHandle } from "./infra/ledger-stream.js";

// MPC crypto & address derivation
export {
  computeRequestId,
  computeResponseHash,
  hashEvmType2Params,
  toSpkiPublicKey,
  derivePublicKey,
} from "./mpc/crypto.js";
export type { TxParams } from "./mpc/crypto.js";
export {
  deriveCantonPublicKey,
  deriveDepositAddress,
  deriveResponseVerificationPublicKey,
  chainIdHexToCaip2,
  CANTON_RESPONSE_KEY_PATH,
  KEY_VERSION,
} from "./mpc/address-derivation.js";

// EVM transaction building
export {
  buildTxRequest,
  serializeUnsignedTx,
  reconstructSignedTx,
  submitRawTransaction,
} from "./evm/tx-builder.js";
export type {
  CantonEvmAccessListEntry,
  CantonEvmType2Params,
  Eip1559TxFields,
} from "./evm/tx-builder.js";
export { cantonHexToHex, toCantonHex } from "./evm/hex.js";

// Daml template types (re-exported for consumer convenience)
export {
  Signer,
  SignBidirectionalEvent,
  SignatureRespondedEvent,
  RespondBidirectionalEvent,
  SignRequest,
} from "@daml.js/daml-signer-0.0.1/lib/Signer/module";

export {
  Vault,
  VaultProposal,
  Erc20Holding,
  PendingDeposit,
  PendingWithdrawal,
} from "@daml.js/daml-vault-0.0.1/lib/Erc20Vault/module";

// DAR path (resolves to dist/ after build)
export const DAR_PATH = fileURLToPath(new URL("daml-vault-0.0.1.dar", import.meta.url));
