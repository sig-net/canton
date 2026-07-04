# signet-vault-v1

ERC-20 custody on Canton, signed by an MPC network. Domain-specific consumer of the generic [`signet-signer-v1`](../signet-signer-v1/README.md) layer — clients supply EIP-1559 `transfer(address,uint256)` params, the Vault validates the recipient/token/amount shape, hands signing to the Signer, and verifies the returned MPC response signature on-ledger via `secp256k1WithEcdsaOnly` before deposit minting or withdrawal settlement/refund.

## Templates

| Template            | Signatory       | Observer                | Purpose                                                                                                                                                                                                                                   |
| ------------------- | --------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `VaultProposal`     | `alreadySigned` | `allOperators`          | Multi-party vault setup; each operator exercises `SignVault` until the set matches `allOperators`, then the choice returns the new `Vault`                                                                                                |
| `Vault`             | `operators`     | `sigNetwork`            | Per-deployment singleton; stores `evmVaultAddress`, `mpcResponseVerifyKey` (the **response-verification** child pubkey, derived off-ledger from the MPC root with `sender = operatorsHash` and `path = "canton response key"`), `vaultId` |
| `PendingDeposit`    | `operators`     | `requester, sigNetwork` | Single-use anchor archived in `ClaimDeposit`; carries `requestId`, `evmTxParams`, and the `SignBidirectionalEvent` CID to clean up after completion                                                                                       |
| `PendingWithdrawal` | `operators`     | `requester, sigNetwork` | Single-use anchor archived in `CompleteWithdrawal`; carries the original holding fields and `SignBidirectionalEvent` CID for refund-on-failure and cleanup                                                                                |
| `Erc20Holding`      | `operators`     | `owner`                 | On-ledger ERC-20 balance. `sigNetwork` is intentionally **not** an observer — the MPC layer is decoupled from domain custody                                                                                                              |

## Parties

| Party          | Role                                               | Owns                                                            |
| -------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| `sigNetwork`   | MPC infrastructure party                           | Co-signs `Signer` (with `sigNetworkFA`); MPC response contracts |
| `sigNetworkFA` | Featured-app provider and fee admin (signer layer) | Co-signs `Signer` and the sign/response events; fee contracts   |
| `operators`    | Vault operator set                                 | `Vault`, pending anchors, holdings                              |
| `requester`    | End user for a deposit/withdrawal                  | Request flow and owned holdings                                 |

## Choices

