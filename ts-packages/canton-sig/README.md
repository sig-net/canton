# canton-sig

TypeScript client for integrating with the Canton MPC custody stack.
Pairs with the [`signet-signer-v1`](../../daml-packages/signet-signer-v1/README.md) and [`signet-vault-v1`](../../daml-packages/signet-vault-v1/README.md) DARs (bundled at `DAR_PATH`).

## Install

```bash
pnpm add canton-sig viem @noble/curves
```

`viem` is a peer dependency; `@noble/curves` is needed only for the DER signature parsing shown in the quick start.

## Inputs at integration time

You will receive:

1. The `Signer` and `Vault` contract IDs (the MPC operator hosts both).
2. Disclosed-contract envelopes for `Signer` and `Vault` — pass them on every exercise via `disclosedContracts`. A requester is **not** a stakeholder of the `sigNetwork`-co-signed `Signer` (nor of the `sigNetworkFA`-signed fee contracts), so it cannot read them from its own ACS; it fetches the envelopes from the operator's disclosure endpoint. That endpoint (`apps/disclosure-api`) is public, read-only, and split per network: DevNet `GET https://disclosure-api.vercel.app` (alias of `/api/devnet`), testnet `GET https://disclosure-api.vercel.app/api/testnet`, each returning `{ network, signer, vault, fee }`. Use its `signer` and `vault`; the `fee` blobs are a deploy-time snapshot of that network, and because `FeePriceConfig` reprices, production must resolve the fee context **live** as the fee admin (`getFeeCollectorContext`, step 4 below).
3. The MPC **root** secp256k1 public key (uncompressed, hex). Two children are derived from it via the Canton KDF (`ε = keccak256("sig.network v2.0.0 epsilon derivation:canton:global:{operatorsHash}:{path}")`, child = `rootPub + ε·G`):
   - The **EVM child** for the deposit / sweep address (path = `${vaultId},${requester},${userPath}` for deposits, `${vaultId},root` for the sweep). Computed via `deriveDepositAddress`.
   - The **response-verification child** for outcome verification (KDF input `sender = operatorsHash`, constant `path = "canton response key"`, stored on `Vault.mpcResponseVerifyKey`). The Vault operator computes this when creating the Vault via `deriveResponseVerificationPublicKey` + `toSpkiPublicKey` — the integrator can recompute and assert equality before trusting the contract.

## Quick start (deposit round-trip)

