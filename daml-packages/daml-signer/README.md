# daml-signer

Generic MPC signing infrastructure for Canton. The Signer is a small set of Daml templates that lets a calling contract ask a trusted MPC service (the `sigNetwork` party) to produce signatures for transactions on a downstream chain (currently EVM; extensible to BTC, Solana, etc.). It is chain-agnostic and reusable across multiple consumer implementations.

For a worked consumer example see [`daml-vault`](../daml-vault/README.md). For an executable end-to-end run-through (party allocation, vault setup, deposit, claim, withdrawal) see `test/src/test/devnet-e2e.test.ts` in this repo.

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

The `Signer` is co-signed by two parties: `sigNetwork` (the MPC service) and
`sigNetworkFA` (the featured-app provider party). `sigNetworkFA` consents once, when the
`Signer` is created via the `SignerProposal`/`AcceptSigner` ceremony; thereafter it is an
ambient co-signatory on every sign/evidence event — i.e. a CIP-0104 confirmer — without
co-submitting any transaction. It is never an authorizer of a request (only
`operators + requester` are), so it cannot forge or initiate signing.

For each `SignBidirectionalEvent` you emit, the MPC publishes two evidence contracts back on Canton:

- `SignatureRespondedEvent` — ECDSA signature for the original downstream-chain signing request. The consumer uses it according to its chain-specific submission flow.
- `RespondBidirectionalEvent` — ECDSA signature over `keccak256(requestId ‖ serializedOutput)` plus the ABI-encoded return data (or a `0xdeadbeef`-prefixed payload on revert). Verified on-ledger before the consumer acts on the outcome.

The Signer enforces operator-set isolation, not replay protection — calldata validation, single-use semantics, and per-deployment `path` namespacing are the consumer's job. See [Security checklist for integrators](#security-checklist-for-integrators).

## Quickstart

`daml.yaml`:

```yaml
data-dependencies:
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar # transitive — required at compile time
  # RequestSignature takes the fee args (see "CC signature fee"), so a consumer
  # that threads them needs the frozen fee API + the vendored interface DARs:
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
  # add daml-abi if you need the calldata-decoding helpers used by daml-vault:
  # - ../daml-abi/.daml/dist/daml-abi-0.0.1.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

Daml imports:

```daml
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
import Signet.Api.Fee.V1 (FeeCollectorRegistration)
import Splice.Api.Token.HoldingV1 (Holding)
import Splice.Api.Token.MetadataV1 (ExtraArgs)
```

You'll be given two things to integrate against.

**1. The `Signer` disclosed-contract envelope.** Attach it under `disclosedContracts` on every command that exercises the `Signer` (e.g. `RequestSignature`). It carries no secrets — treat it as config. Current DevNet payload:

```json
{
  "templateId": "e89a2b8fa915d1a5b682a6ba01eba1f8d0bdca685dc3b0d3039815d70a06abb0:Signer:Signer",
  "contractId": "0002494636bb5d7f7a3e8abf9ad8c6c63c63598e8f95c700df0892593c8d350af5ca12122030b000af34b526db222393b97913597d5ef0a77c5efb27571522ddaa67245427",
  "createdEventBlob": "CgMyLjESjQMKRQACSUY2u11/ej6Kv5rYxsY8Y1mOj5XHAN8Iklk8jTUK9coSEiAwsACvNLUm2yIjk7l5E1l9XvCnfF77J1cVIt2qZyRUJxILZGFtbC1zaWduZXIaUgpAZTg5YTJiOGZhOTE1ZDFhNWI2ODJhNmJhMDFlYmExZjhkMGJkY2E2ODVkYzNiMGQzMDM5ODE1ZDcwYTA2YWJiMBIGU2lnbmVyGgZTaWduZXIiWmpYClYKVDpSc2lnbmV0LWRldi0xOjoxMjIwNDc5Y2U1ZGI3YWNhYjg3YmVhNDUxZGNmY2ZiNTA5YzgzMDJjN2Y3MTI4MTM2MTk4NDAzYzA4MTIyYWUwMDQ0OCpSc2lnbmV0LWRldi0xOjoxMjIwNDc5Y2U1ZGI3YWNhYjg3YmVhNDUxZGNmY2ZiNTA5YzgzMDJjN2Y3MTI4MTM2MTk4NDAzYzA4MTIyYWUwMDQ0ODkNZpuxkFIGAEIqCiYKJAgBEiBSUcACnyWJSqXL+CayG0zRcsKd1yfQtuo0x9Oa2NArzRAe",
  "synchronizerId": "global-domain::1220be58c29e65de40bf273be1dc2b266d43a9a002ea5b18955aeef7aac881bb471a"
}
```

`templateId` + `contractId` identify the on-ledger `Signer`; `createdEventBlob` is the authenticated create-event payload the ledger validates the disclosure against; `synchronizerId` is the Canton synchronizer (domain) it lives on.

**2. The MPC root secp256k1 public key** (uncompressed, hex). Derive two children off-ledger with the Canton KDF — `ε = keccak256(prefix : chainId : predecessorId : path)`, child = `rootPub + ε·G`, with `predecessorId = sender = operatorsHash`. The prefix (`"sig.network v2.0.0 epsilon derivation"`) and `canton:global` chain id are authoritative in signet.js: [`deriveChildPublicKey`](https://github.com/sig-net/signet.js/blob/a301d05a1c94f3e6bbf962f123d2f18236aef510/src/utils/cryptography.ts#L90-L122), [`KDF_CHAIN_IDS`](https://github.com/sig-net/signet.js/blob/a301d05a1c94f3e6bbf962f123d2f18236aef510/src/constants.ts#L35-L39):

- The **EVM child address** (`path` = whatever you pass on `RequestSignature`; `canton-sig`'s `deriveDepositAddress` does this in one call).
- The **response-verification pubkey** for constant `path = "canton response key"` — store this on your contract so `secp256k1WithEcdsaOnly` can verify `RespondBidirectionalEvent.signature` on-ledger. See [Security checklist #4](#security-checklist-for-integrators).

## Integrator lifecycle

A single signing request, end-to-end. All steps run inside one Daml transaction except step 3 (off-Canton, asynchronous) and step 4 (a separate transaction once both response events are visible).

### 1. Issue a signing request

Inside a consumer choice body (which has `operators` signatory + `requester` controller authority):

```daml
nonconsuming choice MyDomainAction : (ContractId SignBidirectionalEvent, ContractId MyAnchor)
  with
    requester    : Party
    signerCid    : ContractId Signer
    evmTxParams  : EvmType2TransactionParams
    userPath     : Text
    -- CC signature-fee inputs, threaded straight through to RequestSignature.
    -- Sourced client-side as disclosed contracts; see "CC signature fee" below.
    feeRegistrationCid : ContractId FeeCollectorRegistration
    feeInputs          : [ContractId Holding]
    feeExtraArgs       : ExtraArgs
  controller requester
  do
    -- 1a. Domain-level authorization. The Signer signs whatever bytes you hand it,
    -- so you must validate calldata yourself if it matters (e.g. ABI selector match,
    -- argument bounds). See daml-vault's RequestDeposit for the ERC-20 case.

    -- 1b. Build the request envelope. Concrete values shown below.
    let caip2Id = "eip155:" <> chainIdToDecimalText evmTxParams.chainId   -- destination CAIP-2
    let fullPath = myDeploymentId <> "," <> partyToText requester <> "," <> userPath

    -- 1c. Exercise the disclosed Signer directly. Your choice body holds operators
    -- (signatory) + requester (controller) — exactly RequestSignature's controllers — and
    -- the co-signed Signer supplies sigNetworkFA ambiently. RequestSignature charges the CC
    -- signature fee, derives `sender` from the on-ledger operators, and creates the
    -- MPC-visible SignBidirectionalEvent, all in one transaction. It aborts (no event)
    -- unless the fee settles. (`sigNetwork` is NOT passed — the Signer knows its own.)
    signEventCid <- exercise signerCid RequestSignature with
      operators; requester
      txParams = EvmType2TxParams evmTxParams
      caip2Id
      keyVersion = 1
      path = fullPath
      algo = ""                                   -- always ""
      dest = ""                                   -- always ""
      params = ""                                 -- always ""
      outputDeserializationSchema = "[{\"name\":\"\",\"type\":\"bool\"}]"
      respondSerializationSchema  = "[{\"name\":\"\",\"type\":\"bool\"}]"
      feeRegistrationCid; feeInputs; feeExtraArgs

    -- 1d. Recompute the requestId for your anchor — the Daml/TS/Rust impls produce
    -- byte-identical hashes (see "requestId formula" below).
    signEvent <- fetch signEventCid
    let requestId = requestIdFromSignEvent signEvent

    -- 1e. Persist whatever single-use anchor enforces your replay-protection policy.
    -- Store signEventCid too, so the claim/completion choice can archive the
    -- request event after the MPC evidence has been validated.
    anchorCid <- create MyAnchor with
      operators; requester; sigNetwork; requestId; evmTxParams; signEventCid

    pure (signEventCid, anchorCid)
