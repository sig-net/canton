# Signer Fee Architecture (Late-Bound FeeCollector) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the approved spec `docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md` — replace the inline 4-arg fee charge in `Signer.RequestSignature` with a late-bound `FeeCollector` interface exercise (frozen `signet-api-fee-v1` API package + evolvable `signet-fee-amulet` impl package, fee admin = `sigNetworkFA`), rewire `daml-signer`/`daml-vault` and the `canton-sig` client, and split test modules out of the shipped DARs.

**Architecture:** A frozen interface package (`signet-api-fee-v1`: `FeeCollector` interface + `FeeCollectorRegistration` trust anchor, both minimal + `Metadata`) sits between `daml-signer` and a separately-versioned implementation package (`signet-fee-amulet`: `CcFeeCollector` + `FeePriceConfig`, owning the splice token-standard dependency). `RequestSignature` fetches the FA-signed registration, asserts `registration.sigNetworkFA == sigNetworkFA`, and exercises `FeeCollector_Charge` — an interface exercise that is **late-bound** at runtime, so impl upgrades ship with zero rebuilds of signer/vault/clients. Off-chain, `canton-sig` gains a registry-shaped fee-collector context builder and rebinds the reprice automation to `FeePriceConfig`.

**Tech Stack:** Daml SDK 3.4.11 (dpm), Splice token-standard vendored DARs, TypeScript (pnpm workspace, vitest, viem, `@daml.js` codegen).

---

## Read these before starting

- The spec: `docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md` (esp. §5, §9, §10, §12).
- Current code being replaced: `daml-packages/daml-signer/daml/Signer.daml` (fee block in `RequestSignature`), `daml-packages/daml-signer/daml/SignerFee.daml`, `ts-packages/canton-sig/src/fee.ts`.

## Ground rules for this repo / branch

1. **Branch:** `feat/cc-deposit-charge` already carries a large **uncommitted** working tree (the sigNetworkFA baseline). NEVER `git add -A` / `git add .`. Each commit step lists the exact paths to stage; stage only those.
2. **Commits need user confirmation.** Per the user's global rules, notify the user and get approval before the first commit of the run (one approval for the whole series is fine if the user grants it). Conventional commits, subject ≤ 72 chars, ≤ 2 lines, **no AI attribution of any kind**.
3. **Shell:** the sandbox resets the cwd between Bash calls. Prefix every command with `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && …` (or deeper). All paths below are relative to that repo root.
4. **Moving files:** use `git mv` (preserves rename detection for review).
5. `dpm test` has no `--all`; run it per package. `dpm build --all` works from the repo root (multi-package.yaml).
6. The MPC Rust repo is **out of scope** — the fee layer is invisible to it.
7. Daml Script's static-time ledger starts at `1970-01-01T00:00:00Z`. Tests that need a 2026 "now" call `setTime` explicitly.
8. `coerceContractId : ContractId a -> ContractId b` is exported from `DA.Internal.LF` (verified in the 3.4.11 stdlib — it is NOT in Prelude). Import it as shown.
9. **Deferred by design (do NOT add):** `upgrades:` / `typecheck-upgrades: yes` wiring, the `dpm upgrade-check` CI step, and the late-binding SCU smoke test (spec §10.3 / §12 bullet 3). All three need a baseline/second DAR version to compare against, and none exists yet — this redeploy IS the breaking baseline. They land with the first post-deploy impl SCU. A doc note records this in Task 10.

---

### Task 1: `signet-api-fee-v1` — the frozen fee API package

**Files:**

- Create: `daml-packages/signet-api-fee-v1/daml.yaml`
- Create: `daml-packages/signet-api-fee-v1/daml/Signet/Api/Fee/V1.daml`
- Modify: `multi-package.yaml`

This package is pure declarations (interface + viewtype + one template), so its "test" is that it compiles and that Tasks 2–5 build against it. No Daml Script here by design.

- [ ] **Step 1: Create `daml-packages/signet-api-fee-v1/daml.yaml`**

```yaml
sdk-version: 3.4.11
name: signet-api-fee-v1
version: 1.0.0
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
data-dependencies:
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
```

- [ ] **Step 2: Create `daml-packages/signet-api-fee-v1/daml/Signet/Api/Fee/V1.daml`**

```daml
-- | Frozen Signet fee API (v1). Name-versioned like the Splice token-standard
-- APIs: this package is never upgraded in place — a breaking change ships as a
-- new `signet-api-fee-v2` package alongside it, never as an SCU. It contains no
-- logic. Every record carries a required `Metadata`, so future additions are
-- new map keys, never field-shape changes.
module Signet.Api.Fee.V1 where

import Splice.Api.Token.HoldingV1 (Holding)
import Splice.Api.Token.MetadataV1 (ExtraArgs, Metadata)

-- | View of a fee collector. `feeReceiver` is display/debug only — the
-- authoritative payee lives in the implementation's price config at charge time.
data FeeCollectorView = FeeCollectorView with
    sigNetworkFA : Party      -- fee admin this collector belongs to
    feeReceiver  : Party      -- current payee (informational)
    meta         : Metadata
  deriving (Eq, Show)

-- | Result of a fee charge.
data FeeCollector_ChargeResult = FeeCollector_ChargeResult with
    amountCharged : Decimal
    meta          : Metadata
  deriving (Eq, Show)

-- | Late-bound fee charge: `Signer.RequestSignature` exercises this interface,
-- so the implementing package upgrades (or is replaced) without rebuilding the
-- Signer, any consumer, or any client — interface exercises resolve the target
-- template at runtime via package preference.
interface FeeCollector where
  viewtype FeeCollectorView

  -- | Implementation hook for the charge. Aborting here aborts the whole
  -- enclosing transaction (fail-closed: no fee settled -> no sign event).
  feeCollector_chargeImpl : ContractId FeeCollector -> FeeCollector_Charge -> Update FeeCollector_ChargeResult

  -- | Charge `payer` the current fee. `inputs` follow the token-standard
  -- holdings idiom (implementations that do not consume holdings take `[]`);
  -- `extraArgs.context` carries implementation-internal references provided by
  -- the FA fee endpoint (price config, transfer factory, ...) — opaque to
  -- callers; `extraArgs.meta` is caller-provided.
  nonconsuming choice FeeCollector_Charge : FeeCollector_ChargeResult
    with
      payer     : Party
      inputs    : [ContractId Holding]
      extraArgs : ExtraArgs
    controller payer
    do feeCollector_chargeImpl this self arg

-- | Trust anchor: binds "the collector the Signer must use" under the fee
-- admin's signature. A requester cannot create one, so a hostile FeeCollector
-- implementation can never be substituted — `RequestSignature` asserts
-- `registration.sigNetworkFA == signer.sigNetworkFA`. One registration can
-- serve every Signer sharing this `sigNetworkFA` (cross-Signer reuse is
-- harmless: fee semantics don't depend on which Signer routed the request).
-- Signing a registration is the act that blesses an implementation — treat it
-- like a deploy approval by the FA party.
template FeeCollectorRegistration
  with
    sigNetworkFA : Party
    collector    : ContractId FeeCollector
    meta         : Metadata
  where
    signatory sigNetworkFA
```

> Note: the method shape (`feeCollector_chargeImpl` taking `self` + the whole
> `arg` record, body `feeCollector_chargeImpl this self arg`) deliberately copies
> the vendored Splice convention (`transferFactory_transferImpl this self arg` in
> `splice-api-token-transfer-instruction-v1`). It is a refinement of the spec §5.1
> sketch (`charge : Party -> ... `) within the same frozen surface — the frozen
> contract is `FeeCollector_Charge`'s signature, which is identical.

- [ ] **Step 3: Add the package to `multi-package.yaml`**

Replace the whole file with:

```yaml
packages:
  - daml-packages/daml-abi
  - daml-packages/daml-uint256
  - daml-packages/daml-eip712
  - daml-packages/signet-api-fee-v1
  - daml-packages/daml-signer
  - daml-packages/daml-vault
```

- [ ] **Step 4: Build**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all`
Expected: success; `daml-packages/signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar` exists.

- [ ] **Step 5: Commit (stage only these paths; first commit of the run — confirm with the user per ground rule 2)**

```bash
git add multi-package.yaml daml-packages/signet-api-fee-v1
git commit -m "feat: add signet-api-fee-v1 frozen fee API package"
```

---

### Task 2: `signet-fee-amulet` — `FeePriceConfig` + its test suite

**Files:**

- Create: `daml-packages/signet-fee-amulet/daml.yaml`
- Create: `daml-packages/signet-fee-amulet/daml/Signet/Fee/Amulet.daml` (price-config half; collector comes in Task 3)
- Create: `daml-packages/signet-fee-amulet-tests/daml.yaml`
- Create: `daml-packages/signet-fee-amulet-tests/daml/TestFeePriceConfig.daml`
- Modify: `multi-package.yaml`

- [ ] **Step 1: Create `daml-packages/signet-fee-amulet/daml.yaml`**

```yaml
sdk-version: 3.4.11
name: signet-fee-amulet
version: 0.0.1
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
data-dependencies:
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
  - ../vendor/splice-api-token-transfer-instruction-v1-1.0.0.dar
```

- [ ] **Step 2: Create `daml-packages/signet-fee-amulet-tests/daml.yaml`**

```yaml
sdk-version: 3.4.11
name: signet-fee-amulet-tests
version: 0.0.1
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
  - daml-script
data-dependencies:
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../signet-fee-amulet/.daml/dist/signet-fee-amulet-0.0.1.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
  - ../vendor/splice-api-token-transfer-instruction-v1-1.0.0.dar
```

- [ ] **Step 3: Write the failing tests — `daml-packages/signet-fee-amulet-tests/daml/TestFeePriceConfig.daml`**

This ports `daml-packages/daml-signer/daml/TestSignerFee.daml` to `FeePriceConfig` (new error strings "Fee price config …", new `meta` field, import from `Signet.Fee.Amulet`):

```daml
module TestFeePriceConfig where

import Daml.Script
import DA.Assert ((===))
import DA.Time (time)
import DA.Date (date, Month(..))

import Splice.Api.Token.MetadataV1 (emptyMetadata)
import Signet.Fee.Amulet (FeePriceConfig(..), UpdateFee(..), validatePriceConfig)

-- A valid config administered by `fa` (the featured-app party), in-window for
-- all of 2026.
mkCfg : Party -> FeePriceConfig
mkCfg fa = FeePriceConfig with
  sigNetworkFA = fa
  feeReceiver = fa
  instrumentAdmin = fa
  instrumentId = "Amulet"
  feeAmount = 1.0
  validFrom = time (date 2026 Jan 1) 0 0 0
  validUntil = time (date 2026 Dec 31) 0 0 0
  version = 0
  meta = emptyMetadata

mid2026 : Time
mid2026 = time (date 2026 Jun 1) 0 0 0

test_validate_ok : Script ()
test_validate_ok = do
  fa <- allocateParty "fa"
  validatePriceConfig fa mid2026 (mkCfg fa) === Right ()

test_validate_wrong_admin : Script ()
test_validate_wrong_admin = do
  fa <- allocateParty "fa"
  other <- allocateParty "other"
  validatePriceConfig other mid2026 (mkCfg fa) === Left "Fee price config belongs to a different sigNetworkFA"

test_validate_not_yet_valid : Script ()
test_validate_not_yet_valid = do
  fa <- allocateParty "fa"
  let early = time (date 2025 Dec 31) 0 0 0
  validatePriceConfig fa early (mkCfg fa) === Left "Fee price config not yet valid"

test_validate_expired : Script ()
test_validate_expired = do
  fa <- allocateParty "fa"
  let late = time (date 2027 Jan 1) 0 0 0
  validatePriceConfig fa late (mkCfg fa) === Left "Fee price config expired"

test_create_and_reprice : Script ()
test_create_and_reprice = do
  fa <- allocateParty "fa"
  cid <- submit fa do createCmd (mkCfg fa)
  let vf = time (date 2026 Jun 1) 0 0 0
      vu = time (date 2026 Jun 3) 0 0 0
  cid2 <- submit fa do
    exerciseCmd cid UpdateFee with
      newAmount = 2.0
      newFeeReceiver = fa
      newValidFrom = vf
      newValidUntil = vu
  Some c <- queryContractId fa cid2
  c.feeAmount === 2.0
  c.feeReceiver === fa
  c.version === 1
  c.validUntil === vu

-- UpdateFee re-points the payee: moving the fee revenue to another party
-- (e.g. a treasury) is one exercise by the fee admin.
test_reprice_repoints_receiver : Script ()
test_reprice_repoints_receiver = do
  fa <- allocateParty "fa"
  treasury <- allocateParty "treasury"
  cid <- submit fa do createCmd (mkCfg fa)
  cid2 <- submit fa do
    exerciseCmd cid UpdateFee with
      newAmount = 1.0
      newFeeReceiver = treasury
      newValidFrom = time (date 2026 Jun 1) 0 0 0
      newValidUntil = time (date 2026 Jun 3) 0 0 0
  Some c <- queryContractId fa cid2
  c.feeReceiver === treasury
  c.version === 1