```typescript
import {
  CantonClient,
  Vault,
  PendingDeposit,
  SignatureRespondedEvent,
  RespondBidirectionalEvent,
  deriveDepositAddress,
  reconstructSignedTx,
  submitRawTransaction,
  toCantonHex,
  findCreated,
  type DisclosedContract,
  // CC signature fee
  getFeeCollectorContext,
  getTransferFactoryForFee,
  selectInputHoldings,
  holdingInputsFromEvents,
  assembleFeeChoiceArgs,
  collectFeeDisclosures,
  HOLDING_INTERFACE_ID,
} from "canton-sig";
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from "viem";
import { DER } from "@noble/curves/abstract/weierstrass.js";

const canton = new CantonClient("http://localhost:7575");

// 1. Inputs you receive at integration time
// Fetch the Signer + Vault disclosures from the operator's disclosure endpoint — you
// can't read the sigNetwork-only Signer from your own ACS (DevNet endpoint shown).
const { signer: signerDisclosure, vault: vaultDisclosure } = (await (
  await fetch("https://disclosure-api.vercel.app")
).json()) as { signer: DisclosedContract; vault: DisclosedContract };
const signerCid = signerDisclosure.contractId!;
const vaultCid = vaultDisclosure.contractId!;
const sigNetworkFA: string = "..."; // featured-app party — the fee admin (Signer.sigNetworkFA)
const ccRegistryUrl = "https://..."; // CC token-standard registry base
const MPC_ROOT_PUBLIC_KEY = "04..."; // uncompressed secp256k1, no 0x
const VAULT_ID = "my-vault"; // matches Vault.vaultId
const operator: string = "..."; // operator party from Vault.operators
const requester = await canton.allocateParty("MyRequester");
await canton.createUser("my-user", requester);

// 2. Compute the per-user deposit address. operatorsHash must match the
//    Daml mirror: sort, keccak each utf-8 party id, keccak the concat.
const operatorsHash = (() => {
  const sorted = [operator].slice().sort();
  const each = sorted.map((op) => keccak256(toHex(op)).slice(2));
  return keccak256(`0x${each.join("")}`).slice(2);
})();
const subpath = requester; // arbitrary; must be unique per user
const depositAddress = deriveDepositAddress(
  MPC_ROOT_PUBLIC_KEY,
  operatorsHash,
  `${VAULT_ID},${requester},${subpath}`,
);
// → fund this address with the ERC-20 you want to deposit

// 3. Build the sweep tx (transfer(address,uint256) → vault sweep address).
//    nonce / gas / fees come from your destination-chain RPC.
const evmTxParams = {
  to: "<erc20 contract, lowercase, no 0x>",
  calldata:
    "a9059cbb" +
    encodeAbiParameters(parseAbiParameters("address, uint256"), [
      `0x${vaultEvmAddress}`,
      amount,
    ]).slice(2),
  accessList: [],
  value: toCantonHex(0n, 32),
  nonce: toCantonHex(nonce, 32),
  gasLimit: toCantonHex(100_000n, 32),
  maxFeePerGas: toCantonHex(maxFee, 32),
  maxPriorityFeePerGas: toCantonHex(maxPrio, 32),
  chainId: toCantonHex(11155111n, 32),
};

// 4. Assemble the CC signature-fee inputs (charged atomically inside RequestSignature).
//    In production the FA's fee endpoint serves the collector context; reading it
//    directly (as here) needs read authority as the fee admin.
const collector = await getFeeCollectorContext(canton, sigNetworkFA);
const holdings = holdingInputsFromEvents(
  await canton.getInterfaceContracts([requester], HOLDING_INTERFACE_ID),
);
const selection = selectInputHoldings(holdings, collector.priceConfig.feeAmount);
const factory = await getTransferFactoryForFee(ccRegistryUrl, {
  sender: requester,
  feeReceiver: collector.priceConfig.feeReceiver,
  instrumentAdmin: collector.priceConfig.instrumentAdmin,
  instrumentId: collector.priceConfig.instrumentId,
  amount: collector.priceConfig.feeAmount,
  inputHoldingCids: selection.inputHoldingCids,
});
const feeArgs = assembleFeeChoiceArgs(collector, factory, selection);
const feeDisclosures = collectFeeDisclosures(collector, factory);

// 5. Exercise RequestDeposit. NOTE: pass disclosedContracts as the last arg.
const depositTx = await canton.exerciseChoice(
  "my-user",
  [requester],
  Vault.templateId,
  vaultCid,
  "RequestDeposit",
  {
    requester,
    signerCid,
    path: subpath,
    evmTxParams,
    keyVersion: 1,
    algo: "ECDSA",
    dest: "ethereum",
    params: "",
    outputDeserializationSchema: '[{"name":"","type":"bool"}]',
    respondSerializationSchema: '[{"name":"","type":"bool"}]',
    ...feeArgs, // feeRegistrationCid, feeInputs, feeExtraArgs
  },
  undefined,
  [vaultDisclosure, signerDisclosure, ...feeDisclosures],
);
const pending = findCreated(depositTx.transaction.events, "PendingDeposit");
const pendingArgs = pending.createArgument as PendingDeposit;
const { requestId } = pendingArgs;
// PendingDeposit retains pendingArgs.signEventCid; ClaimDeposit archives that request event
// after the response evidence has been validated and consumed.

// 6. Wait for SignatureRespondedEvent, parse DER, broadcast.
const sigEvent = await pollForContract(SignatureRespondedEvent.templateId, requestId);
const { der, recoveryId } = (sigEvent.createArgument as SignatureRespondedEvent).signature.value;
const { r, s } = DER.toSig(Uint8Array.from(Buffer.from(der, "hex")));
const signedTx = reconstructSignedTx(evmTxParams, {
  r: `0x${r.toString(16).padStart(64, "0")}`,
  s: `0x${s.toString(16).padStart(64, "0")}`,
  v: Number(recoveryId),
});
await submitRawTransaction(SEPOLIA_RPC_URL, signedTx);

// 7. Wait for RespondBidirectionalEvent, then claim.
const outcome = await pollForContract(RespondBidirectionalEvent.templateId, requestId);
const claimTx = await canton.exerciseChoice(
  "my-user",
  [requester],
  Vault.templateId,
  vaultCid,
  "ClaimDeposit",
  {
    requester,
    pendingDepositCid: pending.contractId,
    respondBidirectionalEventCid: outcome.contractId,
    signatureRespondedEventCid: sigEvent.contractId,
  },
  undefined,
  [vaultDisclosure],
);
const holding = findCreated(claimTx.transaction.events, "Erc20Holding");
```