```

Notes:

- `chainIdToDecimalText` comes from `daml-eip712`. `evmTxParams.chainId` is the 32-byte uint256 hex of the destination chain id (e.g. `"00…aa36a7"` for Sepolia).
- All hex fields in `EvmType2TransactionParams` are bare hex (no `0x` prefix) and are 32-byte left-padded uint256s, except `to` (20-byte address) and `calldata` (raw bytes, may be `""`). You fetch `nonce` / fees / gas from the destination chain yourself — they are not auto-filled.
- `EvmAccessListEntry.address` is 20 bytes; each `storageKeys` entry is 32 bytes.
- `outputDeserializationSchema` and `respondSerializationSchema` are JSON ABI fragments describing the EVM call's return type; the MPC re-simulates the call and ABI-encodes the result accordingly. For a function returning `bool` (e.g. ERC-20 `transfer`) pass `[{"name":"","type":"bool"}]`; for `uint256` pass `[{"name":"","type":"uint256"}]`. The two strings are always identical in current usage.
- `algo`, `dest`, `params`: always pass `""`. They are hashed into `requestId` for forwards-compatibility but no current code path branches on them.

### 2. The MPC service responds (off-Canton, asynchronous)

The MPC service watches `SignBidirectionalEvent` (signatory `operators, requester, sigNetworkFA`; observer `sigNetwork`) and produces **two** Canton events for each request — but they have different roles:

| Event                                 | Signed by                                                                                                                         | Covers                                                   | Use                                                                                                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SignatureRespondedEvent.signature`   | **request child** key (derived from root with `sender = operatorsHash` and the request `path`)                                    | the request-specific signing digest                      | The consumer reads it and submits the downstream-chain operation according to its chain-specific flow. Consumers typically do **not** verify this signature on-ledger. |
| `RespondBidirectionalEvent.signature` | **response-verification child** key (derived from root with `sender = operatorsHash` and constant `path = "canton response key"`) | `responseHash = keccak256(requestId ‖ serializedOutput)` | The proof of execution + outcome. The consumer verifies this on-ledger and acts on `serializedOutput`.                                                                 |

`serializedOutput` carries the ABI-encoded return data on success, or `0xdeadbeef`-prefixed payload on failure (predicate `abiHasErrorPrefix` in `daml-abi`).

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
    -- Archive your single-use anchor first (replay protection).
    anchor <- fetch anchorCid
    archive anchorCid

    -- Validate that both response events match the anchor.
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

    -- Verify the outcome signature against the response-verification pubkey
    -- (derived off-ledger from the MPC root with sender = operatorsHash
    --  and path = "canton response key"; stored at deployment).
    let responseHash = computeResponseHash anchor.requestId outcome.serializedOutput
    assertMsg "Invalid MPC signature"
      (secp256k1WithEcdsaOnly (signatureDer outcome.signature) responseHash mpcResponseVerifyKey)

    -- Interpret the outcome.
    --   abiHasErrorPrefix outcome.serializedOutput        → EVM revert; refund / abort
    --   abiDecodeBool     outcome.serializedOutput 0      → e.g. ERC-20 transfer success bit
    --   abiDecodeUint     outcome.serializedOutput 0      → e.g. balance return
    -- Branching on this is your domain logic.

    -- Clean up the evidence (you lack sigNetwork authority, so call Consume_*).
    exercise respondBidirectionalEventCid Consume_RespondBidirectional with actor = requester
    exercise signatureRespondedEventCid   Consume_SignatureResponded   with actor = requester

    -- Clean up the original request event after both response contracts are
    -- validated and consumed. SignBidirectionalEvent is co-signed by sigNetworkFA, so a
    -- plain `archive` would lack its authority — retire it via the delegated choice.
    exercise anchor.signEventCid Consume_SignBidirectional with actor = requester

    -- Apply your domain effect.
    create MyHolding with ...
