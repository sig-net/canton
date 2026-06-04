# CC Signature Fee Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Charge the requester a non-refundable Canton Coin fee, atomically, inside
`SignRequest.Execute` every time it mints the `SignBidirectionalEvent` the MPC acts on — settled
one-step via the receiver's `TransferPreapproval`, fail-closed if it can't settle.

**Architecture:** A separate sigNetwork-signed `SignerFeeConfig` template (mutable, daily-repriced,
disclosed via a fetch endpoint) carries the current fee. `Execute` nests a token-standard
`TransferFactory_Transfer` (requester → `feeReceiver`) and aborts unless the result is `Completed`,
then creates the event — all in one transaction, preserving the anti-forgery invariant (sigNetwork
stays observer-only). The fee args thread `client → Vault → SignBidirectional → Execute`.

**Tech Stack:** Daml SDK 3.4.11 / `dpm`; Splice token standard (`splice-api-token-*` interface DARs,
vendored); TypeScript `canton-sig` client (viem, JSON Ledger API v2); CN Quickstart Splice runtime.

**Source spec:** `proposals/cc-signature-fee.md` (committed `ecdfed9`). Section refs (§N) point there.

---

## Token-Standard API Reference (verbatim — used throughout)

Captured from the Splice source (`splice-api-token-transfer-instruction-v1`,
`-holding-v1`, `-metadata-v1`). Task 1 must confirm these against the vendored DAR via
`dpm inspect-dar`; they are reproduced here so later tasks have exact signatures.

```daml
-- Splice.Api.Token.HoldingV1
data InstrumentId = InstrumentId with admin : Party; id : Text
interface Holding where                       -- viewtype HoldingView; choice Archive
data HoldingView = HoldingView with
  owner : Party; instrumentId : InstrumentId; amount : Decimal
  lock : Optional Lock; meta : Metadata

-- Splice.Api.Token.MetadataV1
data Metadata = Metadata with values : TextMap Text       -- emptyMetadata
data ChoiceContext = ChoiceContext with values : TextMap AnyValue   -- emptyChoiceContext
data ExtraArgs = ExtraArgs with context : ChoiceContext; meta : Metadata

-- Splice.Api.Token.TransferInstructionV1
data Transfer = Transfer with
  sender : Party; receiver : Party; amount : Decimal; instrumentId : InstrumentId
  requestedAt : Time; executeBefore : Time; inputHoldingCids : [ContractId Holding]; meta : Metadata
data TransferInstructionResult = TransferInstructionResult with
  output : TransferInstructionResult_Output; senderChangeCids : [ContractId Holding]; meta : Metadata
data TransferInstructionResult_Output
  = TransferInstructionResult_Pending with transferInstructionCid : ContractId TransferInstruction
  | TransferInstructionResult_Completed with receiverHoldingCids : [ContractId Holding]
  | TransferInstructionResult_Failed
interface TransferFactory where             -- viewtype TransferFactoryView with admin : Party; meta : Metadata
  nonconsuming choice TransferFactory_Transfer : TransferInstructionResult
    with expectedAdmin : Party; transfer : Transfer; extraArgs : ExtraArgs
    controller transfer.sender
```

---

## File Structure

| Path | Responsibility | Action |
| --- | --- | --- |
| `daml-packages/vendor/splice-api-token-*-v1-<ver>.dar` (×3) | Vendored token-standard interface DARs | Create |
| `daml-packages/daml-signer/daml/SignerFee.daml` | `SignerFeeConfig` template + `validateFeeConfig` pure fn | Create |
| `daml-packages/daml-signer/daml/TestSignerFee.daml` | Daml Script unit tests for the fee config | Create |
| `daml-packages/daml-signer/daml/TestToken.daml` | Test-only mock `Holding` + `TransferFactory` | Create |
| `daml-packages/daml-signer/daml/Signer.daml` | Add fee args to `Execute` + `SignBidirectional` | Modify |
| `daml-packages/daml-signer/daml/TestSigner.daml` | Tests for the `Execute` fee charge | Modify |
| `daml-packages/daml-signer/daml.yaml` | Add vendored DAR data-dependencies | Modify |
| `daml-packages/daml-vault/daml/Erc20Vault.daml` | Thread fee args through Request{Deposit,Withdrawal} | Modify |
| `daml-packages/daml-vault/daml/TestVault.daml` | Update call sites | Modify |
| `daml-packages/daml-vault/daml.yaml` | Add vendored DAR data-dependencies | Modify |
| `ts-packages/canton-sig/src/fee.ts` | Fee disclosure fetch + transfer-factory/holding assembly | Create |
| `ts-packages/canton-sig/src/fee.test.ts` | Oracle tests for selection/assembly logic | Create |
| `ts-packages/canton-sig/src/index.ts` | Export the new fee helpers | Modify |
| `test/src/test/devnet-e2e.test.ts` | Fund CC, preapproval, assert the charge | Modify |
| `proposals/cc-signature-fee-runbook.md` | Off-ledger infra runbook (preapproval, FA right, daily automation) | Create |

---

## Phase 0 — Foundations & de-risking

### Task 1: Provision the Splice runtime and vendor the token-standard interface DARs

**Files:**

