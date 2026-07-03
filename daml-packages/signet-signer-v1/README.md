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

The `Signer` is co-signed by `sigNetwork` (the MPC service) and `sigNetworkFA` (the featured-app provider party), created once via the `SignerProposal`/`AcceptSigner` ceremony. Only `operators + requester` authorize a request; `sigNetwork` is observer-only on `SignBidirectionalEvent`, so a compromised MPC cannot forge or initiate signing. The MPC answers each request with two evidence contracts — see [Integrator lifecycle § 2](#2-the-mpc-service-responds-off-canton-asynchronous).

The Signer enforces operator-set isolation, not replay protection — calldata validation, single-use semantics, and per-deployment `path` namespacing are the consumer's job. See [Security checklist for integrators](#security-checklist-for-integrators).

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

```daml
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

**1. The `Signer` disclosed-contract envelope.** Attach it under `disclosedContracts` on every command that exercises the `Signer` (e.g. `RequestSignature`). It carries no secrets — treat it as config. You can't read the `sigNetwork`-co-signed `Signer` from your own ACS, so obtain its envelope from the operator's disclosure endpoint. That endpoint is `apps/disclosure-api`, served live per network: DevNet at `https://disclosure-api.vercel.app` (alias of `/api/devnet`), testnet at `https://disclosure-api.vercel.app/api/testnet`. `await fetch(<network endpoint>)` returns the disclosures as `{ network, signer, vault, fee }`, where the `signer` field is the `Signer` envelope below (illustrative values — fetch the live one rather than hard-coding it):

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
- The **response-verification pubkey** for constant `path = "canton response key"` — store this on your contract so `secp256k1WithEcdsaOnly` can verify `RespondBidirectionalEvent.signature` on-ledger. See [Security checklist #4](#security-checklist-for-integrators).

## Integrator lifecycle

A single signing request, end-to-end. All steps run inside one Daml transaction except step 2 (off-Canton, asynchronous) and step 3 (a separate transaction once both response events are visible).

### 1. Issue a signing request

Inside a consumer choice body (which has `operators` signatory + `requester` controller authority):

```daml
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
    -- the Signer knows its own. sigNetworkFA rides along ambiently from the co-signed Signer.
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
      operators; requester; sigNetwork; requestId; evmTxParams; signEventCid

    pure (signEventCid, anchorCid)
```

Notes:

- All hex fields in `EvmType2TransactionParams` are bare hex (no `0x` prefix), 32-byte left-padded uint256s — except `to` (20-byte address) and `calldata` (raw bytes, may be `""`). You fetch `nonce` / fees / gas from the destination chain yourself; they are not auto-filled. `chainIdToDecimalText` (from `signet-eip712`) renders the 32-byte `chainId` hex as its decimal string; prefix `eip155:` to form the `caip2Id`.
- Field-by-field semantics (`caip2Id`, `keyVersion`, `path`, `algo`/`dest`/`params`, the two schemas) are in the [`RequestSignature` request fields](#signer) table.

### 2. The MPC service responds (off-Canton, asynchronous)

The MPC service watches `SignBidirectionalEvent` (signatory `operators, requester, sigNetworkFA`; observer `sigNetwork`) and produces **two** Canton events for each request — but they have different roles:

| Event                                 | Signed by                                                                                  | Covers                                                   | Use                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SignatureRespondedEvent.signature`   | **request child** (`sender = operatorsHash`, request `path`)                               | the request-specific signing digest                      | The consumer reads it and submits the downstream-chain operation per its chain-specific flow. Its signature is typically **not** verified on-ledger (the consumer cross-checks its fields, not its ECDSA signature). |
| `RespondBidirectionalEvent.signature` | **response-verification child** (`sender = operatorsHash`, `path = "canton response key"`) | `responseHash = keccak256(requestId ‖ serializedOutput)` | Proof of execution + outcome. The consumer verifies it on-ledger and acts on `serializedOutput`.                                                                                                                     |

Both children derive from the MPC root via the Canton KDF (see [Quickstart](#quickstart) step 2). `serializedOutput` carries the ABI-encoded return data on success, or a `0xdeadbeef`-prefixed payload on failure (predicate `abiHasErrorPrefix` in `signet-abi`).

### 3. Verify and act

Once both events are visible (poll via `/v2/state/active-contracts` for the template ids, or subscribe to `/v2/updates` for streaming), in a new transaction:

```daml
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
    assertMsg "outcome sigNetwork mismatch" (outcome.sigNetwork  == sigNetwork)
    assertMsg "outcome operators mismatch"  (sort outcome.operators == sort operators)
    assertMsg "outcome requester mismatch"  (outcome.requester  == requester)
    assertMsg "outcome requestId mismatch"  (outcome.requestId  == anchor.requestId)

    sigResp <- fetch signatureRespondedEventCid
    assertMsg "sigResp sigNetwork mismatch" (sigResp.sigNetwork == sigNetwork)
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

    -- Retire the evidence (you lack sigNetwork authority → Consume_*), then the request
    -- event via its delegated choice (see SignBidirectionalEvent in the API reference).
    exercise respondBidirectionalEventCid Consume_RespondBidirectional with actor = requester
    exercise signatureRespondedEventCid   Consume_SignatureResponded   with actor = requester
    exercise anchor.signEventCid          Consume_SignBidirectional    with actor = requester

    -- Apply your domain effect.
    create MyHolding with ...
```

`mpcResponseVerifyKey` is the response-verification pubkey you derive off-ledger from the MPC root with `sender = operatorsHash` and `path = "canton response key"`, stored at deployment time (see [Quickstart](#quickstart) step 2 and [Security checklist #4](#security-checklist-for-integrators)); `signet-vault-v1` stores it on `Vault.mpcResponseVerifyKey`. For why the request event is retired with `Consume_SignBidirectional` rather than a bare `archive` — and why only in the final claim — see [`SignBidirectionalEvent`](#signbidirectionalevent) in the API reference.

### Failure modes

| Symptom                                                                                        | Meaning                                                                                                                                                                                                                                                                                                                                             | Action                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RespondBidirectionalEvent` arrives but `abiHasErrorPrefix outcome.serializedOutput` is `True` | EVM tx reverted (or was replaced / dropped). The MPC still signs and publishes the outcome — payload is the 4-byte `0xdeadbeef` prefix followed by a 32-byte ABI-encoded `bool(true)` placeholder (MPC convention; on-ledger only the prefix is checked, no embedded EVM error data). The signature is valid; the prefix is the only revert signal. | Domain decision (refund, retry, surface error).                                                                                                                                                                                                                               |
| `secp256k1WithEcdsaOnly` returns `False`                                                       | Signature does not match `responseHash` under your stored response-verification pubkey                                                                                                                                                                                                                                                              | Reject the claim. Either the wrong pubkey is stored (e.g. someone stored the root by mistake — see Security checklist #4) or the response is forged. Escalate, do not retry.                                                                                                  |
| Only one of the two response events ever arrives                                               | The downstream-chain operation has not been submitted yet, or the destination chain has not confirmed it                                                                                                                                                                                                                                            | Submit or resubmit the downstream-chain operation. There is no Canton-side timeout, and you **must not** add a wall-clock refund of optimistically-debited state — see [Recovering a stuck destination-chain transaction](#recovering-a-stuck-destination-chain-transaction). |
| `Consume_*` exercised twice                                                                    | Second exercise fails because the contract is already archived                                                                                                                                                                                                                                                                                      | Idempotent at your level (your claim choice should archive the anchor first, so a duplicate claim won't reach `Consume_*`).                                                                                                                                                   |
| Duplicate `SignBidirectionalEvent` with identical `requestId`                                  | Replay attempt                                                                                                                                                                                                                                                                                                                                      | A duplicate request signs the identical digest — same signing address and nonce — so at most one tx can land. Your single-use anchor prevents acting on it twice.                                                                                                             |

### Recovering a stuck destination-chain transaction

A consumer that debits Canton state before the destination-chain tx confirms (e.g. `signet-vault-v1` archives the `Erc20Holding` in `RequestWithdrawal`) must respect one invariant:

> **An externally-signed EVM transaction never expires** — it stays mineable while its nonce is unspent. Never refund optimistically-debited state on a timeout: the tx could land afterward and spend it twice.

The only safe refund trigger is proof the tx can't execute — the signing account's nonce advancing past it via a _different_ confirmed tx. The MPC attests this automatically: it detects the superseded nonce and publishes a signed `0xdeadbeef` `RespondBidirectionalEvent` that your claim choice already verifies (`abiHasErrorPrefix`).

To unstick, replace the transaction at the **same nonce, higher fee** (a replacement at `N+1` just stalls behind `N`). The address is MPC-controlled, so the replacement is an ordinary signing request — no "cancel" choice needed. In `signet-vault-v1`: submit another withdrawal of any spare holding with `evmTxParams.nonce` set to the stuck nonce; once it mines, the MPC fails the original and `CompleteWithdrawal` recreates the `Erc20Holding`. (A holder whose sole holding is fully withdrawn must re-deposit or have an operator re-issue it — no funds are lost either way.)

### Security checklist for integrators

The Signer signs whatever bytes it is given and tracks no per-request state. Every item below is the consumer's responsibility — getting any of them wrong can leak funds.

| #   | Must do                                                                                                                                                                                                                                                                                         | Why                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Validate `txParams.calldata` before `RequestSignature`** (ABI selector + argument checks).                                                                                                                                                                                                    | The Signer will sign anything.                                                                                                       |
| 2   | **Use a single-use anchor for replay protection** (or a `requestId` nullifier set).                                                                                                                                                                                                             | The Signer has no nonce, no nullifier set, no approval state.                                                                        |
| 3   | **Namespace `path` per deployment** (e.g. `${vaultId},${requester},${userPath}`).                                                                                                                                                                                                               | The Signer isolates operator sets only; two consumers sharing an operator set share the key namespace unless `path` says otherwise.  |
| 4   | **Derive and store the response-verification pubkey at deployment time** on your equivalent of `Vault` (KDF inputs `sender = operatorsHash`, `path = "canton response key"`; formula + tooling in [Quickstart](#quickstart) step 2). **Do not store the root pubkey** — verification will fail. | What `secp256k1WithEcdsaOnly` is checked against. Re-fetching at claim time opens a TOCTOU window.                                   |
| 5   | **Cross-check `(operators, requester, requestId)`** between your anchor, `RespondBidirectionalEvent`, and `SignatureRespondedEvent`.                                                                                                                                                            | A misbehaving `sigNetwork` could otherwise pair a valid signature with a different anchor.                                           |
| 6   | **Archive the anchor first in the claim choice**, before any other assertion.                                                                                                                                                                                                                   | The anchor is the single-use guard — it must be consumed in the same atomic transaction as the state change;                         |
| 7   | **Verify the outcome signature on-ledger before mutating state**, against the stored response-verification pubkey.                                                                                                                                                                              | Forged `RespondBidirectionalEvent` rejected at the consumer's claim choice.                                                          |
| 8   | **Reject `serializedOutput` starting with `0xdeadbeef`** (revert payload) or that does not ABI-decode to your expected success value.                                                                                                                                                           | EVM revert ≠ Canton-side success.                                                                                                    |
| 9   | **Store `signEventCid` on your pending anchor and archive it after validated completion.**                                                                                                                                                                                                      | Keeps the original request event available for the MPC response path, then removes stale request events once the domain action acts. |

Replay-protection options (pick what fits your threat model):

- A registry contract that records every used `requestId` (nullifier set).
- Off-chain operator enforcement via a request-approve flow before the consumer ever calls `RequestSignature`.
- Nothing — relying on the destination chain's nonce when a duplicate sign is harmless (duplicate requests sign the identical digest — same signing address and nonce — so only one tx can land).

For a complete worked consumer, see [`signet-vault-v1/daml/Erc20Vault.daml`](../signet-vault-v1/daml/Erc20Vault.daml).

## CC signature fee

Every `RequestSignature` — and therefore every Vault deposit/withdrawal request — charges the
requester a Canton Coin fee, paid requester → `feeReceiver` **atomically inside the same
transaction** through a registered, late-bound `FeeCollector`. If the fee cannot settle,
`RequestSignature` aborts and no event is created (**fail-closed**).

The full fee subsystem — the late-bound collector model and `signet-fee-amulet` implementation,
the FA fee endpoint contract, the fee contracts and their upgrade/vetting rules, the
`sigNetworkFA` admin runbook, and the security model (the factory-trust bypass, its threat
model, and the off-ledger detection/escalation response) — lives in [`FEE.md`](./FEE.md).

# API Reference

## Templates

### `Signer`

Singleton identity contract, **co-signed by `sigNetwork` (the MPC party) and `sigNetworkFA` (the featured-app provider party)**; disclosed off-chain. Created only via the `SignerProposal`/`AcceptSigner` ceremony (below), never with a bare `create`.

- Signatory: `sigNetwork, sigNetworkFA`
- Fields: `sigNetwork : Party`, `sigNetworkFA : Party`

| Choice             | Type         | Controller             | Args                                                                                                      | Returns                             |
| ------------------ | ------------ | ---------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `RequestSignature` | nonconsuming | `operators, requester` | the request fields (table below) + the three fee args (`feeRegistrationCid`, `feeInputs`, `feeExtraArgs`) | `ContractId SignBidirectionalEvent` |

`Respond` and `RespondBidirectional` (both nonconsuming, controller `sigNetwork`) are the MPC-side choices that create `SignatureRespondedEvent` / `RespondBidirectionalEvent`; integrators never exercise them.

`RequestSignature` charges the CC signature fee (fail-closed — see [CC signature fee](#cc-signature-fee)), derives `sender = computeOperatorsHash (map partyToText operators)` from the on-ledger operators, and creates the `SignBidirectionalEvent` (co-signed by `sigNetworkFA` ambiently via the `Signer`), all in one transaction. A consumer supplies the required authority by being `signatory operators`; `operators + requester` co-authorize as the choice controllers, so no intermediate authority-bridge contract is needed.

`RequestSignature` request fields (also the fields stamped onto `SignBidirectionalEvent`; note there is no `sigNetwork` arg — the `Signer` knows its own):

| Field                         | Type       | Notes                                                                                                                                                                                                                                                                         |
| ----------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operators`                   | `[Party]`  | Operator multi-sig. Non-empty, unique. Sorted internally for hashing — caller order doesn't matter.                                                                                                                                                                           |
| `requester`                   | `Party`    | Initiator. Becomes co-signatory of `SignBidirectionalEvent`.                                                                                                                                                                                                                  |
| `txParams`                    | `TxParams` | Chain-agnostic transaction wrapper.                                                                                                                                                                                                                                           |
| `caip2Id`                     | `Text`     | **Destination** chain CAIP-2 id, e.g. `"eip155:1"` (mainnet) or `"eip155:11155111"` (Sepolia). Build as `"eip155:" <> chainIdToDecimalText chainId` (from `signet-eip712`). The deployed MPC currently accepts only `"eip155:1"` (see `signet-vault-v1`'s test-mode pinning). |
| `keyVersion`                  | `Int`      | KDF version. Use `1` (the latest supported).                                                                                                                                                                                                                                  |
| `path`                        | `Text`     | KDF subkey path. Consumer namespaces by deployment id when reusing operator sets (Security checklist #3). The Signer cannot enforce this.                                                                                                                                     |
| `algo`                        | `Text`     | Opaque; hashed into `requestId` — no current code path branches on it. In-repo consumers pass `"ECDSA"`.                                                                                                                                                                      |
| `dest`                        | `Text`     | Same; in-repo consumers pass `"ethereum"`.                                                                                                                                                                                                                                    |
| `params`                      | `Text`     | Same; in-repo consumers pass `""`.                                                                                                                                                                                                                                            |
| `outputDeserializationSchema` | `Text`     | JSON ABI fragment, e.g. `[{"name":"","type":"bool"}]`. Tells the MPC how to decode the traced return data of the destination call.                                                                                                                                            |
| `respondSerializationSchema`  | `Text`     | Schema the MPC uses to encode the decoded output into `serializedOutput`.                                                                                                                                                                                                     |

### `SignerProposal`

Two-party creation ceremony for the co-signed `Signer`. `sigNetwork` proposes; `sigNetworkFA` accepts, and only then does the `Signer` exist — so the featured-app party's consent is mandatory before any signing infra is live.

- Signatory: `sigNetwork`
- Observer: `sigNetworkFA`
- Fields: `sigNetwork : Party`, `sigNetworkFA : Party`

| Choice         | Type      | Controller     | Args | Returns             |
| -------------- | --------- | -------------- | ---- | ------------------- |
| `AcceptSigner` | consuming | `sigNetworkFA` | —    | `ContractId Signer` |

### Fee packages

The fee surface lives outside `signet-signer-v1`:

| Package             | Contents                                                                    |
| ------------------- | --------------------------------------------------------------------------- |
| `signet-api-fee-v1` | `FeeCollector` interface, `FeeCollector_Charge`, `FeeCollectorRegistration` |
| `signet-fee-amulet` | `CcFeeCollector` (charge logic), `FeePriceConfig` (rotating price)          |

`RequestSignature` only ever sees the frozen API: it validates the registration and exercises
`FeeCollector_Charge`. Everything else (pricing, settlement policy, the token-standard dependency)
is the implementation package's business. Stability and upgrade rules: see [`FEE.md`](./FEE.md).

### `SignBidirectionalEvent`

Created by `Signer.RequestSignature`. **What the MPC watches.** Co-signed by `sigNetworkFA` (the CIP-0104 confirmer). Consumers retire it from their final claim/completion choice — via `Consume_SignBidirectional`, not a bare `archive` — after both MPC response contracts have been validated and consumed.

- Signatory: `operators, requester, sigNetworkFA`
- Observer: `sigNetwork`
- Ensure: `not (null operators) && unique operators && sender == computeOperatorsHash (map partyToText operators) && validTxParams txParams`

Fields: the `RequestSignature` request fields (table above) plus `sigNetwork : Party`, `sigNetworkFA : Party` and `sender : BytesHex` (= `operatorsHash`, set by `RequestSignature`).

| Choice                      | Type      | Controller                                                 | Args            |
| --------------------------- | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_SignBidirectional` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

`Consume_SignBidirectional` exists because `sigNetworkFA` is a signatory: a consumer's choice body cannot `archive` the event directly (it lacks `sigNetworkFA`'s authority), so `sigNetworkFA` pre-consents to this delegated archival. Only `operators`/`requester` may exercise it. Keep `signEventCid` on your pending anchor and call it **only in the final claim/completion transaction**, after the response evidence has been validated and consumed — exercising it earlier would delete a request the MPC has not yet answered (forfeiting the already-paid fee).

### `SignatureRespondedEvent`

Request-signature evidence. Created by `Signer.Respond`, signed by the **request child** key (`sender = operatorsHash`, request `path`); the consumer uses it according to its downstream-chain submission flow. See [Integrator lifecycle § 2](#2-the-mpc-service-responds-off-canton-asynchronous) for the key/usage table.

- Signatory: `sigNetwork, sigNetworkFA`
- Observer: `operators, requester`
- Ensure: `isBytesN 32 requestId && validSignature signature`

| Field                                                  | Type                  |
| ------------------------------------------------------ | --------------------- |
| `sigNetwork`, `sigNetworkFA`, `requester`, `responder` | `Party`               |
| `operators`                                            | `[Party]`             |
| `requestId`                                            | `BytesHex` (32 bytes) |
| `signature`                                            | `Signature`           |

| Choice                       | Type      | Controller                                                 | Args            |
| ---------------------------- | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_SignatureResponded` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

### `RespondBidirectionalEvent`

Outcome signature evidence. Created by `Signer.RespondBidirectional`, signed by the **response-verification child** key (`sender = operatorsHash`, `path = "canton response key"`) over `responseHash = keccak256(requestId ‖ serializedOutput)`; the consumer verifies it on-ledger with `secp256k1WithEcdsaOnly` against its stored `mpcResponseVerifyKey`. `serializedOutput` is ABI-encoded return data on success, or `0xdeadbeef`+payload on failure (`abiHasErrorPrefix` in `signet-abi`). See [Integrator lifecycle § 2](#2-the-mpc-service-responds-off-canton-asynchronous).

- Signatory: `sigNetwork, sigNetworkFA`
- Observer: `operators, requester`
- Ensure: `isBytesN 32 requestId && isCanonicalHex serializedOutput && validSignature signature`

| Field                                                  | Type                  |
| ------------------------------------------------------ | --------------------- |
| `sigNetwork`, `sigNetworkFA`, `requester`, `responder` | `Party`               |
| `operators`                                            | `[Party]`             |
| `requestId`                                            | `BytesHex` (32 bytes) |
| `serializedOutput`                                     | `BytesHex`            |
| `signature`                                            | `Signature`           |

| Choice                         | Type      | Controller                                                 | Args            |
| ------------------------------ | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_RespondBidirectional` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

## Data types

### `EvmTypes.daml`

```daml
data EvmAccessListEntry = EvmAccessListEntry with
    address     : BytesHex          -- 20 bytes
    storageKeys : [BytesHex]        -- each 32 bytes

data EvmType2TransactionParams = EvmType2TransactionParams with
    chainId, nonce, maxPriorityFeePerGas, maxFeePerGas, gasLimit : BytesHex            -- each 32-byte uint256
    to                                                           : Optional BytesHex   -- None = contract creation; Some 20-byte address
    value                                                        : BytesHex            -- 32-byte uint256
    calldata                                                     : BytesHex            -- raw EVM calldata, no 0x prefix; "" allowed
    accessList                                                   : [EvmAccessListEntry]
```

### `TxParams.daml`

```daml
data TxParams = EvmType2TxParams EvmType2TransactionParams
```

Single constructor today; `BtcTxParams` / `SolTxParams` slot in the future.

### `Signer.daml`

```daml
data EcdsaSigData = EcdsaSigData with
    der        : SignatureHex   -- DER-encoded (r, s)
    recoveryId : Int            -- 0 or 1

data Signature = EcdsaSig EcdsaSigData
-- future variants: EddsaSig, SchnorrSig
```

DER because `secp256k1WithEcdsaOnly` requires DER. Union for future EdDSA / Schnorr without changing the wire format.

## Helpers

### `Signer.daml`

| Symbol                   | Type                                 | Use                                                  |
| ------------------------ | ------------------------------------ | ---------------------------------------------------- |
| `signatureDer`           | `Signature -> SignatureHex`          | Extract DER bytes for `secp256k1WithEcdsaOnly`       |
| `validSignature`         | `Signature -> Bool`                  | Predicate used by evidence-contract `ensure` clauses |
| `requestIdFromSignEvent` | `SignBidirectionalEvent -> BytesHex` | Recompute `requestId` from a fetched event           |

### `RequestId.daml`

| Symbol                 | Type                                                                          | Use                                                                |
| ---------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `computeOperatorsHash` | `[Text] -> BytesHex`                                                          | `keccak256(concat (map (keccak256 . toHex) (sort operatorTexts)))` |
| `computeRequestId`     | `Text -> TxParams -> Text -> Int -> Text -> Text -> Text -> Text -> BytesHex` | Full sign-request commitment (formula below)                       |
| `computeResponseHash`  | `BytesHex -> BytesHex -> BytesHex`                                            | `keccak256(requestId ‖ output)`                                    |
| `hashTxParams`         | `TxParams -> BytesHex`                                                        | Per-chain dispatch                                                 |

### `EvmTypes.daml`

| Symbol                           | Type                                | Use                          |
| -------------------------------- | ----------------------------------- | ---------------------------- |
| `isBytesN`                       | `Int -> BytesHex -> Bool`           | Length-checked canonical hex |
| `isCanonicalHex`                 | `BytesHex -> Bool`                  | Even-length hex (or empty)   |
| `isEvmUInt256`                   | `BytesHex -> Bool`                  | 32-byte canonical hex        |
| `validOptionalAddress`           | `Optional BytesHex -> Bool`         | `None` or 20-byte address    |
| `validAccessListEntry`           | `EvmAccessListEntry -> Bool`        | Per-entry validator          |
| `validEvmType2TransactionParams` | `EvmType2TransactionParams -> Bool` | Full record validator        |

### `TxParams.daml`

| Symbol          | Type               | Use                          |
| --------------- | ------------------ | ---------------------------- |
| `validTxParams` | `TxParams -> Bool` | Per-chain dispatch validator |

## `requestId` and `responseHash` formulas

```
requestId = keccak256(
    eip712EncodeString  sender                    -- = operatorsHash, set by RequestSignature
  ‖ hashTxParams        txParams
  ‖ eip712EncodeString  caip2Id
  ‖ eip712EncodeUint256 (toHex keyVersion)
  ‖ eip712EncodeString  path
  ‖ eip712EncodeString  algo
  ‖ eip712EncodeString  dest
  ‖ eip712EncodeString  params
)

responseHash = keccak256(requestId ‖ serializedOutput)
```

Every implementation that mirrors this off-Canton must produce byte-identical hashes — verify cross-language with golden vectors before integrating. The Daml vectors live in `signet-signer-v1-tests/daml/TestRequestId.daml`; the DevNet e2e asserts the TS mirror against the on-ledger `requestId` at runtime.

## Build & Test

From the repo root:

```bash
dpm build --all     # build all packages
pnpm run daml:test  # per-package Daml Script tests (dpm test has no multi-package mode); they live in signet-signer-v1-tests
```
