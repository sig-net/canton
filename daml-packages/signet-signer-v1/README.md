# signet-signer-v1

Generic MPC signing infrastructure for Canton. The Signer is a small set of Daml templates that lets a calling contract ask a trusted MPC service (the `sigNetwork` party) to produce signatures for transactions on a downstream chain (currently EVM; extensible to BTC, Solana, etc.). It is chain-agnostic and reusable across multiple consumer implementations.

These templates are the Canton implementation of the standard Signet [Sign Bidirectional Flow](https://docs.sig.network/architecture/sign-bidirectional) — see that page for the chain-agnostic lifecycle phases; it links onward to the detailed docs for the serialization schemas, `0xdeadbeef` error handling, key derivation, and response-key model. This README documents only the Canton-specific API and integrator obligations.

For a worked consumer example see [`signet-vault-v1`](../signet-vault-v1/README.md). For an executable end-to-end run-through of deposit, claim, and withdrawal (run as a pure client against a pre-provisioned party and the deployed Vault) see `test/src/test/devnet-e2e.test.ts` in this repo.

## How this fits together

```
+--------------------+        exercise         +----------------------+
| Consumer contract  | ----------------------> | Canton (Signer)      |
|  (operators+req.)  |    RequestSignature     |   RequestSignature   |
+--------------------+                         |   -> SignBidirEvent  |
        ^                                      +-----------+----------+
        |                                                  |
        |  SignatureRespondedEvent                         | observed off-Canton
        |  RespondBidirectionalEvent                       v
        +------------------------------------------ (MPC produces two
                                                    Canton evidence
                                                    contracts asynchronously)
```

Two service parties are involved: `sigNetwork` (the MPC service) and `sigNetworkFA` (the featured-app provider). Only `operators + requester` authorize a request — a compromised MPC cannot forge or initiate signing. The MPC answers each request with two evidence contracts — see [Integrator lifecycle § 2](#2-the-mpc-service-responds-off-canton-asynchronous).

The Signer enforces operator-set isolation, not replay protection — calldata validation, single-use semantics, and per-deployment `path` namespacing are the consumer's job. See the [security checklist](./SECURITY.md).

## Quickstart

`daml.yaml`:

```yaml
data-dependencies:
  - ../signet-signer-v1/.daml/dist/signet-signer-v1-0.0.1.dar
  - ../signet-eip712/.daml/dist/signet-eip712-0.0.1.dar # transitive — required at compile time
  # RequestSignature takes the fee args (see "CC signature fee"), so a consumer
  # that threads them needs the frozen fee API + the vendored interface DARs:
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
  # add signet-abi if you need the calldata-decoding helpers used by signet-vault-v1:
  # - ../signet-abi/.daml/dist/signet-abi-0.0.1.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

Daml imports:

```haskell
import DA.Crypto.Text (secp256k1WithEcdsaOnly)
import DA.List (sort)

import Signer
  ( Signer, RequestSignature(..), SignBidirectionalEvent(..)
  , SignatureRespondedEvent(..), RespondBidirectionalEvent(..)
  , Consume_SignBidirectional(..)
  , Consume_SignatureResponded(..), Consume_RespondBidirectional(..)
  , requestIdFromSignEvent, signatureDer, validSignature
  , Signature(..), EcdsaSigData(..)
  )
import EvmTypes (EvmType2TransactionParams(..), EvmAccessListEntry(..))
import TxParams (TxParams(..))
import RequestId (computeRequestId, computeResponseHash)
import Eip712 (chainIdToDecimalText)
import Signet.Api.Fee.V1 (FeeCollectorRegistration)
import Splice.Api.Token.HoldingV1 (Holding)
import Splice.Api.Token.MetadataV1 (ExtraArgs)
```

You'll be given two things to integrate against.

**1. The `Signer` disclosed-contract envelope.** Attach it under `disclosedContracts` on every command that exercises the `Signer` (e.g. `RequestSignature`). It carries no secrets — treat it as config. You can't read the `Signer` from your own ACS, so obtain its envelope from the operator's disclosure endpoint. That endpoint is `apps/disclosure-api`, served live per network: DevNet at `https://disclosure-api.vercel.app` (alias of `/api/devnet`), testnet at `https://disclosure-api.vercel.app/api/testnet`. `await fetch(<network endpoint>)` returns the disclosures as `{ network, signer, vault, fee }`, where the `signer` field is the `Signer` envelope below (illustrative values — fetch the live one rather than hard-coding it):

```json
{
  "templateId": "…:Signer:Signer",
  "contractId": "00…",
  "createdEventBlob": "CgMy…",
  "synchronizerId": "global-domain::1220…"
}
```

`templateId` + `contractId` identify the on-ledger `Signer`; `createdEventBlob` is the authenticated create-event payload the ledger validates the disclosure against; `synchronizerId` is the Canton synchronizer (domain) it lives on.

**2. The MPC root secp256k1 public key** (uncompressed hex; the per-network values published in signet.js as [`ROOT_PUBLIC_KEYS`](https://github.com/sig-net/signet.js/blob/a301d05a1c94f3e6bbf962f123d2f18236aef510/src/constants.ts#L20) are NAJ-encoded (`secp256k1:…`) — convert with signet.js's `normalizeToUncompressedPubKey`). Derive two children off-ledger with the Canton KDF — `ε = keccak256(prefix : chainId : predecessorId : path)`, child = `rootPub + ε·G`, with `predecessorId = sender = operatorsHash`. The prefix (`"sig.network v2.0.0 epsilon derivation"`) and `canton:global` chain id are authoritative in signet.js: [`deriveChildPublicKey`](https://github.com/sig-net/signet.js/blob/a301d05a1c94f3e6bbf962f123d2f18236aef510/src/utils/cryptography.ts#L90-L122), [`KDF_CHAIN_IDS`](https://github.com/sig-net/signet.js/blob/a301d05a1c94f3e6bbf962f123d2f18236aef510/src/constants.ts#L35-L39):

- The **EVM child address** (`path` = whatever you pass on `RequestSignature`; `canton-sig`'s `deriveDepositAddress` does this in one call).
- The **response-verification pubkey** for constant `path = "canton response key"` — store this on your contract so `secp256k1WithEcdsaOnly` can verify `RespondBidirectionalEvent.signature` on-ledger. See [security checklist #4](./SECURITY.md).

## Integrator lifecycle

A single signing request, end-to-end. All steps run inside one Daml transaction except step 2 (off-Canton, asynchronous) and step 3 (a separate transaction once both response events are visible).

### 1. Issue a signing request

Inside a consumer choice body (which has `operators` signatory + `requester` controller authority):

```haskell
nonconsuming choice MyDomainAction : (ContractId SignBidirectionalEvent, ContractId MyAnchor)
  with
    requester    : Party
    signerCid    : ContractId Signer
    evmTxParams  : EvmType2TransactionParams
    userPath     : Text
    -- CC signature-fee inputs, threaded straight through to RequestSignature
    -- (sourced client-side as disclosed contracts; see "CC signature fee").
    feeRegistrationCid : ContractId FeeCollectorRegistration
    feeInputs          : [ContractId Holding]
    feeExtraArgs       : ExtraArgs
  controller requester
  do
    -- 1a. The Signer signs whatever bytes you hand it: validate calldata yourself
    -- if it matters (selector, argument bounds). See signet-vault-v1's RequestDeposit.

    -- 1b. Build the request envelope.
    -- caip2 "eip155:1" — see signet-vault-v1's test-mode pinning.
    let caip2Id = "eip155:" <> chainIdToDecimalText evmTxParams.chainId
    let fullPath = myDeploymentId <> "," <> partyToText requester <> "," <> userPath

    -- 1c. Exercise the disclosed Signer. RequestSignature charges the CC fee, derives
    -- `sender` from the on-ledger operators, and emits the SignBidirectionalEvent in one
    -- transaction — aborting (no event) unless the fee settles. `sigNetwork` is not passed;
    -- the Signer knows its own.
    signEventCid <- exercise signerCid RequestSignature with
      operators; requester
      txParams = EvmType2TxParams evmTxParams
      caip2Id
      keyVersion = 1
      path = fullPath
      algo = "ECDSA"
      dest = "ethereum"
      params = ""
      outputDeserializationSchema = "[{\"name\":\"\",\"type\":\"bool\"}]"
      respondSerializationSchema  = "[{\"name\":\"\",\"type\":\"bool\"}]"
      feeRegistrationCid; feeInputs; feeExtraArgs

    -- 1d. Recompute the requestId for your anchor (byte-identical across Daml/TS/Rust).
    signEvent <- fetch signEventCid
    let requestId = requestIdFromSignEvent signEvent

    -- 1e. Persist your single-use anchor. Keep signEventCid so the claim/completion
    -- choice can retire the request event after the MPC evidence is validated.
    anchorCid <- create MyAnchor with
      operators; requester; requestId; evmTxParams; signEventCid

    pure (signEventCid, anchorCid)
```

Notes:

- All hex fields in `EvmType2TransactionParams` are bare hex (no `0x` prefix), 32-byte left-padded uint256s — except `to` (20-byte address) and `calldata` (raw bytes, may be `""`). You fetch `nonce` / fees / gas from the destination chain yourself; they are not auto-filled. `chainIdToDecimalText` (from `signet-eip712`) renders the 32-byte `chainId` hex as its decimal string; prefix `eip155:` to form the `caip2Id`.
- Field-by-field semantics (`caip2Id`, `keyVersion`, `path`, `algo`/`dest`/`params`, the two schemas) are in the [`RequestSignature` request fields](./API.md#signer) table.

### 2. The MPC service responds (off-Canton, asynchronous)

The MPC service watches `SignBidirectionalEvent` (signatory `operators, requester, sigNetworkFA`; observer `sigNetwork`) and produces **two** Canton events for each request — but they have different roles:

| Event                                 | Signed by                                                                                  | Covers                                                   | Use                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SignatureRespondedEvent.signature`   | **request child** (`sender = operatorsHash`, request `path`)                               | the request-specific signing digest                      | The consumer reads it and submits the downstream-chain operation per its chain-specific flow. Its signature is typically **not** verified on-ledger (the consumer cross-checks its fields, not its ECDSA signature). |
| `RespondBidirectionalEvent.signature` | **response-verification child** (`sender = operatorsHash`, `path = "canton response key"`) | `responseHash = keccak256(requestId ‖ serializedOutput)` | Proof of execution + outcome. The consumer verifies it on-ledger and acts on `serializedOutput`.                                                                                                                     |

Both children derive from the MPC root via the Canton KDF (see [Quickstart](#quickstart) step 2). `serializedOutput` carries the ABI-encoded return data on success, or a `0xdeadbeef`-prefixed payload on failure (predicate `abiHasErrorPrefix` in `signet-abi`).

### 3. Verify and act

Once both events are visible (poll via `/v2/state/active-contracts` for the template ids, or subscribe to `/v2/updates` for streaming), in a new transaction:

```haskell
nonconsuming choice MyDomainClaim : ...
  with
    requester                    : Party
    anchorCid                    : ContractId MyAnchor
    respondBidirectionalEventCid : ContractId RespondBidirectionalEvent
    signatureRespondedEventCid   : ContractId SignatureRespondedEvent
  controller requester
  do
    -- Archive the single-use anchor FIRST (replay protection).
    anchor <- fetch anchorCid
    archive anchorCid

    -- Both response events must match the anchor.
    outcome <- fetch respondBidirectionalEventCid
    assertMsg "outcome operators mismatch"  (sort outcome.operators == sort operators)
    assertMsg "outcome requester mismatch"  (outcome.requester  == requester)
    assertMsg "outcome requestId mismatch"  (outcome.requestId  == anchor.requestId)

    sigResp <- fetch signatureRespondedEventCid
    assertMsg "sigResp operators mismatch"  (sort sigResp.operators == sort operators)
    assertMsg "sigResp requester mismatch"  (sigResp.requester  == requester)
    assertMsg "sigResp requestId mismatch"  (sigResp.requestId  == anchor.requestId)

    -- Verify the outcome signature against your stored response-verification pubkey.
    let responseHash = computeResponseHash anchor.requestId outcome.serializedOutput
    assertMsg "Invalid MPC signature"
      (secp256k1WithEcdsaOnly (signatureDer outcome.signature) responseHash mpcResponseVerifyKey)

    -- Interpret the outcome (your domain logic):
    --   abiHasErrorPrefix outcome.serializedOutput   → EVM revert; refund / abort
    --   abiDecodeBool     outcome.serializedOutput 0 → e.g. ERC-20 transfer success bit
    --   abiDecodeUint     outcome.serializedOutput 0 → e.g. balance return

    -- Retire the evidence contracts, then the request event
    -- (see SignBidirectionalEvent in API.md).
    exercise respondBidirectionalEventCid Consume_RespondBidirectional with actor = requester
    exercise signatureRespondedEventCid   Consume_SignatureResponded   with actor = requester
    exercise anchor.signEventCid          Consume_SignBidirectional    with actor = requester

    -- Apply your domain effect.
    create MyHolding with ...
```

`mpcResponseVerifyKey` is the response-verification pubkey from [Quickstart](#quickstart) step 2, derived and stored at deployment time ([security checklist #4](./SECURITY.md)); `signet-vault-v1` stores it on `Vault.mpcResponseVerifyKey`.

### Failure modes

| Symptom                                                                                        | Meaning                                                                                                                                                                                                                                                                                                                                             | Action                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RespondBidirectionalEvent` arrives but `abiHasErrorPrefix outcome.serializedOutput` is `True` | EVM tx reverted (or was replaced / dropped). The MPC still signs and publishes the outcome — payload is the 4-byte `0xdeadbeef` prefix followed by a 32-byte ABI-encoded `bool(true)` placeholder (MPC convention; on-ledger only the prefix is checked, no embedded EVM error data). The signature is valid; the prefix is the only revert signal. | Domain decision (refund, retry, surface error).                                                                                                                                                                                                                               |
| `secp256k1WithEcdsaOnly` returns `False`                                                       | Signature does not match `responseHash` under your stored response-verification pubkey                                                                                                                                                                                                                                                              | Reject the claim. Either the wrong pubkey is stored (e.g. someone stored the root by mistake — see [security checklist #4](./SECURITY.md)) or the response is forged. Escalate, do not retry.                                                                                 |
| Only one of the two response events ever arrives                                               | The downstream-chain operation has not been submitted yet, or the destination chain has not confirmed it                                                                                                                                                                                                                                            | Submit or resubmit the downstream-chain operation. There is no Canton-side timeout, and you **must not** add a wall-clock refund of optimistically-debited state — see [Recovering a stuck destination-chain transaction](#recovering-a-stuck-destination-chain-transaction). |
| `Consume_*` exercised twice                                                                    | Second exercise fails because the contract is already archived                                                                                                                                                                                                                                                                                      | Idempotent at your level (your claim choice should archive the anchor first, so a duplicate claim won't reach `Consume_*`).                                                                                                                                                   |
| Duplicate `SignBidirectionalEvent` with identical `requestId`                                  | Replay attempt                                                                                                                                                                                                                                                                                                                                      | A duplicate request signs the identical digest — same signing address and nonce — so at most one tx can land. Your single-use anchor prevents acting on it twice.                                                                                                             |

### Recovering a stuck destination-chain transaction

A consumer that debits Canton state before the destination-chain tx confirms (e.g. `signet-vault-v1` archives the `Erc20Holding` in `RequestWithdrawal`) must respect one invariant:

> **An externally-signed EVM transaction never expires** — it stays mineable while its nonce is unspent. Never refund optimistically-debited state on a timeout: the tx could land afterward and spend it twice.

The only safe refund trigger is proof the tx can't execute — the signing account's nonce advancing past it via a _different_ confirmed tx. The MPC attests this automatically: it detects the superseded nonce and publishes a signed `0xdeadbeef` `RespondBidirectionalEvent` that your claim choice already verifies (`abiHasErrorPrefix`).

To unstick, replace the transaction at the **same nonce, higher fee** (a replacement at `N+1` just stalls behind `N`). The address is MPC-controlled, so the replacement is an ordinary signing request — no "cancel" choice needed. In `signet-vault-v1`: submit another withdrawal of any spare holding with `evmTxParams.nonce` set to the stuck nonce; once it mines, the MPC fails the original and `CompleteWithdrawal` recreates the `Erc20Holding`. (A holder whose sole holding is fully withdrawn must re-deposit or have an operator re-issue it — no funds are lost either way.)

### Security checklist for integrators

The Signer signs whatever bytes it is given and tracks no per-request state — every safeguard (calldata validation, replay protection, key pinning, outcome verification) is the consumer's responsibility. The full checklist and the replay-protection options live in [`SECURITY.md`](./SECURITY.md).

## CC signature fee

Every `RequestSignature` — and therefore every Vault deposit/withdrawal request — charges the
requester a Canton Coin fee, paid requester → `feeReceiver` **atomically inside the same
transaction** through a registered, late-bound `FeeCollector`. If the fee cannot settle,
`RequestSignature` aborts and no event is created (**fail-closed**).

The full fee subsystem — the late-bound collector model and `signet-fee-amulet` implementation,
the FA fee endpoint contract, the fee contracts and their upgrade/vetting rules, the
`sigNetworkFA` admin runbook, and the security model (the factory-trust bypass, its threat
model, and the off-ledger detection/escalation response) — lives in [`FEE.md`](./FEE.md).

## API reference

Templates (`Signer`, `SignerProposal`, the three event contracts — signatories, ensure clauses, choices), data types, helpers, and the `requestId`/`responseHash` formulas live in [`API.md`](./API.md).

## Build & Test

From the repo root:

```bash
dpm build --all     # build all packages
pnpm run daml:test  # per-package Daml Script tests (dpm test has no multi-package mode); they live in signet-signer-v1-tests
```