- Create: `daml-packages/vendor/` (3 DARs)
- Modify: `daml-packages/daml-signer/daml.yaml`, `daml-packages/daml-vault/daml.yaml`

- [ ] **Step 1: Stand up the CN Quickstart Splice stack** (provides vetted amulet + token-standard at
      runtime; SETUP.md). In a separate clone:

```bash
git clone https://github.com/digital-asset/cn-quickstart.git
cd cn-quickstart && direnv allow && cd quickstart
printf 'OBSERVABILITY_ENABLED=false\nAUTH_MODE=oauth2\nPARTY_HINT=signet-mpc-1\nTEST_MODE=off\n' > .env.local
make build && make start && make status
```

Expected: ~17 containers healthy; `splice` healthy after ~60–90s.

- [ ] **Step 2: Extract the three interface DARs from the running participant.** They are vetted on
      the app-provider participant; download them via the Canton console (`make canton-console`):

```scala
val dir = "/tmp/splice-dars"
participants.local.foreach(_.dars.list().filter(d =>
  Seq("splice-api-token-holding-v1","splice-api-token-transfer-instruction-v1",
      "splice-api-token-metadata-v1").exists(d.name.contains))
  .foreach(d => participant1.dars.download(d.hash, s"$dir/${d.name}-${d.version}.dar")))
```

