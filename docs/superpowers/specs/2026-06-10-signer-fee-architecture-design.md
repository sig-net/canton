# Signer Fee Architecture — Late-Bound Fee Collector (Design Spec)

**Status:** approved (owner, 2026-06-10) · **Date:** 2026-06-10 · **Branch:** `feat/cc-deposit-charge`

Successor to the fee mechanics designed in the former `proposals/cc-signature-fee.md` /
`proposals/featured-app-signer-cosigner.md` (removed from `proposals/` in the baseline
consolidation; their surviving decisions live in `daml-packages/daml-signer/README.md` and this
spec). Fee model and economics unchanged. Rides the same breaking baseline redeploy as the
`sigNetworkFA` / `RequestSignature` work.

---

## 1. Goal & non-goals

**Goal.** Make the fee-charge mechanism maximally future-proof: fee _logic_ must be changeable
without rebuilding or re-versioning `daml-signer`, `daml-vault`, any other consumer, or any client —
and without touching the MPC. Lift everything that can be lifted off-chain so the featured-app
party (`sigNetworkFA`) can operate it.

**Decided (owner, 2026-06-10): the fee layer's admin authority is `sigNetworkFA`.** It signs the
registration, the collector, and the price config, controls repricing, and operates the fee
endpoint + automation. `sigNetwork` keeps only the signing-protocol role — a compromised MPC
identity can no longer touch fee pricing or collector binding at all. This makes the
`sigNetworkFA`-independent-from-`sigNetwork` requirement (already stated on the `Signer`) fully
load-bearing for the fee layer.

**Non-goals.**

- Changing the fee _model_. It stays: per-request CC charge, requester → `feeReceiver`, atomic
  and fail-closed inside `RequestSignature`, non-refundable, one-step via the receiver's
  `TransferPreapproval` (the fee decisions recorded in `daml-signer/README.md` § CC signature fee).
- Changing the Signer's authority structure (`signatory sigNetwork, sigNetworkFA`;
  `RequestSignature` controllers `operators, requester`). Explicitly stable per owner decision.
- The MPC node. It is fee-blind today and stays fee-blind (no fee field feeds `requestId` or
  `SignBidirectionalEvent`).
- Featured-app registration / preapproval provisioning (operational; §11).

## 2. The problem with the current shape

Today `Signer.RequestSignature` charges the fee inline: it takes four fee args
(`feeConfigCid : ContractId SignerFeeConfig`, `transferFactoryCid : ContractId TransferFactory`,
`inputHoldingCids : [ContractId Holding]`, `transferContext : ChoiceContext`), reads the
sigNetwork-signed `SignerFeeConfig`, and exercises `TransferFactory_Transfer` directly in the body.

Two coupling facts make this expensive to evolve:

1. **Static linking of template calls.** A choice body runs the callee version it was _compiled
   against_. All real traffic enters via `Vault.RequestDeposit`/`RequestWithdrawal`, so any change
   to `RequestSignature`'s body ships only after: SCU of `daml-signer` → rebuild `daml-vault`
   against it → SCU of `daml-vault` → repeat for every future consumer. Clients regenerate codegen.
2. **Frozen choice shapes.** Under SCU, choice args can only gain `Optional` parameters appended at
   the end; names and consuming-ness never change. The four fee args are mirrored in every
   consumer's choice signature, so every fee-input change cascades as append-only sprawl through
   `daml-signer` _and_ all consumers — forever.

Consequence: the parts the owner expects to change most (fee logic, settlement policy, the
token-standard integration itself) live in the package with the highest change cost and the most
security-sensitive review surface.

## 3. Doc-verified mechanisms this design rests on

All verified against official docs (2026-06-10):