-- A requester (non-signatory) cannot create the sigNetworkFA-signed config.
test_requester_cannot_forge : Script ()
test_requester_cannot_forge = do
  fa <- allocateParty "fa"
  requester <- allocateParty "requester"
  submitMustFail requester do createCmd (mkCfg fa)

-- The MPC party (sigNetwork) is not the fee admin: it cannot create the
-- sigNetworkFA-signed config — a compromised MPC cannot touch pricing.
test_mpc_party_cannot_forge : Script ()
test_mpc_party_cannot_forge = do
  fa <- allocateParty "fa"
  sigNetwork <- allocateParty "sigNetwork"
  submitMustFail sigNetwork do createCmd (mkCfg fa)
```

- [ ] **Step 4: Add both packages to `multi-package.yaml`**

Replace the whole file with:

```yaml
packages:
  - daml-packages/daml-abi
  - daml-packages/daml-uint256
  - daml-packages/daml-eip712
  - daml-packages/signet-api-fee-v1
  - daml-packages/signet-fee-amulet
  - daml-packages/signet-fee-amulet-tests
  - daml-packages/daml-signer
  - daml-packages/daml-vault
```

- [ ] **Step 5: Run the build to verify it fails (module doesn't exist yet)**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all`
Expected: FAIL — `signet-fee-amulet` has no source / `Signet.Fee.Amulet` not found.

- [ ] **Step 6: Write the implementation — `daml-packages/signet-fee-amulet/daml/Signet/Fee/Amulet.daml`** (price-config half)

```daml
-- | Canton Coin fee-collector implementation package. Owns everything expected
-- to change about the fee (settlement policy, token-standard integration,
-- pricing plumbing) — including the splice transfer-instruction dependency —
-- and evolves by SCU or replacement with ZERO rebuilds of `signet-api-fee-v1`,
-- `daml-signer`, `daml-vault`, or clients: `FeeCollector_Charge` is dispatched
-- late-bound at runtime. Design:
-- docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md §5.2.
module Signet.Fee.Amulet where

import Splice.Api.Token.MetadataV1 (Metadata)

-- | A price config is chargeable for a given Signer iff it is signed by the
-- same sigNetworkFA and the ledger time is inside its validity window. Pure so
-- it is unit-testable without a ledger.
validatePriceConfig : Party -> Time -> FeePriceConfig -> Either Text ()
validatePriceConfig expectedSigNetworkFA now cfg
  | cfg.sigNetworkFA /= expectedSigNetworkFA = Left "Fee price config belongs to a different sigNetworkFA"
  | now < cfg.validFrom = Left "Fee price config not yet valid"
  | now > cfg.validUntil = Left "Fee price config expired"
  | otherwise = Right ()

-- | Successor of the former `SignerFee.SignerFeeConfig`, now implementation-
-- internal and FA-owned. Repriced ~every 10 min (≈ one OpenMiningRound cycle)
-- by the off-ledger `fee-reprice.ts` automation running as `sigNetworkFA`.
-- Referenced at charge time via `extraArgs.context` (`priceConfigContextKey`)
-- and attached as a disclosure by the FA fee endpoint.
template FeePriceConfig
  with
    sigNetworkFA    : Party    -- fee admin + identity binding: must equal the Signer's sigNetworkFA
    feeReceiver     : Party    -- who is paid; re-stamped on every roll
    instrumentAdmin : Party    -- Amulet/DSO admin party of the CC InstrumentId
    instrumentId    : Text     -- the CC instrument id ("Amulet")
    feeAmount       : Decimal  -- current CC fee; 0.0 = waived (Charge skips the transfer)
    validFrom       : Time     -- window start (pre-publish the next config with overlap)
    validUntil      : Time     -- window end; Charge rejects an expired config
    version         : Int      -- monotonic; audit/observability
    meta            : Metadata -- extension room: new data = new keys, never new fields
  where
    -- only sigNetworkFA can set the fee -> neither a requester nor a compromised
    -- sigNetwork (MPC identity) can forge a cheaper or different-payee config
    signatory sigNetworkFA
    observer feeReceiver
    ensure feeAmount >= 0.0 && validUntil > validFrom

    -- Reprice: archive + recreate with a new amount, payee, and validity window.
    -- The contract id rotates, so clients fetch the current disclosure at submit
    -- time rather than hardcoding it.
    choice UpdateFee : ContractId FeePriceConfig
      with
        newAmount      : Decimal
        newFeeReceiver : Party
        newValidFrom   : Time
        newValidUntil  : Time
      controller sigNetworkFA
      do
        create this with
          feeAmount = newAmount
          feeReceiver = newFeeReceiver
          validFrom = newValidFrom
          validUntil = newValidUntil
          version = version + 1
```

(No `ReadFeeConfig` successor: the charge-time read is a plain `fetch` under the
collector's ambient `sigNetworkFA` authority, and off-ledger reads run as the FA
party against its own ACS — the authority workaround is obsolete, spec §5.3.)

- [ ] **Step 7: Build + run the tests**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all && (cd daml-packages/signet-fee-amulet-tests && dpm test)`
Expected: PASS — 8 test scripts green.

- [ ] **Step 8: Commit**

```bash
git add multi-package.yaml daml-packages/signet-fee-amulet daml-packages/signet-fee-amulet-tests
git commit -m "feat: add signet-fee-amulet package with FA-owned FeePriceConfig"
```

---

### Task 3: `CcFeeCollector` (late-bound charge impl) + its test suite

**Files:**

- Create: `daml-packages/signet-fee-amulet-tests/daml/TestToken.daml` (3-mode mock factory)
- Create: `daml-packages/signet-fee-amulet-tests/daml/TestCcFeeCollector.daml`
- Modify: `daml-packages/signet-fee-amulet/daml/Signet/Fee/Amulet.daml` (append context keys + helper + `CcFeeCollector`)

- [ ] **Step 1: Create the token-standard mocks — `daml-packages/signet-fee-amulet-tests/daml/TestToken.daml`**

This is the existing `daml-signer/daml/TestToken.daml` upgraded from a `Bool`
toggle to a 3-mode settle outcome so the `Pending` fail-closed branch is testable:

```daml
module TestToken where

-- Test-only mock implementations of the Splice token-standard interfaces, so
-- CcFeeCollector's charge can be unit-tested deterministically without the live
-- Amulet runtime. MockHolding mirrors the upstream DummyHolding example
-- (DSO/admin-signed, owner as observer); MockTransferFactory's settleMode
-- exercises all three charge branches (Completed vs Pending vs Failed).

import DA.Internal.LF (coerceContractId)
import Splice.Api.Token.HoldingV1 (Holding, HoldingView (..), InstrumentId)
import Splice.Api.Token.MetadataV1 (emptyMetadata)
import Splice.Api.Token.TransferInstructionV1
  ( TransferFactory
  , TransferFactoryView (..)
  , TransferInstructionResult (..)
  , TransferInstructionResult_Output (..)
  )

template MockHolding
  with
    admin : Party
    owner : Party
    instrumentId : InstrumentId
    amount : Decimal
  where
    signatory admin
    observer owner
    interface instance Holding for MockHolding where
      view = HoldingView with
        owner
        instrumentId
        amount
        lock = None
        meta = emptyMetadata

-- SettleCompleted -> Completed (simulates the receiver's TransferPreapproval)
-- SettlePending   -> Pending   (no preapproval; two-step offer — charge must abort)
-- SettleFailed    -> Failed    (transfer failure — charge must abort)
data MockSettleMode = SettleCompleted | SettlePending | SettleFailed
  deriving (Eq, Show)

template MockTransferFactory
  with
    admin : Party
    settleMode : MockSettleMode
  where
    signatory admin
    interface instance TransferFactory for MockTransferFactory where
      view = TransferFactoryView with admin; meta = emptyMetadata

      transferFactory_publicFetchImpl _selfCid _arg =
        pure (TransferFactoryView with admin; meta = emptyMetadata)

      transferFactory_transferImpl selfCid _arg = case settleMode of
        SettleCompleted ->
          pure TransferInstructionResult with
            output = TransferInstructionResult_Completed with receiverHoldingCids = []
            senderChangeCids = []
            meta = emptyMetadata
        SettlePending ->
          pure TransferInstructionResult with
            -- the cid is never fetched by a fail-closed caller (it aborts on
            -- Pending), so a coerced placeholder is fine for tests
            output = TransferInstructionResult_Pending with transferInstructionCid = coerceContractId selfCid
            senderChangeCids = []
            meta = emptyMetadata
        SettleFailed ->
          pure TransferInstructionResult with
            output = TransferInstructionResult_Failed
            senderChangeCids = []
            meta = emptyMetadata
```

- [ ] **Step 2: Write the failing tests — `daml-packages/signet-fee-amulet-tests/daml/TestCcFeeCollector.daml`**

```daml
module TestCcFeeCollector where

import DA.Assert ((===))
import DA.Internal.LF (coerceContractId)
import qualified DA.TextMap as TextMap
import DA.Time (time)
import DA.Date (date, Month(..))
import Daml.Script

import Splice.Api.Token.MetadataV1 (AnyValue(..), ChoiceContext(..), ExtraArgs(..), emptyMetadata)
import Signet.Api.Fee.V1 (FeeCollector, FeeCollector_Charge(..))
import Signet.Fee.Amulet
import TestToken (MockTransferFactory(..), MockSettleMode(..))

mid2026 : Time
mid2026 = time (date 2026 Jun 1) 0 0 0

-- valid all of 2026; admin/receiver = fa
mkPriceConfig : Party -> Decimal -> FeePriceConfig
mkPriceConfig fa amount = FeePriceConfig with
  sigNetworkFA = fa
  feeReceiver = fa
  instrumentAdmin = fa
  instrumentId = "Amulet"
  feeAmount = amount
  validFrom = time (date 2026 Jan 1) 0 0 0
  validUntil = time (date 2026 Dec 31) 0 0 0
  version = 0
  meta = emptyMetadata

-- charge context carrying the price config + optionally the transfer factory
mkChargeContext : ContractId FeePriceConfig -> Optional (ContractId MockTransferFactory) -> ChoiceContext
mkChargeContext priceCfgCid optFactory = ChoiceContext with
  values = TextMap.fromList
    ( (priceConfigContextKey, AV_ContractId (coerceContractId priceCfgCid))
      :: case optFactory of
           Some f -> [(transferFactoryContextKey, AV_ContractId (coerceContractId f))]
           None -> []
    )

mkExtras : ChoiceContext -> ExtraArgs
mkExtras ctx = ExtraArgs with context = ctx; meta = emptyMetadata

setupCharge : Decimal -> MockSettleMode -> Script (Party, Party, ContractId CcFeeCollector, ContractId FeePriceConfig, ContractId MockTransferFactory)
setupCharge feeAmount settleMode = do
  setTime mid2026
  fa <- allocateParty "fa"
  payer <- allocateParty "payer"
  collectorCid <- submit fa do
    createCmd CcFeeCollector with sigNetworkFA = fa; feeReceiver = fa; meta = emptyMetadata
  priceCfgCid <- submit fa do createCmd (mkPriceConfig fa feeAmount)
  factoryCid <- submit fa do
    createCmd MockTransferFactory with admin = fa; settleMode
  pure (fa, payer, collectorCid, priceCfgCid, factoryCid)

-- Happy path: the transfer settles one-step, the charge returns the config amount.
testChargeHappyPath : Script ()
testChargeHappyPath = do
  (fa, payer, collectorCid, priceCfgCid, factoryCid) <- setupCharge 1.0 SettleCompleted
  result <- submit (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext priceCfgCid (Some factoryCid))
  result.amountCharged === 1.0

-- Fail-closed: a Pending outcome (no TransferPreapproval) aborts the charge.
testChargeFailsClosedOnPending : Script ()
testChargeFailsClosedOnPending = do
  (fa, payer, collectorCid, priceCfgCid, factoryCid) <- setupCharge 1.0 SettlePending
  submitMustFail (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext priceCfgCid (Some factoryCid))

-- Fail-closed: a Failed outcome aborts the charge.
testChargeFailsClosedOnFailed : Script ()
testChargeFailsClosedOnFailed = do
  (fa, payer, collectorCid, priceCfgCid, factoryCid) <- setupCharge 1.0 SettleFailed
  submitMustFail (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext priceCfgCid (Some factoryCid))

-- A price config signed by a different fee admin is rejected (validatePriceConfig).
testChargeRejectsForeignPriceConfig : Script ()
testChargeRejectsForeignPriceConfig = do
  (fa, payer, collectorCid, _ownCfg, factoryCid) <- setupCharge 1.0 SettleCompleted
  other <- allocateParty "otherFA"
  foreignCfgCid <- submit other do createCmd (mkPriceConfig other 0.5)
  submitMustFail (actAs payer <> readAs fa <> readAs other) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext foreignCfgCid (Some factoryCid))

