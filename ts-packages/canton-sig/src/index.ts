import { fileURLToPath } from "node:url";

// Canton infrastructure
export { CantonClient } from "./infra/canton-client.js";
export type {
  CantonClientOptions,
  CreatedEvent,
  Event,
  UserRight,
  DisclosedContract,
  TransactionResponse,
} from "./infra/canton-client.js";
export { canActAsRight, canReadAsRight } from "./infra/canton-client.js";
export { getCreatedEvent, findCreated, firstCreated } from "./infra/canton-helpers.js";

// MPC crypto & address derivation
export {
  computeRequestId,
  computeResponseHash,
  hashEvmType2Params,
  toSpkiPublicKey,
  derivePublicKey,
} from "./crypto.js";
export type { TxParams } from "./crypto.js";
export {
  deriveCantonPublicKey,
  deriveDepositAddress,
  deriveResponseVerificationPublicKey,
  chainIdHexToCaip2,
  CANTON_RESPONSE_KEY_PATH,
  KEY_VERSION,
} from "./address-derivation.js";

// CC signature fee
export {
  selectInputHoldings,
  holdingInputsFromEvents,
  parsePriceConfig,
  isPriceConfigInWindow,
  getFeeCollectorContext,
  getTransferFactoryForFee,
  assembleFeeChoiceArgs,
  collectFeeDisclosures,
  MAX_TRANSFER_INPUTS,
  TRANSFER_FACTORY_REGISTRY_PATH,
  HOLDING_INTERFACE_ID,
  PRICE_CONFIG_CONTEXT_KEY,
  TRANSFER_FACTORY_CONTEXT_KEY,
  FEE_COLLECTOR_ENDPOINT_PATH,
  EMPTY_TRANSFER_CONTEXT,
} from "./fee.js";
export type {
  HoldingInput,
  HoldingSelection,
  FeeLedgerReader,
  FeeCollectorContext,
  FeeTransferDetails,
  ResolvedTransferFactory,
  TransferChoiceContext,
  FeeExtraArgs,
  FeeChoiceArgs,
} from "./fee.js";
export { computeFeeCc, CC_DECIMALS } from "./fee-pricing.js";
export type { FeePricingInputs, FeePricingResult } from "./fee-pricing.js";
export {
  repriceWindow,
  findLatestPriceConfig,
  repriceOnce,
  runRepriceLoop,
} from "./fee-reprice.js";
export type {
  MarketInputs,
  RepriceConfig,
  RepriceResult,
  RepriceLoopOptions,
  FeeRepriceClient,
} from "./fee-reprice.js";

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
  SignerProposal,
  SignBidirectionalEvent,
  SignatureRespondedEvent,
  RespondBidirectionalEvent,
} from "@daml.js/signet-signer-v1-0.0.1/lib/Signer/module";

export {
  Vault,
  VaultProposal,
  Erc20Holding,
  PendingDeposit,
  PendingWithdrawal,
} from "@daml.js/signet-vault-v1-0.0.1/lib/Erc20Vault/module";

// DAR path (resolves to dist/ after build)
export const DAR_PATH = fileURLToPath(new URL("signet-vault-v1-0.0.1.dar", import.meta.url));
