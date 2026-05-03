# daml-vault

ERC-20 custody on Canton, signed by an MPC network. Domain-specific consumer of the generic [`daml-signer`](../daml-signer/README.md) layer — the Vault builds an EIP-1559 `transfer(address,uint256)` call, hands signing to the Signer, and verifies the returned MPC signature on-ledger via `secp256k1WithEcdsaOnly` before crediting / debiting holdings.

## Templates

| Template | Signatory | Observer | Purpose |
| --- | --- | --- | --- |
| `VaultProposal` | `alreadySigned` | `allOperators` | Multi-party vault setup; each operator exercises `SignVault` until the set matches `allOperators`, then the choice returns the new `Vault` |
| `Vault` | `operators` | `sigNetwork` | Per-deployment singleton; stores `evmVaultAddress`, `evmMpcPublicKey` (the **response-verification** child pubkey, derived off-ledger from the MPC root + `(operatorsHash, "canton response key")`), `vaultId` |
| `PendingDeposit` | `operators` | `requester, sigNetwork` | Single-use anchor archived in `ClaimDeposit` |
| `PendingWithdrawal` | `operators` | `requester, sigNetwork` | Single-use anchor archived in `CompleteWithdrawal`; carries the original holding fields for refund-on-failure |
| `Erc20Holding` | `operators` | `owner` | On-ledger ERC-20 balance. `sigNetwork` is intentionally **not** an observer — the MPC layer is decoupled from domain custody |

## Choices

`Vault.RequestDeposit` (controller `requester`):
1. Validates `evmTxParams.calldata` is exactly `transfer(address,uint256)` (selector `a9059cbb`, two ABI slots, recipient = `evmVaultAddress`, no trailing bytes), and `evmTxParams.to = Some <token>`.
2. Builds `path = "${vaultId},${requester},${userPath}"` so the deposit address is namespaced per vault and per user.
3. In one tx: creates `SignRequest` → exercises `Signer.SignBidirectional` (which runs `Execute` to emit `SignBidirectionalEvent`) → creates `PendingDeposit` carrying `requestId`.

`Vault.ClaimDeposit` (controller `requester`):
1. Archives `PendingDeposit` first (single-use guard against MPC-outcome replay).
2. Cross-checks operators / requester / `requestId` between pending, `RespondBidirectionalEvent`, and `SignatureRespondedEvent`.
3. Verifies the MPC outcome signature against `evmMpcPublicKey`: `secp256k1WithEcdsaOnly(sigDer, keccak256(requestId ‖ serializedOutput), evmMpcPublicKey)`.
4. Rejects if the output starts with the `deadbeef` error prefix or ABI-decodes to `bool(false)`.
5. Calls `Consume_RespondBidirectional` / `Consume_SignatureResponded` (the requester lacks `sigNetwork` authority to archive directly).
6. Decodes the amount from `pending.evmTxParams.calldata` slot 1 and creates `Erc20Holding`.

`Vault.RequestWithdrawal` (controller `requester`):
1. Validates the same calldata shape; also checks `evmTxParams.to == Some holding.erc20Address`, the recipient ABI slot equals the supplied `recipientAddress`, and the amount equals `holding.amount`.
2. **Archives the holding first** (optimistic debit). If MPC reports failure, `CompleteWithdrawal` recreates it.
3. Builds `path = "${vaultId},root"` (the vault sweep address — same as the address tokens were originally deposited to).
4. Same atomic SignRequest → SignBidirectional → PendingWithdrawal flow as deposit.

`Vault.CompleteWithdrawal` (controller `requester`): same verification block as `ClaimDeposit`. Returns `Some Erc20Holding` (refund) when the MPC reports a revert / `bool(false)`, `None` on success.

`VaultProposal.SignVault` (controller `signer`): adds `signer` to `alreadySigned`. When the set matches `allOperators` (sort-equal — order-independent), returns `Right (ContractId Vault)`; otherwise `Left (ContractId VaultProposal)`.

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

const args = encodeAbiParameters(
  parseAbiParameters("address, uint256"),
  [vaultAddress, amount],          // vaultAddress is `0x...`; amount is bigint
).slice(2);                        // drop 0x for Canton-format hex
const calldata = `a9059cbb${args}`;
```

## Security invariants

- `sigNetwork` is **not** an observer of `Erc20Holding`. Compromising the MPC participant cannot leak the domain ledger.
- All four Pending\* lifecycle templates are signed only by `operators` — `sigNetwork` cannot fabricate a pending claim.
- `Vault` and `VaultProposal` reject any `evmVaultAddress` whose high 12 bytes are non-zero (`isAbiAddressSlot`); same check on withdrawal `recipientAddress`. Prevents accidental dirty-padding from changing the recipient on EVM.
- `RequestDeposit` requires `transfer(address,uint256)` with recipient = `evmVaultAddress` and exactly two ABI slots. Anything else aborts before signing.
- `RequestWithdrawal` requires `transfer(address,uint256)` to the holding's token address with recipient = supplied `recipientAddress` and amount = `holding.amount` exactly.
- `Erc20Holding` operators must equal `Vault` operators (sort-equal) on every withdrawal — prevents using a holding minted by a different operator set.
- `ClaimDeposit` / `CompleteWithdrawal` archive the Pending\* contract **before** any other validation, then verify the MPC signature on the outcome bytes before mutating state. Replay of the same `(pendingCid, evidence pair)` fails because the pending is already archived.
- Per-vault key derivation: `path` always includes `vaultId`, so two vaults sharing the same operator set still derive distinct EVM keys. The Signer cannot enforce this — it's the consumer's job, and `daml-vault` does it for you by always prefixing `path` with `vaultId`.

## Usage

```yaml
# daml.yaml
data-dependencies:
  - ../daml-vault/.daml/dist/daml-vault-0.0.1.dar
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../daml-abi/.daml/dist/daml-abi-0.0.1.dar
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

```daml
import Erc20Vault
  ( Vault, VaultProposal, Erc20Holding, PendingDeposit, PendingWithdrawal
  , RequestDeposit(..), ClaimDeposit(..)
  , RequestWithdrawal(..), CompleteWithdrawal(..)
  , SignVault(..)
  )
import Signer (Signer, SignBidirectionalEvent, SignatureRespondedEvent, RespondBidirectionalEvent)
import EvmTypes (EvmType2TransactionParams(..))
```

A complete TypeScript end-to-end run-through (party allocation, vault creation, deposit, claim, withdrawal, refund-on-failure) lives in `test/src/test/helpers/e2e-setup.ts` in this repo.