`pollForContract` is whatever you implement on top of `canton.getActiveContracts`. The full runnable version (faucet funding, gas fetch, fee assembly, polling, withdrawal) is `test/src/test/devnet-e2e.test.ts` in this repo and is the recommended starting point; it runs as a pure client against a pre-provisioned party and the deployed Vault.

## Security caveats for integrators

`canton-sig` is a thin client; the on-ledger Daml contracts enforce custody. The TS side is responsible for:

- **Use the right disclosed contracts.** `RequestDeposit` and `RequestWithdrawal` exercise `Vault`, the disclosed `Signer`, and the CC fee charge, so pass `[vaultDisclosure, signerDisclosure, ...feeDisclosures]` (the fee registration/collector/price config + the registry's factory/`AmuletRules`/`OpenMiningRound`, from `collectFeeDisclosures`). `ClaimDeposit` and `CompleteWithdrawal` only exercise `Vault` plus visible evidence contracts, so pass `[vaultDisclosure]`; the stored `SignBidirectionalEvent` is visible to the requester and is archived internally by the Vault.
- **The CC signature fee is fail-closed.** `RequestDeposit` / `RequestWithdrawal` abort unless the fee charge settles. Resolve the inputs with `getFeeCollectorContext` + `getTransferFactoryForFee` + `selectInputHoldings`/`holdingInputsFromEvents`, fold them via `assembleFeeChoiceArgs` / `collectFeeDisclosures`, and ensure the receiver's `TransferPreapproval` + the requester's CC funding are in place (design + fee-admin runbook: [`signet-signer-v1/FEE.md`](../../daml-packages/signet-signer-v1/FEE.md)). The off-ledger reprice job sizes `FeePriceConfig.feeAmount` via `computeFeeCc`.
- **Never trust `SignatureRespondedEvent.signature` alone** as proof of execution. Broadcast the resulting tx; wait for the EVM receipt; _then_ wait for `RespondBidirectionalEvent` (signed over the outcome) before exercising `ClaimDeposit` / `CompleteWithdrawal`. The Daml verification is what makes the outcome safe to act on.
- **Treat `SEPOLIA_RPC_URL` (or any destination-chain RPC) as untrusted.** Validate the receipt status, confirmations as your domain requires.
- **Recompute `requestId` and the deposit address with the helpers and assert they match the values inside `PendingDeposit` / your `Vault` instance.** `PendingDeposit.signEventCid` is kept for Vault cleanup after claim; you do not pass it to `ClaimDeposit`. If the derived values don't match, something out-of-band changed (operator set, vaultId, path) — abort.
- **Path namespacing.** `path` must be unique per `(vault, user, sub-path)` — sharing across users gives them the same deposit address. The Vault enforces the `${vaultId},${requester},${userPath}` shape, but your TS side must pass a meaningful `userPath`.
- **`canton-sig` does not verify the outcome signature off-chain.** Rely on the on-ledger `secp256k1WithEcdsaOnly` check inside `ClaimDeposit` / `CompleteWithdrawal`, not on TS-side checks.

## Encoding contract

Canton-format hex is bare lowercase hex, no `0x` prefix; `""` represents empty bytes. All `EvmType2TxParams` numeric fields are 32-byte left-padded uint256s; `to` is a 20-byte address (or `null` for contract creation); `calldata` is raw EVM bytes (may be `""`).

`requestId` is `computeRequestId(sender, txParams, caip2Id, keyVersion, path, algo, dest, params)`:

- `sender` — the operatorsHash. Set on-ledger by `Signer.RequestSignature`; never user-supplied. Mirror it off-chain with the snippet above to verify.
- `caip2Id` — must equal whatever the Vault used, **not** necessarily the signed chainId. The test-mode Vault hardcodes `"eip155:1"` while signing for Sepolia (`11155111`) — a devnet workaround; on mainnet the chain is genuinely `eip155:1`, so `chainIdHexToCaip2(evmTxParams.chainId)` matches and no hardcode is needed. Use whichever the Vault uses, or the recomputed `requestId` won't match.
- `keyVersion` — `KEY_VERSION` (`1`).
- `path` — what you passed in. The Vault prefixes with `${vaultId},${requester},` for deposits and uses `${vaultId},root` internally for the sweep address.
- `algo`, `dest`, `params` — opaque; hashed into `requestId` only. Pass the same values you used on the request (in-repo consumers use `"ECDSA"` / `"ethereum"` / `""`).

The TS implementation matches `signet-signer-v1/daml/RequestId.daml` byte-for-byte.

## API

### `CantonClient(baseUrl = "http://localhost:7575", options?: CantonClientOptions)`

`uploadDar`, `allocateParty`, `createUser`, `createUserWithRights`, `grantUserRights`, `listUserRights`, `createContract`, `exerciseChoice`, `getActiveContracts`, `getInterfaceContracts`, `getDisclosedContract`, `getLedgerEnd`. All typed against the generated OpenAPI schema, except `uploadDar`, which posts the raw DAR bytes via plain `fetch`.

`options.getToken` — optional async bearer-token provider; when set, every request carries `Authorization: Bearer <token>`. A local `dpm sandbox` needs no auth; a hosted participant (e.g. DevNet) does.

Pure helpers: `canActAsRight(party)`, `canReadAsRight(party)`.

### Crypto / KDF

| Export                                                                              | Purpose                                                                                                                               |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `computeRequestId(sender, txParams, caip2Id, keyVersion, path, algo, dest, params)` | Mirror of `RequestId.computeRequestId` — returns `0x`-prefixed `Hex`                                                                  |
| `computeResponseHash(requestId, mpcOutput)`                                         | `keccak256(requestId ‖ output)`                                                                                                       |
| `hashEvmType2Params(p)`                                                             | Per-tx-type field hash used inside `requestId`                                                                                        |
| `deriveCantonPublicKey(rootPubKey, predecessorId, path, keyVersion = 1)`            | Child secp256k1 public key from the Canton KDF                                                                                        |
| `deriveDepositAddress(rootPubKey, predecessorId, path, keyVersion = 1)`             | Child EVM address from MPC root pubkey                                                                                                |
| `deriveResponseVerificationPublicKey(rootPubKey, predecessorId, keyVersion = 1)`    | Child pubkey for `RespondBidirectionalEvent.signature` verification (`predecessorId = operatorsHash`, `path = "canton response key"`) |
| `toSpkiPublicKey(uncompressedPubKey)`                                               | SPKI envelope. Wrap the response-verification child pubkey before storing as `Vault.mpcResponseVerifyKey`.                            |
| `derivePublicKey(privateKey)`                                                       | Uncompressed pubkey hex (no `0x`)                                                                                                     |
| `chainIdHexToCaip2(chainIdHex)`                                                     | Canton-format chainId hex → `"eip155:<decimal>"`                                                                                      |
| `CANTON_RESPONSE_KEY_PATH`                                                          | Constant response-verification key path (`"canton response key"`)                                                                     |
| `KEY_VERSION`                                                                       | `1`                                                                                                                                   |

### EVM tx

| Export                                            | Purpose                                             |
| ------------------------------------------------- | --------------------------------------------------- |
| `buildTxRequest(p)`                               | Canton params → viem-shaped `Eip1559TxFields`       |
| `serializeUnsignedTx(p)`                          | RLP-encoded unsigned tx bytes                       |
| `reconstructSignedTx(p, { r, s, v })`             | RLP-encoded signed tx for `eth_sendRawTransaction`  |
| `submitRawTransaction(rpcUrl, raw)`               | POSTs `eth_sendRawTransaction`, returns the tx hash |
| `cantonHexToHex(s)` / `toCantonHex(value, bytes)` | Format adapters                                     |

### CC signature fee

| Export                                                                       | Purpose                                                                                            |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `getFeeCollectorContext(reader, sigNetworkFA)`                               | Active `FeeCollectorRegistration` + collector + in-window `FeePriceConfig`, with their disclosures |
| `getTransferFactoryForFee(registryUrl, details)`                             | Resolves the CC `TransferFactory` + transfer context from the token-standard registry              |
| `holdingInputsFromEvents(events)`                                            | `Holding` interface views → fee inputs                                                             |
| `selectInputHoldings(holdings, feeAmount)`                                   | Greedy largest-first selection of unlocked holdings covering the fee (max `MAX_TRANSFER_INPUTS`)   |
| `assembleFeeChoiceArgs(collector, factory, selection)`                       | → `{ feeRegistrationCid, feeInputs, feeExtraArgs }` for `RequestDeposit` / `RequestWithdrawal`     |
| `collectFeeDisclosures(collector, factory)`                                  | All fee disclosures to attach to the exercise                                                      |
| `parsePriceConfig(createArgument)` / `isPriceConfigInWindow(cfg, now)`       | `FeePriceConfig` helpers                                                                           |
| `computeFeeCc(inputs)`                                                       | Prices the fee in CC (traffic cost + coverage + profit, scale `CC_DECIMALS`)                       |
| `repriceWindow` / `findLatestPriceConfig` / `repriceOnce` / `runRepriceLoop` | Fee-admin reprice job (`pnpm --filter canton-sig reprice` → `scripts/reprice-fee.ts`)              |

Constants: `HOLDING_INTERFACE_ID`, `PRICE_CONFIG_CONTEXT_KEY`, `TRANSFER_FACTORY_CONTEXT_KEY`, `TRANSFER_FACTORY_REGISTRY_PATH`, `FEE_COLLECTOR_ENDPOINT_PATH`, `EMPTY_TRANSFER_CONTEXT`, `MAX_TRANSFER_INPUTS`, `CC_DECIMALS`.

The FA fee endpoint (`POST` `FEE_COLLECTOR_ENDPOINT_PATH`) serves the same `FeeCollectorContext` shape `getFeeCollectorContext` builds — endpoint contract: [`signet-signer-v1/FEE.md` § Fee endpoint contract](../../daml-packages/signet-signer-v1/FEE.md#fee-endpoint-contract).

### Event utilities

`findCreated(events, templateFragment)` / `firstCreated(events)` / `getCreatedEvent(event)`.

### Re-exported Daml templates

From `@daml.js/signet-signer-v1-0.0.1` and `@daml.js/signet-vault-v1-0.0.2`: `Signer`, `SignerProposal`, `SignBidirectionalEvent`, `SignatureRespondedEvent`, `RespondBidirectionalEvent`, `Vault`, `VaultProposal`, `Erc20Holding`, `PendingDeposit`, `PendingWithdrawal`.

### Types

`CantonClientOptions`, `CreatedEvent`, `Event`, `UserRight`, `DisclosedContract`, `TransactionResponse`, `CantonEvmType2Params`, `CantonEvmAccessListEntry`, `Eip1559TxFields`, `TxParams`, plus the fee types `HoldingInput`, `HoldingSelection`, `FeeLedgerReader`, `FeeCollectorContext`, `FeeTransferDetails`, `ResolvedTransferFactory`, `TransferChoiceContext`, `FeeExtraArgs`, `FeeChoiceArgs`, `FeePricingInputs`, `FeePricingResult`, `MarketInputs`, `RepriceConfig`, `RepriceResult`, `RepriceLoopOptions`, `FeeRepriceClient`.

## Limitations

- **Sepolia RPC defaults.** The internal `PublicClient` is hard-coded to Sepolia. Multi-chain support requires a Vault that wires `evmTxParams.chainId` through to a per-chain client.
- **EIP-1559 only.** `EvmType2TxParams` is the only `TxParams` variant wired through today; the union is open for future BTC / SOL variants.