-- An expired price config is rejected (the window check runs at charge time).
testChargeRejectsExpiredPriceConfig : Script ()
testChargeRejectsExpiredPriceConfig = do
  (fa, payer, collectorCid, _ownCfg, factoryCid) <- setupCharge 1.0 SettleCompleted
  let expiredCfg = (mkPriceConfig fa 1.0) with
        validFrom = time (date 2026 Jan 1) 0 0 0
        validUntil = time (date 2026 Mar 1) 0 0 0
  expiredCid <- submit fa do createCmd expiredCfg
  submitMustFail (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext expiredCid (Some factoryCid))

-- Zero-fee waiver: feeAmount == 0.0 skips the transfer entirely — proven by
-- omitting the factory from the context (a transfer attempt would abort).
testChargeZeroFeeWaivesTransfer : Script ()
testChargeZeroFeeWaivesTransfer = do
  (fa, payer, collectorCid, _oneCcCfg, _factoryCid) <- setupCharge 1.0 SettleCompleted
  zeroCfgCid <- submit fa do createCmd (mkPriceConfig fa 0.0)
  result <- submit (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext zeroCfgCid None)
  result.amountCharged === 0.0

-- Missing price-config context key aborts.
testChargeMissingPriceConfigKeyAborts : Script ()
testChargeMissingPriceConfigKeyAborts = do
  (fa, payer, collectorCid, _cfg, _factory) <- setupCharge 1.0 SettleCompleted
  submitMustFail (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (ChoiceContext with values = TextMap.empty)

-- Fee due but no transfer factory in the context aborts.
testChargeMissingFactoryKeyAborts : Script ()
testChargeMissingFactoryKeyAborts = do
  (fa, payer, collectorCid, priceCfgCid, _factory) <- setupCharge 1.0 SettleCompleted
  submitMustFail (actAs payer <> readAs fa) do
    exerciseCmd (toInterfaceContractId @FeeCollector collectorCid) FeeCollector_Charge with
      payer; inputs = []
      extraArgs = mkExtras (mkChargeContext priceCfgCid None)
```

- [ ] **Step 3: Run to verify failure**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all`
Expected: FAIL — `CcFeeCollector`, `priceConfigContextKey`, `transferFactoryContextKey` not in scope.

- [ ] **Step 4: Append the collector to `daml-packages/signet-fee-amulet/daml/Signet/Fee/Amulet.daml`**

Add these imports to the module's import block:

```daml
import qualified DA.TextMap as TextMap
import DA.Internal.LF (coerceContractId)
import DA.Time (hours, addRelTime)

import Splice.Api.Token.HoldingV1 (InstrumentId(..))
import Splice.Api.Token.MetadataV1
  ( AnyContractId, AnyValue(..), ChoiceContext(..), ExtraArgs(..), emptyMetadata )
import Splice.Api.Token.TransferInstructionV1
  ( TransferFactory, TransferFactory_Transfer(..), Transfer(..)
  , TransferInstructionResult_Output(..)
  )
import Signet.Api.Fee.V1
```

(keep the existing `Metadata` import; merge into one `Splice.Api.Token.MetadataV1` import list: `( AnyContractId, AnyValue(..), ChoiceContext(..), ExtraArgs(..), Metadata, emptyMetadata )`.)

Append at the end of the module:

```daml
-- ---------------------------------------------------------------------------
-- Charge context keys (implementation-internal)
--
-- Per the token-standard rule, these keys are internal to this implementation,
-- its FA-operated fee endpoint, and canton-sig's `assembleFeeChoiceArgs`;
-- third-party code must treat the context as opaque. They may change freely
-- together with the endpoint.
-- ---------------------------------------------------------------------------

-- | Context key carrying the `FeePriceConfig` to charge against (`AV_ContractId`).
priceConfigContextKey : Text
priceConfigContextKey = "signet.network/fee/price-config"

-- | Context key carrying the CC `TransferFactory` to settle through (`AV_ContractId`).
transferFactoryContextKey : Text
transferFactoryContextKey = "signet.network/fee/transfer-factory"

-- | Read an `AV_ContractId` context value.
lookupContextCid : Text -> ChoiceContext -> Optional AnyContractId
lookupContextCid key ctx = case TextMap.lookup key ctx.values of
  Some (AV_ContractId cid) -> Some cid
  _ -> None

-- | Long-lived collector singleton (`FeeCollector_Charge` is nonconsuming).
-- Compatible logic changes ship as an SCU of this package and take effect on
-- the LIVE contract via late binding; incompatible redesigns ship as a new
-- template + a fresh collector + a rotated `FeeCollectorRegistration`.
-- `feeReceiver` here is informational (view display) — the authoritative payee
-- is the price config's at charge time.
template CcFeeCollector
  with
    sigNetworkFA : Party
    feeReceiver  : Party
    meta         : Metadata
  where
    signatory sigNetworkFA

    interface instance FeeCollector for CcFeeCollector where
      view = FeeCollectorView with sigNetworkFA; feeReceiver; meta

      feeCollector_chargeImpl _self arg = do
        now <- getTime
        priceCfgAnyCid <- case lookupContextCid priceConfigContextKey arg.extraArgs.context of
          Some cid -> pure cid
          None -> abort ("Fee charge context is missing " <> priceConfigContextKey)
        -- plain fetch: this collector's sigNetworkFA signatory is ambient in the
        -- Charge subtree, and the price config is signed by the same party
        let priceCfgCid : ContractId FeePriceConfig = coerceContractId priceCfgAnyCid
        priceCfg <- fetch priceCfgCid
        case validatePriceConfig sigNetworkFA now priceCfg of
          Left err -> abort err
          Right () -> pure ()

        if priceCfg.feeAmount == 0.0
          then -- zero-fee waiver: "free mode" is a config flip, no transfer exercised
            pure FeeCollector_ChargeResult with amountCharged = 0.0; meta = emptyMetadata
          else do
            factoryAnyCid <- case lookupContextCid transferFactoryContextKey arg.extraArgs.context of
              Some cid -> pure cid
              None -> abort ("Fee charge context is missing " <> transferFactoryContextKey)
            let factoryCid : ContractId TransferFactory = coerceContractId factoryAnyCid
            result <- exercise factoryCid TransferFactory_Transfer with
              expectedAdmin = priceCfg.instrumentAdmin
              transfer = Transfer with
                sender = arg.payer
                receiver = priceCfg.feeReceiver
                amount = priceCfg.feeAmount
                instrumentId = InstrumentId with admin = priceCfg.instrumentAdmin; id = priceCfg.instrumentId
                requestedAt = now
                executeBefore = addRelTime now (hours 1)
                inputHoldingCids = arg.inputs
                meta = emptyMetadata
              -- pass the merged context through: the registry's own keys ride
              -- along (factory implementations look up only their own keys)
              extraArgs = ExtraArgs with context = arg.extraArgs.context; meta = arg.extraArgs.meta
            case result.output of
              TransferInstructionResult_Completed _ -> pure ()
              TransferInstructionResult_Pending _ ->
                abort "Fee transfer did not settle one-step; receiver TransferPreapproval required"
              TransferInstructionResult_Failed -> abort "Fee transfer failed"
            pure FeeCollector_ChargeResult with amountCharged = priceCfg.feeAmount; meta = emptyMetadata
```

- [ ] **Step 5: Build + test**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all && (cd daml-packages/signet-fee-amulet-tests && dpm test)`
Expected: PASS — all `TestFeePriceConfig` + `TestCcFeeCollector` scripts green.

- [ ] **Step 6: Mutation checks (spec §12; revert each mutation after observing the failure)**

1. In `Amulet.daml`, change `TransferInstructionResult_Failed -> abort "Fee transfer failed"` to `TransferInstructionResult_Failed -> pure ()` → rerun `dpm test`. Expected: `testChargeFailsClosedOnFailed` FAILS. Revert.
2. Change `TransferInstructionResult_Pending _ -> abort …` to `TransferInstructionResult_Pending _ -> pure ()` → Expected: `testChargeFailsClosedOnPending` FAILS. Revert.
3. In `validatePriceConfig`, change `cfg.sigNetworkFA /= expectedSigNetworkFA` to `False` (always pass) → Expected: `test_validate_wrong_admin` FAILS. Revert. (`testChargeRejectsForeignPriceConfig` still passes under this mutation — the foreign config's `fetch` is already unauthorized at the ledger level, which is the deeper guarantee; the pure test is what pins the validate branch.)

Run after reverting: `dpm build --all && (cd daml-packages/signet-fee-amulet-tests && dpm test)` → PASS.

- [ ] **Step 7: Commit**

```bash
git add daml-packages/signet-fee-amulet daml-packages/signet-fee-amulet-tests
git commit -m "feat: add CcFeeCollector late-bound charge implementation"
```

---

### Task 4: Split test modules out of the shipped DARs (pure move, no behavior change)

**Files:**

- Create: `daml-packages/daml-signer-tests/daml.yaml`, `daml-packages/daml-vault-tests/daml.yaml`
- Move (git mv): `daml-packages/daml-signer/daml/{TestFixtures,TestSigner,TestSignerFee,TestToken}.daml` → `daml-packages/daml-signer-tests/daml/`
- Move (git mv): `daml-packages/daml-vault/daml/{TestVault,TestVaultProposal,TestRequestId}.daml` → `daml-packages/daml-vault-tests/daml/`
- Modify: `multi-package.yaml`, `package.json` (root), `.github/workflows/ci.yml`, `CLAUDE.md`, `README.md`

After this task the shipped `daml-signer` / `daml-vault-poc` DARs contain no test
modules or mocks. File contents are moved VERBATIM — all imports still resolve
because the test packages data-depend on the DARs that export those modules.

- [ ] **Step 1: Move the files**

```bash
cd /Users/felipesousapessina/Documents/signet/currently-working/canton
mkdir -p daml-packages/daml-signer-tests/daml daml-packages/daml-vault-tests/daml
git mv daml-packages/daml-signer/daml/TestFixtures.daml daml-packages/daml-signer-tests/daml/
git mv daml-packages/daml-signer/daml/TestSigner.daml daml-packages/daml-signer-tests/daml/
git mv daml-packages/daml-signer/daml/TestSignerFee.daml daml-packages/daml-signer-tests/daml/
git mv daml-packages/daml-signer/daml/TestToken.daml daml-packages/daml-signer-tests/daml/
git mv daml-packages/daml-vault/daml/TestVault.daml daml-packages/daml-vault-tests/daml/
git mv daml-packages/daml-vault/daml/TestVaultProposal.daml daml-packages/daml-vault-tests/daml/
git mv daml-packages/daml-vault/daml/TestRequestId.daml daml-packages/daml-vault-tests/daml/
```

(Note: `git mv` works on modified-but-uncommitted files; the moved file keeps its
working-tree content.)

- [ ] **Step 2: Create `daml-packages/daml-signer-tests/daml.yaml`**

```yaml
sdk-version: 3.4.11
name: daml-signer-tests
version: 0.0.1
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
  - daml-script
data-dependencies:
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
  - ../vendor/splice-api-token-transfer-instruction-v1-1.0.0.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

- [ ] **Step 3: Create `daml-packages/daml-vault-tests/daml.yaml`**

```yaml
sdk-version: 3.4.11
name: daml-vault-tests
version: 0.0.1
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
  - daml-script
data-dependencies:
  - ../daml-vault/.daml/dist/daml-vault-poc-0.0.1.dar
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../daml-signer-tests/.daml/dist/daml-signer-tests-0.0.1.dar
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
  - ../vendor/splice-api-token-transfer-instruction-v1-1.0.0.dar
build-options:
  - -Wno-crypto-text-is-alpha
```

(`daml-vault-tests` data-depends on `daml-signer-tests` exactly as `daml-vault`'s
tests already import `TestFixtures`/`TestToken` cross-package today — the
relationship just becomes explicit.)

- [ ] **Step 4: Update `multi-package.yaml`** (replace whole file)

```yaml
packages:
  - daml-packages/daml-abi
  - daml-packages/daml-uint256
  - daml-packages/daml-eip712
  - daml-packages/signet-api-fee-v1
  - daml-packages/signet-fee-amulet
  - daml-packages/signet-fee-amulet-tests
  - daml-packages/daml-signer
  - daml-packages/daml-signer-tests
  - daml-packages/daml-vault
  - daml-packages/daml-vault-tests
```

- [ ] **Step 5: Update the root `package.json` `daml:test` script**

Replace:

```json
    "daml:test": "for pkg in daml-packages/*/; do (cd \"$pkg\" && dpm test) || exit 1; done",
```

with (test packages only — shipped packages no longer contain Script entry points):

```json
    "daml:test": "for pkg in daml-abi daml-uint256 daml-eip712 signet-fee-amulet-tests daml-signer-tests daml-vault-tests; do (cd \"daml-packages/$pkg\" && dpm test) || exit 1; done",
```

- [ ] **Step 6: Update `.github/workflows/ci.yml`**

Replace the loop inside the "Build DAR, run Daml tests & generate codegen" step:

```yaml
for pkg in daml-abi daml-uint256 daml-eip712 daml-signer daml-vault; do
```

with:

```yaml
for pkg in daml-abi daml-uint256 daml-eip712 signet-fee-amulet-tests daml-signer-tests daml-vault-tests; do
```

- [ ] **Step 7: Update the Daml-test package list in `CLAUDE.md` and `README.md`**

In `CLAUDE.md` (repo root) and `README.md` ("Daml Unit Tests" section), replace:

```bash
for pkg in daml-abi daml-uint256 daml-eip712 daml-signer daml-vault; do
```

with:

```bash
for pkg in daml-abi daml-uint256 daml-eip712 signet-fee-amulet-tests daml-signer-tests daml-vault-tests; do
```

- [ ] **Step 8: Build + run all Daml tests**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all && pnpm daml:test`
Expected: PASS — identical test set as before the move (plus the Task 2/3 suites).

- [ ] **Step 9: Commit**

```bash
git add multi-package.yaml package.json .github/workflows/ci.yml CLAUDE.md README.md \
  daml-packages/daml-signer-tests daml-packages/daml-vault-tests \
  daml-packages/daml-signer/daml daml-packages/daml-vault/daml
git commit -m "refactor: split Daml test modules into test-only packages"
```

---

### Task 5: Rewire `daml-signer` + `daml-vault` (+ their test packages) to the FeeCollector architecture

This is one atomic task: the choice-argument change ripples signer → vault →
both test packages, and intermediate states do not build. Work through the steps
in order; build/test/commit once at the end.

**Files:**

- Modify: `daml-packages/daml-signer/daml/Signer.daml`
- Delete (git rm): `daml-packages/daml-signer/daml/SignerFee.daml`
- Modify: `daml-packages/daml-signer/daml.yaml`
- Delete (git rm): `daml-packages/daml-signer-tests/daml/TestSignerFee.daml`, `daml-packages/daml-signer-tests/daml/TestToken.daml`
- Create: `daml-packages/daml-signer-tests/daml/TestFeeCollector.daml`
- Modify: `daml-packages/daml-signer-tests/daml/TestSigner.daml`, `daml-packages/daml-signer-tests/daml.yaml`
- Modify: `daml-packages/daml-vault/daml/Erc20Vault.daml`, `daml-packages/daml-vault/daml.yaml`
- Modify: `daml-packages/daml-vault-tests/daml/TestVault.daml`, `daml-packages/daml-vault-tests/daml/TestVaultProposal.daml`, `daml-packages/daml-vault-tests/daml.yaml`

- [ ] **Step 1: Rewrite `Signer.daml`'s fee surface**

1a. Imports — delete these three lines:

```daml
import DA.Time (hours, addRelTime)
```

```daml
import SignerFee (SignerFeeConfig, ReadFeeConfig(..), validateFeeConfig)
```

and the whole splice import block:

```daml
import Splice.Api.Token.HoldingV1 (Holding, InstrumentId(..))
import Splice.Api.Token.MetadataV1 (ExtraArgs(..), ChoiceContext, emptyMetadata)
import Splice.Api.Token.TransferInstructionV1
  ( TransferFactory, TransferFactory_Transfer(..), Transfer(..)
  , TransferInstructionResult_Output(..)
  )
```

Replace the splice block with:

```daml
import Splice.Api.Token.HoldingV1 (Holding)
import Splice.Api.Token.MetadataV1 (ExtraArgs)
import Signet.Api.Fee.V1 (FeeCollectorRegistration, FeeCollector_Charge(..))
```

1b. In `RequestSignature`'s `with` block, replace the four fee args:

```daml
        -- CC signature-fee inputs, threaded through as command-level disclosed
        -- contracts; the charge fail-closes unless it settles one-step.
        feeConfigCid                : ContractId SignerFeeConfig
        transferFactoryCid          : ContractId TransferFactory
        inputHoldingCids            : [ContractId Holding]
        transferContext             : ChoiceContext
```

with the three new ones (frozen-forever shape, spec §9 — opaque by design):

```daml
        -- CC signature-fee inputs, threaded through as command-level disclosed
        -- contracts (FA fee endpoint + token registry). The late-bound
        -- FeeCollector_Charge fail-closes the whole request unless the fee
        -- settles. These three args are designed to never change again:
        -- everything fee-specific travels opaquely inside feeExtraArgs.
        feeRegistrationCid          : ContractId FeeCollectorRegistration
        feeInputs                   : [ContractId Holding]
        feeExtraArgs                : ExtraArgs
```

1c. In the choice body, replace the whole fee block — everything from
`-- Charge the CC fee first: requester → feeReceiver, settled one-step via the`
down to (and including)
`          TransferInstructionResult_Failed -> abort "Fee transfer failed"`
— with:

```daml
        -- Charge the CC fee first via the registered FeeCollector. The
        -- FA-signed registration is the trust anchor: a requester cannot forge
        -- one, so a hostile collector implementation cannot be substituted
        -- (the view is never trusted). The interface exercise is LATE-BOUND:
        -- fee-logic upgrades ship in the impl package (signet-fee-amulet) with
        -- zero rebuilds of this package, consumers, or clients.
        registration <- fetch feeRegistrationCid   -- plain fetch: sigNetworkFA is ambient via the co-signed Signer
        assertMsg "Fee registration belongs to a different sigNetworkFA"
          (registration.sigNetworkFA == sigNetworkFA)
        _ <- exercise registration.collector FeeCollector_Charge with
          payer = requester; inputs = feeInputs; extraArgs = feeExtraArgs
        -- aborts inside Charge propagate: no fee settled -> no event (fail-closed)
```

(The deleted block includes the `now <- getTime` line — `now` was only used by
the fee transfer. Verify no remaining use of `now`, `SignerFeeConfig`,
`TransferFactory`, `ChoiceContext`, `emptyMetadata`, `InstrumentId`, `hours`,
`addRelTime` in the file.)

- [ ] **Step 2: Delete the old fee module and update `daml-signer/daml.yaml`**

```bash
git rm daml-packages/daml-signer/daml/SignerFee.daml
```

In `daml-packages/daml-signer/daml.yaml`, replace the `data-dependencies` block with:

```yaml
data-dependencies:
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
```

(The transfer-instruction dependency moves to `signet-fee-amulet` — `daml-signer`
no longer knows the token standard exists.)

- [ ] **Step 3: Verify the signer package builds in isolation**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/daml-packages/daml-signer && dpm build`
Expected: success. (`dpm build --all` still fails — vault not rewired yet.)

- [ ] **Step 4: Create `daml-packages/daml-signer-tests/daml/TestFeeCollector.daml`**

```daml
module TestFeeCollector where

-- Test-only FeeCollector implementation for the daml-signer + daml-vault
-- suites: the Signer only needs "a registered collector whose Charge succeeds
-- or aborts" — the real CC settlement logic is tested in
-- signet-fee-amulet-tests against CcFeeCollector.

import Splice.Api.Token.MetadataV1 (ExtraArgs(..), emptyChoiceContext, emptyMetadata)
import Signet.Api.Fee.V1

-- | Empty fee extras for tests: MockFeeCollector reads nothing from context.
noFeeExtras : ExtraArgs
noFeeExtras = ExtraArgs with context = emptyChoiceContext; meta = emptyMetadata

template MockFeeCollector
  with
    sigNetworkFA   : Party
    chargeSucceeds : Bool     -- False simulates any failed charge (fail-closed path)
    chargedAmount  : Decimal  -- echoed in the result on success
  where
    signatory sigNetworkFA

    interface instance FeeCollector for MockFeeCollector where
      view = FeeCollectorView with sigNetworkFA; feeReceiver = sigNetworkFA; meta = emptyMetadata
      feeCollector_chargeImpl _self _arg =
        if chargeSucceeds
          then pure FeeCollector_ChargeResult with amountCharged = chargedAmount; meta = emptyMetadata
          else abort "MockFeeCollector: charge rejected"
```

- [ ] **Step 5: Delete superseded signer-test modules; update `daml-signer-tests/daml.yaml`**

```bash
git rm daml-packages/daml-signer-tests/daml/TestSignerFee.daml \
       daml-packages/daml-signer-tests/daml/TestToken.daml
```

(`TestSignerFee` is superseded by `TestFeePriceConfig` in `signet-fee-amulet-tests`
(Task 2); `TestToken` now lives in `signet-fee-amulet-tests` (Task 3).)

Replace `daml-signer-tests/daml.yaml`'s `data-dependencies` with:

```yaml
data-dependencies:
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
```

(No holding/transfer-instruction DARs: nothing in this package imports those
modules anymore — compile-time proof of `daml-signer`'s dependency diet.)

- [ ] **Step 6: Rewire `daml-signer-tests/daml/TestSigner.daml`**

6a. Imports — delete:

```daml
import DA.Time (time)
import DA.Date (date, Month(..))
import SignerFee (SignerFeeConfig(..))
import TestToken (MockTransferFactory(..))
import Splice.Api.Token.MetadataV1 (emptyChoiceContext)
import Splice.Api.Token.TransferInstructionV1 (TransferFactory)
```

and add:

```daml
import Splice.Api.Token.MetadataV1 (emptyMetadata)
import Signet.Api.Fee.V1 (FeeCollector, FeeCollectorRegistration(..))
import TestFeeCollector (MockFeeCollector(..), noFeeExtras)
```

6b. Replace the `mkFeeInfra`, `feeDisclosures`, and `feeInfraAndDisclosures`
helpers (the block from the comment `-- Create the fee inputs RequestSignature needs:`
through the end of `feeInfraAndDisclosures`) with:

```daml
-- Fee infra RequestSignature needs: a sigNetworkFA-signed MockFeeCollector and
-- the FeeCollectorRegistration trust anchor binding it. Fee admin = the
-- featured-app party, NOT the MPC's sigNetwork. chargeSucceeds toggles the
-- happy vs fail-closed branch.
mkFeeInfra : Party -> Bool -> Script (ContractId MockFeeCollector, ContractId FeeCollectorRegistration)
mkFeeInfra sigNetworkFA chargeSucceeds = do
  collectorCid <- submit sigNetworkFA do
    createCmd MockFeeCollector with sigNetworkFA; chargeSucceeds; chargedAmount = 1.0
  registrationCid <- submit sigNetworkFA do
    createCmd FeeCollectorRegistration with
      sigNetworkFA
      collector = toInterfaceContractId @FeeCollector collectorCid
      meta = emptyMetadata
  pure (collectorCid, registrationCid)

-- Explicit disclosures for the co-signed Signer + collector + registration,
-- exactly as a requester is handed them in production (the Signer envelope +
-- the FA fee endpoint). Without these, RequestSignature's nested fetch/exercise
-- of FA-only contracts is unauthorized (operators + requester are not
-- stakeholders). sigNetworkFA co-signs the Signer and signs the other two, so
-- it can produce all three disclosures.
feeDisclosures
  :  Party -> ContractId Signer -> ContractId MockFeeCollector -> ContractId FeeCollectorRegistration
  -> Script [Disclosure]
feeDisclosures owner signerCid collectorCid registrationCid = do
  dSigner <- fromSome <$> queryDisclosure owner signerCid
  dCollector <- fromSome <$> queryDisclosure owner collectorCid
  dRegistration <- fromSome <$> queryDisclosure owner registrationCid
  pure [dSigner, dCollector, dRegistration]

-- Build the fee infra + disclosures pair that nearly every RequestSignature exercise needs.
feeInfraAndDisclosures
  :  Party -> ContractId Signer
  -> Script (ContractId FeeCollectorRegistration, [Disclosure])
feeInfraAndDisclosures sigNetworkFA signerCid = do
  (collectorCid, registrationCid) <- mkFeeInfra sigNetworkFA True
  ds <- feeDisclosures sigNetworkFA signerCid collectorCid registrationCid
  pure (registrationCid, ds)
```

6c. Mechanical replace-all across the file (these exact strings recur at every
call site):

| old (replace_all)                                                                                                                                                     | new                                                                           |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `  (feeConfigCid, factoryCid, ds) <- feeInfraAndDisclosures sigNetworkFA signerCid`                                                                                   | `  (feeRegistrationCid, ds) <- feeInfraAndDisclosures sigNetworkFA signerCid` |
| `      feeConfigCid\n      transferFactoryCid = toInterfaceContractId @TransferFactory factoryCid\n      inputHoldingCids = []; transferContext = emptyChoiceContext` | `      feeRegistrationCid\n      feeInputs = []; feeExtraArgs = noFeeExtras`  |

(In `mkSignEvent` the binder is indented differently — fix it the same way; in
`testSenderIsOperatorsHash`'s `mkEvt`, the binder line is
`        (feeConfigCid, factoryCid, ds) <- feeInfraAndDisclosures sigNetworkFA signerCid`
(8 spaces) and the arg lines are indented 12 spaces — apply the same renames there.)

6d. Replace the three fee tests at the bottom (`testRequestSignatureChargesFee`,
`testRequestSignatureFailsClosedWithoutPreapproval`,
`testRequestSignatureRejectsForeignFeeConfig`) — the whole section from
`-- CC signature fee (SignerFeeConfig + RequestSignature charge)` to the end of
`testRequestSignatureRejectsForeignFeeConfig` — with:

```daml
------------------------------------------------------------------------
-- CC signature fee (FeeCollectorRegistration + late-bound Charge)
------------------------------------------------------------------------

-- RequestSignature charges the fee and creates the event when Charge succeeds.
testRequestSignatureChargesFee : Script ()
testRequestSignatureChargesFee = do
  (_sigNetwork, sigNetworkFA, operator, requester, signerCid) <- setup
  (feeRegistrationCid, ds) <- feeInfraAndDisclosures sigNetworkFA signerCid

  evtCid <- submit (actAs operator <> actAs requester <> discloseMany ds) do
    exerciseCmd signerCid RequestSignature with
      operators = [operator]; requester
      txParams = EvmType2TxParams sampleEvmType2Params
      caip2Id = "eip155:11155111"; keyVersion = 1; path = "test-path"
      algo = "ECDSA"; dest = "ethereum"; params = ""
      outputDeserializationSchema = erc20BoolSchema
      respondSerializationSchema = erc20BoolSchema
      feeRegistrationCid
      feeInputs = []; feeExtraArgs = noFeeExtras

  Some _ <- queryContractId requester evtCid
  pure ()

-- Fail-closed: when Charge aborts (e.g. the transfer cannot settle one-step),
-- RequestSignature aborts and no SignBidirectionalEvent is created.
testRequestSignatureFailsClosedWhenChargeAborts : Script ()
testRequestSignatureFailsClosedWhenChargeAborts = do
  (_sigNetwork, sigNetworkFA, operator, requester, signerCid) <- setup
  (collectorCid, feeRegistrationCid) <- mkFeeInfra sigNetworkFA False
  ds <- feeDisclosures sigNetworkFA signerCid collectorCid feeRegistrationCid

  submitMustFail (actAs operator <> actAs requester <> discloseMany ds) do
    exerciseCmd signerCid RequestSignature with
      operators = [operator]; requester
      txParams = EvmType2TxParams sampleEvmType2Params
      caip2Id = "eip155:11155111"; keyVersion = 1; path = "test-path"
      algo = "ECDSA"; dest = "ethereum"; params = ""
      outputDeserializationSchema = erc20BoolSchema
      respondSerializationSchema = erc20BoolSchema
      feeRegistrationCid
      feeInputs = []; feeExtraArgs = noFeeExtras

-- A registration signed by a different featured-app party is rejected: the
-- Signer binds the fee layer to ITS OWN sigNetworkFA.
testRequestSignatureRejectsForeignFeeRegistration : Script ()
testRequestSignatureRejectsForeignFeeRegistration = do
  (sigNetwork, _sigNetworkFA, operator, requester, signerCid) <- setup
  other <- allocateParty "OtherSigNetworkFA"
  (collectorCid, feeRegistrationCid) <- mkFeeInfra other True
  dSigner <- fromSome <$> queryDisclosure sigNetwork signerCid
  dCollector <- fromSome <$> queryDisclosure other collectorCid
  dRegistration <- fromSome <$> queryDisclosure other feeRegistrationCid

  submitMustFail (actAs operator <> actAs requester <> discloseMany [dSigner, dCollector, dRegistration]) do
    exerciseCmd signerCid RequestSignature with
      operators = [operator]; requester
      txParams = EvmType2TxParams sampleEvmType2Params
      caip2Id = "eip155:11155111"; keyVersion = 1; path = "test-path"
      algo = "ECDSA"; dest = "ethereum"; params = ""
      outputDeserializationSchema = erc20BoolSchema
      respondSerializationSchema = erc20BoolSchema
      feeRegistrationCid
      feeInputs = []; feeExtraArgs = noFeeExtras

-- The trust anchor itself cannot be forged: a requester cannot create a
-- FeeCollectorRegistration naming sigNetworkFA (missing its signature), so a
-- hostile collector can never be bound.
testRequesterCannotForgeFeeRegistration : Script ()
testRequesterCannotForgeFeeRegistration = do
  (_sigNetwork, sigNetworkFA, _operator, requester, _signerCid) <- setup
  rogueCollector <- submit requester do
    createCmd MockFeeCollector with sigNetworkFA = requester; chargeSucceeds = True; chargedAmount = 0.0
  submitMustFail requester do
    createCmd FeeCollectorRegistration with
      sigNetworkFA
      collector = toInterfaceContractId @FeeCollector rogueCollector
      meta = emptyMetadata
```

- [ ] **Step 7: Build + test the signer test package**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/daml-packages/daml-signer-tests && dpm build && dpm test`
Expected: PASS — all TestSigner scripts green (vault still pending).

- [ ] **Step 8: Rewire `daml-packages/daml-vault/daml/Erc20Vault.daml`**

8a. Imports — delete:

```daml
import SignerFee (SignerFeeConfig)
```

```daml
import Splice.Api.Token.TransferInstructionV1 (TransferFactory)
```

change:

```daml
import Splice.Api.Token.MetadataV1 (ChoiceContext)
```

to:

```daml
import Splice.Api.Token.MetadataV1 (ExtraArgs)
```

and add:

```daml
import Signet.Api.Fee.V1 (FeeCollectorRegistration)
```

8b. In **both** `RequestDeposit` and `RequestWithdrawal`, replace the fee-arg
block (comment + four args):

```daml
        -- CC signature fee inputs (proposals/cc-signature-fee.md §5): the requester
        -- pays the featured-app fee atomically inside Signer.RequestSignature. Sourced
        -- client-side as disclosed contracts (fee-disclosure endpoint + token registry);
        -- the charge fail-closes unless the transfer settles one-step.
        feeConfigCid       : ContractId SignerFeeConfig
        transferFactoryCid : ContractId TransferFactory
        inputHoldingCids   : [ContractId Holding]
        transferContext    : ChoiceContext
```

with (use replace_all — the block is identical in both choices):

```daml
        -- CC signature-fee inputs (docs/superpowers/specs/
        -- 2026-06-10-signer-fee-architecture-design.md §5.4): the requester pays
        -- the featured-app fee atomically inside Signer.RequestSignature via the
        -- registered late-bound FeeCollector. Sourced client-side as disclosed
        -- contracts (FA fee endpoint + token registry); the charge fail-closes
        -- the whole request unless it settles. Opaque by design — these three
        -- args are expected to never change again for fee reasons.
        feeRegistrationCid : ContractId FeeCollectorRegistration
        feeInputs          : [ContractId Holding]
        feeExtraArgs       : ExtraArgs
```

8c. Replace the forwarding line in both choices (replace_all):

```daml
          feeConfigCid; transferFactoryCid; inputHoldingCids; transferContext
```

with:

```daml
          feeRegistrationCid; feeInputs; feeExtraArgs
```

8d. Update `daml-packages/daml-vault/daml.yaml` `data-dependencies` to:

```yaml
data-dependencies:
  - ../daml-abi/.daml/dist/daml-abi-0.0.1.dar
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
  - ../vendor/splice-api-token-holding-v1-1.0.0.dar
```

8e. Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/daml-packages/daml-vault && dpm build`
Expected: success.

- [ ] **Step 9: Rewire `daml-vault-tests`**

9a. `daml-packages/daml-vault-tests/daml.yaml` `data-dependencies` → :

```yaml
data-dependencies:
  - ../daml-vault/.daml/dist/daml-vault-poc-0.0.1.dar
  - ../daml-signer/.daml/dist/daml-signer-0.0.1.dar
  - ../daml-signer-tests/.daml/dist/daml-signer-tests-0.0.1.dar
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
  - ../signet-api-fee-v1/.daml/dist/signet-api-fee-v1-1.0.0.dar
  - ../vendor/splice-api-token-metadata-v1-1.0.0.dar
```

9b. `TestVault.daml` imports — delete:

```daml
import SignerFee (SignerFeeConfig(..))
import TestToken (MockTransferFactory(..))
import Splice.Api.Token.MetadataV1 (emptyChoiceContext)
import Splice.Api.Token.TransferInstructionV1 (TransferFactory)
import DA.Time (time)
import DA.Date (date, Month(..))
```

add:

```daml
import Splice.Api.Token.MetadataV1 (emptyMetadata)
import Signet.Api.Fee.V1 (FeeCollector, FeeCollectorRegistration(..))
import TestFeeCollector (MockFeeCollector(..), noFeeExtras)
```

9c. Replace the `mkVaultFeeInfra` helper (comment block + function) with:

```daml
-- Fee infra for the RequestDeposit/RequestWithdrawal charge: a sigNetworkFA-
-- signed MockFeeCollector + the FeeCollectorRegistration binding it (fee admin
-- = the featured-app party). The charge always succeeds here — fail-closed
-- behaviour is covered by the daml-signer suite. Submissions add
-- `readAs sigNetworkFA` so the FA-signed registration + collector are visible
-- (production clients attach them as disclosures instead).
mkVaultFeeInfra : Party -> Script (ContractId FeeCollectorRegistration)
mkVaultFeeInfra sigNetworkFA = do
  collectorCid <- submit sigNetworkFA do
    createCmd MockFeeCollector with sigNetworkFA; chargeSucceeds = True; chargedAmount = 1.0
  submit sigNetworkFA do
    createCmd FeeCollectorRegistration with
      sigNetworkFA
      collector = toInterfaceContractId @FeeCollector collectorCid
      meta = emptyMetadata
```

9d. Mechanical replace-all across `TestVault.daml`:

| old (replace_all)                                                                                     | new                                                                               |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `  (feeConfigCid, transferFactoryCid) <- mkVaultFeeInfra sigNetwork sigNetworkFA`                     | `  feeRegistrationCid <- mkVaultFeeInfra sigNetworkFA`                            |
| `      feeConfigCid; transferFactoryCid; inputHoldingCids = []; transferContext = emptyChoiceContext` | `      feeRegistrationCid; feeInputs = []; feeExtraArgs = noFeeExtras`            |
| `actAs requester <> readAs operator <> readAs sigNetwork)`                                            | `actAs requester <> readAs operator <> readAs sigNetwork <> readAs sigNetworkFA)` |

The third replacement (24 sites) also touches Claim/Complete submissions — the
extra read authority is harmless there. After replacing, compile; any test the
compiler flags with "sigNetworkFA not in scope" needs `sigNetworkFA` added to
its `VaultEnv{...}` destructuring pattern (purely mechanical).

9e. `TestVaultProposal.daml` — at its single fee site (Step 4 of
`testVaultProposalLifecycle`): apply the same binder/arg replacement:

```daml
  (feeConfigCid, transferFactoryCid) <- mkVaultFeeInfra sigNetwork sigNetworkFA
```

→

```daml
  feeRegistrationCid <- mkVaultFeeInfra sigNetworkFA
```

```daml
      feeConfigCid; transferFactoryCid; inputHoldingCids = []; transferContext = emptyChoiceContext
```

→

```daml
      feeRegistrationCid; feeInputs = []; feeExtraArgs = noFeeExtras
```

and extend its submit authority:

```daml
  (signEventCid, pendingCid) <- submit (actAs requester <> readAs op1 <> readAs op2 <> readAs sigNetwork) do
```

→

```daml
  (signEventCid, pendingCid) <- submit (actAs requester <> readAs op1 <> readAs op2 <> readAs sigNetwork <> readAs sigNetworkFA) do
```

Update its imports the same way as 9b (it imports `emptyChoiceContext` today;
swap for `import TestFeeCollector (noFeeExtras)`; ensure `sigNetworkFA` is bound
in that test's setup — it allocates parties directly).

- [ ] **Step 10: Full build + all Daml tests**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && dpm build --all && pnpm daml:test`
Expected: PASS — all six test packages green.

- [ ] **Step 11: Mutation checks on the Signer (revert each after observing)**

1. In `Signer.daml`, comment out the `_ <- exercise registration.collector FeeCollector_Charge with …` lines (and the `payer = requester; …` continuation) → rebuild + `(cd daml-packages/daml-signer-tests && dpm test)`. Expected: `testRequestSignatureFailsClosedWhenChargeAborts` FAILS (the submit now succeeds). Revert.
2. Flip the registration assert to `(registration.sigNetworkFA /= sigNetworkFA)` → Expected: `testRequestSignatureRejectsForeignFeeRegistration` AND the happy-path tests FAIL. Revert.

Run after reverting: `dpm build --all && pnpm daml:test` → PASS.

- [ ] **Step 12: Commit**

```bash
git add daml-packages/daml-signer daml-packages/daml-signer-tests \
  daml-packages/daml-vault daml-packages/daml-vault-tests
git commit -m "feat: charge Signer fee via late-bound FeeCollector interface"
```

---

### Task 6: Codegen wiring for the new packages

**Files:**

- Modify: `package.json` (root, `codegen:daml`)
- Modify: `.github/workflows/ci.yml` (codegen line)
- Modify: `ts-packages/canton-sig/package.json` (devDependencies)

- [ ] **Step 1: Extend root `codegen:daml`**

The impl package is NOT a dependency of the vault DAR, so it needs its own
codegen invocation. Replace the `codegen:daml` script value with:

```json
    "codegen:daml": "dpm codegen-js daml-packages/daml-signer/.daml/dist/daml-signer-0.0.1.dar -o ts-packages/canton-sig/generated/model -s daml.js && dpm codegen-js daml-packages/daml-vault/.daml/dist/daml-vault-poc-0.0.1.dar -o ts-packages/canton-sig/generated/model -s daml.js && dpm codegen-js daml-packages/signet-fee-amulet/.daml/dist/signet-fee-amulet-0.0.1.dar -o ts-packages/canton-sig/generated/model -s daml.js",
```

- [ ] **Step 2: Mirror it in `.github/workflows/ci.yml`**

After the existing line

```yaml
dpm codegen-js daml-packages/daml-vault/.daml/dist/daml-vault-poc-0.0.1.dar -o ts-packages/canton-sig/generated/model -s daml.js
```

add:

```yaml
dpm codegen-js daml-packages/signet-fee-amulet/.daml/dist/signet-fee-amulet-0.0.1.dar -o ts-packages/canton-sig/generated/model -s daml.js
```

- [ ] **Step 3: Add the generated packages to `ts-packages/canton-sig/package.json` devDependencies**

```json
    "@daml.js/signet-api-fee-v1-1.0.0": "file:./generated/model/signet-api-fee-v1-1.0.0",
    "@daml.js/signet-fee-amulet-0.0.1": "file:./generated/model/signet-fee-amulet-0.0.1",
```

(insert alphabetically next to the existing `@daml.js/*` entries).

- [ ] **Step 4: Regenerate + install**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton && pnpm codegen:daml && ls ts-packages/canton-sig/generated/model | grep signet && pnpm install --config.confirm-modules-purge=false`
Expected: `signet-api-fee-v1-1.0.0` and `signet-fee-amulet-0.0.1` directories exist; install succeeds.

- [ ] **Step 5: Commit**

```bash
git add package.json .github/workflows/ci.yml ts-packages/canton-sig/package.json pnpm-lock.yaml
git commit -m "chore: codegen TS bindings for the fee packages"
```

---

### Task 7: Rework `canton-sig` `fee.ts` to the collector architecture (TDD)

**Files:**

- Modify: `ts-packages/canton-sig/src/fee.ts`
- Modify: `ts-packages/canton-sig/test/fee.test.ts`
- Modify: `ts-packages/canton-sig/src/index.ts` (fee export block)

API delta in `fee.ts` (everything else — `selectInputHoldings`,
`holdingInputsFromEvents`, `getTransferFactoryForFee`, the constants — stays as
is):

| old                                                                                     | new                                                                                                                              |
| --------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `parseFeeConfig` (SignerFeeConfig)                                                      | `parsePriceConfig` (FeePriceConfig)                                                                                              |
| `isFeeConfigInWindow`                                                                   | `isPriceConfigInWindow`                                                                                                          |
| `getCurrentFeeDisclosure` / `CurrentFeeDisclosure`                                      | `getFeeCollectorContext` / `FeeCollectorContext`                                                                                 |
| `FeeChoiceArgs { feeConfigCid, transferFactoryCid, inputHoldingCids, transferContext }` | `FeeChoiceArgs { feeRegistrationCid, feeInputs, feeExtraArgs }`                                                                  |
| `assembleFeeChoiceArgs(fee, factory, selection)`                                        | `assembleFeeChoiceArgs(collector, factory, selection)` — merges contexts + stamps the factory ref key                            |
| `collectFeeDisclosures(fee, factory, extra)`                                            | `collectFeeDisclosures(collector, factory, extra)`                                                                               |
| —                                                                                       | new constants `PRICE_CONFIG_CONTEXT_KEY`, `TRANSFER_FACTORY_CONTEXT_KEY`, `FEE_COLLECTOR_ENDPOINT_PATH`; new type `FeeExtraArgs` |

- [ ] **Step 1: Update the tests first — `ts-packages/canton-sig/test/fee.test.ts`**

Keep the `selectInputHoldings`, `holdingInputsFromEvents`, and
`getTransferFactoryForFee` describe blocks unchanged. Replace the
`parseFeeConfig`/`isFeeConfigInWindow` blocks, the `getCurrentFeeDisclosure`
block, and the `assembleFeeChoiceArgs + collectFeeDisclosures` block with the
following (adjust imports at the top of the file accordingly):

```ts
import {
  selectInputHoldings,
  holdingInputsFromEvents,
  parsePriceConfig,
  isPriceConfigInWindow,
  getFeeCollectorContext,
  getTransferFactoryForFee,
  assembleFeeChoiceArgs,
  collectFeeDisclosures,
  MAX_TRANSFER_INPUTS,
  PRICE_CONFIG_CONTEXT_KEY,
  TRANSFER_FACTORY_CONTEXT_KEY,
  FEE_COLLECTOR_ENDPOINT_PATH,
} from "canton-sig";
import type {
  CreatedEvent,
  DisclosedContract,
  FeeCollectorContext,
  ResolvedTransferFactory,
} from "canton-sig";
```

Shared fixtures (replace the old `feeConfigPayload` helpers):

```ts
const FA = "sigNetworkFA::fa";
const NOW = Date.parse("2026-06-10T12:00:00Z");

/** A FeePriceConfig payload (Daml Decimal/Int/Time fields travel as JSON strings). */
function priceConfigPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sigNetworkFA: FA,
    feeReceiver: FA,
    instrumentAdmin: "dso::admin",
    instrumentId: "Amulet",
    feeAmount: "1.5",
    validFrom: "2026-06-10T00:00:00Z",
    validUntil: "2026-06-11T00:00:00Z",
    version: "0",
    meta: { values: {} },
    ...overrides,
  };
}

function priceConfigEvent(
  contractId: string,
  overrides: Record<string, unknown> = {},
): CreatedEvent {
  return {
    contractId,
    templateId: "#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig",
    createArgument: priceConfigPayload(overrides),
  } as CreatedEvent;
}

function registrationEvent(contractId: string, collector: string): CreatedEvent {
  return {
    contractId,
    templateId: "#signet-api-fee-v1:Signet.Api.Fee.V1:FeeCollectorRegistration",
    createArgument: { sigNetworkFA: FA, collector, meta: { values: {} } },
  } as CreatedEvent;
}

function disclosure(contractId: string): DisclosedContract {
  return {
    contractId,
    templateId: "stub",
    createdEventBlob: `blob-${contractId}`,
    synchronizerId: "sync::1",
  } as DisclosedContract;
}
```

New describe blocks:

```ts
describe("fee endpoint contract", () => {
  it("pins the collector endpoint path and context keys", () => {
    expect(FEE_COLLECTOR_ENDPOINT_PATH).toBe("/fee/v1/collector");
    expect(PRICE_CONFIG_CONTEXT_KEY).toBe("signet.network/fee/price-config");
    expect(TRANSFER_FACTORY_CONTEXT_KEY).toBe("signet.network/fee/transfer-factory");
  });
});

describe("parsePriceConfig", () => {
  it("decodes a well-formed FeePriceConfig payload", () => {
    const cfg = parsePriceConfig(priceConfigPayload());
    expect(cfg.feeAmount).toBe("1.5");
    expect(cfg.sigNetworkFA).toBe(FA);
    expect(cfg.version).toBe("0");
  });

  it("throws on a malformed payload", () => {
    expect(() => parsePriceConfig({ nope: true })).toThrow();
  });
});

describe("isPriceConfigInWindow", () => {
  it("is true inside the window and false outside", () => {
    const cfg = parsePriceConfig(priceConfigPayload());
    expect(isPriceConfigInWindow(cfg, NOW)).toBe(true);
    expect(isPriceConfigInWindow(cfg, Date.parse("2026-06-12T00:00:00Z"))).toBe(false);
    expect(isPriceConfigInWindow(cfg, Date.parse("2026-06-09T00:00:00Z"))).toBe(false);
  });
});

describe("getFeeCollectorContext", () => {
  function mkReader(registrations: CreatedEvent[], priceConfigs: CreatedEvent[]) {
    return {
      getActiveContracts: async (_parties: string[], templateId: string) =>
        templateId.includes("FeeCollectorRegistration") ? registrations : priceConfigs,
      getDisclosedContract: async (_parties: string[], _templateId: string, contractId: string) =>
        disclosure(contractId),
    };
  }

  it("returns registration, collector, price config and the context key", async () => {
    const reader = mkReader([registrationEvent("reg::1", "coll::1")], [priceConfigEvent("cfg::1")]);
    const r = await getFeeCollectorContext(reader, FA, {
      nowMs: NOW,
      collectorTemplateId: "#signet-fee-amulet:Signet.Fee.Amulet:CcFeeCollector",
    });
    expect(r.registrationCid).toBe("reg::1");
    expect(r.collectorCid).toBe("coll::1");
    expect(r.priceConfigCid).toBe("cfg::1");
    expect(r.priceConfig.feeAmount).toBe("1.5");
    expect(r.choiceContextData.values[PRICE_CONFIG_CONTEXT_KEY]).toEqual({
      tag: "AV_ContractId",
      value: "cfg::1",
    });
    expect(r.disclosedContracts.map((d) => d.contractId)).toEqual(["reg::1", "coll::1", "cfg::1"]);
  });

  it("picks the in-window config with the highest version on overlap", async () => {
    const reader = mkReader(
      [registrationEvent("reg::1", "coll::1")],
      [
        priceConfigEvent("cfg::old", { version: "3" }),
        priceConfigEvent("cfg::new", { version: "4" }),
      ],
    );
    const r = await getFeeCollectorContext(reader, FA, {
      nowMs: NOW,
      collectorTemplateId: "tpl::collector",
    });
    expect(r.priceConfigCid).toBe("cfg::new");
  });

  it("throws when no registration exists", async () => {
    const reader = mkReader([], [priceConfigEvent("cfg::1")]);
    await expect(
      getFeeCollectorContext(reader, FA, { nowMs: NOW, collectorTemplateId: "tpl::collector" }),
    ).rejects.toThrow(/no FeeCollectorRegistration/);
  });

  it("throws on multiple active registrations (ambiguous rotation state)", async () => {
    const reader = mkReader(
      [registrationEvent("reg::1", "coll::1"), registrationEvent("reg::2", "coll::2")],
      [priceConfigEvent("cfg::1")],
    );
    await expect(
      getFeeCollectorContext(reader, FA, { nowMs: NOW, collectorTemplateId: "tpl::collector" }),
    ).rejects.toThrow(/multiple active FeeCollectorRegistration/);
  });

  it("throws when no in-window price config exists", async () => {
    const reader = mkReader(
      [registrationEvent("reg::1", "coll::1")],
      [
        priceConfigEvent("cfg::stale", {
          validUntil: "2026-06-10T01:00:00Z",
          validFrom: "2026-06-10T00:00:00Z",
        }),
      ],
    );
    await expect(
      getFeeCollectorContext(reader, FA, { nowMs: NOW, collectorTemplateId: "tpl::collector" }),
    ).rejects.toThrow(/no in-window FeePriceConfig/);
  });
});

describe("assembleFeeChoiceArgs + collectFeeDisclosures", () => {
  const collector: FeeCollectorContext = {
    registrationCid: "reg::1",
    collectorCid: "coll::1",
    priceConfigCid: "cfg::1",
    priceConfig: parsePriceConfig(priceConfigPayload()),
    choiceContextData: {
      values: { [PRICE_CONFIG_CONTEXT_KEY]: { tag: "AV_ContractId", value: "cfg::1" } },
    },
    disclosedContracts: [disclosure("reg::1"), disclosure("coll::1"), disclosure("cfg::1")],
  };
  const factory: ResolvedTransferFactory = {
    transferFactoryCid: "factory::1",
    transferContext: { values: { "splice.lfdecentralizedtrust.org/open-round": "round::7" } },
    disclosedContracts: [disclosure("factory::1"), disclosure("rules::1")],
  };
  const selection = { inputHoldingCids: ["h::1", "h::2"], total: "2.0" };

  it("builds the three choice args with a merged context", () => {
    const args = assembleFeeChoiceArgs(collector, factory, selection);
    expect(args.feeRegistrationCid).toBe("reg::1");
    expect(args.feeInputs).toEqual(["h::1", "h::2"]);
    expect(args.feeExtraArgs.meta).toEqual({ values: {} });
    expect(args.feeExtraArgs.context.values[PRICE_CONFIG_CONTEXT_KEY]).toEqual({
      tag: "AV_ContractId",
      value: "cfg::1",
    });
    expect(args.feeExtraArgs.context.values[TRANSFER_FACTORY_CONTEXT_KEY]).toEqual({
      tag: "AV_ContractId",
      value: "factory::1",
    });
    expect(args.feeExtraArgs.context.values["splice.lfdecentralizedtrust.org/open-round"]).toBe(
      "round::7",
    );
  });

  it("collects fee-endpoint + registry disclosures, plus extras", () => {
    const ds = collectFeeDisclosures(collector, factory);
    expect(ds.map((d) => d.contractId)).toEqual([
      "reg::1",
      "coll::1",
      "cfg::1",
      "factory::1",
      "rules::1",
    ]);
    const extra = disclosure("extra::1");
    expect(collectFeeDisclosures(collector, factory, [extra]).at(-1)).toBe(extra);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/ts-packages/canton-sig && pnpm test`
Expected: FAIL — `parsePriceConfig` etc. are not exported.

- [ ] **Step 3: Rework `src/fee.ts`**

Apply this delta (the untouched parts — decimal helpers, holding selection,
`getTransferFactoryForFee` — stay exactly as they are):

3a. Module header: update the doc comment to describe the new flow (1.
`getFeeCollectorContext` — registration + collector + price config from the FA
fee endpoint; 2. `getTransferFactoryForFee` — CC registry; 3.
`selectInputHoldings`; 4. `assembleFeeChoiceArgs` → `{feeRegistrationCid,
feeInputs, feeExtraArgs}`), referencing
`docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md §5.5`.

3b. Imports: replace the `SignerFeeConfig` import with:

```ts
import {
  FeePriceConfig,
  CcFeeCollector,
} from "@daml.js/signet-fee-amulet-0.0.1/lib/Signet/Fee/Amulet/module.js";
import { FeeCollectorRegistration } from "@daml.js/signet-api-fee-v1-1.0.0/lib/Signet/Api/Fee/V1/module.js";
```

3c. Add the context-key constants next to `TRANSFER_FACTORY_REGISTRY_PATH`:

```ts
/**
 * Charge-context keys, internal to the `signet-fee-amulet` implementation and
 * this assembly helper (mirrors `Signet.Fee.Amulet.priceConfigContextKey` /
 * `transferFactoryContextKey`). Third-party code must treat the context as
 * opaque.
 */
export const PRICE_CONFIG_CONTEXT_KEY = "signet.network/fee/price-config";
export const TRANSFER_FACTORY_CONTEXT_KEY = "signet.network/fee/transfer-factory";

/** FA fee-endpoint path serving the collector context (registry-shaped). */
export const FEE_COLLECTOR_ENDPOINT_PATH = "/fee/v1/collector";
```

3d. Replace `parseFeeConfig`/`isFeeConfigInWindow` with:

```ts
/**
 * Decode a `FeePriceConfig` createArgument using the generated Daml decoder
 * (the source-of-truth schema), throwing on any shape mismatch.
 */
export function parsePriceConfig(createArgument: unknown): FeePriceConfig {
  return FeePriceConfig.decoder.runWithException(createArgument);
}

/**
 * Whether `cfg`'s `[validFrom, validUntil]` window contains `nowMs`
 * (inclusive). `nowMs` is injected so the check is deterministic.
 */
export function isPriceConfigInWindow(cfg: FeePriceConfig, nowMs: number): boolean {
  return nowMs >= Date.parse(cfg.validFrom) && nowMs <= Date.parse(cfg.validUntil);
}
```

3e. Replace `CurrentFeeDisclosure` + `getCurrentFeeDisclosure` with (keep
`FeeLedgerReader` as is — it already has both methods needed):

```ts
/** The fee-collector context the FA fee endpoint serves (registry-shaped). */
export interface FeeCollectorContext {
  /** Contract id of the active `FeeCollectorRegistration` (the `feeRegistrationCid` choice arg). */
  registrationCid: string;
  /** Contract id of the registered collector (interface cid; disclosed, not passed as an arg). */
  collectorCid: string;
  /** Contract id of the current `FeePriceConfig` (referenced via the charge context). */
  priceConfigCid: string;
  /** Decoded current price config (`feeAmount` drives holding selection). */
  priceConfig: FeePriceConfig;
  /** Implementation-internal charge context (price-config ref today); opaque to clients. */
  choiceContextData: TransferChoiceContext;
  /** Disclosures for the submission: registration, collector, price config. */
  disclosedContracts: DisclosedContract[];
}

/**
 * Build the fee-collector context, as the FA-operated fee endpoint does for
 * `POST {FEE_COLLECTOR_ENDPOINT_PATH}`. The registration, collector, and price
 * config are all signed by `sigNetworkFA` (the fee admin), so this runs under
 * the fee admin's read authority and hands the requester the live envelope.
 *
 * Of the active price configs for `sigNetworkFA`, picks the in-window one; if
 * windows overlap (a pre-published next config), the highest `version` wins.
 * Exactly one registration must be active — rotation must archive the old one.
 *
 * @param reader - A {@link CantonClient} (or stub) reading as the fee admin.
 * @param sigNetworkFA - The featured-app party whose fee infra to serve.
 * @param opts.nowMs - Override "now" for the window check (defaults to `Date.now()`).
 * @param opts.registrationTemplateId - Override the registration template id.
 * @param opts.priceConfigTemplateId - Override the price-config template id.
 * @param opts.collectorTemplateId - Template id used to disclose the collector
 *   contract (defaults to the current `CcFeeCollector`; the endpoint knows its
 *   own implementation).
 * @throws If no (or multiple) registrations exist, or no in-window price config.
 */
export async function getFeeCollectorContext(
  reader: FeeLedgerReader,
  sigNetworkFA: string,
  opts: {
    nowMs?: number;
    registrationTemplateId?: string;
    priceConfigTemplateId?: string;
    collectorTemplateId?: string;
  } = {},
): Promise<FeeCollectorContext> {
  const nowMs = opts.nowMs ?? Date.now();
  const registrationTemplateId = opts.registrationTemplateId ?? FeeCollectorRegistration.templateId;
  const priceConfigTemplateId = opts.priceConfigTemplateId ?? FeePriceConfig.templateId;
  const collectorTemplateId = opts.collectorTemplateId ?? CcFeeCollector.templateId;

  const registrations = (
    await reader.getActiveContracts([sigNetworkFA], registrationTemplateId, false)
  )
    .map((ev) => ({
      ev,
      reg: FeeCollectorRegistration.decoder.runWithException(ev.createArgument),
    }))
    .filter(({ reg }) => reg.sigNetworkFA === sigNetworkFA);
  if (registrations.length === 0) {
    throw new Error(`getFeeCollectorContext: no FeeCollectorRegistration for ${sigNetworkFA}`);
  }
  if (registrations.length > 1) {
    throw new Error(
      `getFeeCollectorContext: multiple active FeeCollectorRegistration contracts for ` +
        `${sigNetworkFA} — rotation must archive the stale one`,
    );
  }
  const registration = registrations[0]!;

  const configs = (await reader.getActiveContracts([sigNetworkFA], priceConfigTemplateId, false))
    .map((ev) => ({ ev, config: parsePriceConfig(ev.createArgument) }))
    .filter(({ config }) => config.sigNetworkFA === sigNetworkFA)
    .filter(({ config }) => isPriceConfigInWindow(config, nowMs))
    .sort((a, b) => (BigInt(a.config.version) < BigInt(b.config.version) ? 1 : -1));
  const chosen = configs[0];
  if (!chosen) {
    throw new Error(
      `getFeeCollectorContext: no in-window FeePriceConfig for ${sigNetworkFA} ` +
        `at ${new Date(nowMs).toISOString()}`,
    );
  }

  const collectorCid = registration.reg.collector;
  const [dRegistration, dCollector, dPriceConfig] = await Promise.all([
    reader.getDisclosedContract([sigNetworkFA], registrationTemplateId, registration.ev.contractId),
    reader.getDisclosedContract([sigNetworkFA], collectorTemplateId, collectorCid),
    reader.getDisclosedContract([sigNetworkFA], priceConfigTemplateId, chosen.ev.contractId),
  ]);

  return {
    registrationCid: registration.ev.contractId,
    collectorCid,
    priceConfigCid: chosen.ev.contractId,
    priceConfig: chosen.config,
    choiceContextData: {
      values: {
        [PRICE_CONFIG_CONTEXT_KEY]: { tag: "AV_ContractId", value: chosen.ev.contractId },
      },
    },
    disclosedContracts: [dRegistration, dCollector, dPriceConfig],
  };
}
```

3f. Replace `FeeChoiceArgs`, `assembleFeeChoiceArgs`, `collectFeeDisclosures` with:

```ts
/** Daml `ExtraArgs` as it travels over the JSON Ledger API. */
export interface FeeExtraArgs {
  context: TransferChoiceContext;
  meta: { values: Record<string, string> };
}

/** The fee-related arguments threaded into `RequestDeposit` / `RequestWithdrawal`. */
export interface FeeChoiceArgs {
  feeRegistrationCid: string;
  feeInputs: string[];
  feeExtraArgs: FeeExtraArgs;
}

/**
 * Fold the three resolved inputs into the fee choice arguments that
 * `RequestDeposit` / `RequestWithdrawal` (and `Signer.RequestSignature`)
 * require: the fee endpoint's context, the CC registry's transfer context, and
 * the transfer-factory reference are merged into one opaque `feeExtraArgs`
 * envelope read by the `signet-fee-amulet` charge implementation.
 *
 * The matching disclosures — fee-endpoint + registry — must be attached to the
 * submission; combine them with {@link collectFeeDisclosures}.
 */
export function assembleFeeChoiceArgs(
  collector: FeeCollectorContext,
  factory: ResolvedTransferFactory,
  selection: HoldingSelection,
): FeeChoiceArgs {
  return {
    feeRegistrationCid: collector.registrationCid,
    feeInputs: selection.inputHoldingCids,
    feeExtraArgs: {
      context: {
        values: {
          ...collector.choiceContextData.values,
          ...factory.transferContext.values,
          [TRANSFER_FACTORY_CONTEXT_KEY]: {
            tag: "AV_ContractId",
            value: factory.transferFactoryCid,
          },
        },
      },
      meta: { values: {} },
    },
  };
}

/**
 * Collect every disclosure a fee-bearing submission must attach: the fee
 * endpoint's (registration, collector, price config) and the registry's
 * (factory, `AmuletRules`, `OpenMiningRound`). The requester's own holdings
 * need no disclosure; extras can be appended via `extra`.
 */
export function collectFeeDisclosures(
  collector: FeeCollectorContext,
  factory: ResolvedTransferFactory,
  extra: DisclosedContract[] = [],
): DisclosedContract[] {
  return [...collector.disclosedContracts, ...factory.disclosedContracts, ...extra];
}
```

- [ ] **Step 4: Update the fee export block in `src/index.ts`**

Replace the "CC signature fee" export block with:

```ts
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
  CC_DECIMALS,
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
```

- [ ] **Step 5: Run the tests**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/ts-packages/canton-sig && pnpm test`
Expected: `fee.test.ts` green. (`fee-reprice.test.ts` may now fail to compile —
that is Task 8; if vitest aborts on it, scope the run:
`pnpm vitest run test/fee.test.ts`.)

- [ ] **Step 6: Commit**

```bash
git add ts-packages/canton-sig/src/fee.ts ts-packages/canton-sig/src/index.ts ts-packages/canton-sig/test/fee.test.ts
git commit -m "feat: registry-shaped fee-collector context client in canton-sig"
```

---

### Task 8: Rebind the reprice automation to `FeePriceConfig`

**Files:**

- Modify: `ts-packages/canton-sig/src/fee-reprice.ts`
- Modify: `ts-packages/canton-sig/test/fee-reprice.test.ts`
- Modify: `ts-packages/canton-sig/scripts/reprice-fee.ts` (comments only)
- Modify: `ts-packages/canton-sig/src/index.ts` (one rename)

- [ ] **Step 1: Update the tests first — `test/fee-reprice.test.ts`**

Mechanical updates (the suite's structure is already right):

- `import { findLatestFeeConfig, … }` → `findLatestPriceConfig`.
- Every fixture/templateId string `"#daml-signer:SignerFee:SignerFeeConfig"` → `"#signet-fee-amulet:Signet.Fee.Amulet:FeePriceConfig"`.
- `findCreated`-style fixture entity names `"SignerFeeConfig"` → `"FeePriceConfig"`.
- Fixture payloads gain `meta: { values: {} }` (the decoder requires it).
- Any doc-comment references to `SignerFeeConfig` → `FeePriceConfig`.
- Assertions on the bootstrap `createContract` payload must expect the new
  `meta: { values: {} }` field.

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/ts-packages/canton-sig && pnpm vitest run test/fee-reprice.test.ts`
Expected: FAIL — `findLatestPriceConfig` not exported / payload mismatch.

- [ ] **Step 2: Update `src/fee-reprice.ts`**

- Imports: `import { parsePriceConfig } from "./fee.js";` and
  `import { FeePriceConfig } from "@daml.js/signet-fee-amulet-0.0.1/lib/Signet/Fee/Amulet/module.js";`
  (drop the `SignerFeeConfig` import).
- Rename `findLatestFeeConfig` → `findLatestPriceConfig`; inside it:
  `SignerFeeConfig.templateId` → `FeePriceConfig.templateId`, `parseFeeConfig` →
  `parsePriceConfig`. Update its doc comment (`SignerFeeConfig` →
  `FeePriceConfig`; "Unlike `getCurrentFeeDisclosure`" → "Unlike
  `getFeeCollectorContext`").
- In `repriceOnce`: `SignerFeeConfig.templateId` → `FeePriceConfig.templateId`;
  both `findCreated(res.transaction.events, "SignerFeeConfig")` →
  `findCreated(res.transaction.events, "FeePriceConfig")`; the bootstrap
  `createContract` payload gains `meta: { values: {} },` after `version: "0",`.
- Module header doc: drop the references to the deleted
  `proposals/cc-signature-fee.md §6.3` / runbook §3.1 / "sigNetwork →
  sigNetworkFA switch (runbook §5)" — reference
  `docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md §11`
  instead, and say `FeePriceConfig` throughout.
- `RepriceConfig.feeReceiver` doc: `(sigNetwork today, sigNetworkFA later)` →
  `(typically sigNetworkFA; re-stamped on every roll)`.

- [ ] **Step 3: Update `src/index.ts` and the script header**

In `index.ts`: `export { repriceWindow, findLatestFeeConfig, repriceOnce, runRepriceLoop }` → `export { repriceWindow, findLatestPriceConfig, repriceOnce, runRepriceLoop }`.

In `scripts/reprice-fee.ts`: header comment — `cc-signature-fee-runbook.md §3.1` reference → the spec §11 path; `SignerFeeConfig` → `FeePriceConfig` (two mentions). No code changes.

- [ ] **Step 4: Run the full canton-sig suite + typecheck**

Run: `cd /Users/felipesousapessina/Documents/signet/currently-working/canton/ts-packages/canton-sig && pnpm test && pnpm check:types`
Expected: PASS (all of fee/fee-pricing/fee-reprice/package-exports).

- [ ] **Step 5: Commit**

```bash
git add ts-packages/canton-sig/src/fee-reprice.ts ts-packages/canton-sig/src/index.ts \
  ts-packages/canton-sig/test/fee-reprice.test.ts ts-packages/canton-sig/scripts/reprice-fee.ts
git commit -m "feat: rebind fee reprice automation to FeePriceConfig"
```

---

### Task 9: DevNet e2e client assembly + full verification gates

**Files:**

- Modify: `test/src/test/devnet-e2e.test.ts`

- [ ] **Step 1: Rewire `prepareFeeInputs()`**

In the import block: `getCurrentFeeDisclosure` → `getFeeCollectorContext`.
Replace the `prepareFeeInputs` function body (keep the function name and return
type) with:

```ts
/**
 * Assemble the CC signature-fee inputs for one RequestDeposit / RequestWithdrawal.
 *
 * On DevNet a single party is requester = sigNetwork = feeReceiver — and, unless
 * MPC_CANTON_SIG_NETWORK_FA_PARTY_ID says otherwise, also the fee admin — so the
 * sigNetworkFA-signed fee contracts are readable directly (the reader is their
 * stakeholder) and the fee transfer is a self-transfer settled via the party's
 * own `TransferPreapproval`. Requires the fee infra to be standing
 * (CcFeeCollector + FeeCollectorRegistration + FeePriceConfig posted,
 * preapproval + featured-app right live) and the CC token-standard registry —
 * see the design spec §10–§11.
 *
 * Returns the three fee choice args (spread into the choice record) and the
 * disclosures to append to the submission (registration/collector/price config
 * + factory/rules/round).
 */
async function prepareFeeInputs(): Promise<{
  args: FeeChoiceArgs;
  disclosures: DisclosedContract[];
}> {
  const feeAdmin = env!.MPC_CANTON_SIG_NETWORK_FA_PARTY_ID ?? party;
  const collector = await getFeeCollectorContext(canton, feeAdmin);
  const holdingEvents = await canton.getInterfaceContracts([party], HOLDING_INTERFACE_ID);
  const selection = selectInputHoldings(
    holdingInputsFromEvents(holdingEvents),
    collector.priceConfig.feeAmount,
  );
  const factory = await getTransferFactoryForFee(env!.MPC_CANTON_CC_REGISTRY_URL, {
    sender: party,
    feeReceiver: collector.priceConfig.feeReceiver,
    instrumentAdmin: collector.priceConfig.instrumentAdmin,
    instrumentId: collector.priceConfig.instrumentId,
    amount: collector.priceConfig.feeAmount,
    inputHoldingCids: selection.inputHoldingCids,
  });
  return {
    args: assembleFeeChoiceArgs(collector, factory, selection),
    disclosures: collectFeeDisclosures(collector, factory),
  };
}
```

The `...feeInputs.args` spread sites in the RequestDeposit/RequestWithdrawal
payloads need no edits — `FeeChoiceArgs` now carries the three new fields, and
the regenerated `@daml.js` choice types enforce them. Fix any remaining
references the typechecker flags (e.g. variable names mentioning `feeConfig`).

- [ ] **Step 2: Full verification gates**

Run (each must pass):

```bash
cd /Users/felipesousapessina/Documents/signet/currently-working/canton
dpm build --all
pnpm daml:test
pnpm -r --filter='@canton/*' --filter='canton-sig' run test
pnpm check
(cd test && pnpm test)        # devnet e2e auto-skips without MPC_CANTON_LIVE_MUTATE=1
```

Expected: all green. (`pnpm check` runs tsc + eslint + knip + prettier; fix any
knip complaints by ensuring removed exports are gone from `index.ts` and new
exports are referenced by tests/consumers — do NOT add knip ignores.)

- [ ] **Step 3: Commit**

```bash
git add test/src/test/devnet-e2e.test.ts
git commit -m "feat: assemble fee-collector args in devnet e2e client"
```

---

### Task 10: Documentation sweep

**Files:**

- Modify: `README.md` (architecture paragraph)
- Modify: `daml-packages/daml-signer/README.md` (fee sections)
- Modify: `daml-packages/daml-vault/README.md` (fee-args paragraph)
- Modify: `ts-packages/canton-sig/README.md` (fee helper mentions, if any)

These files are already modified in the working tree — read each section before
editing and keep edits scoped to fee-architecture content.

- [ ] **Step 1: `README.md` — architecture paragraph**

In the "Architecture in one paragraph" section, replace the fee clause

> atomically charges the requester a Canton Coin signature fee (`requester → feeReceiver`, settled in-transaction via a token-standard `TransferFactory_Transfer` priced by a disclosed `SignerFeeConfig`; if it cannot settle, the event is never created — fail-closed)

with:

> atomically charges the requester a Canton Coin signature fee through the registered, late-bound `FeeCollector` (`requester → feeReceiver`, priced by the FA-signed `FeePriceConfig` and settled via a token-standard `TransferFactory_Transfer` inside the `signet-fee-amulet` implementation package; if it cannot settle, the event is never created — fail-closed)

- [ ] **Step 2: `daml-packages/daml-signer/README.md` — fee content**

Update every fee-related section to the new architecture. Specifically:

1. The sample consumer snippet near the top (and its `import SignerFee …` line):
   imports become `import Signet.Api.Fee.V1 (FeeCollectorRegistration)` +
   `Splice.Api.Token.MetadataV1 (ExtraArgs)` + `Splice.Api.Token.HoldingV1 (Holding)`;
   the four fee fields become
   `feeRegistrationCid : ContractId FeeCollectorRegistration`,
   `feeInputs : [ContractId Holding]`, `feeExtraArgs : ExtraArgs`; the forwarded
   line becomes `feeRegistrationCid; feeInputs; feeExtraArgs`.
2. The `RequestSignature` row in the choices table: "+ the four fee args (…)" →
   "+ the three fee args (`feeRegistrationCid`, `feeInputs`, `feeExtraArgs`)".
3. Replace the whole `## CC signature fee` section body with:

```markdown
Every `RequestSignature` (and therefore every Vault deposit/withdrawal request) charges the
requester a Canton Coin fee, paid requester → `feeReceiver` **atomically inside the same
transaction**. If the fee cannot settle, `RequestSignature` aborts and no event is created
(fail-closed). Design:
[`docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md`](../../docs/superpowers/specs/2026-06-10-signer-fee-architecture-design.md).

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
- **Upgrade wiring note.** `upgrades:` / `typecheck-upgrades:` for `daml-signer`, `daml-vault-poc`,
  and `signet-fee-amulet` is added once this baseline is deployed — the current redeploy is the
  breaking baseline (spec §10.3).
```

4. Replace the `### SignerFeeConfig` template-reference section with a short
   `### Fee packages` section:

```markdown
### Fee packages

The fee surface lives outside `daml-signer`:

| Package             | Contents                                                                    | Stability                                        |
| ------------------- | --------------------------------------------------------------------------- | ------------------------------------------------ |
| `signet-api-fee-v1` | `FeeCollector` interface, `FeeCollector_Charge`, `FeeCollectorRegistration` | frozen forever (breaking change ⇒ `-v2` package) |
| `signet-fee-amulet` | `CcFeeCollector` (charge logic), `FeePriceConfig` (rotating price)          | evolves freely via SCU or replacement            |

`RequestSignature` only ever sees the frozen API: it validates the registration and exercises
`FeeCollector_Charge`. Everything else (pricing, settlement policy, the token-standard dependency)
is the implementation package's business.
```

5. Fix any remaining stale references in the file flagged by
   `grep -n "SignerFeeConfig\|ReadFeeConfig\|feeConfigCid\|transferFactoryCid\|inputHoldingCids\|transferContext\|cc-signature-fee" daml-packages/daml-signer/README.md`.

- [ ] **Step 3: `daml-packages/daml-vault/README.md`**

Replace the four-fee-args paragraph:

```markdown
Both `RequestDeposit` and `RequestWithdrawal` also take the three CC signature-fee args
(`feeRegistrationCid`, `feeInputs`, `feeExtraArgs`) and forward them to
`Signer.RequestSignature`, which charges the fee atomically through the registered late-bound
`FeeCollector`. The requester sources them client-side (see `canton-sig`'s fee helpers) and
attaches the matching disclosures; if the fee can't settle, `RequestSignature` aborts and nothing
is created. See [daml-signer § CC signature fee](../daml-signer/README.md#cc-signature-fee).
```

Then `grep -n "feeConfigCid\|transferFactoryCid\|SignerFeeConfig" daml-packages/daml-vault/README.md` and fix any other hits.

- [ ] **Step 4: `ts-packages/canton-sig/README.md`**

`grep -n "getCurrentFeeDisclosure\|SignerFeeConfig\|feeConfigCid\|parseFeeConfig\|findLatestFeeConfig" ts-packages/canton-sig/README.md` — update each hit to the new names (`getFeeCollectorContext`, `FeePriceConfig`, `feeRegistrationCid`, `parsePriceConfig`, `findLatestPriceConfig`).

- [ ] **Step 5: Final verification + commit**

```bash
cd /Users/felipesousapessina/Documents/signet/currently-working/canton
grep -rn "SignerFeeConfig\|ReadFeeConfig\|getCurrentFeeDisclosure" --include="*.daml" --include="*.ts" --include="*.md" \
  daml-packages ts-packages test README.md CLAUDE.md | grep -v docs/superpowers || echo CLEAN
dpm build --all && pnpm daml:test && pnpm check
git add README.md daml-packages/daml-signer/README.md daml-packages/daml-vault/README.md ts-packages/canton-sig/README.md
git commit -m "docs: describe the late-bound FeeCollector fee architecture"
```

Expected: the grep prints `CLEAN` (no stale references outside the spec/plan docs); all gates green.

---

## Done criteria (maps to spec §10 steps 1–4 + §12)

- [ ] `signet-api-fee-v1` + `signet-fee-amulet` exist, built, in `multi-package.yaml` (spec §10.1)
- [ ] `SignerFee.daml` deleted; `daml-signer`/`daml-vault` rewired to 3 opaque fee args; transfer-instruction dependency lives only in `signet-fee-amulet` + test packages (spec §10.2)
- [ ] Test modules split out of shipped DARs; signer tests use `MockFeeCollector`; token-standard mocks live next to the impl (spec §10.3 — `upgrades:` wiring intentionally deferred to post-deploy)
- [ ] `canton-sig`: `getFeeCollectorContext` + merged-context `assembleFeeChoiceArgs` + reprice rebind + codegen for new DARs (spec §10.4)
- [ ] Fee tests: charge-success/abort, foreign registration, forged registration, zero-fee waiver, Pending/Failed fail-closed, price-config window/forgery — plus the mutation checks (spec §12)
- [ ] MPC repo untouched (spec §10.6)
