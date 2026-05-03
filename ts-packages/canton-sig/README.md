# canton-sig

TypeScript client for integrating with the Canton MPC custody stack.
Pairs with the [`daml-signer`](../../daml-packages/daml-signer/README.md) and [`daml-vault`](../../daml-packages/daml-vault/README.md) DARs (bundled).

What's in here:

- **`CantonClient`** — typed wrapper around the [Canton JSON Ledger API v2](https://docs.digitalasset.com/build/3.4/explanations/json-api/index.html) (party / user / DAR / command / state / updates).
- **Crypto helpers** — `computeRequestId`, `computeResponseHash`, `hashEvmType2Params`, `deriveDepositAddress`, `toSpkiPublicKey`. Byte-identical mirrors of `daml-signer`'s `RequestId.daml`.
- **EVM tx helpers** — `buildTxRequest`, `serializeUnsignedTx`, `reconstructSignedTx`, `submitRawTransaction`. Use these to assemble + broadcast the signed EIP-1559 tx after the MPC publishes its signature.
- **Daml template re-exports** — `Signer`, `SignBidirectionalEvent`, `SignatureRespondedEvent`, `RespondBidirectionalEvent`, `SignRequest`, `Vault`, `VaultProposal`, `Erc20Holding`, `PendingDeposit`, `PendingWithdrawal`.
- **`DAR_PATH`** — absolute path to the bundled `daml-vault-0.0.1.dar` (includes `daml-signer` transitively).

## Install

```bash
pnpm add canton-sig viem
```

`viem` is a peer dependency.

## Quick Start

You'll receive three things at integration time:

1. The `Signer` and `Vault` contract IDs (the MPC operator hosts both).
2. Disclosed-contract envelopes for `Signer` and `Vault` (so your participant can exercise choices on contracts it doesn't see otherwise).
3. The MPC **root** secp256k1 public key (uncompressed, hex). Used to derive your deposit address and to verify outcome signatures on-ledger.

A full deposit round-trip:

```typescript
import {
  CantonClient,
  Signer,
  Vault,
  Erc20Holding,
  PendingDeposit,
  SignatureRespondedEvent,
  RespondBidirectionalEvent,
  deriveDepositAddress,
  reconstructSignedTx,
  submitRawTransaction,
  toCantonHex,
  findCreated,
  type DisclosedContract,
} from "canton-sig";
import { encodeAbiParameters, parseAbiParameters } from "viem";
import { DER } from "@noble/curves/abstract/weierstrass.js";

const canton = new CantonClient("http://localhost:7575");

// 1. Inputs you receive at integration time
const signerCid: string         = "...";
const vaultCid: string          = "...";
const signerDisclosure: DisclosedContract = /* envelope */;
const vaultDisclosure:  DisclosedContract = /* envelope */;
const MPC_ROOT_PUBLIC_KEY: string = "04...";  // uncompressed secp256k1, no 0x
const VAULT_ID            = "my-vault";       // matches the Vault.vaultId field
const operator: string    = "...";            // operator party (Vault.operators)
const requester: string   = await canton.allocateParty("MyRequester");
await canton.createUser("my-user", requester);

// 2. Compute your per-user deposit address (vaultId,requester,subpath)
//    operatorsHash mirror — sort, keccak each (utf-8), keccak the concat.
import { keccak256, toHex } from "viem";
const operatorsHash = (() => {
  const sorted = [operator].slice().sort();
  const each = sorted.map((op) => keccak256(toHex(op)).slice(2));
  return keccak256(`0x${each.join("")}`).slice(2);
})();
const subpath = requester;                                  // arbitrary; per-user
const depositAddress = deriveDepositAddress(
  MPC_ROOT_PUBLIC_KEY, operatorsHash, `${VAULT_ID},${requester},${subpath}`,
);
//    -> send your ERC-20 to depositAddress on the destination chain

// 3. Build the sweep tx (transfer(address,uint256) -> vault address)
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

// 4. Exercise RequestDeposit (note the disclosedContracts last)
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

// 5. Wait for the MPC's SignatureRespondedEvent (poll or stream),
//    reconstruct the signed tx, broadcast.
const sigEvent = await pollForContract(SignatureRespondedEvent.templateId, requestId);
const sig = parseDer(sigEvent.signature);
const signedTx = reconstructSignedTx(evmTxParams, sig);
await submitRawTransaction(SEPOLIA_RPC_URL, signedTx);

// 6. Wait for the MPC's RespondBidirectionalEvent.
const outcome = await pollForContract(RespondBidirectionalEvent.templateId, requestId);

// 7. Claim
const claimTx = await canton.exerciseChoice(
  "my-user", [requester], Vault.templateId, vaultCid, "ClaimDeposit",
  {
    requester,
    pendingDepositCid:           pending.contractId,
    respondBidirectionalEventCid: outcome.contractId,
    signatureRespondedEventCid:   sigEvent.contractId,
  },
  undefined,
  [vaultDisclosure],
);
const holding = findCreated(claimTx.transaction.events, "Erc20Holding");
```

The full executable version (with party allocation, faucet funding, gas fetch, polling helpers, withdrawal + refund) lives in `test/src/test/helpers/e2e-setup.ts` in this repo and is the recommended starting point.

## Encoding contract

Canton-format hex is bare lowercase hex, no `0x` prefix; `""` represents empty bytes. All `EvmType2TxParams` numeric fields are 32-byte left-padded uint256s; `to` is a 20-byte address (or `null` for contract creation); `calldata` is raw EVM bytes (may be `""`).

- `toCantonHex(value, bytes)` — encode a number/bigint as left-padded Canton-format hex.
- `cantonHexToHex(s)` — convert back to viem `Hex`.

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
| `toSpkiPublicKey(uncompressedPubKey)` | SPKI envelope; matches `Vault.evmMpcPublicKey` |
| `derivePublicKey(privateKey)` | Uncompressed pubkey hex (no 0x) |
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

From `@daml.js/daml-signer-0.0.1` and `@daml.js/daml-vault-0.0.1`:

`Signer`, `SignBidirectionalEvent`, `SignatureRespondedEvent`, `RespondBidirectionalEvent`, `SignRequest`, `Vault`, `VaultProposal`, `Erc20Holding`, `PendingDeposit`, `PendingWithdrawal`.

### Types

`CreatedEvent`, `Event`, `UserRight`, `DisclosedContract`, `TransactionResponse`, `JsGetUpdatesResponse`, `StreamHandle`, `CantonEvmType2Params`, `CantonEvmAccessListEntry`, `Eip1559TxFields`, `TxParams`.

## Limitations

- **Sepolia RPC defaults.** The internal `PublicClient` used internally is hard-coded to Sepolia. Multi-chain support requires a Vault that wires `evmTxParams.chainId` through to a per-chain client.
- **Unsupported tx types.** Only `EvmType2TxParams` (EIP-1559) is wired through today; the union is open for future BTC / SOL variants.