Expected: three `.dar` files in `/tmp/splice-dars`. (Fallback if console download is unavailable:
fetch the same-versioned artifacts from the Splice release bundle for the network's Splice version.)

- [ ] **Step 3: Vendor the DARs into the repo and record exact versions.**

```bash
cd /Users/felipesousapessina/Documents/signet/currently-working/canton
mkdir -p daml-packages/vendor
cp /tmp/splice-dars/splice-api-token-holding-v1-*.dar \
   /tmp/splice-dars/splice-api-token-transfer-instruction-v1-*.dar \
   /tmp/splice-dars/splice-api-token-metadata-v1-*.dar daml-packages/vendor/
ls -1 daml-packages/vendor/        # record these exact filenames — used in Step 4
```

Expected: three versioned DAR filenames printed. Note them; `<HOLDING>`, `<TRANSFER>`, `<META>` below
mean those exact filenames.

- [ ] **Step 4: Confirm the API matches the reference block** above:

```bash
~/.dpm/bin/dpm inspect-dar daml-packages/vendor/<TRANSFER> | grep -A12 "TransferFactory_Transfer"
```

Expected: the choice/record signatures match the Token-Standard API Reference. If they differ, update
the reference block and every dependent task before continuing.

- [ ] **Step 5: Add the vendored DARs as data-dependencies** to both packages. Edit
      `daml-packages/daml-signer/daml.yaml`, replacing the `data-dependencies:` block with (use the
      exact filenames from Step 3):

```yaml
data-dependencies:
  - ../daml-eip712/.daml/dist/daml-eip712-0.0.1.dar
  - ../vendor/<HOLDING>
  - ../vendor/<TRANSFER>
  - ../vendor/<META>
```

Apply the same three `../vendor/<...>` lines to `daml-packages/daml-vault/daml.yaml` (keeping its
existing daml-abi/daml-eip712/daml-signer deps).

- [ ] **Step 6: Verify the build still compiles** (no code uses the new deps yet):

```bash
~/.dpm/bin/dpm build --all
```

Expected: BUILD SUCCESSFUL for all 5 packages.

- [ ] **Step 7: Commit.**

```bash
git add daml-packages/vendor daml-packages/daml-signer/daml.yaml daml-packages/daml-vault/daml.yaml
git commit -m "build: vendor splice token-standard interface DARs"
```

### Task 2: Spike — prove `TransferFactory_Transfer` nests inside a choice (§10)

**Files:** Create `daml-packages/daml-signer/daml/SpikeNesting.daml` (throwaway; deleted in Step 5).

- [ ] **Step 1: Write a minimal wrapper choice that nests the transfer.** This mirrors what `Execute`
      will do, isolated from the rest of the protocol:

```daml
module SpikeNesting where

import Splice.Api.Token.HoldingV1 (Holding, InstrumentId(..))
import Splice.Api.Token.MetadataV1 (ExtraArgs(..), ChoiceContext, emptyMetadata)
import Splice.Api.Token.TransferInstructionV1
  (TransferFactory, TransferFactory_Transfer(..), Transfer(..),
   TransferInstructionResult(..), TransferInstructionResult_Output(..))
import DA.Time (hours)

template SpikeAnchor with
    requester : Party
  where
    signatory requester
    choice SpikeCharge : Text
      with
        factoryCid : ContractId TransferFactory
        receiver : Party
        admin : Party
        amount : Decimal
        inputs : [ContractId Holding]
        context : ChoiceContext
      controller requester
      do
        now <- getTime
        r <- exercise factoryCid TransferFactory_Transfer with
          expectedAdmin = admin
          transfer = Transfer with
            sender = requester; receiver; amount
            instrumentId = InstrumentId with admin; id = "Amulet"
            requestedAt = now; executeBefore = addRelTime now (hours 1)
            inputHoldingCids = inputs; meta = emptyMetadata
          extraArgs = ExtraArgs with context; meta = emptyMetadata
        case r.output of
          TransferInstructionResult_Completed _ -> pure "COMPLETED"
          TransferInstructionResult_Pending _ -> pure "PENDING"
          TransferInstructionResult_Failed -> pure "FAILED"
```

- [ ] **Step 2: Confirm it compiles** (proves the interface composes in a choice body):

```bash
~/.dpm/bin/dpm build --all
```

Expected: BUILD SUCCESSFUL. A compile failure here = the interface can't be referenced this way →
stop and reassess (fallbacks A2/C in §10).

- [ ] **Step 3: Run it live against the stack.** Allocate a funded `requester` and a `receiver` with a
      self-`TransferPreapproval` on the CN Quickstart stack; fetch the CC `TransferFactory` +
      `choiceContext` + disclosures from the registry API (mirror `splice/token-standard/cli` →
      `transfer.ts`); submit `SpikeCharge` with the factory/holdings/context disclosed. Use the JSON
      Ledger API (`canton-sig` `CantonClient`) or the quickstart CLI.

Expected: choice returns `"COMPLETED"`; requester's CC drops by `amount`; receiver's rises; a
`FeaturedAppActivityMarker` is emitted when the receiver holds a `FeaturedAppRight`.

- [ ] **Step 4: Record the spike result** (go/no-go + the exact `choiceContext` keys the registry
      returned) at the top of `proposals/cc-signature-fee-runbook.md` (created in Task 12; for now a
      stub). This is the authoritative wiring later tasks reuse.

- [ ] **Step 5: Delete the spike and commit the finding.**

```bash
rm daml-packages/daml-signer/daml/SpikeNesting.daml
~/.dpm/bin/dpm build --all
git add -A && git commit -m "chore: nesting spike validated (TransferFactory_Transfer in choice body)"
```

Expected: BUILD SUCCESSFUL; spike file gone.

---

## Phase 1 — `SignerFeeConfig` (pure Daml, fully deterministic)

### Task 3: `validateFeeConfig` pure function (TDD)

**Files:**

- Create: `daml-packages/daml-signer/daml/SignerFee.daml`
- Create: `daml-packages/daml-signer/daml/TestSignerFee.daml`

- [ ] **Step 1: Write the failing test.** Create `TestSignerFee.daml`:

```daml
module TestSignerFee where

import Daml.Script
import DA.Time (time)
import DA.Date (date, Month(..))
import SignerFee (SignerFeeConfig(..), validateFeeConfig)

mkCfg : Party -> SignerFeeConfig
mkCfg sn = SignerFeeConfig with
  sigNetwork = sn; feeReceiver = sn; instrumentAdmin = sn; instrumentId = "Amulet"
  feeAmount = 1.0
  validFrom = time (date 2026 Jan 1) 0 0 0
  validUntil = time (date 2026 Dec 31) 0 0 0
  version = 0

test_validate_ok : Script ()
test_validate_ok = do
  sn <- allocateParty "sn"
  let now = time (date 2026 Jun 1) 0 0 0
  validateFeeConfig sn now (mkCfg sn) === Right ()

test_validate_wrong_signer : Script ()
test_validate_wrong_signer = do
  sn <- allocateParty "sn"
  other <- allocateParty "other"
  let now = time (date 2026 Jun 1) 0 0 0
  validateFeeConfig other now (mkCfg sn) === Left "Fee config belongs to a different sigNetwork"

test_validate_expired : Script ()
test_validate_expired = do
  sn <- allocateParty "sn"
  let now = time (date 2027 Jan 1) 0 0 0
  validateFeeConfig sn now (mkCfg sn) === Left "Fee config expired"
```

- [ ] **Step 2: Run it; verify it fails** (module `SignerFee` not found):

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -5
```

Expected: FAIL — `Could not find module 'SignerFee'`.

- [ ] **Step 3: Write the minimal implementation.** Create `SignerFee.daml`:

```daml
module SignerFee where

-- | The config is valid for this Signer iff it is signed for the same sigNetwork
-- and the current ledger time is inside its [validFrom, validUntil] window.
validateFeeConfig : Party -> Time -> SignerFeeConfig -> Either Text ()
validateFeeConfig expectedSigNetwork now cfg
  | cfg.sigNetwork /= expectedSigNetwork = Left "Fee config belongs to a different sigNetwork"
  | now < cfg.validFrom = Left "Fee config not yet valid"
  | now > cfg.validUntil = Left "Fee config expired"
  | otherwise = Right ()

template SignerFeeConfig
  with
    sigNetwork      : Party
    feeReceiver     : Party
    instrumentAdmin : Party
    instrumentId    : Text
    feeAmount       : Decimal
    validFrom       : Time
    validUntil      : Time
    version         : Int
  where
    signatory sigNetwork
    observer feeReceiver
    ensure feeAmount >= 0.0 && validUntil > validFrom
```

- [ ] **Step 4: Run the tests; verify they pass:**

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -5
```

Expected: all three `test_validate_*` PASS.

- [ ] **Step 5: Commit.**

```bash
git add daml-packages/daml-signer/daml/SignerFee.daml daml-packages/daml-signer/daml/TestSignerFee.daml
git commit -m "feat(signer): add SignerFeeConfig template and validateFeeConfig"
```

### Task 4: `UpdateFee` choice (TDD)

**Files:** Modify `SignerFee.daml`, `TestSignerFee.daml`.

- [ ] **Step 1: Write the failing test** (append to `TestSignerFee.daml`):

```daml
test_update_fee : Script ()
test_update_fee = do
  sn <- allocateParty "sn"
  cid <- submit sn do createCmd (mkCfg sn)
  let vf = time (date 2026 Jun 1) 0 0 0
      vu = time (date 2026 Jun 3) 0 0 0
  cid2 <- submit sn do exerciseCmd cid UpdateFee with newAmount = 2.0; newValidFrom = vf; newValidUntil = vu
  Some c <- queryContractId sn cid2
  c.feeAmount === 2.0
  c.version === 1
```

- [ ] **Step 2: Run it; verify it fails** (`UpdateFee` not in scope):

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -5
```

Expected: FAIL — data constructor / choice `UpdateFee` not in scope.

- [ ] **Step 3: Add the choice** to `SignerFeeConfig` (inside the `where`, after `ensure`):

```daml
    choice UpdateFee : ContractId SignerFeeConfig
      with
        newAmount     : Decimal
        newValidFrom  : Time
        newValidUntil : Time
      controller sigNetwork
      do
        create this with
          feeAmount = newAmount
          validFrom = newValidFrom
          validUntil = newValidUntil
          version = version + 1
```

- [ ] **Step 4: Run the tests; verify they pass:**

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -5
```

Expected: `test_update_fee` PASS (plus prior tests).

- [ ] **Step 5: Commit.**

```bash
git add daml-packages/daml-signer/daml/SignerFee.daml daml-packages/daml-signer/daml/TestSignerFee.daml
git commit -m "feat(signer): add UpdateFee reprice choice"
```

---

## Phase 2 — Mock token standard (deterministic test scaffolding)

### Task 5: `TestToken.daml` — mock `Holding` + `TransferFactory`

**Files:** Create `daml-packages/daml-signer/daml/TestToken.daml`.

- [ ] **Step 1: Write the mock** (a real interface implementation, settling one-step or failing):

```daml
module TestToken where

import DA.Foldable (forA_)
import Splice.Api.Token.HoldingV1
import Splice.Api.Token.MetadataV1 (emptyMetadata)
import Splice.Api.Token.TransferInstructionV1

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
      view = HoldingView with owner; instrumentId; amount; lock = None; meta = emptyMetadata

-- settleOneStep = True  → Completed (simulates the receiver's TransferPreapproval)
-- settleOneStep = False → Failed    (simulates no preapproval / refusal)
template MockTransferFactory
  with
    admin : Party
    settleOneStep : Bool
  where
    signatory admin
    interface instance TransferFactory for MockTransferFactory where
      view = TransferFactoryView with admin; meta = emptyMetadata
      transferFactory_publicFetchImpl _self _arg = pure (TransferFactoryView with admin; meta = emptyMetadata)
      transferFactory_transferImpl _self arg = do
        let t = arg.transfer
        forA_ t.inputHoldingCids archive
        if settleOneStep
          then do
            rcid <- create MockHolding with
              admin; owner = t.receiver; instrumentId = t.instrumentId; amount = t.amount
            pure TransferInstructionResult with
              output = TransferInstructionResult_Completed with
                receiverHoldingCids = [toInterfaceContractId @Holding rcid]
              senderChangeCids = []
              meta = emptyMetadata
          else
            pure TransferInstructionResult with
              output = TransferInstructionResult_Failed
              senderChangeCids = []
              meta = emptyMetadata
```

- [ ] **Step 2: Confirm it compiles:**

```bash
~/.dpm/bin/dpm build --all
```

Expected: BUILD SUCCESSFUL. (If `transferFactory_transferImpl`'s arity differs from the vendored
interface, match it to the Task 1 `inspect-dar` signature.)

- [ ] **Step 3: Commit.**

```bash
git add daml-packages/daml-signer/daml/TestToken.daml
git commit -m "test(signer): add mock Holding and TransferFactory for fee tests"
```

---

## Phase 3 — `Execute` fee charge + `SignBidirectional` threading

### Task 6: Charge the fee inside `Execute` (TDD against the mock)

**Files:** Modify `Signer.daml`; modify `TestSigner.daml`.

- [ ] **Step 1: Write the failing tests** (append to `TestSigner.daml`; reuse its existing fixtures
      for `operators`/`requester`/`sigNetwork`/`SignRequest` args — mirror an existing
      `Execute`/`SignBidirectional` test there). Add a helper that funds the requester with a
      `MockHolding` and creates a `MockTransferFactory`, then:

```daml
test_execute_charges_fee : Script ()
test_execute_charges_fee = do
  f <- setupSignerFixture                      -- existing fixture: operators, requester, sigNetwork, signRequestCid
  factory <- submit f.sigNetwork do createCmd MockTransferFactory with admin = f.sigNetwork; settleOneStep = True
  holding <- submit f.sigNetwork do createCmd MockHolding with
    admin = f.sigNetwork; owner = f.requester
    instrumentId = InstrumentId with admin = f.sigNetwork; id = "Amulet"; amount = 5.0
  cfg <- submit f.sigNetwork do createCmd feeCfg f.sigNetwork           -- helper building a valid SignerFeeConfig
  ev <- submit f.requester do exerciseCmd f.signRequestCid Execute with
    feeConfigCid = cfg
    transferFactoryCid = toInterfaceContractId @TransferFactory factory
    inputHoldingCids = [toInterfaceContractId @Holding holding]
    transferContext = emptyChoiceContext
  -- event created AND the requester's mock holding consumed
  Some _ <- queryContractId f.sigNetwork ev
  hs <- query @MockHolding f.requester
  assertMsg "input holding consumed" (null (filter (\(_,h) -> h.owner == f.requester && h.amount == 5.0) hs))

test_execute_fails_closed_without_preapproval : Script ()
test_execute_fails_closed_without_preapproval = do
  f <- setupSignerFixture
  factory <- submit f.sigNetwork do createCmd MockTransferFactory with admin = f.sigNetwork; settleOneStep = False
  holding <- submit f.sigNetwork do createCmd MockHolding with
    admin = f.sigNetwork; owner = f.requester
    instrumentId = InstrumentId with admin = f.sigNetwork; id = "Amulet"; amount = 5.0
  cfg <- submit f.sigNetwork do createCmd feeCfg f.sigNetwork
  submitMustFail f.requester do exerciseCmd f.signRequestCid Execute with
    feeConfigCid = cfg
    transferFactoryCid = toInterfaceContractId @TransferFactory factory
    inputHoldingCids = [toInterfaceContractId @Holding holding]
    transferContext = emptyChoiceContext
```

(Add `feeCfg : Party -> SignerFeeConfig` and `setupSignerFixture` helpers near the top of
`TestSigner.daml`, reusing patterns already in `TestFixtures.daml`.)

- [ ] **Step 2: Run; verify failure** (`Execute` has no such args yet):

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -8
```

Expected: FAIL — `Execute` does not have fields `feeConfigCid`, ….

- [ ] **Step 3: Add the imports** to `Signer.daml` (top, with the existing imports):

```daml
import Splice.Api.Token.HoldingV1 (Holding, InstrumentId(..))
import Splice.Api.Token.MetadataV1 (ExtraArgs(..), ChoiceContext, emptyMetadata)
import Splice.Api.Token.TransferInstructionV1
  (TransferFactory, TransferFactory_Transfer(..), Transfer(..),
   TransferInstructionResult(..), TransferInstructionResult_Output(..))
import DA.Time (hours)
import SignerFee (SignerFeeConfig, validateFeeConfig)
```

- [ ] **Step 4: Replace the `Execute` choice** (Signer.daml:130-137) with the fee-charging version:

```daml
    choice Execute : ContractId SignBidirectionalEvent
      with
        feeConfigCid       : ContractId SignerFeeConfig
        transferFactoryCid : ContractId TransferFactory
        inputHoldingCids   : [ContractId Holding]
        transferContext    : ChoiceContext
      controller requester
      do
        now <- getTime
        feeConfig <- fetch feeConfigCid
        case validateFeeConfig sigNetwork now feeConfig of
          Left err -> abort err
          Right () -> pure ()

        result <- exercise transferFactoryCid TransferFactory_Transfer with
          expectedAdmin = feeConfig.instrumentAdmin
          transfer = Transfer with
            sender = requester
            receiver = feeConfig.feeReceiver
            amount = feeConfig.feeAmount
            instrumentId = InstrumentId with admin = feeConfig.instrumentAdmin; id = feeConfig.instrumentId
            requestedAt = now
            executeBefore = addRelTime now (hours 1)
            inputHoldingCids
            meta = emptyMetadata
          extraArgs = ExtraArgs with context = transferContext; meta = emptyMetadata
        case result.output of
          TransferInstructionResult_Completed _ -> pure ()
          TransferInstructionResult_Pending _ -> abort "Fee transfer did not settle one-step; receiver TransferPreapproval required"
          TransferInstructionResult_Failed -> abort "Fee transfer failed"

        let sender = computeOperatorsHash (map partyToText operators)
        create SignBidirectionalEvent with
          operators; requester; sigNetwork; sender
          txParams; caip2Id; keyVersion; path; algo; dest; params
          outputDeserializationSchema; respondSerializationSchema
```

- [ ] **Step 5: Run the tests; verify they pass:**

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -8
```

Expected: `test_execute_charges_fee` PASS; `test_execute_fails_closed_without_preapproval` PASS.

- [ ] **Step 6: Mutation check** (per CLAUDE.md). Temporarily change the `Completed` case to also
      accept `Pending` (`TransferInstructionResult_Pending _ -> pure ()`); rerun — the fail-closed test
      MUST now fail. Revert.

- [ ] **Step 7: Commit.**

```bash
git add daml-packages/daml-signer/daml/Signer.daml daml-packages/daml-signer/daml/TestSigner.daml
git commit -m "feat(signer): charge CC fee atomically in SignRequest.Execute"
```

### Task 7: Thread fee args through `Signer.SignBidirectional`

**Files:** Modify `Signer.daml`; the existing `TestSigner.daml` `SignBidirectional` tests.

- [ ] **Step 1: Update the `SignBidirectional` callers in tests first** to pass the four new args
      (factory/holding/cfg/context as in Task 6), so the test expresses the new signature. Run; expect
      compile FAIL on the choice signature.

- [ ] **Step 2: Replace `SignBidirectional`** (Signer.daml:55-61) with:

```daml
    nonconsuming choice SignBidirectional : ContractId SignBidirectionalEvent
      with
        signRequestCid     : ContractId SignRequest
        requester          : Party
        feeConfigCid       : ContractId SignerFeeConfig
        transferFactoryCid : ContractId TransferFactory
        inputHoldingCids   : [ContractId Holding]
        transferContext    : ChoiceContext
      controller requester
      do
        exercise signRequestCid Execute with
          feeConfigCid; transferFactoryCid; inputHoldingCids; transferContext
```

- [ ] **Step 3: Run tests; verify pass:**

```bash
cd daml-packages/daml-signer && ~/.dpm/bin/dpm test 2>&1 | tail -8
```

Expected: PASS.

- [ ] **Step 4: Commit.**

```bash
git add daml-packages/daml-signer/daml/Signer.daml daml-packages/daml-signer/daml/TestSigner.daml
git commit -m "feat(signer): thread fee inputs through SignBidirectional"
```

---

## Phase 4 — Vault threading

### Task 8: Thread fee args through `RequestDeposit` and `RequestWithdrawal`

**Files:** Modify `Erc20Vault.daml`, `TestVault.daml`.

- [ ] **Step 1: Update `TestVault.daml` call sites first** to pass the four new args into
      `RequestDeposit`/`RequestWithdrawal` (use the `MockHolding`/`MockTransferFactory` from `TestToken`
      and a valid `SignerFeeConfig`). Run `cd daml-packages/daml-vault && ~/.dpm/bin/dpm test`; expect
      compile FAIL on the choice signatures.

- [ ] **Step 2: Add imports to `Erc20Vault.daml`** (with the existing `Signer` import):

```daml
import Splice.Api.Token.HoldingV1 (Holding)
import Splice.Api.Token.MetadataV1 (ChoiceContext)
import Splice.Api.Token.TransferInstructionV1 (TransferFactory)
import SignerFee (SignerFeeConfig)
```

- [ ] **Step 3: Add the four args** to both `RequestDeposit` (Erc20Vault.daml:171) and
      `RequestWithdrawal` (:269) `with` blocks:

```daml
        feeConfigCid       : ContractId SignerFeeConfig
        transferFactoryCid : ContractId TransferFactory
        inputHoldingCids   : [ContractId Holding]
        transferContext    : ChoiceContext
```

- [ ] **Step 4: Pass them into both `exercise signerCid SignBidirectional` calls** (:217, :325):

```daml
        signEventCid <- exercise signerCid SignBidirectional with
          signRequestCid = signReqCid; requester
          feeConfigCid; transferFactoryCid; inputHoldingCids; transferContext
```

- [ ] **Step 5: Run vault tests; verify pass:**

```bash
cd daml-packages/daml-vault && ~/.dpm/bin/dpm test 2>&1 | tail -8
```

Expected: PASS (deposit + withdrawal lifecycle now charges the mock fee).

- [ ] **Step 6: Full build + all package tests:**

```bash
~/.dpm/bin/dpm build --all && for p in daml-abi daml-uint256 daml-eip712 daml-signer daml-vault; do (cd daml-packages/$p && ~/.dpm/bin/dpm test) || exit 1; done
```

Expected: all green.

- [ ] **Step 7: Commit.**

```bash
git add daml-packages/daml-vault/daml/Erc20Vault.daml daml-packages/daml-vault/daml/TestVault.daml
git commit -m "feat(vault): thread CC fee inputs through deposit and withdrawal"
```

---

## Phase 5 — Client (`canton-sig`)

> Reference implementation for registry lookup + disclosure assembly: the Splice CLI
> `token-standard/cli/src/commands/transfer.ts` (hyperledger-labs/splice). The client must obtain the
> CC `TransferFactory` cid, the `ChoiceContext` values, and the disclosed contracts from the
> instrument admin's **registry API**; the exact `choiceContext` keys were captured in Task 2/Step 4.

### Task 9: Fee-disclosure fetch helper

**Files:** Create `ts-packages/canton-sig/src/fee.ts`, `ts-packages/canton-sig/src/fee.test.ts`;
modify `src/index.ts`.

- [ ] **Step 1: Write the failing oracle test** (`fee.test.ts`) for parsing a `SignerFeeConfig`
      created-event into a typed fee + `DisclosedContract`. Use a captured `active-contracts` JSON
      fixture (one `SignerFeeConfig` with `createdEventBlob`) and assert `parseFeeConfig` returns
      `{ feeAmount, feeReceiver, instrumentAdmin, instrumentId, disclosed }` and throws when the active
      set is empty.

- [ ] **Step 2: Run; verify fail:**

```bash
pnpm --filter canton-sig test 2>&1 | tail -5
```

Expected: FAIL — `parseFeeConfig` not exported.

- [ ] **Step 3: Implement `getCurrentFeeDisclosure` + `parseFeeConfig`** in `fee.ts`, built on the
      existing client (`getActiveContracts`/`fetchActiveContracts`, canton-client.ts:475-578):

```ts
import type { CantonClient, DisclosedContract, CreatedEvent } from "./infra/canton-client.js";

export const SIGNER_FEE_CONFIG_T = "#daml-signer:SignerFee:SignerFeeConfig";

export interface FeeConfig {
  feeAmount: string;
  feeReceiver: string;
  instrumentAdmin: string;
  instrumentId: string;
  disclosed: DisclosedContract;
}

export function parseFeeConfig(event: CreatedEvent, synchronizerId: string): FeeConfig {
  const a = event.createdArgument as Record<string, unknown>;
  if (!event.createdEventBlob) throw new Error("SignerFeeConfig missing createdEventBlob");
  return {
    feeAmount: String(a.feeAmount),
    feeReceiver: String(a.feeReceiver),
    instrumentAdmin: String(a.instrumentAdmin),
    instrumentId: String(a.instrumentId),
    disclosed: {
      templateId: event.templateId,
      contractId: event.contractId,
      createdEventBlob: event.createdEventBlob,
      synchronizerId,
    },
  };
}

/** Served by sigNetwork (the requester is not a stakeholder); see proposals/cc-signature-fee.md §6. */
export async function getCurrentFeeDisclosure(
  client: CantonClient,
  sigNetwork: string,
): Promise<FeeConfig> {
  const entries = await client.fetchActiveContracts([sigNetwork], SIGNER_FEE_CONFIG_T, true);
  if (entries.length === 0) throw new Error("no active SignerFeeConfig");
  const { createdEvent, synchronizerId } = entries[0];
  return parseFeeConfig(createdEvent, synchronizerId);
}
```

(If `fetchActiveContracts` is `private`, widen it to `public` or add a thin public wrapper — one-line
change in canton-client.ts.)

- [ ] **Step 4: Export from `index.ts`:**

```ts
export { getCurrentFeeDisclosure, parseFeeConfig, SIGNER_FEE_CONFIG_T, type FeeConfig } from "./fee.js";
```

- [ ] **Step 5: Run; verify pass.** `pnpm --filter canton-sig test` → PASS.

- [ ] **Step 6: Commit.** `git add ts-packages/canton-sig/src/fee.ts ts-packages/canton-sig/src/fee.test.ts ts-packages/canton-sig/src/index.ts && git commit -m "feat(canton-sig): fetch current SignerFeeConfig disclosure"`

### Task 10: Transfer-factory lookup + holding selection

**Files:** Modify `fee.ts`, `fee.test.ts`.

- [ ] **Step 1: Write the failing test** for `selectInputHoldings(holdings, amount)`: returns the
      smallest prefix whose summed `amount` ≥ requested, throws if total is insufficient, and never
      returns more than 100 cids.

- [ ] **Step 2: Run; verify fail.** `pnpm --filter canton-sig test` → FAIL.

- [ ] **Step 3: Implement `selectInputHoldings`** (pure) and `getTransferFactoryForFee` (calls the
      registry API — mirror `transfer.ts`; returns `{ factoryId, choiceContext, disclosed[] }`):

```ts
export function selectInputHoldings(
  holdings: { contractId: string; amount: string }[],
  amount: string,
): string[] {
  const need = Number(amount);
  let acc = 0;
  const picked: string[] = [];
  for (const h of holdings) {
    if (acc >= need || picked.length >= 100) break;
    picked.push(h.contractId);
    acc += Number(h.amount);
  }
  if (acc < need) throw new Error(`insufficient CC: have ${acc}, need ${need}`);
  return picked;
}
```

`getTransferFactoryForFee` posts the transfer details to the instrument admin's registry
`transfer-factory` endpoint and returns the factory cid, the `ChoiceContext` value, and the disclosed
contracts — the exact request/response shape is the one `transfer.ts` uses and the `choiceContext`
keys recorded in Task 2.

- [ ] **Step 4: Run; verify pass.** Commit:
      `git commit -am "feat(canton-sig): select holdings and resolve CC transfer factory"`

### Task 11: Wire the fee into deposit/withdraw submission

**Files:** Modify the deposit/withdraw entry points in `canton-sig` and `src/index.ts`.

- [ ] **Step 1:** In the deposit and withdrawal builders, before submitting: call
      `getCurrentFeeDisclosure`, `getTransferFactoryForFee`, query the requester's `Holding`s
      (`getActiveContracts([requester], HOLDING_T, true)`) and `selectInputHoldings`. Pass
      `feeConfigCid`, `transferFactoryCid`, `inputHoldingCids`, `transferContext` as the new choice
      args; append `[feeConfig.disclosed, ...factory.disclosed, ...holdingDisclosures]` to the
      submission's `disclosedContracts`.

- [ ] **Step 2:** Regenerate bindings and typecheck:

```bash
pnpm codegen:daml && pnpm --filter canton-sig run build 2>&1 | tail -5
```

Expected: clean typecheck against the new choice signatures.

- [ ] **Step 3:** Run the oracle suite. `pnpm -r --filter='@canton/*' --filter='canton-sig' run test` → PASS.

- [ ] **Step 4: Commit.** `git commit -am "feat(canton-sig): attach CC fee to deposit and withdrawal submissions"`

---

## Phase 6 — Off-ledger infrastructure

### Task 12: Fee-disclosure endpoint, daily automation, and infra runbook

**Files:** Create `proposals/cc-signature-fee-runbook.md`; add a small automation script (location per
the repo's ops conventions, e.g. `ts-packages/canton-sig/scripts/reprice-fee.ts`).

- [ ] **Step 1: Write the runbook** documenting the three standing pieces (§6): `feeReceiver`'s
      self-`TransferPreapproval` (kept renewed, ~$1/yr, 90-day expiry), its `FeaturedAppRight`, and the
      fee-disclosure endpoint contract (serves `getCurrentFeeDisclosure`'s result as JSON). Include the
      `sigNetwork → sigNetworkFA` future-party migration steps. Fold in the Task 2 spike result.

- [ ] **Step 2: Write the daily reprice script** — read `amuletPrice` from the current
      `OpenMiningRound`, compute `feeAmount = targetUsd / amuletPrice`, exercise `UpdateFee` with a
      fresh `[validFrom, validUntil]` window overlapping the previous one. Idempotent; safe to run on a
      daily cron.

- [ ] **Step 3: Dry-run the script** against the CN Quickstart stack; confirm `UpdateFee` lands and
      `getCurrentFeeDisclosure` returns the new amount.

- [ ] **Step 4: Commit.** `git commit -m "docs+ops: CC fee runbook and daily reprice automation"`

---

## Phase 7 — Integration & docs

### Task 13: DevNet e2e + mutation coverage

**Files:** Modify `test/src/test/devnet-e2e.test.ts`.

- [ ] **Step 1:** Extend the e2e env schema with the `SignerFeeConfig` disclosure injection (mirror the
      existing `MPC_CANTON_SIGNER_*` pattern, devnet-e2e.test.ts:112-116) and the funded-requester / CC
      details.

- [ ] **Step 2:** In the deposit + withdrawal flows, fetch the fee disclosure + factory + holdings and
      pass the four new args (Phase 5 helpers). Assert: requester CC balance drops by `feeAmount`;
      `feeReceiver` balance rises; the `SignBidirectionalEvent` is created.

- [ ] **Step 3: Fail-closed e2e** — point `feeReceiver` at a party with **no** preapproval; assert
      `RequestDeposit` fails and **no** `SignBidirectionalEvent` exists (anti-bypass).

- [ ] **Step 4: Run** (gated, mutating):

```bash
cd test && MPC_CANTON_LIVE_MUTATE=1 pnpm test 2>&1 | tail -20
```

Expected: deposit/withdraw pass with the charge; fail-closed test passes.

- [ ] **Step 5: Commit.** `git commit -am "test(e2e): assert CC fee charge and fail-closed on missing preapproval"`

### Task 14: Anti-forgery regression + final docs

**Files:** Modify `TestSigner.daml`; update `README.md` sections describing the Signer choices.

- [ ] **Step 1: Add a regression test** asserting `sigNetwork` is **not** a signatory of
      `SignRequest`/`SignBidirectionalEvent` after the change (the §1 invariant) — e.g. a
      `submitMustFail sigNetwork` on a choice that would require its authority, plus a static check that
      the event's signatories are exactly `operators ++ [requester]`.

- [ ] **Step 2: Run all Daml tests + build.** `~/.dpm/bin/dpm build --all && (cd daml-packages/daml-signer && ~/.dpm/bin/dpm test)` → PASS.

- [ ] **Step 3: Update `daml-signer/README.md`** choice tables to include the four fee args and the
      `SignerFeeConfig` template. Run `pnpm prettier --write` on changed docs.

- [ ] **Step 4: Commit.** `git commit -am "test(signer): anti-forgery regression; docs: fee args"`

---

## Self-Review

**Spec coverage:** §4 SignerFeeConfig → Tasks 3-4; §5 Execute charge + threading → Tasks 6-8; §6
off-ledger infra incl. fee-disclosure endpoint → Tasks 9, 12; §8 client → Tasks 9-11; §9 DAR
provisioning → Task 1; §10 spike → Task 2; §12 testing (unit/anti-forgery/mutation/oracle/e2e) →
Tasks 3-8, 13-14. All sections mapped.

**Placeholder scan:** The only deferred specifics are the registry `choiceContext` request/response
shape and the exact vendored DAR version — both are explicitly *captured artifacts* (Task 1 Step 3,
Task 2 Step 4) that downstream tasks reference, not open TODOs. The `<HOLDING>/<TRANSFER>/<META>`
tokens resolve to filenames printed in Task 1 Step 3.

**Type consistency:** Choice-arg names are identical across `Execute`, `SignBidirectional`,
`RequestDeposit`, `RequestWithdrawal` (`feeConfigCid`, `transferFactoryCid`, `inputHoldingCids`,
`transferContext`). Token-standard types match the verbatim reference block. `validateFeeConfig` and
`SignerFeeConfig` field names are consistent across SignerFee.daml and every test.

**Risk note:** Task 2 is the gate. If `TransferFactory_Transfer` cannot be nested, stop and switch to
spec §10 fallback A2 (client-atomic with an on-ledger fee-proof) before Phase 3.