```

`mpcResponseVerifyKey` is the uncompressed secp256k1 pubkey you derive off-ledger from the MPC root with `sender = operatorsHash` and `path = "canton response key"` (formula and tooling pointer in [Security checklist #4](#security-checklist-for-integrators)) and store at deployment time. The `daml-vault` package stores this value on `Vault.mpcResponseVerifyKey`.

`SignBidirectionalEvent` exposes a single delegated-archival choice,
`Consume_SignBidirectional` (controller `actor`, who must be in `operators` or be
`requester`). It exists because the event is co-signed by `sigNetworkFA`: a consumer's
choice body never holds `sigNetworkFA`'s authority, so it cannot `archive` the event
directly. The recommended pattern is to keep `signEventCid` in the consumer's pending
anchor and call `Consume_SignBidirectional` only in the final claim/completion
transaction, after the response evidence has been validated — exercising it earlier would
delete a request the MPC has not yet answered (self-inflicted; only `operators`/`requester`
can do it, and they forfeit the already-paid fee).

### Failure modes

| Symptom                                                                                        | Meaning                                                                                                                                                                                                                                                                                       | Action                                                                                                                                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `RespondBidirectionalEvent` arrives but `abiHasErrorPrefix outcome.serializedOutput` is `True` | EVM tx reverted (or was replaced / dropped). The MPC still signs and publishes the outcome — payload is the 4-byte `0xdeadbeef` prefix followed by a 32-byte ABI-encoded `bool(true)` placeholder (no embedded EVM error data). The signature is valid; the prefix is the only revert signal. | Domain decision (refund, retry, surface error).                                                                                                                                                                                                                               |
| `secp256k1WithEcdsaOnly` returns `False`                                                       | Signature does not match `responseHash` under your stored response-verification pubkey                                                                                                                                                                                                        | Reject the claim. Either the wrong pubkey is stored (e.g. someone stored the root by mistake — see Security checklist #4) or the response is forged. Escalate, do not retry.                                                                                                  |
| Only one of the two response events ever arrives                                               | The downstream-chain operation has not been submitted yet, or the destination chain has not confirmed it                                                                                                                                                                                      | Submit or resubmit the downstream-chain operation. There is no Canton-side timeout, and you **must not** add a wall-clock refund of optimistically-debited state — see [Recovering a stuck destination-chain transaction](#recovering-a-stuck-destination-chain-transaction). |
| `Consume_*` exercised twice                                                                    | Second exercise fails because the contract is already archived                                                                                                                                                                                                                                | Idempotent at your level (your claim choice should archive the anchor first, so a duplicate claim won't reach `Consume_*`).                                                                                                                                                   |
| Duplicate `SignBidirectionalEvent` with identical `requestId`                                  | Replay attempt                                                                                                                                                                                                                                                                                | Signing is RFC6979-deterministic, so duplicates produce identical signatures. Your single-use anchor prevents acting on it twice.                                                                                                                                             |

### Recovering a stuck destination-chain transaction

A consumer that debits Canton state before the destination-chain tx confirms (e.g. `daml-vault` archives the `Erc20Holding` in `RequestWithdrawal`) must respect one invariant:

> **An externally-signed EVM transaction never expires** — it stays mineable while its nonce is unspent. Never refund optimistically-debited state on a timeout: the tx could land afterward and spend it twice.

The only safe refund trigger is proof the tx can't execute — the signing account's nonce advancing past it via a _different_ confirmed tx. The MPC attests this automatically: it detects the superseded nonce and publishes a signed `0xdeadbeef` `RespondBidirectionalEvent` that your claim choice already verifies (`abiHasErrorPrefix`).

To unstick, replace the transaction at the **same nonce, higher fee** (a replacement at `N+1` just stalls behind `N`). The address is MPC-controlled, so the replacement is an ordinary signing request — no "cancel" choice needed. In `daml-vault`: submit another withdrawal of any spare holding with `evmTxParams.nonce` set to the stuck nonce; once it mines, the MPC fails the original and `CompleteWithdrawal` recreates the `Erc20Holding`. (A holder whose sole holding is fully withdrawn must re-deposit or have an operator re-issue it — no funds are lost either way.)

### Security checklist for integrators

The Signer signs whatever bytes it is given and tracks no per-request state. Every item below is the consumer's responsibility — getting any of them wrong can leak funds.

| #   | Must do                                                                                                                                                                                                                                                                                                                                                               | Why                                                                                                                                  |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Validate `txParams.calldata` before `RequestSignature`** (ABI selector + argument checks).                                                                                                                                                                                                                                                                          | The Signer will sign anything.                                                                                                       |
| 2   | **Use a single-use anchor for replay protection** (or a `requestId` nullifier set).                                                                                                                                                                                                                                                                                   | The Signer has no nonce, no nullifier set, no approval state.                                                                        |
| 3   | **Namespace `path` per deployment** (e.g. `${vaultId},${requester},${userPath}`).                                                                                                                                                                                                                                                                                     | The Signer isolates operator sets only; two consumers sharing an operator set share the key namespace unless `path` says otherwise.  |
| 4   | **Derive and store the response-verification pubkey at deployment time** on your equivalent of `Vault`: `derive_key(rootPub, derive_epsilon_canton(1, operatorsHash, "canton response key"))`, where the second argument is `sender = operatorsHash` and the third is the constant response path. **Do not store the root pubkey directly** — verification will fail. | What `secp256k1WithEcdsaOnly` is checked against. Re-fetching at claim time opens a TOCTOU window.                                   |
| 5   | **Cross-check `(operators, requester, requestId)`** between your anchor, `RespondBidirectionalEvent`, and `SignatureRespondedEvent`.                                                                                                                                                                                                                                  | A misbehaving `sigNetwork` could otherwise pair a valid signature with a different anchor.                                           |
| 6   | **Archive the anchor first in the claim choice**, before any other assertion.                                                                                                                                                                                                                                                                                         | Replay protection only holds if the anchor is gone before a later assertion can revert.                                              |
| 7   | **Verify the outcome signature on-ledger before mutating state**, against the stored response-verification pubkey.                                                                                                                                                                                                                                                    | Forged `RespondBidirectionalEvent` rejected at the consumer's claim choice.                                                          |
| 8   | **Reject `serializedOutput` starting with `0xdeadbeef`** (revert payload) or that does not ABI-decode to your expected success value.                                                                                                                                                                                                                                 | EVM revert ≠ Canton-side success.                                                                                                    |
| 9   | **Store `signEventCid` on your pending anchor and archive it after validated completion.**                                                                                                                                                                                                                                                                            | Keeps the original request event available for the MPC response path, then removes stale request events once the domain action acts. |

Replay-protection options (pick what fits your threat model):

- A registry contract that records every used `requestId` (nullifier set).
- Off-chain operator enforcement via a request-approve flow before the consumer ever calls `RequestSignature`.
- Nothing — relying on the destination chain's nonce when a duplicate sign is harmless (signing is RFC6979-deterministic, so duplicates produce identical signatures and only one tx can land).

For a complete worked consumer, see [`daml-vault/daml/Erc20Vault.daml`](../daml-vault/daml/Erc20Vault.daml).

## CC signature fee

Every `RequestSignature` (and therefore every Vault deposit/withdrawal request) charges the
requester a Canton Coin fee, paid requester → `feeReceiver` **atomically inside the same
transaction**. If the fee cannot settle, `RequestSignature` aborts and no event is created
(fail-closed).

- **Late-bound collector.** The Signer does not contain fee logic. It fetches the FA-signed
  `FeeCollectorRegistration` (the trust anchor — only `sigNetworkFA` can create one, so a hostile
  collector cannot be substituted), asserts it belongs to its own `sigNetworkFA`, and exercises
  `FeeCollector_Charge` (from the frozen `signet-api-fee-v1` package) on the registered collector.
  Interface exercises are late-bound: upgrading the implementation package changes live fee
  behaviour with **zero rebuilds** of `daml-signer`, consumers, or clients.
- **Implementation: `signet-fee-amulet`.** `CcFeeCollector` reads the FA-signed `FeePriceConfig`
  (repriced ~every 10 min off-ledger by `fee-reprice.ts` running as `sigNetworkFA`; `feeAmount = 0.0`
  waives the charge), resolves the CC `TransferFactory` from `feeExtraArgs.context`, and requires the
  transfer to settle one-step via the receiver's `TransferPreapproval` — `Pending`/`Failed` abort.
- **Fee admin = `sigNetworkFA`.** The registration, collector, and price config are all signed by
  the featured-app party; a compromised `sigNetwork` (MPC identity) can neither forge requests nor
  touch pricing, payee, or collector binding.
- **Disclosures.** The FA fee endpoint serves `{registration, collector, priceConfig}` + an opaque
  charge context (registry shape); the CC token registry serves the factory/`AmuletRules`/
  `OpenMiningRound`. `canton-sig` assembles both: `getFeeCollectorContext`,
  `getTransferFactoryForFee`, `selectInputHoldings` / `holdingInputsFromEvents`, then
  `assembleFeeChoiceArgs` / `collectFeeDisclosures`.

### Fee contracts and what may change

All three fee contracts are signed by `sigNetworkFA` (the fee admin) and served as disclosures
by the FA fee endpoint:

| Contract                   | Package                      | Lifetime                                                                                       |
| -------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------- |
| `FeeCollectorRegistration` | `signet-api-fee-v1` (frozen) | long-lived; rotates only when the collector contract is replaced                               |
| `CcFeeCollector`           | `signet-fee-amulet`          | long-lived singleton (`FeeCollector_Charge` is nonconsuming); replaced on wholesale impl swaps |
| `FeePriceConfig`           | `signet-fee-amulet`          | rotates ~10 min via `UpdateFee` (the off-ledger reprice job)                                   |

Upgradability rules:

- **Frozen forever:** everything in `signet-api-fee-v1` (the `FeeCollector` interface + viewtype,
  `FeeCollector_Charge`'s signature, `FeeCollector_ChargeResult`, `FeeCollectorRegistration`'s
  fields); `RequestSignature`'s name, consuming-ness, and arg shapes (append-`Optional`-only) —
  including the three fee args; the event templates' shapes; the `requestId` inputs (a
  cross-language contract with the Rust/TS mirrors). Every fee record carries a required
  `Metadata`, so future additions are new map keys, never field-shape changes.
- **Evolves by SCU:** `signet-fee-amulet`. Interface dispatch is late-bound, so the new code takes
  effect on the **live** collector contract with zero rebuilds of `daml-signer`, consumers, or
  clients. An incompatible redesign instead ships a new template/package + a fresh collector + a
  rotated registration.
- **Evolves by rotation (no package change):** `FeePriceConfig` values; the registration →
  collector binding; the endpoint's charge-context keys (impl-internal — third-party code must
  treat `feeExtraArgs` as opaque).
- **Evolves by new name (last resort):** a breaking fee-API change ships as `signet-api-fee-v2`
  alongside v1, never as an upgrade.
- **Upgrade checking is off until a v-next exists — by construction, not oversight.**
  `signet-fee-amulet` / `signet-api-fee-v1` are new package names (no prior version to diff
  against); `daml-signer` / `daml-vault-poc` keep main's name **and** `0.0.1` but change it
  incompatibly (added `sigNetworkFA` signatory, renamed choices), so main's DAR is not a valid
  `upgrades:` target — SCU rejects a same-version redefinition and the diff is breaking by design.
  There is nothing for `typecheck-upgrades:` to validate until the first change _after_ this
  baseline ships. Turn it on then:
  1. **At baseline freeze**, archive the exact deployed DARs (`dpm build --all` output) as the
     reference — commit under `baseline-dars/` or pin to the deploy tag.
  2. **On the first change**, bump that package's `version` and add to its `daml.yaml`:
     `typecheck-upgrades: yes` and `upgrades: <baseline-dars>/<pkg>-0.0.1.dar`. Only the package
     that changed; `signet-api-fee-v1` stays frozen forever (breaking changes ship as `-v2`).
  3. **CI gate:** `dpm upgrade-check --both <baseline>.dar <new>.dar` per evolving package.

### Fee admin runbook (`sigNetworkFA`, off-ledger)

- **Bootstrap (once per deployment):** as `sigNetworkFA`, create the `CcFeeCollector`, its
  `FeeCollectorRegistration`, and the first `FeePriceConfig`; stand up the fee endpoint serving
  the `{registration, collector, priceConfig}` disclosures + the opaque charge context; ensure the
  `feeReceiver`'s `TransferPreapproval` and the `FeaturedAppRight` are live. The MPC needs no
  fee-related changes — no fee data feeds `requestId` or the events.
- **Repricing:** run `fee-reprice.ts` (`pnpm --filter canton-sig reprice`) as `sigNetworkFA` every
  ~10 min (≈ one `OpenMiningRound` cycle) with overlapping validity windows; `feeAmount = 0.0` is
  the free-mode switch. Renew the receiver's `TransferPreapproval` ahead of expiry; automate reward
  minting via a CIP-73 `MintingDelegation`.
- **Vetting IS the fee-logic deploy.** The charge resolves at runtime to the newest
  `signet-fee-amulet` version vetted by **all** participants involved, so vetting a new DAR changes
  live fee behavior immediately. Shipping v2 does not retire v1 — a submitter can pin any
  still-vetted version via `packageIdSelectionPreference` — so **unvet** superseded versions whose
  logic must die. Gate both acts (vetting a fee impl, signing a registration) like production
  deploy approvals.
- **Economics:** keeping `feeReceiver = sigNetworkFA` (also the preapproval provider) captures the
  featured-app reward on each incoming fee transfer (~$1 activity markers until CIP-0104
  Increment 4 cuts over; traffic-based afterwards). Reward model + strategy:
  [`proposals/featured-app-rewards.md`](../../proposals/featured-app-rewards.md).

### Fee security model and accepted trade-offs

Two distinct trust axes — keep them separate.

**Collector trust (the registration anchor).** The Signer trusts only the `FeeCollectorRegistration`,
never the collector contract itself, and does not read the charge result — only `sigNetworkFA` can
create a registration, so a requester can never substitute a hostile collector. Signing a registration
is therefore the _entire_ blessing of an implementation: the payer's authority is ambient inside the
charge subtree, so a malicious-but-FA-blessed collector could mis-spend the **attached** `feeInputs`
(worst case their full value, not just the fee — and `selectInputHoldings` is greedy largest-first, so
a small fee can attach a large holding). This harms only the FA's own users, but it is why registration
signing must be gated like a production deploy approval.

**Factory trust — fee integrity depends on package vetting, not on-ledger checks. Read before mainnet.**
The charge settles by exercising `TransferFactory_Transfer` on a factory cid taken from the
**caller-supplied** `feeExtraArgs.context`, and decides success purely from the returned
`TransferInstructionResult` tag. Per the token standard, that choice's controller is just the transfer's
`sender` (the requester), and "_Implementations MUST validate that [`expectedAdmin`] matches the admin of
the factory_" — so exercising a factory from an untrusted source is safe only "_provided all vetted Daml
packages only contain interface implementations that check the expected admin party_." The charge does
its half correctly (`expectedAdmin = priceCfg.instrumentAdmin`, from the FA-signed config). The residual:
a requester who can get a **permissive** `TransferFactory` implementation vetted — one that returns
`Completed` without moving funds — bypasses the fee and obtains a free signature.

There is **no on-ledger defense** within the token-standard interfaces (verified against the vendored
DARs): the `Completed` result's `receiverHoldingCids` can point at any pre-existing holdings; the
`Holding` interface exposes only a `HoldingView` whose `instrumentId.admin` is an implementation-controlled
field (not the concrete signatory) with no signatory accessor; and entering the choice needs only the
payer's authority. Allocations relocate but do not escape this. The only on-ledger guarantee would require
coupling the charge to the concrete `splice-amulet` template — defeating the registry-agnostic, late-bound
design and breaking on every Amulet upgrade. This is **not** introduced by the FeeCollector package split:
the previous inline-fee design had the identical caller-supplied-factory + trust-the-tag pattern. A
`FeeReceipt` (below) would **not** fix it either — a receipt attests the charge body _ran_, which already
trusted the forged `Completed`.

So fee integrity is a **vetting-governance + hosting-topology** property, not a contract-code property:

- **Production control.** On every participant that can _confirm a fee transfer_, ensure only conformant
  `TransferFactory` / `Holding` implementations are vetted (the genuine Amulet/registry packages). Treat
  vetting a new token package as a governed approval; unvet permissive/superseded ones (versions cannot be
  deleted, only unvetted). This is a **different** vetting concern from the collector-package vetting in the
  runbook above — a different package, and (by our analysis of Canton view confirmation, worth confirming
  empirically) a different participant set: the factory sub-view is confirmed by the participant hosting the
  **requester**, not the FA.
- **Topology.** Because the fee inverts the usual incentive (the payer _wants_ the charge to no-op), the
  precondition is only enforceable where the operator/FA controls vetting on the requester-hosting
  participant. **Recommended: host fee-payers on operator-controlled participants** (also today's
  single-participant reality). If self-hosted payers are required, accept that the token standard cannot give
  the FA a bypass-proof fee on-ledger, and compensate out of band (the bypass costs the attacker their own
  participant operation + featured-app/reputation standing for a sub-dollar fee; gate signing-service access
  by other means; or require prepayment via a rail the FA controls).

**Standalone `FeeCollector_Charge`.** The choice is intentionally exercisable standalone (controller `payer`;
the collector is publicly disclosed) and is harmless — it only moves the payer's own holdings to the
FA-configured receiver and mints nothing the protocol reads. It cannot be restricted to "called from
`RequestSignature`" (Daml has no caller introspection).

**Deferred hardening — `FeeReceipt`.** An in-transaction receipt minted by the impl and validated + consumed
by `RequestSignature` would prove the charge body _ran_ independent of the impl version, at the cost of
freezing the receipt shape + validation logic into the stable zone. As noted above it does **not** close the
factory bypass; revisit it only for the collector-governance axis if registration/vetting discipline weakens.

# API Reference

## Templates

### `Signer`

Singleton identity contract, **co-signed by `sigNetwork` (the MPC party) and `sigNetworkFA` (the featured-app provider party)**; disclosed off-chain. Created only via the `SignerProposal`/`AcceptSigner` ceremony (below), never with a bare `create`.

- Signatory: `sigNetwork, sigNetworkFA`
- Fields: `sigNetwork : Party`, `sigNetworkFA : Party`

| Choice                 | Type         | Controller             | Args                                                                                                                               | Returns                                |
| ---------------------- | ------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| `RequestSignature`     | nonconsuming | `operators, requester` | the request fields (table below) + the three fee args (`feeRegistrationCid`, `feeInputs`, `feeExtraArgs`)                          | `ContractId SignBidirectionalEvent`    |
| `Respond`              | nonconsuming | `sigNetwork`           | `signEventCid : ContractId SignBidirectionalEvent`, `requestId : BytesHex`, `signature : Signature`                                | `ContractId SignatureRespondedEvent`   |
| `RespondBidirectional` | nonconsuming | `sigNetwork`           | `signEventCid : ContractId SignBidirectionalEvent`, `requestId : BytesHex`, `serializedOutput : BytesHex`, `signature : Signature` | `ContractId RespondBidirectionalEvent` |

`RequestSignature` charges the CC signature fee, derives `sender = computeOperatorsHash (map partyToText operators)` from the on-ledger operators, and creates the MPC-visible `SignBidirectionalEvent` (co-signed by `sigNetworkFA` ambiently, via the `Signer`) — all in one transaction. The fee is charged through the registered late-bound `FeeCollector` (the FA-signed `FeeCollectorRegistration` is validated first); if the charge aborts, `RequestSignature` aborts and no event is created (**fail-closed**). See [CC signature fee](#cc-signature-fee). It replaces the previous transient `SignRequest` + `SignBidirectional`/`Execute` step: `operators` co-authorize directly as choice controllers (a consumer supplies their authority by being `signatory operators`), so no intermediate authority-bridge contract is needed.

`RequestSignature` request fields (also the fields stamped onto `SignBidirectionalEvent`; note there is no `sigNetwork` arg — the `Signer` knows its own):

| Field                         | Type       | Notes                                                                                                                                               |
| ----------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `operators`                   | `[Party]`  | Operator multi-sig. Non-empty, unique. Sorted internally for hashing — caller order doesn't matter.                                                 |
| `requester`                   | `Party`    | Initiator. Becomes co-signatory of `SignBidirectionalEvent`.                                                                                        |
| `txParams`                    | `TxParams` | Chain-agnostic transaction wrapper.                                                                                                                 |
| `caip2Id`                     | `Text`     | **Destination** chain CAIP-2 id, e.g. `"eip155:1"` (mainnet) or `"eip155:11155111"` (Sepolia). Build via `chainIdToDecimalText` from `daml-eip712`. |
| `keyVersion`                  | `Int`      | KDF version. Use `1` (the latest supported).                                                                                                        |
| `path`                        | `Text`     | KDF subkey path. Consumer namespaces by deployment id when reusing operator sets (Security checklist #3). The Signer cannot enforce this.           |
| `algo`                        | `Text`     | Always `""`. Hashed into `requestId` for forwards-compat; no current code path branches on it.                                                      |
| `dest`                        | `Text`     | Always `""`. Same.                                                                                                                                  |
| `params`                      | `Text`     | Always `""`. Same.                                                                                                                                  |
| `outputDeserializationSchema` | `Text`     | JSON ABI fragment, e.g. `[{"name":"","type":"bool"}]`. Tells the MPC how to ABI-encode the simulated return value into `serializedOutput`.          |
| `respondSerializationSchema`  | `Text`     | Schema describing how the response is signed. Same value as `outputDeserializationSchema` in current usage.                                         |

### `SignerProposal`

Two-party creation ceremony for the co-signed `Signer`. `sigNetwork` proposes; `sigNetworkFA` accepts, and only then does the `Signer` exist — so the featured-app party's consent is mandatory before any signing infra is live.

- Signatory: `sigNetwork`
- Observer: `sigNetworkFA`
- Fields: `sigNetwork : Party`, `sigNetworkFA : Party`

| Choice         | Type      | Controller     | Args | Returns             |
| -------------- | --------- | -------------- | ---- | ------------------- |
| `AcceptSigner` | consuming | `sigNetworkFA` | —    | `ContractId Signer` |

### Fee packages

The fee surface lives outside `daml-signer`:

| Package             | Contents                                                                    | Stability                                        |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `signet-api-fee-v1` | `FeeCollector` interface, `FeeCollector_Charge`, `FeeCollectorRegistration` | frozen forever (breaking change ⇒ `-v2` package) |
| `signet-fee-amulet` | `CcFeeCollector` (charge logic), `FeePriceConfig` (rotating price)          | evolves freely via SCU or replacement            |

`RequestSignature` only ever sees the frozen API: it validates the registration and exercises
`FeeCollector_Charge`. Everything else (pricing, settlement policy, the token-standard dependency)
is the implementation package's business.

### `SignBidirectionalEvent`

Created by `Signer.RequestSignature`. **What the MPC watches.** Co-signed by `sigNetworkFA` (the CIP-0104 confirmer). Consumers retire it from their final claim/completion choice — via `Consume_SignBidirectional`, not a bare `archive` — after both MPC response contracts have been validated and consumed.

- Signatory: `operators, requester, sigNetworkFA`
- Observer: `sigNetwork`
- Ensure: `not (null operators) && unique operators && sender == computeOperatorsHash (map partyToText operators) && validTxParams txParams`

Fields: the `RequestSignature` request fields (table above) plus `sigNetworkFA : Party` and `sender : BytesHex` (= `operatorsHash`, set by `RequestSignature`).

| Choice                      | Type      | Controller                                                 | Args            |
| --------------------------- | --------- | ---------------------------------------------------------- | --------------- |
| `Consume_SignBidirectional` | consuming | `actor : Party` (must be in `operators` or be `requester`) | `actor : Party` |

`Consume_SignBidirectional` exists because `sigNetworkFA` is a signatory: a consumer's choice body cannot `archive` the event directly (it lacks `sigNetworkFA`'s authority), so `sigNetworkFA` pre-consents to this delegated archival. Only `operators`/`requester` may exercise it.

### `SignatureRespondedEvent`

Request-signature evidence. Created by `Signer.Respond`. Signed by the request child key derived from the root with `sender = operatorsHash` and the request `path`; used by the consumer according to its downstream-chain submission flow. See [Integrator lifecycle § 2](#2-the-mpc-service-responds-off-canton-asynchronous) for the full key/usage table.

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

Outcome signature evidence. Signed by the response-verification child key derived from the root with `sender = operatorsHash` and `path = "canton response key"` over `responseHash = keccak256(requestId ‖ serializedOutput)`. The consumer verifies it on-ledger with `secp256k1WithEcdsaOnly` against the response-verification pubkey it stored at deployment. `serializedOutput` is ABI-encoded return data on success, or `0xdeadbeef`+payload on failure (predicate `abiHasErrorPrefix` in `daml-abi`).

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

Every implementation that mirrors this off-Canton must produce byte-identical hashes — verify cross-language with golden vectors before integrating.

## Build & Test

From the repo root:

```bash
dpm build --all                                  # build all packages
(cd daml-packages/daml-signer && dpm test)       # per-package — dpm test does NOT support --all
```