1. **Interface exercises are late-bound.** "In a top-level exercise triggered by a Ledger API
   command, _or in an interface fetch or exercise triggered from the body of a choice_, the rules
   of package preference detailed in dynamic package resolution determine the target template at
   runtime." Upgrading the implementing package changes behavior immediately — no caller rebuild.
   — [SCU reference (3.4)](https://docs.digitalasset.com/build/3.4/reference/smart-contract-upgrades.html)
2. **Interface definitions are frozen; keep them in template-light packages.** "Neither interface
   definitions nor exception definitions can be upgraded." Interface instances may be _added_ to a
   template version, never removed. Docs strongly recommend declaring interfaces in their own
   package. — same page
3. **Package preference & vetting.** By-package-name commands and interface dispatch resolve to a
   version vetted by _all_ participants involved; clients may pin via
   `packageIdSelectionPreference`. Vetting the new DAR on the involved participants _is_ the
   deployment act. — [SCU how-to (3.4)](https://docs.digitalasset.com/build/3.4/sdlc-howtos/smart-contracts/upgrade/smart-contract-upgrades.html)
4. **Disclosed contracts compose with interface choices, nested.** Explicit disclosure bypasses
   visibility during interpretation regardless of choice kind; the Splice token standard exercises
   interface choices on disclosed factory contracts nested inside app workflows as its core
   pattern. — [explicit disclosure](https://docs.digitalasset.com/build/3.4/sdlc-howtos/applications/develop/explicit-contract-disclosure.html),
   [token standard](https://docs.sync.global/app_dev/token_standard/index.html)
5. **The Splice precedent.** API packages (`splice-api-token-*-v1`) are name-versioned and
   "guaranteed stable … published as a new version of the API using a fresh package name" if they
   ever break; `ExtraArgs { context : ChoiceContext, meta : Metadata }` is the sanctioned
   extension channel; implementations evolve behind them with zero client changes (CIP-0107 shipped
   a full internal rewrite of CC transfers — "Users of the token standard APIs do not need to make
   any change"). Registries serve the current factory + disclosures + context over HTTP at submit
   time. — [Daml APIs](https://docs.sync.global/app_dev/daml_api/index.html),
   [MetadataV1](https://docs.sync.global/app_dev/api/splice-api-token-metadata-v1/Splice-Api-Token-MetadataV1.html),
   [CIP-0107](https://github.com/canton-foundation/cips/blob/main/cip-0107/cip-0107.md),
   [transfer-instruction OpenAPI](https://docs.sync.global/app_dev/token_standard/openapi/transfer_instruction.html)

Also relevant: `AppPaymentRequest`/`SubscriptionRequest` are deprecated since splice-0.4.10 (docs
redirect to token-standard allocations), so transfer-via-preapproval remains the right primitive;
CIP-0104 Increment 4 (traffic-based reward computation) is **not yet live on MainNet** — featured
incoming transfers still earn ~$1 activity markers, which rewards making
`feeReceiver = sigNetworkFA = preapproval provider` early.

## 4. Design overview

Apply Splice's own stability pattern to the fee: a frozen Signet fee **API package**, a
separately-versioned **implementation package**, late-bound dispatch from `RequestSignature`, and a
registry-style off-chain **fee endpoint** operated by the FA party.

```
                 frozen forever                      evolves freely (SCU / replace)
        ┌──────────────────────────┐          ┌─────────────────────────────────────┐
        │ signet-api-fee-v1        │          │ signet-fee-amulet (impl)            │
        │  interface FeeCollector  │◄─────────│  template CcFeeCollector            │
        │  FeeCollector_Charge     │implements│   (validate config → factory        │
        │  FeeCollectorRegistration│          │    transfer → fail-closed checks)   │
        └────────────▲─────────────┘          │  template FeePriceConfig (rotates)  │
                     │ depends on             │  depends on splice token-standard   │
        ┌────────────┴─────────────┐          └─────────────────────────────────────┘
        │ daml-signer              │   interface exercise = LATE-BOUND:
        │  RequestSignature:       │   impl upgrades take effect with zero
        │   fetch registration     │   rebuilds of signer / vault / clients
        │   assert sigNetworkFA    │
        │   exercise Charge ───────┼──────────► runs newest commonly-vetted impl
        │   create SignBidirEvent  │
        └──────────────────────────┘
```

On-ledger contracts at runtime (all **sigNetworkFA-signed** — the fee admin authority — and all
served as disclosures by the FA-operated fee endpoint):

| Contract                   | Package      | Lifetime                                                                      |
| -------------------------- | ------------ | ----------------------------------------------------------------------------- |
| `FeeCollectorRegistration` | api (frozen) | long-lived; rotates only when the collector contract is replaced              |
| `CcFeeCollector`           | impl         | long-lived singleton (nonconsuming `Charge`); replaced on wholesale impl swap |
| `FeePriceConfig`           | impl         | rotates ~10 min (today's `SignerFeeConfig` cadence)                           |

## 5. Component specs

### 5.1 `signet-api-fee-v1` (new package — frozen by design)

Name-versioned like Splice APIs: a breaking change later ships as `signet-api-fee-v2` alongside,
never as an upgrade. Depends only on the vendored `splice-api-token-metadata-v1` and
`splice-api-token-holding-v1` (both frozen APIs). Contains no logic.

```daml
module Signet.Api.Fee.V1 where

import Splice.Api.Token.MetadataV1 (ExtraArgs, Metadata)
import Splice.Api.Token.HoldingV1 (Holding)

data FeeCollectorView = FeeCollectorView with
    sigNetworkFA : Party      -- fee admin this collector belongs to
    feeReceiver  : Party      -- current payee (display/debug; authoritative value lives in the impl)
    meta         : Metadata   -- extension room (required from day 1 — see §9)
  deriving (Eq, Show)

data FeeCollector_ChargeResult = FeeCollector_ChargeResult with
    amountCharged : Decimal
    meta          : Metadata
  deriving (Eq, Show)

interface FeeCollector where
  viewtype FeeCollectorView

  charge : Party -> [ContractId Holding] -> ExtraArgs -> Update FeeCollector_ChargeResult

  nonconsuming choice FeeCollector_Charge : FeeCollector_ChargeResult
    with
      payer     : Party
      inputs    : [ContractId Holding]   -- token-standard idiom; non-holding impls take [] + context refs
      extraArgs : ExtraArgs              -- context: endpoint-provided (factory ref, price-config ref, …)
                                         -- meta: caller-provided
    controller payer
    do charge this payer inputs extraArgs

-- Trust anchor: binds "the collector the Signer must use" under the fee admin's
-- (sigNetworkFA's) signature. A requester cannot create one, so a hostile
-- FeeCollector implementation can never be substituted. The admin is also the
-- endpoint operator, so no separate observer is needed — it reads its own ACS.
-- Frozen template → deliberately minimal + meta. One registration can serve
-- every Signer that shares this sigNetworkFA (cross-Signer reuse is harmless:
-- the fee semantics don't depend on which Signer routed the request).
template FeeCollectorRegistration
  with
    sigNetworkFA : Party
    collector    : ContractId FeeCollector
    meta         : Metadata
  where
    signatory sigNetworkFA
```

Frozen-forever inventory of this package: the interface + viewtype, `FeeCollector_Charge`'s
signature, `FeeCollector_ChargeResult`, and `FeeCollectorRegistration`'s fields. Every record
carries a required `Metadata` so additions are _new keys_, never shape changes (avoids the
`Optional`-`Some` downgrade trap entirely).

### 5.2 `signet-fee-amulet` (new package — where change lives)

Owns everything expected to change, including the splice token-standard dependency
(`splice-api-token-transfer-instruction-v1` moves here, out of `daml-signer`):

- `template CcFeeCollector` — `signatory sigNetworkFA`; implements `FeeCollector`. Its `charge`
  body is today's `RequestSignature` fee block, verbatim in semantics: read the price config
  (plain `fetch` — authorized because the collector's own `sigNetworkFA` signatory is ambient in
  the `Charge` subtree), `validateFeeConfig` (sigNetworkFA binding + validity window), resolve the
  `TransferFactory` cid from `extraArgs.context` (key e.g. `signet.network/fee/transfer-factory`,
  an `AV_ContractId`), exercise `TransferFactory_Transfer` with `sender = payer`, and keep the
  fail-closed branching (`Completed` → ok; `Pending`/`Failed` → abort). A `feeAmount == 0` waiver
  guard skips the transfer — making "free mode" a config flip.
- `template FeePriceConfig` — successor of `SignerFeeConfig`, now impl-internal and FA-owned:
  `signatory sigNetworkFA`, same economic fields (receiver, instrument, amount, window, version —
  `feeReceiver` stays re-stampable per roll, per the `UpdateFee.newFeeReceiver` change already in
  the tree) plus `meta : Metadata`. Reprice controller is `sigNetworkFA`; rotates ~10 min via the
  existing `fee-reprice.ts` automation (now running as the FA party). Referenced via
  `extraArgs.context` (key e.g. `signet.network/fee/price-config`) and attached as a disclosure.
- Context keys are documented as **internal to the implementation** (per the token-standard rule:
  "keys are considered internal to the app and should not be read by third-party code") — the impl
  may change them freely together with its endpoint.

Evolution: compatible changes ship as SCU of this package (the live collector contract keeps
working — late binding runs the new code against it); incompatible changes ship as a new
template/package + a fresh collector + a rotated registration. Either way nothing outside this
package rebuilds.

### 5.3 `daml-signer` (modified)

`RequestSignature` swaps four fee args for three, and the fee block shrinks to ~8 lines:

```daml
      with
        ...                                  -- request fields unchanged
        feeRegistrationCid : ContractId FeeCollectorRegistration
        feeInputs          : [ContractId Holding]
        feeExtraArgs       : ExtraArgs
      controller operators, requester
      do
        ...                                  -- operator/txParams asserts unchanged
        registration <- fetch feeRegistrationCid   -- plain fetch: sigNetworkFA is ambient
                                                   -- via the co-signed Signer
        assertMsg "Fee registration belongs to a different sigNetworkFA"
          (registration.sigNetworkFA == sigNetworkFA)
        _ <- exercise registration.collector FeeCollector_Charge with
          payer = requester; inputs = feeInputs; extraArgs = feeExtraArgs
        -- aborts inside Charge propagate: no fee settled → no event (fail-closed)
        ...                                  -- sender derivation + event create unchanged
```

Removed from `daml-signer`: `SignerFee.daml` (template + `ReadFeeConfig` + `validateFeeConfig` move
to the impl package; the `ReadFeeConfig` authority workaround is obsolete — interface-choice
controller semantics and ambient sigNetwork authority cover both reads). Dependency diet:
drops `splice-api-token-transfer-instruction-v1`; gains `signet-api-fee-v1`; keeps `metadata-v1`
and `holding-v1` (frozen APIs, used by the arg types). `daml-signer` becomes near-pure signing
protocol — its SCU surface no longer includes fee logic.

### 5.4 `daml-vault-poc` (modified)

`RequestDeposit` / `RequestWithdrawal` swap the four pass-through fee args for the same three and
forward them verbatim. Drops its `TransferFactory` import. These signatures are now expected to
never change again for fee reasons.

### 5.5 `canton-sig` + the fee endpoint (off-chain, FA-operated)

The fee endpoint evolves from "serve the current `SignerFeeConfig` disclosure" to the full
registry shape (mirroring `POST /registry/transfer-instruction/v1/transfer-factory`):

```
POST /fee/v1/collector  →  {
  registrationId, collectorId,
  choiceContext: {
    choiceContextData,            -- price-config ref, transfer-factory ref, … (opaque to clients)
    disclosedContracts: [ registration, collector, priceConfig ]
  }
}
```

`canton-sig` changes: `getCurrentFeeDisclosure` → `getFeeCollector` (above);
`assembleFeeChoiceArgs` builds `{feeRegistrationCid, feeInputs, feeExtraArgs}` by merging the fee
endpoint's context with the CC token-registry context (factory + AmuletRules + OpenMiningRound
disclosures, fetched exactly as today via `getTransferFactoryForFee`); holding selection unchanged.
Clients treat `choiceContextData` opaquely and pass it through — the documented token-standard rule
that lets the impl change its required context without client releases.

## 6. Submit-time data flow

1. Client → FA fee endpoint: current `{registration, collector, priceConfig}` disclosures + context.
2. Client → CC token registry: current transfer factory + its disclosures + transfer context.
3. Client selects the requester's `Holding`s covering the advertised fee.
4. Client submits `Vault.RequestDeposit/RequestWithdrawal` (by package-name template ref) with all
   disclosures attached; args carry `(feeRegistrationCid, feeInputs, feeExtraArgs)`.
5. On-ledger, atomically: Vault validates calldata → `Signer.RequestSignature` → registration
   check → `FeeCollector_Charge` (late-bound impl: config validation, factory transfer, fail-closed)
   → `SignBidirectionalEvent` created.
6. MPC flow unchanged from here.

## 7. Security analysis

- **Anti-forgery (unchanged).** `RequestSignature` controllers stay `operators, requester`;
  `sigNetwork` remains observer-only on `SignBidirectionalEvent`. The fee path adds no request
  authority.
- **No fee bypass (new mechanism, equivalent strength).** Today a requester cannot forge a cheap
  `SignerFeeConfig` because it carries the fee admin's signature. In the new shape the requester
  could write a hostile `FeeCollector` implementation whose _view_ lies — but the Signer never
  trusts the view: it trusts `FeeCollectorRegistration`, which only `sigNetworkFA` can create.
  Substitution is therefore impossible at the ledger level. Governance corollary: signing a
  registration is the act that blesses an implementation — treat it like a deploy approval by the
  FA party.
- **Stronger authority separation (new).** With the fee layer FA-signed, a compromised
  `sigNetwork` (MPC identity) can neither forge sign requests (unchanged) _nor_ reprice fees,
  re-point the payee, or re-bind the collector (new). Fee/business authority and signing authority
  are now fully disjoint, which is what makes the independence requirement on `sigNetworkFA` (own
  key, own participant) load-bearing rather than advisory.
- **Fail-closed (unchanged).** Any abort inside `Charge` (expired config, insufficient holdings,
  lapsed preapproval → `Pending`, transfer failure) kills the whole transaction; no event, no MPC
  work, by Daml atomicity.
- **MPC blindness (unchanged).** No fee data feeds `requestId`, the event, or the Rust mirrors.
- **New surface: package vetting.** Late binding means whoever can get an impl version vetted on
  the involved participants controls live fee behavior. This is the same trust already extended to
  DAR uploads generally; document vetting approval as part of the fee-change runbook.
- **Deferred hardening (not in v1): `FeeReceipt`.** An API-package receipt template
  (sigNetworkFA-signed, minted by the honest impl under the collector's ambient authority,
  validated + consumed by `RequestSignature`) would additionally prove _in-transaction_ that the
  charge body executed. Deferred because the registration anchor already kills the only
  adversarial case — an FA-deployed-but-buggy impl harms only the FA party, the fee beneficiary.
  Revisit if registration governance weakens.

## 8. Why this is better than the current design

The current design is sound for what it fixes in place: the fee model, atomicity, anti-forgery.
What it gets wrong is _where change lives_. Concretely, scenario by scenario:

| Change scenario                                                                                  | Today (fee inline in `daml-signer`)                                                                                | This design                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Reprice / change receiver / change instrument                                                    | Config rotation (`UpdateFee` / recreate)                                                                           | Same — `FeePriceConfig` rotation. No regression.                                  |
| Waive fee (zero-fee mode)                                                                        | SCU `daml-signer` + rebuild & SCU `daml-vault` + codegen (body has no zero-guard)                                  | Config flip (impl ships the guard)                                                |
| Change fee logic: settlement policy, validation rules, retries, metadata stamped on the transfer | SCU `daml-signer` → rebuild + SCU `daml-vault` → every consumer, every client codegen                              | SCU **impl package only** + vet. Zero rebuilds anywhere                           |
| Splice ships token-standard `-v2` interfaces                                                     | Append `Optional` args to `RequestSignature` **and** every consumer choice, forever-vestigial old args             | Impl package change only; `daml-signer`/`daml-vault` never see it                 |
| Switch mechanism entirely (allocations, burn-mint, credits)                                      | Effectively blocked: choice args/names frozen under SCU → append-sprawl or a breaking redeploy of the whole Signer | New impl template/package + fresh collector + rotated registration. API unchanged |
| Add fee-related data (correlation ids, reward attribution hints)                                 | New args (append-only cascade) or unused today                                                                     | New `Metadata`/context keys — pure data, no shape change                          |
| Number of frozen fee args mirrored in every consumer choice                                      | 4 today, grows append-only with every input change                                                                 | 3, fixed, opaque — designed to never change again                                 |

Structural wins behind the table:

1. **The cascade inverts.** Today the most-changed logic lives in the least-changeable place; every
   fee iteration drags the security-critical Signer package, all consumers, and all clients through
   an upgrade train. After this change, fee iterations are scoped to one package whose deployment
   is "upload + vet + rotate a disclosure" — the exact operational shape Splice proved at network
   scale with CIP-0107.
2. **`daml-signer` becomes boring — by design.** Its remaining SCU surface is the actual signing
   protocol. Audits of fee changes no longer touch the package that guards anti-forgery; audits of
   signer changes no longer wade through token-standard plumbing. Smaller blast radius per review
   in both directions.
3. **Consumers integrate against a 3-arg, never-changing fee surface.** Third-party consumers of
   the Signer protocol (the stated goal of `daml-signer`'s README) no longer inherit the
   token-standard dependency set or its churn — they vendor two frozen Signet/Splice API DARs and
   are done.
4. **Tests get simpler where it matters.** `daml-signer` tests mock one tiny `FeeCollector`
   interface (the same pattern as today's `MockTransferFactory`, but smaller); the heavy
   token-standard mocks move next to the code they test, in the impl package.
5. **The off-chain story consolidates.** The fee endpoint stops being a bespoke
   "serve one contract" hack and becomes the standard registry shape clients already understand —
   owned and operated outright by `sigNetworkFA`, which is now the fee admin, aligning with the FA
   split and the marker/traffic reward economics (§11).
6. **No security regression buys this.** Anti-forgery, fail-closed atomicity, sigNetwork-signed fee
   authority, and MPC blindness are preserved mechanism-for-mechanism (§7).

Honest costs:

- **Two more packages** (one frozen, one live) and one more on-ledger object (`registration`) with
  a small ceremony. More moving parts to explain to integrators — mitigated by being the same
  pattern as the token standard they already integrate.
- **Late binding is power.** A vetted impl upgrade changes live behavior immediately; vetting
  discipline replaces "consumers opt in by rebuilding". This is the intended feature, but it must
  be governed (runbook + registration signing policy).
- **The API package is a one-shot bet.** If `FeeCollector_Charge`'s shape is wrong, fixing it means
  `signet-api-fee-v2`. Mitigated the way Splice mitigates it: minimal surface + `ExtraArgs`/
  `Metadata` everywhere.
- **Slightly deeper transaction tree** (one extra interface exercise) — negligible traffic delta
  against the evidence post-backs that dominate the fee's own cost model.

## 9. Upgradability rules going forward (inventory)

- **Frozen forever:** everything in `signet-api-fee-v1` (§5.1); `RequestSignature`'s name,
  consuming-ness, arg shapes (append-`Optional`-only) — including the three fee args; the
  evidence/event templates' shapes; `requestId` inputs (cross-language contract with Rust/TS).
- **Evolves by SCU:** `signet-fee-amulet` (impl logic, new `Optional` fields on its own templates —
  new fields only populated after rotation since `FeePriceConfig` recreates every ~10 min);
  `daml-signer`/`daml-vault` for protocol (non-fee) changes.
- **Evolves by rotation (no package change):** `FeePriceConfig` values; `FeeCollectorRegistration`
  → collector binding; the endpoint's `choiceContextData` keys (impl-internal).
- **Evolves by new name:** `signet-api-fee-v2` (last resort); incompatible impl replacements.
- Required-`Metadata`-not-`Optional` rule: all new extension points ship as required `Metadata`
  fields at first publication, so later additions are map keys, never field-shape changes.

## 10. Migration (rides the planned baseline redeploy)

The baseline redeploy (sigNetworkFA co-signing + `RequestSignature` rename) is already breaking;
this design adds no extra breakage, only different args. Sequence:

1. Create `signet-api-fee-v1` + `signet-fee-amulet`; move `SignerFee.daml` logic into the impl
   (delete from `daml-signer`); add the zero-fee guard.
2. Rewire `daml-signer` / `daml-vault-poc` args + deps (§5.3/§5.4); `multi-package.yaml` gains the
   two packages.
3. Test hygiene in the same pass: split `Test*.daml` (incl. `TestToken` mocks) out of the shipped
   DARs into test-only packages; add `upgrades:`/`typecheck-upgrades: yes` wiring for
   `daml-signer`, `daml-vault-poc`, `signet-fee-amulet` once the baseline DARs exist.
4. `canton-sig`: fee-endpoint client + arg assembly (§5.5); `pnpm codegen:daml`.
5. Deploy: upload + vet all DARs; `SignerProposal`/`AcceptSigner` ceremony (already planned);
   create `CcFeeCollector` + `FeePriceConfig` + `FeeCollectorRegistration` **as `sigNetworkFA`**;
   stand up the `/fee/v1/collector` endpoint; rotate `.env` disclosures; DevNet e2e.
6. MPC: zero fee-related changes. (The independently-known baseline items remain: choice-name check
   `SignBidirectional` → `RequestSignature`, and switching `signer_template_id` to the
   `#daml-signer:Signer:Signer` package-name form.)

## 11. Off-chain operations kit (FA-operated)

Runnable off-ledger by `sigNetworkFA` (the fee admin), all doc-verified:

- **Fee endpoint** (§5.5) — registry-pattern disclosures; the precedent is Scan serving
  `OpenMiningRound`/`AmuletRules` and registries serving transfer factories.
- **Pricing oracle + reprice loop** — unchanged `fee_cc` formula (`fee-pricing.ts`) and the
  already-implemented `fee-reprice.ts` automation (`repriceOnce`/`runRepriceLoop`,
  `scripts/reprice-fee.ts`), re-pointed at `FeePriceConfig` and run as the FA party; inputs from
  Scan (`amuletPrice` in the open round; CIP-0104 `app_activity_records`/`traffic_summary` for
  measured bytes once Increment 2/3 data is used).
- **Preapproval renewal** — auto if `feeReceiver` is the validator operator party; else a renewal
  job before the 30-days-to-expiry window (~$1/yr, 90-day terms).
- **Reward minting** — delegate via CIP-73 `MintingDelegation`; beneficiary-split computation is
  explicitly app-built off-ledger, only the split amounts go on-ledger.
- Irreducibly on-ledger: the CC transfer, `FeaturedAppRight`, `TransferPreapproval`, the three fee
  contracts, coupons/minting, and FA's ambient co-signature.
- Economics note: until CIP-0104 Increment 4 cuts over (not live on MainNet as of mid-2026),
  featured incoming fee transfers earn `feeReceiver` ~$1 activity markers — pointing the
  preapproval + `feeReceiver` at `sigNetworkFA` early captures this immediately.

## 12. Testing strategy

- **Daml Script (`daml-signer` + `MockFeeCollector`):** charge-success creates the event;
  charge-abort (mock set to fail) creates **no** event; registration with wrong `sigNetworkFA`
  rejected; a requester cannot create a `FeeCollectorRegistration` (signatory check); zero-fee
  waiver path skips the transfer but still creates the event.
- **Daml Script (`signet-fee-amulet`):** port the existing `TestSignerFee` suite (config window,
  forged config, insufficient holdings, `Pending`/`Failed` branches) against `CcFeeCollector` with
  the existing `MockTransferFactory`/`MockHolding`.
- **Upgrade tests:** `dpm upgrade-check --participant` impl v1 → v2 in CI; a script exercising the
  _existing_ collector contract after an impl SCU (late-binding smoke test).
- **Mutation tests (repo convention):** delete the `FeeCollector_Charge` exercise → fee-enforcement
  test must fail; flip the registration `sigNetwork` assert → forged-registration test must fail;
  remove the fail-closed `Pending` abort in the impl → impl suite must fail.
- **Golden/oracle:** `fee-pricing.ts` reference calc unchanged; `requestId` cross-language vectors
  unchanged (fee never feeds them — assert this stays true).
- **e2e:** DevNet deposit + withdraw through the new endpoint + args; verify the charge on Scan and
  the marker attribution to `feeReceiver`.

## 13. Open questions

1. ~~Registration/collector signing party~~ — **Resolved (owner, 2026-06-10): `sigNetworkFA` is
   the fee admin.** It signs the registration, collector, and price config, and controls
   repricing; `RequestSignature` binds against the Signer's own `sigNetworkFA` field.
2. **`packageIdSelectionPreference` pinning** — should the fee endpoint return a recommended impl
   package-id for clients to pin (deterministic rollouts), or rely on default preference
   (newest commonly-vetted)? Default preference is the simpler v1 answer.
3. **Final package names** (`signet-api-fee-v1` / `signet-fee-amulet`) and context-key namespace
   (`signet.network/fee/…`).
4. **`FeeReceipt` hardening** — deferred (§7); re-evaluate if registration governance or vetting
   policy weakens.

## 14. References

- DA docs: [SCU reference](https://docs.digitalasset.com/build/3.4/reference/smart-contract-upgrades.html) ·
  [SCU how-to](https://docs.digitalasset.com/build/3.4/sdlc-howtos/smart-contracts/upgrade/smart-contract-upgrades.html) ·
  [explicit disclosure](https://docs.digitalasset.com/build/3.4/sdlc-howtos/applications/develop/explicit-contract-disclosure.html) ·
  [interfaces](https://docs.digitalasset.com/build/3.4/reference/daml/interfaces.html)
- Splice/CN: [token standard](https://docs.sync.global/app_dev/token_standard/index.html) ·
  [MetadataV1 API](https://docs.sync.global/app_dev/api/splice-api-token-metadata-v1/Splice-Api-Token-MetadataV1.html) ·
  [transfer-instruction OpenAPI](https://docs.sync.global/app_dev/token_standard/openapi/transfer_instruction.html) ·
  [preapprovals](https://docs.dev.sync.global/background/preapprovals.html) ·
  [Scan APIs](https://docs.sync.global/app_dev/scan_api/scan_global_synchronizer_operations_api.html) ·
  [deprecated wallet payments](https://docs.sync.global/app_dev/api/splice-wallet-payments/index.html)
- CIPs: [0056](https://github.com/canton-foundation/cips/blob/main/cip-0056/cip-0056.md) ·
  [0073](https://github.com/canton-foundation/cips/blob/main/cip-0073/cip-0073.md) ·
  [0104](https://github.com/canton-foundation/cips/blob/main/cip-0104/cip-0104.md) ·
  [0107](https://github.com/canton-foundation/cips/blob/main/cip-0107/cip-0107.md)
- In-repo: `proposals/featured-app-rewards.md` · `daml-signer/README.md` (fee decisions; the
  former `cc-signature-fee.md` / `featured-app-signer-cosigner.md` design docs were removed in the
  proposals consolidation) · `Signer.daml` · `SignerFee.daml` · `Erc20Vault.daml` ·
  `ts-packages/canton-sig/src/fee.ts` / `fee-pricing.ts` / `fee-reprice.ts`
