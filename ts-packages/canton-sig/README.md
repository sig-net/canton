# canton-sig

TypeScript client for integrating with the Canton MPC custody stack.
Pairs with the [`daml-signer`](../../daml-packages/daml-signer/README.md) and [`daml-vault`](../../daml-packages/daml-vault/README.md) DARs (bundled at `DAR_PATH`).

## Install

```bash
pnpm add canton-sig viem
```

`viem` is a peer dependency.

## Inputs at integration time

You will receive:

1. The `Signer` and `Vault` contract IDs (the MPC operator hosts both).
2. Disclosed-contract envelopes for `Signer` and `Vault` — pass them on every exercise via `disclosedContracts`.
3. The MPC **root** secp256k1 public key (uncompressed, hex). Two children are derived from it via the Canton KDF (`ε = keccak256("sig.network v2.0.0 epsilon derivation:canton:global:{operatorsHash}:{path}")`, child = `rootPub + ε·G`):
   - The **EVM child** for the deposit / sweep address (path = `${vaultId},${requester},${userPath}` for deposits, `${vaultId},root` for the sweep). Computed via `deriveDepositAddress`.
   - The **response-verification child** for outcome verification (constant path `"canton response key"`, stored on `Vault.evmMpcPublicKey`). The Vault operator computes this when creating the Vault — the integrator can recompute and assert equality before trusting the contract.

## Quick start (deposit round-trip)

```typescript
import {
  CantonClient,
  Vault, PendingDeposit, SignatureRespondedEvent, RespondBidirectionalEvent,
  deriveDepositAddress, reconstructSignedTx, submitRawTransaction,
  toCantonHex, findCreated, type DisclosedContract,
} from "canton-sig";
import { encodeAbiParameters, parseAbiParameters, keccak256, toHex } from "viem";
import { DER } from "@noble/curves/abstract/weierstrass.js";

const canton = new CantonClient("http://localhost:7575");

// 1. Inputs you receive at integration time
const signerCid: string = "...";
const vaultCid:  string = "...";
const signerDisclosure: DisclosedContract = /* envelope */;
const vaultDisclosure:  DisclosedContract = /* envelope */;
const MPC_ROOT_PUBLIC_KEY = "04..."; // uncompressed secp256k1, no 0x
const VAULT_ID  = "my-vault";        // matches Vault.vaultId
const operator: string  = "...";     // operator party from Vault.operators
const requester = await canton.allocateParty("MyRequester");
await canton.createUser("my-user", requester);

// 2. Compute the per-user deposit address. operatorsHash must match the
//    Daml mirror: sort, keccak each utf-8 party id, keccak the concat.
const operatorsHash = (() => {
  const sorted = [operator].slice().sort();
  const each   = sorted.map((op) => keccak256(toHex(op)).slice(2));
  return keccak256(`0x${each.join("")}`).slice(2);
})();
const subpath = requester;                  // arbitrary; must be unique per user
const depositAddress = deriveDepositAddress(
  MPC_ROOT_PUBLIC_KEY, operatorsHash, `${VAULT_ID},${requester},${subpath}`,
);
// → fund this address with the ERC-20 you want to deposit

// 3. Build the sweep tx (transfer(address,uint256) → vault sweep address).
//    nonce / gas / fees come from your destination-chain RPC.
const evmTxParams = {
  to:                   "<erc20 contract, lowercase, no 0x>",
  calldata:             "a9059cbb" + encodeAbiParameters(
                          parseAbiParameters("address, uint256"),
                          [`0x${vaultEvmAddress}`, amount],
                        ).slice(2),
  accessList:           [],
  value:                toCantonHex(0n,        32),
  nonce:                toCantonHex(nonce,     32),
  gasLimit:             toCantonHex(100_000n,  32),
  maxFeePerGas:         toCantonHex(maxFee,    32),
  maxPriorityFeePerGas: toCantonHex(maxPrio,   32),
  chainId:              toCantonHex(11155111n, 32),
};

// 4. Exercise RequestDeposit. NOTE: pass disclosedContracts as the last arg.
const depositTx = await canton.exerciseChoice(
  "my-user", [requester], Vault.templateId, vaultCid, "RequestDeposit",
  {
    requester, signerCid, path: subpath, evmTxParams,
    keyVersion: 1, algo: "", dest: "", params: "",
    outputDeserializationSchema: '[{"name":"","type":"bool"}]',
    respondSerializationSchema:  '[{"name":"","type":"bool"}]',
  },
  undefined,
  [vaultDisclosure, signerDisclosure],
);
const pending = findCreated(depositTx.transaction.events, "PendingDeposit");
const { requestId } = pending.createArgument as PendingDeposit;

// 5. Wait for SignatureRespondedEvent, parse DER, broadcast.
const sigEvent = await pollForContract(SignatureRespondedEvent.templateId, requestId);
const { der, recoveryId } = sigEvent.signature.value;
const { r, s } = DER.toSig(Uint8Array.from(Buffer.from(der, "hex")));
const signedTx = reconstructSignedTx(evmTxParams, {
  r: `0x${r.toString(16).padStart(64, "0")}`,
  s: `0x${s.toString(16).padStart(64, "0")}`,
  v: Number(recoveryId),
});
await submitRawTransaction(SEPOLIA_RPC_URL, signedTx);

// 6. Wait for RespondBidirectionalEvent, then claim.
const outcome = await pollForContract(RespondBidirectionalEvent.templateId, requestId);
const claimTx = await canton.exerciseChoice(
  "my-user", [requester], Vault.templateId, vaultCid, "ClaimDeposit",
  {
    requester,
    pendingDepositCid:            pending.contractId,
    respondBidirectionalEventCid: outcome.contractId,
    signatureRespondedEventCid:   sigEvent.contractId,
  },
  undefined,
  [vaultDisclosure],
);
const holding = findCreated(claimTx.transaction.events, "Erc20Holding");
```