Both `RequestDeposit` and `RequestWithdrawal` also take the three CC signature-fee args
(`feeRegistrationCid`, `feeInputs`, `feeExtraArgs`) and forward them to
`Signer.RequestSignature`, which charges the fee atomically through the registered late-bound
`FeeCollector`. The requester sources them client-side (see `canton-sig`'s fee helpers) and
attaches the matching disclosures; if the fee can't settle, `RequestSignature` aborts and nothing
is created. See [signet-signer-v1 § CC signature fee](../signet-signer-v1/FEE.md).

Both choices also pin `caip2Id = "eip155:1"` (test mode — the MPC indexer accepts only that
caip2). caip2 is decoupled from the signed `chainId`, so on DevNet the tx itself targets Sepolia.

`Vault.RequestDeposit` (controller `requester`):

1. Validates `evmTxParams.calldata` is exactly `transfer(address,uint256)` (selector `a9059cbb`, two ABI slots, recipient = `evmVaultAddress`, no trailing bytes), and `evmTxParams.to = Some <token>`.
2. Builds `path = "${vaultId},${requester},${userPath}"` so the deposit address is namespaced per vault and per user.
3. In one tx: exercises `Signer.RequestSignature` (which charges the CC fee and emits `SignBidirectionalEvent`) → creates `PendingDeposit` carrying `requestId` and `signEventCid`.

`Vault.ClaimDeposit` (controller `requester`):

1. Archives `PendingDeposit` first (single-use guard against MPC-outcome replay).
2. Cross-checks operators / requester / `requestId` between pending, `RespondBidirectionalEvent`, and `SignatureRespondedEvent`.
3. Verifies the MPC outcome signature against `mpcResponseVerifyKey`: `secp256k1WithEcdsaOnly(sigDer, keccak256(requestId ‖ serializedOutput), mpcResponseVerifyKey)`.
4. Rejects if the output starts with the `deadbeef` error prefix or ABI-decodes to `bool(false)`.
5. Calls `Consume_RespondBidirectional` / `Consume_SignatureResponded` (the requester lacks `sigNetwork` authority to archive those directly).
6. Retires the stored `SignBidirectionalEvent` via `Consume_SignBidirectional` (a bare `archive` would lack `sigNetworkFA`'s authority) after the response evidence has been validated and consumed.
7. Decodes the amount from `pending.evmTxParams.calldata` slot 1 and creates `Erc20Holding`.

`Vault.RequestWithdrawal` (controller `requester`):

1. Validates the same calldata shape; also checks `evmTxParams.to == Some holding.erc20Address`, the recipient ABI slot equals the supplied `recipientAddress`, and the amount equals `holding.amount`.
2. **Archives the holding first** (optimistic debit). If MPC reports failure, `CompleteWithdrawal` recreates it.
3. Builds `path = "${vaultId},root"` for the shared vault address that receives deposit sweeps and funds withdrawals.
4. Same atomic `RequestSignature` → `PendingWithdrawal` flow as deposit, including storage of `signEventCid`.

`Vault.CompleteWithdrawal` (controller `requester`): same verification and Signer cleanup block as `ClaimDeposit`. Returns `Some Erc20Holding` (refund) when the MPC reports a revert / `bool(false)`, `None` on success.

`VaultProposal.SignVault` (controller `signer`): adds `signer` to `alreadySigned`. When the set matches `allOperators` (sort-equal — order-independent), returns `Right (ContractId Vault)`; otherwise `Left (ContractId VaultProposal)`.

## Deposit lifecycle

The deposit flow mirrors the usual centralized-exchange pattern: a user funds a derived deposit address, the vault sweeps those tokens to the shared vault address, and Canton mints an `Erc20Holding` only after the MPC outcome is verified on-ledger.

1. Derive addresses off-ledger from the MPC root public key with `sender = operatorsHash`.
   - Deposit address path: `${vaultId},${requester},${userPath}`.
   - Vault sweep address path: `${vaultId},root`; store this as `Vault.evmVaultAddress` in ABI address-slot form.
2. The user funds the deposit address on the destination chain with the ERC-20 token and enough native gas for the sweep.
3. The user exercises `Vault.RequestDeposit`, passing EIP-1559 params for `transfer(vaultAddress, amount)` against the ERC-20 contract.
4. `RequestDeposit` validates calldata, exercises `Signer.RequestSignature`, fetches the resulting `SignBidirectionalEvent`, computes `requestId`, and creates `PendingDeposit` with both `requestId` and `signEventCid`.
5. The MPC service observes `SignBidirectionalEvent`, signs the request-specific digest with the child key for the request path, and creates `SignatureRespondedEvent`.
6. The client reads `SignatureRespondedEvent`, reconstructs the signed EIP-1559 transaction, and submits it to the destination chain.
7. After the receipt is finalized, the MPC service publishes `RespondBidirectionalEvent` with `serializedOutput` and a response signature made by the response-verification child key.
8. The user exercises `Vault.ClaimDeposit`. The choice archives `PendingDeposit`, cross-checks both MPC evidence contracts, verifies `RespondBidirectionalEvent.signature` against `mpcResponseVerifyKey`, rejects failures or `bool(false)`, consumes both evidence contracts, retires the original `SignBidirectionalEvent` via `Consume_SignBidirectional`, and creates `Erc20Holding`.

```text
  Sender / requester              Vault (operators)               Signer (sigNetwork)             MPC service                     Destination chain
|                               |                               |                               |                               |                               |
| 1. fund deposit address       |                               |                               |                               | ERC20 transfer                |
|------------------------------------------------------------------------------------------------------------------------------>|                               |
|                               |                               |                               |                               |                               |
| 2. RequestDeposit             |                               |                               |                               |                               |
|------------------------------>|                               |                               |                               |                               |
|                               | validate calldata             |                               |                               |                               |
|                               | exercise RequestSignature     |                               |                               |                               |
|                               |------------------------------>| RequestSignature              |                               |                               |
|                               |                               | charge CC fee                 |                               |                               |
|                               |                               | SignBidirectionalEvent        |                               |                               |
|                               | create PendingDeposit         |                               |                               |                               |
|                               |                               |                               |                               |                               |
|                               |                               |                               | 3. observe event              |                               |
|                               |                               |                               | derive request key            |                               |
|                               |                               |                               | threshold-sign request        |                               |
|                               |                               |                               |                               |                               |
|                               |                               | Respond                       | 4. create                     |                               |
|                               |                               |<------------------------------|                               |                               |
|                               |                               | SignatureRespondedEvent       |                               |                               |
|                               |                               |                               |                               |                               |
| 5. read                       |                               |                               |                               |                               |
| SignatureRespondedEvent       |                               |                               |                               |                               |
| reconstructSignedTx           |                               |                               |                               | eth_sendRawTransaction        |
|                               |                               |                               |                               | sweep funds to vault address  |
|------------------------------------------------------------------------------------------------------------------------------>|                               |
|                               |                               |                               |                               |                               |
|                               |                               |                               | 6. poll receipt               | receipt finalized             |
|                               |                               |                               | re-simulate call              |                               |
|                               |                               |                               |                               |                               |
|                               |                               | RespondBidirectional          | 7. create                     |                               |
|                               |                               |<------------------------------|                               |                               |
|                               |                               | RespondBidirectionalEvent     |                               |                               |
|                               |                               |                               |                               |                               |
| 8. ClaimDeposit               |                               |                               |                               |                               |
|------------------------------>|                               |                               |                               |                               |
|                               | archive PendingDeposit        |                               |                               |                               |
|                               | validate evidence contracts   |                               |                               |                               |
|                               | verify response signature     |                               |                               |                               |
|                               | via mpcResponseVerifyKey      |                               |                               |                               |
|                               | Consume_RespondBidirectional  |                               |                               |                               |
|                               | Consume_SignatureResponded    |                               |                               |                               |
|                               | Consume_SignBidirectional     |                               |                               |                               |
|                               | create Erc20Holding           |                               |                               |                               |
|<------------------------------|                               |                               |                               |                               |
| Erc20Holding                  |                               |                               |                               |                               |
```

## Withdrawal lifecycle

The withdrawal flow spends a user's Canton holding by signing an ERC-20 transfer from the shared vault address. It uses optimistic debit: the holding is archived before signing, then recreated only if the destination-chain outcome reports failure.

1. The user exercises `Vault.RequestWithdrawal` with an owned `Erc20Holding`, a recipient ABI address slot, and EIP-1559 params for `transfer(recipient, amount)`.
2. `RequestWithdrawal` verifies holding owner, operator set, token address, amount, recipient, calldata shape, and token contract recipient.
3. The choice archives the holding, then exercises `Signer.RequestSignature`, fetches the `SignBidirectionalEvent`, computes `requestId`, and creates `PendingWithdrawal` with both `requestId` and `signEventCid`.
4. The signing path is `${vaultId},root`, so the signed transaction spends from the shared vault address.
5. The MPC service and client follow the same response flow as deposit: `SignatureRespondedEvent` carries the request signature, the client submits the signed transaction, and `RespondBidirectionalEvent` carries the verified outcome bytes.
6. The user exercises `Vault.CompleteWithdrawal`. The choice archives `PendingWithdrawal`, cross-checks both MPC evidence contracts, verifies the response signature against `mpcResponseVerifyKey`, consumes both evidence contracts, and retires the original `SignBidirectionalEvent` via `Consume_SignBidirectional`.
7. On success (`serializedOutput` does not start with `deadbeef` and ABI-decodes to `bool(true)`), the withdrawal is final and the choice returns `None`.
8. On failure or `bool(false)`, the choice recreates the archived `Erc20Holding` with the original owner, token address, and amount, then returns `Some refundCid`.

```text
  Sender / requester              Vault (operators)               Signer (sigNetwork)             MPC service                     Destination chain
|                               |                               |                               |                               |                               |
| 1. RequestWithdrawal          |                               |                               |                               |                               |
|------------------------------>|                               |                               |                               |                               |
|                               | validate holding + calldata   |                               |                               |                               |
|                               | archive Erc20Holding          |                               |                               |                               |
|                               | exercise RequestSignature     |                               |                               |                               |
|                               |------------------------------>| RequestSignature              |                               |                               |
|                               |                               | charge CC fee                 |                               |                               |
|                               |                               | SignBidirectionalEvent        |                               |                               |
|                               | create PendingWithdrawal      |                               |                               |                               |
|                               |                               |                               |                               |                               |
|                               |                               |                               | 2. observe event              |                               |
|                               |                               |                               | derive vault key              |                               |
|                               |                               |                               | threshold-sign request        |                               |
|                               |                               |                               |                               |                               |
|                               |                               | Respond                       | 3. create                     |                               |
|                               |                               |<------------------------------|                               |                               |
|                               |                               | SignatureRespondedEvent       |                               |                               |
|                               |                               |                               |                               |                               |
| 4. read                       |                               |                               |                               |                               |
| SignatureRespondedEvent       |                               |                               |                               |                               |
| reconstructSignedTx           |                               |                               |                               | eth_sendRawTransaction        |
|                               |                               |                               |                               | transfer funds to recipient   |
|------------------------------------------------------------------------------------------------------------------------------>|                               |
|                               |                               |                               |                               |                               |
|                               |                               |                               | 5. poll receipt               | receipt finalized             |
|                               |                               |                               | re-simulate call              |                               |
|                               |                               |                               |                               |                               |
|                               |                               | RespondBidirectional          | 6. create                     |                               |
|                               |                               |<------------------------------|                               |                               |
|                               |                               | RespondBidirectionalEvent     |                               |                               |
|                               |                               |                               |                               |                               |
| 7. CompleteWithdrawal         |                               |                               |                               |                               |
|------------------------------>|                               |                               |                               |                               |
|                               | archive PendingWithdrawal     |                               |                               |                               |
|                               | validate evidence contracts   |                               |                               |                               |
|                               | verify response signature     |                               |                               |                               |
|                               | via mpcResponseVerifyKey      |                               |                               |                               |
|                               | Consume_RespondBidirectional  |                               |                               |                               |
|                               | Consume_SignatureResponded    |                               |                               |                               |
|                               | Consume_SignBidirectional     |                               |                               |                               |
|                               | success -> None               |                               |                               |                               |
|                               | failure -> Erc20Holding       |                               |                               |                               |
|<------------------------------|                               |                               |                               |                               |
| result                        |                               |                               |                               |                               |
```

## MPC outcome bytes

`RespondBidirectionalEvent.serializedOutput` is interpreted by the vault claim choices:

| Outcome                            | Encoding                                                                                                                     | Vault behavior                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| ERC-20 call succeeded              | ABI-encoded return data, expected to decode as `bool(true)` for `transfer`                                                   | `ClaimDeposit` mints; `CompleteWithdrawal` ends |
| ERC-20 call returned `bool(false)` | ABI-encoded `bool(false)`                                                                                                    | deposit rejects; withdrawal refunds             |
| EVM tx reverted/replaced/failed    | `deadbeef` prefix followed by a fixed ABI-encoded placeholder — only the prefix is meaningful, no error details are embedded | deposit rejects; withdrawal refunds             |

The response signature is over `keccak256(requestId ‖ serializedOutput)`. The request signature in `SignatureRespondedEvent` is not treated as proof of execution; deposit minting and withdrawal settlement/refund happen only after the vault verifies the signed response outcome. `RequestWithdrawal` archives the holding earlier as optimistic debit.

## Calldata shape (deposit + withdrawal)

```
selector = 0xa9059cbb                                    // transfer(address,uint256)
slot 0   = recipient address, 20 bytes left-zero-padded to 32 bytes
slot 1   = amount, 32-byte uint256
total    = 4 + 32 + 32 = 68 bytes; no trailing bytes
```

Build with viem:

```typescript
import { encodeAbiParameters, parseAbiParameters } from "viem";

const transferRecipient = vaultAddress; // for withdrawal, use the external recipient address
const args = encodeAbiParameters(parseAbiParameters("address, uint256"), [
  transferRecipient,
  amount,
]).slice(2); // drop 0x for Canton-format hex
const calldata = `a9059cbb${args}`;
```

## Security invariants

- `sigNetwork` is **not** an observer of `Erc20Holding`. It can observe the vault and pending MPC workflow contracts, but not active per-owner holding balances.
- Both Pending\* lifecycle templates are signed only by `operators` — `sigNetwork` cannot fabricate a pending claim.
- `Vault` and `VaultProposal` reject any `evmVaultAddress` whose high 12 bytes are non-zero (`isAbiAddressSlot`); same check on withdrawal `recipientAddress`. Prevents accidental dirty-padding from changing the recipient on EVM.
- `RequestDeposit` requires `transfer(address,uint256)` with recipient = `evmVaultAddress` and exactly two ABI slots. Anything else aborts before signing.
- `RequestWithdrawal` requires `transfer(address,uint256)` to the holding's token address with recipient = supplied `recipientAddress` and amount = `holding.amount` exactly.
- `Erc20Holding` operators must equal `Vault` operators (sort-equal) on every withdrawal — prevents using a holding minted by a different operator set.
- `ClaimDeposit` / `CompleteWithdrawal` archive the Pending\* contract **before** any other validation as the single-use guard, then verify the MPC signature on the outcome bytes before minting, refunding, or finalizing. Replay of the same `(pendingCid, evidence pair)` fails because the pending is already archived.
- Pending\* contracts store the original `signEventCid`; successful claim/completion retires that `SignBidirectionalEvent` via `Consume_SignBidirectional` after the response evidence is validated and consumed. The event stays active while the MPC still needs it for `Respond` / `RespondBidirectional`, then is removed to avoid stale request events.
- Per-vault key derivation: `path` always includes `vaultId`, so two vaults sharing the same operator set still derive distinct EVM keys. The Signer cannot enforce this — it's the consumer's job, and `signet-vault-v1` does it for you by always prefixing `path` with `vaultId`.

## Usage

```yaml
# daml.yaml
data-dependencies:
  - ../signet-vault-v1/.daml/dist/signet-vault-v1-0.0.1.dar
  - ../signet-signer-v1/.daml/dist/signet-signer-v1-0.0.1.dar
  - ../signet-abi/.daml/dist/signet-abi-0.0.1.dar
  - ../signet-eip712/.daml/dist/signet-eip712-0.0.1.dar
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

```haskell
import Erc20Vault
  ( Vault, VaultProposal, Erc20Holding, PendingDeposit, PendingWithdrawal
  , RequestDeposit(..), ClaimDeposit(..)
  , RequestWithdrawal(..), CompleteWithdrawal(..)
  , SignVault(..)
  )
import Signer (Signer, SignBidirectionalEvent, SignatureRespondedEvent, RespondBidirectionalEvent)
import EvmTypes (EvmType2TransactionParams(..))
```

A TypeScript end-to-end run-through of the success paths (deposit, claim, withdrawal) lives in `test/src/test/devnet-e2e.test.ts`, against a Vault pre-deployed by `test/src/scripts/deploy.ts` (the e2e fetches it from the disclosure endpoint).