`pollForContract` is whatever you implement on top of `canton.getActiveContracts` or `createLedgerStream`. The full runnable version (party allocation, faucet funding, gas fetch, polling, withdrawal + refund) is `test/src/test/helpers/e2e-setup.ts` in this repo and is the recommended starting point.

## Security caveats for integrators

`canton-sig` is a thin client; the on-ledger Daml contracts enforce custody. The TS side is responsible for:

- **Use disclosed contracts.** Pass `[vaultDisclosure, signerDisclosure]` on every exercise that touches `Vault` / `Signer`. Without them, the choice fails.
- **Never trust `SignatureRespondedEvent.signature` alone** as proof of execution. Broadcast the resulting tx; wait for the EVM receipt; *then* wait for `RespondBidirectionalEvent` (signed over the outcome) before exercising `ClaimDeposit` / `CompleteWithdrawal`. The Daml verification is what makes the outcome safe to act on.
- **Treat `SEPOLIA_RPC_URL` (or any destination-chain RPC) as untrusted.** Validate the receipt status, confirmations as your domain requires.
- **Recompute `requestId` and the deposit address with the helpers and assert they match the values inside `PendingDeposit` / your `Vault` instance.** If they don't, something out-of-band changed (operator set, vaultId, path) — abort.
- **Path namespacing.** `path` must be unique per `(vault, user, sub-path)` — sharing across users gives them the same deposit address. The Vault enforces the `${vaultId},${requester},${userPath}` shape, but your TS side must pass a meaningful `userPath`.
- **`canton-sig` does not verify the outcome signature off-chain.** Rely on the on-ledger `secp256k1WithEcdsaOnly` check inside `ClaimDeposit` / `CompleteWithdrawal`, not on TS-side checks.

## Encoding contract

Canton-format hex is bare lowercase hex, no `0x` prefix; `""` represents empty bytes. All `EvmType2TxParams` numeric fields are 32-byte left-padded uint256s; `to` is a 20-byte address (or `null` for contract creation); `calldata` is raw EVM bytes (may be `""`).

`requestId` is `computeRequestId(sender, txParams, caip2Id, keyVersion, path, algo, dest, params)`:

- `sender` — the operatorsHash. Set on-ledger by `SignRequest.Execute`; never user-supplied. Mirror it off-chain with the snippet above to verify.
- `caip2Id` — `chainIdHexToCaip2(evmTxParams.chainId)` (e.g. `"eip155:11155111"`).
- `keyVersion` — `KEY_VERSION` (`1`).
- `path` — what you passed in. The Vault prefixes with `${vaultId},${requester},` for deposits and uses `${vaultId},root` internally for the sweep address.
- `algo`, `dest`, `params` — always `""`.

The TS implementation matches `daml-signer/daml/RequestId.daml` byte-for-byte.

## API

### `CantonClient(baseUrl = "http://localhost:7575")`

`uploadDar`, `allocateParty`, `createUser`, `createUserWithRights`, `listUserRights`, `createContract`, `exerciseChoice`, `getActiveContracts`, `getDisclosedContract`, `getLedgerEnd`, `getUpdates`. All typed against the generated OpenAPI schema.

Pure helpers: `canActAsRight(party)`, `canReadAsRight(party)`.

### Crypto / KDF

| Export | Purpose |
| --- | --- |
| `computeRequestId(sender, txParams, caip2Id, keyVersion, path, algo, dest, params)` | Mirror of `RequestId.computeRequestId` — returns `0x`-prefixed `Hex` |
| `computeResponseHash(requestId, mpcOutput)` | `keccak256(requestId ‖ output)` |
| `hashEvmType2Params(p)` | Per-tx-type field hash used inside `requestId` |
| `deriveDepositAddress(rootPubKey, predecessorId, path, keyVersion = 1)` | Child EVM address from MPC root pubkey |
| `toSpkiPublicKey(uncompressedPubKey)` | SPKI envelope. Wrap the **response-verification child pubkey** (not the root) before storing as `Vault.evmMpcPublicKey`. |
| `derivePublicKey(privateKey)` | Uncompressed pubkey hex (no `0x`) |
| `chainIdHexToCaip2(chainIdHex)` | Canton-format chainId hex → `"eip155:<decimal>"` |
| `KEY_VERSION` | `1` |

### EVM tx

| Export | Purpose |
| --- | --- |
| `buildTxRequest(p)` | Canton params → viem-shaped `Eip1559TxFields` |
| `serializeUnsignedTx(p)` | RLP-encoded unsigned tx bytes |
| `reconstructSignedTx(p, { r, s, v })` | RLP-encoded signed tx for `eth_sendRawTransaction` |
| `submitRawTransaction(rpcUrl, raw)` | POSTs `eth_sendRawTransaction`, returns the tx hash |
| `cantonHexToHex(s)` / `toCantonHex(value, bytes)` | Format adapters |

### Streaming + event utilities

`createLedgerStream({ canton, parties, beginExclusive, onUpdate, onReady, onError, onReconnect, maxReconnectAttempts? })` — auto-reconnecting WebSocket with HTTP polling fallback.

`findCreated(events, templateFragment)` / `firstCreated(events)` / `getCreatedEvent(event)`.

### Re-exported Daml templates

From `@daml.js/daml-signer-0.0.1` and `@daml.js/daml-vault-0.0.1`: `Signer`, `SignBidirectionalEvent`, `SignatureRespondedEvent`, `RespondBidirectionalEvent`, `SignRequest`, `Vault`, `VaultProposal`, `Erc20Holding`, `PendingDeposit`, `PendingWithdrawal`.

### Types

`CreatedEvent`, `Event`, `UserRight`, `DisclosedContract`, `TransactionResponse`, `JsGetUpdatesResponse`, `StreamHandle`, `CantonEvmType2Params`, `CantonEvmAccessListEntry`, `Eip1559TxFields`, `TxParams`.

## Limitations

- **Sepolia RPC defaults.** The internal `PublicClient` is hard-coded to Sepolia. Multi-chain support requires a Vault that wires `evmTxParams.chainId` through to a per-chain client.
- **EIP-1559 only.** `EvmType2TxParams` is the only `TxParams` variant wired through today; the union is open for future BTC / SOL variants.
