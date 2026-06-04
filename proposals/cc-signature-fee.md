# CC Signature Fee — Design Spec

**Status:** Design agreed (pricing model finalized) · **Date:** 2026-06-04 · **Branch:** `feat/cc-deposit-charge`

Charge the requester a Canton Coin (CC) fee, atomically, every time they request a signature —
i.e. every time `SignRequest.Execute` mints the `SignBidirectionalEvent` that sigNetwork observes
and the MPC acts on. The fee is paid requester → sigNetwork in the **same transaction** that creates
the event, and the event cannot be created unless the fee settles.

Builds on the two prior research docs in this folder:

- [`canton-transaction-flow.md`](./canton-transaction-flow.md) — Canton submit/confirm/commit flow and
  traffic-price estimation ("submitter pays, confirmer earns").
- [`featured-app-rewards.md`](./featured-app-rewards.md) — CIP-0104/0107 featured-app rewards, the
  TransferPreapproval path, and why the legacy `deposit` field is inert on Canton.

---

## 1. Goal & requirement

|                                        |                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **What**                               | A non-refundable CC charge, requester → sigNetwork, enforced on every signature request.                                                                                                                                                                                             |
| **When**                               | At `SignRequest.Execute`, the choice that creates `SignBidirectionalEvent` (the contract the MPC watches). Deposits and withdrawals each route through exactly one `Execute`, so each is charged once.                                                                               |
| **Enforcement**                        | Atomic. If the fee cannot settle, `Execute` aborts → no `SignBidirectionalEvent` → the MPC never sees a request. No "pay later", no out-of-band invoice.                                                                                                                             |
| **Anti-forgery invariant (must hold)** | sigNetwork stays a **non-signatory observer** of `SignRequest` / `SignBidirectionalEvent` (Signer.daml:159 — _"operators + requester — NOT sigNetwork — so a compromised sigNetwork cannot forge sign requests"_). The fee must not make sigNetwork a signatory of the request path. |

---

## 2. Decisions (this brainstorm)

| #   | Decision                                                                                                                                                                                                                            | Note                                                                                                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Approach A — enforced-atomic, on-ledger nested transfer.** The CC transfer is exercised _inside_ `Execute`, not composed client-side.                                                                                             | Client-composed (sibling root command) is atomic but **not enforced** — a requester could submit `Execute` alone and skip the fee. Rejected. |
| 2   | **Fee lives in a separate mutable template** `SignerFeeConfig`, re-pegged off-ledger ~every 10 min (≈ one OpenMiningRound cycle) to track current Canton economics — _not_ a fixed field on the immutable `Signer`.                                           | Original ask was "daily"; refined to ~10 min (one OpenMiningRound cycle) — see §6.3 — so the coverage buffer stays small and intraday CC moves can't break cost coverage.                 |
| 3   | **Non-refundable.** If the MPC never responds or the EVM tx later fails, the fee is not returned.                                                                                                                                   | Per requirement ("3. good"). Rationale in §7.                                                                                                |
| 4   | **Receiver is parameterized.** Today fee receiver = preapproval provider = featured-app party = `sigNetwork`. A `feeReceiver` field lets this become a dedicated featured-app party (`sigNetworkFA`) later with **no Daml change**. | Per requirement: "it won't be sigNetwork in the future it will be the FeatureApp party like sigNetworkFA."                                   |
| 5   | **Settlement is one-step via the receiver's `TransferPreapproval`.** No second signature from sigNetwork at request time.                                                                                                           | Off-ledger infra in §6.                                                                                                                      |

---

## 3. The protocol today (where the fee hooks in)

```
Erc20Vault.RequestDeposit / RequestWithdrawal   (controller: requester)
  └─ create SignRequest                          (signatory: operators, requester · observer: sigNetwork)
  └─ exercise signerCid SignBidirectional         (Signer.daml:55, controller: requester)
       └─ exercise signRequestCid Execute          (Signer.daml:130, controller: requester)
            └─ create SignBidirectionalEvent        (signatory: operators, requester · observer: sigNetwork)
                                                     ▲ the contract the MPC watches
```

`Execute` runs with the authority of `SignRequest`'s signatories (**operators + requester**) plus its
controller (**requester**). The requester's spend authority is therefore already present inside
`Execute` — which is exactly what a requester → receiver CC transfer needs. **No new authority is
introduced**, so the anti-forgery invariant is untouched: sigNetwork remains observer-only on the
request path; it is merely the _payee_ of a transfer the requester authorizes.

---

## 4. New on-ledger component — `SignerFeeConfig`

A small, mutable, sigNetwork-signed contract holding the current fee. Lives in `daml-signer`.

```haskell
-- illustrative, not final
template SignerFeeConfig
  with
    sigNetwork  : Party        -- identity binding: which Signer this fee applies to
    feeReceiver : Party        -- who is paid + who is the featured-app party
                               --   = sigNetwork today; = sigNetworkFA in the future (§6)
    instrumentAdmin : Party    -- Amulet/DSO admin party of the CC InstrumentId
    instrumentId    : Text     -- the CC instrument ("Amulet")
    feeAmount   : Decimal      -- current CC fee (fee_cc), in CC; re-pegged ~every 10 min by automation (§6)
    version     : Int          -- monotonic; audit/observability
  where
    signatory sigNetwork       -- only sigNetwork can set the fee → a requester cannot forge a cheaper config
    observer feeReceiver

    choice UpdateFee : ContractId SignerFeeConfig
      with newAmount : Decimal
      controller sigNetwork
      do create this with feeAmount = newAmount, version = version + 1
```

**Why a separate template, not a `Signer` field.** `Signer` is the disclosed MPC-identity singleton;
making the fee a field would force a contract churn / package upgrade to reprice. A standalone config
lets sigNetwork reprice with a single `UpdateFee` exercise (~every 10 min, per §6) without touching `Signer`,
`SignRequest`, or any vault.

**Binding & anti-forgery.** `Execute` asserts the supplied config belongs to this Signer
(`feeConfig.sigNetwork == signRequest.sigNetwork`). Because the config is **signatory sigNetwork**, a
requester cannot fabricate a `SignerFeeConfig` with `feeAmount = 0`: such a contract would lack
sigNetwork's signature and the assertion (and disclosure) would reject it.

**Disclosure & repricing.** The `Signer` is handed to requesters as a _static disclosure envelope_
baked into config — `MPC_CANTON_SIGNER_CONTRACT_ID` + `MPC_CANTON_SIGNER_CREATED_EVENT_BLOB`
(devnet-e2e.test.ts:112–116) — and reused forever. That works **only because the Signer is a
never-archived singleton**: its choices are `nonconsuming`, so its contract id is permanent.
`SignerFeeConfig` cannot inherit that trick — every `UpdateFee` archives the old contract and creates
a new one with a **new contract id and new `createdEventBlob`**, so any statically-published envelope
goes stale on the next reprice. Mutability and a permanent cid are mutually exclusive in Daml.

Repricing therefore needs **no manual re-disclosure**. sigNetwork runs one `UpdateFee` exercise
per re-peg interval (~10 min); its service serves whatever the current `SignerFeeConfig` is; the requester fetches that
current envelope at submit time over the **same handoff channel as the Signer** (a requester can't
read the sigNetwork-only config from its own ACS), except it returns the _current_ contract instead of
a fixed one. This is exactly how every Canton app already consumes `OpenMiningRound` (rotates on the
order of minutes) and `AmuletRules`: the cid is never hardcoded — only the endpoint is. We document the
**fetch endpoint** once, not the fee cid.

**In-flight robustness / anti-replay.** Give `SignerFeeConfig` a `validFrom`/`validUntil` window and
assert `getTime` falls inside it in `Execute`. sigNetwork can publish the next interval's config ahead of time
with overlapping windows, so there is always a valid config, in-flight submissions don't fail across
an update, and an expired config can't be replayed even if archived lazily. Without the window, a
stale-cid submission that races an `UpdateFee` simply hits `CONTRACT_NOT_FOUND` and the client
refetches the current envelope and resubmits.

_(Contract key `key sigNetwork` so `Execute` does `fetchByKey` and the client passes no cid —
**deferred, and it does not fit this topology.** Canton resolves keys at the **submitter's**
participant, which here is the requester's; that participant doesn't host sigNetwork (the key
maintainer) and can't see the sigNetwork-only config, so the key won't resolve cross-participant. The
fetched-envelope path is the one that works.)_

---

## 5. The fee charge — inside `SignRequest.Execute`

```haskell
-- illustrative, not final
choice Execute : ContractId SignBidirectionalEvent
  with
    feeConfigCid       : ContractId SignerFeeConfig
    transferFactoryCid : ContractId TransferFactory      -- token-standard factory for CC
    inputHoldingCids   : [ContractId Holding]            -- requester's Amulet holdings (≤ 100)
  controller requester
  do
    feeConfig <- fetch feeConfigCid
    assertMsg "Fee config belongs to a different sigNetwork" (feeConfig.sigNetwork == sigNetwork)

    -- charge first: requester → feeReceiver, settled one-step via feeReceiver's TransferPreapproval.
    -- aborts (insufficient holdings / no preapproval / wrong instrument) propagate and kill Execute.
    _ <- exercise transferFactoryCid TransferFactory_Transfer with
           expectedAdmin = feeConfig.instrumentAdmin
           transfer = Transfer with
             sender   = requester
             receiver = feeConfig.feeReceiver
             amount   = feeConfig.feeAmount
             instrumentId = InstrumentId with admin = feeConfig.instrumentAdmin; id = feeConfig.instrumentId
             inputHoldingCids
             ...                                          -- meta, executeBefore, etc.
           extraArgs = ...

    let sender = computeOperatorsHash (map partyToText operators)
    create SignBidirectionalEvent with
      operators; requester; sigNetwork; sender
      txParams; caip2Id; keyVersion; path; algo; dest; params
      outputDeserializationSchema; respondSerializationSchema
```

- **Atomicity** is structural: a Daml choice is all-or-nothing. Either the transfer settles _and_ the
  event is created, or neither happens.
- **Settlement is one-step** because `feeReceiver` holds a self-provided `TransferPreapproval` (§6):
  the factory consumes the requester's input holdings and credits `feeReceiver` without `feeReceiver`
  signing at request time.
- **Disclosed contracts are transaction-scoped** in Canton — the factory, `AmuletRules`,
  `OpenMiningRound`, the `SignerFeeConfig`, and the requester's holdings are attached at the command
  level and are visible to the _entire_ transaction tree, including this nested exercise. (This is the
  crux the spike validates — see §10.)

### Threading the inputs through the call chain

The factory cid, input-holding cids, and fee-config cid are choice arguments that flow:

```
client ──▶ Vault.RequestDeposit / RequestWithdrawal   (+ feeConfigCid, transferFactoryCid, inputHoldingCids)
        ──▶ Signer.SignBidirectional                  (+ same three)
        ──▶ SignRequest.Execute                        (+ same three)
        ──▶ TransferFactory_Transfer
```

The disclosed contracts themselves (factory blob, `AmuletRules`, `OpenMiningRound`, holdings,
`SignerFeeConfig`) are attached to the **submission**, not stored on any template. Touch points:

- `Signer.daml`: add the three args to `SignBidirectional` and `Execute`; add `SignerFeeConfig`.
- `Erc20Vault.daml`: add the three args to `RequestDeposit` (line 171) and `RequestWithdrawal`
  (line 269); pass them into the existing `exercise signerCid SignBidirectional` calls
  (lines 217, 325). No other vault logic changes.

---

## 6. Off-ledger infrastructure (must be documented & operated)

> **sigNetwork runs a self-provided `TransferPreapproval`** (provider = receiver = sigNetwork, kept
> renewed) **and holds a `FeaturedAppRight`.** This is what makes receipt **atomic** (one-step
> settlement, no sigNetwork liveness needed at request time) **and earns sigNetwork the featured-app
> reward on every fee transfer** — the feature pays for its own traffic, closing the loop with the
> rewards research in `featured-app-rewards.md`.

Concretely, four standing pieces of off-ledger operation:

1. **Self-provided `TransferPreapproval`** — `feeReceiver` pre-approves incoming CC to itself so the
   requester's transfer settles in one step inside `Execute`. The provider pays the small preapproval
   fee (~$1/yr, 90-day expiry per CIP-0107) and must keep it renewed. If it lapses, `Execute` aborts
   (fail-closed) until renewed.
2. **`FeaturedAppRight`** — held by `feeReceiver` so that incoming transfers via its preapproval emit a
   `FeaturedAppActivityMarker` and accrue featured-app rewards (CIP-0104). CC transfer fees are zeroed
   (CIP-0078), so the only real network cost of the charge is **traffic**, which the reward offsets.
3. **Fee-pricing automation (~10 min) — extends the §2 decisions.** A job recomputes `feeAmount` (the
   single CC number) **entirely off-chain** and posts it via `SignerFeeConfig.UpdateFee` once per
   re-peg interval (~10 min, ≈ one `OpenMiningRound` cycle). Only the resulting CC value is posted
   on-ledger, so `Execute` reads no price and needs **no `splice-amulet` build dependency** — the
   token-standard interface DARs of §9 suffice. _(Rejected alternative: reading `amuletPrice` on-ledger
   inside `Execute` for exact per-tx pricing would force a `splice-amulet` build dep, since
   `OpenMiningRound` / `AmuletRules` are not token-standard interfaces. Off-chain pricing keeps deps
   light; the trade is that a posted number is stale between re-pegs.)_

   **What the fee covers.** sigNetwork is the **submitter** of the two evidence post-backs — `Respond`
   and `RespondBidirectional` (`Signer.daml:63,83`) — and the submitter pays their traffic
   ("submitter pays", `canton-transaction-flow.md` §5). The fee reimburses that, plus margin:

   ```text
   bytes    = measured billable bytes of (Respond + RespondBidirectional)   # Scan CIP-0104 traffic API or MemberTraffic delta — measured, never hand-calc
   cost_usd = bytes / 1e6 * extraTrafficPrice            # gross cost; ignore the free base-rate burst (safe upper bound)
   fee_cc   = (cost_usd / amuletPrice) * (1 + coverage + profit)
   #                                          ^buffer    ^0.10
   ```

   `extraTrafficPrice` (USD/MB) and `amuletPrice` (USD↔CC) are read off-chain from Scan / the current
   `OpenMiningRound`.

   - **Gross basis (rewards = upside).** `cost_usd` is the full traffic cost as if always billable.
     Below the free burst (~400 KB / 20 min, `canton-transaction-flow.md` §4) the real marginal cost
     is ≈ 0, so this over-collects at low volume — intentionally, as headroom. sigNetwork _also_ earns
     featured-app rewards on those same confirmed post-backs; that is treated as **upside, never netted
     into the fee** (the reward is an unpredictable, dilutable pooled share).
   - **Markup = two separate terms.** `coverage` (~0.10–0.15, tuned to the worst `amuletPrice` move
     over one re-peg interval + post-back latency, plus `serializedOutput` byte variance and any MPC
     retry) is what actually _guarantees_ coverage; `profit` (0.10) is margin on top. Keep them
     separate — folding both into a single 10% lets a normal CC dip eat the profit and then break
     coverage.
   - **Why ~10 min, not daily.** The only fast-moving input is `amuletPrice` (new `OpenMiningRound`
     ~every 10 min). Re-pegging at that cadence keeps `coverage` small; a daily peg would need a large
     buffer and still could not guarantee coverage across intraday CC moves. Coverage is therefore
     **high-probability, not absolute** (the posted number is stale between re-pegs) — cadence and
     buffer size are the knobs that tighten it.
4. **Fee-disclosure endpoint** — `SignerFeeConfig` is sigNetwork-only (the requester is not a
   stakeholder, exactly like the `Signer`), so the requester cannot read it from its own ACS.
   sigNetwork serves the current disclosure: an active-contracts query by template, run as sigNetwork
   (`getActiveContracts([sigNetwork], SignerFeeConfig, includeCreatedEventBlob = true)` →
   the in-window contract, canton-client.ts:532), returned as the 4-field `DisclosedContract`
   `{templateId, contractId, createdEventBlob, synchronizerId}`. This is the same shape as Splice's
   Scan API serving `OpenMiningRound` / `AmuletRules` — a stable **URL documented once whose response
   rotates** with each `UpdateFee`. (Today the `Signer`'s envelope is the static, never-rotating
   version of this, injected via `.env`.)

### Future party split (`sigNetworkFA`)

Today `feeReceiver = sigNetwork` — the MPC identity also receives the fee, provides the preapproval,
and is the featured party. **In the future this will be a dedicated featured-app party, e.g.
`sigNetworkFA`**, separate from the MPC signing identity. Because `feeReceiver` is a field on
`SignerFeeConfig`, the migration is purely operational: stand up `sigNetworkFA` with its own
`TransferPreapproval` + `FeaturedAppRight`, then `UpdateFee`/recreate the config pointing
`feeReceiver` at `sigNetworkFA`. No change to `Signer`, `SignRequest`, `Execute`, or the vaults. The
spec is written with this split in mind — nothing hardcodes the MPC party as the payee.

---

## 7. Fee semantics

- **One fee per signature request.** A deposit is one `Execute`; a withdrawal is one `Execute`. Each
  is charged once. (Claim/Complete choices create no new `SignBidirectionalEvent`, so they are free.)
- **Amount** = `SignerFeeConfig.feeAmount` (CC) — the single off-chain-computed `fee_cc` from §6.3,
  read as a flat value at `Execute` time (no on-chain price math). Sized to cover sigNetwork's
  **gross** traffic cost of the two evidence post-backs (`Respond` + `RespondBidirectional`) + a
  `coverage` buffer + 10% profit.
- **It's a price, not a pass-through.** Below the free burst sigNetwork's real post-back cost ≈ 0, and
  (if featured) it earns rewards on those same contracts — so at low volume the fee is largely margin.
  Keep it competitive and don't manufacture traffic (featured status is revocable).
- **Instrument** = Canton Coin (Amulet), per the config's `instrumentId` / `instrumentAdmin`.
- **Non-refundable.** The charge buys the _request_ (the observed event + the traffic it costs),
  settled atomically at request time. It is **not** an escrow on the downstream EVM outcome. Refunding
  on MPC non-response or EVM failure would require sigNetwork to _send_ CC back later — reintroducing
  sigNetwork authority/liveness into settlement and breaking the one-step, fail-closed model. Out of
  scope by decision #3.

---

## 8. Client changes (`ts-packages/canton-sig`)

New responsibilities before submitting a deposit/withdrawal:

1. **Read the current fee** — GET the current `SignerFeeConfig` disclosure from sigNetwork's
   fee-disclosure endpoint (§6); read `feeAmount`, `feeReceiver`, instrument, and the contract id +
   `createdEventBlob`. The requester cannot query it directly (not a stakeholder), so it is served by
   sigNetwork — same handoff as the Signer envelope, but live.
2. **Resolve the CC `TransferFactory`** — token-standard registry lookup for the instrument; collect
   its required disclosures (`AmuletRules`, `OpenMiningRound`, the factory itself).
3. **Select input holdings** — pick the requester's Amulet `Holding` contracts covering `feeAmount`
   (≤ 100 inputs, token-standard cap); attach as disclosed contracts.
4. **Assemble the submission** — pass `feeConfigCid`, `transferFactoryCid`, `inputHoldingCids` as
   choice args; attach all disclosed contracts (factory, amulet rules, open round, fee config,
   holdings) to the command.

New helpers in `canton-sig` for factory/disclosure resolution and holding selection; the existing
deposit/withdraw entry points gain the fee plumbing. Bindings regenerate via `pnpm codegen:daml`
after the Daml changes.

---

## 9. Dependencies & DAR provisioning — **the hard-blocker answer**

**Verified in this environment (2026-06-04):**

| Check                                                      | Result                                                                                                                                                                                 |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| splice / amulet / token-standard DARs on disk              | **None** (searched `~/Documents/signet`, `~/Downloads`, `~/.daml`, `~/.dpm`, caches).                                                                                                  |
| Any `daml.yaml` / `multi-package.yaml` depending on splice | **None** — every in-repo package depends only on `daml-prim`, `daml-stdlib`, `daml-script` + internal DARs.                                                                            |
| `cn-quickstart` checked out locally                        | **No** (not present under `$HOME`).                                                                                                                                                    |
| Daml SDK 3.4.11 bundled token-standard DARs                | **No** — the SDK ships none.                                                                                                                                                           |
| `dpm` (1.0.10) able to fetch them                          | **No** — `dpm`'s registry (`europe-docker.pkg.dev/da-images/public`) serves the **dpm-SDK**, not third-party Daml packages. `dpm` has no `add`/`install-package` for DAR dependencies. |
| Splice runtime (where CC/amulet actually run)              | **Provided by the CN Quickstart Docker stack** (SETUP.md) — packages are vetted _inside the containers_, not exposed as local build files. Also vetted on DevNet.                      |

**Conclusion: not a wall — a provisioning task.** The split that makes this tractable:

- **Build-time (needed to compile `daml-signer`):** only the token-standard **interface** DARs —
  `splice-api-token-holding-v1`, `splice-api-token-transfer-instruction-v1`,
  `splice-api-token-metadata-v1`. These are small, version-stable, and published. They must be
  **vendored** into the repo (e.g. `daml-packages/vendor/`) and added as `data-dependencies` to
  `daml-signer/daml.yaml`.
- **Run-time (must be vetted on the target participant):** the heavy `splice-amulet` implementation
  (where `AmuletRules`, `TransferFactory`, `TransferPreapproval`, `OpenMiningRound` live). We do **not**
  compile against it; it is already vetted on CN Quickstart / DevNet. ✓

**How to obtain the interface DARs** (pin the version to the Splice release running on the target
network; confirm exact source in the plan): the Splice release bundle, or extract from a running
CN Quickstart participant (`dpm inspect-dar` / Canton admin `participant.dars.download`) after
`make build`. Use **package-name** template-id references (`#splice-api-token-transfer-instruction-v1:…`)
so a patch-version drift between the vendored interface and the vetted runtime implementation does not
break the build.

---

## 10. Highest risk — the spike (plan step 1)

**Assumption:** `TransferFactory_Transfer` can be exercised _nested inside_ `SignRequest.Execute`
(with the factory, amulet rules, open round, and input holdings supplied as command-level disclosed
contracts), not only as a top-level command.

- **Why it should hold:** authority is satisfied (requester is the transfer's `sender` and is the
  `Execute` controller), and disclosed contracts are transaction-scoped (visible to nested exercises).
  The token standard is explicitly designed for apps to compose transfers inside their own workflows.
- **Why it must be proven anyway:** the end-to-end mechanics — holding selection, the factory's
  internal fee/round math, and `FeaturedAppActivityMarker` emission — must actually execute in the
  nested position on Canton 3.4.11 + the target Splice version.

**Spike success criteria:** on the CN Quickstart stack (or DevNet), a single transaction exercises a
nested `TransferFactory_Transfer` that (a) moves CC requester → receiver via the receiver's
preapproval, (b) creates a sibling `SignBidirectionalEvent`, (c) aborts cleanly when holdings are
insufficient, and (d) emits the featured-app marker crediting the receiver.

**Fallbacks if nesting fails:**

- **A2 — client-atomic with an on-ledger fee-proof.** `Execute` requires a fee-payment contract
  created in the _same_ transaction and asserts its amount/receiver. Keeps atomicity + enforcement
  without nesting, at the cost of an extra template and a tighter client contract.
- **C — prepaid credit.** Requester tops up a `SignerCredit` balance (its own CC transfer); `Execute`
  debits one unit. Decouples settlement from the request, but adds a credit lifecycle and a top-up UX.

---

## 11. Blast radius & migration

- **`daml-signer`** — new template (`SignerFeeConfig`, additive) **plus** changed choice signatures on
  `SignBidirectional` and `Execute` (new required args). Signature changes are **breaking** → new
  package version; existing in-flight `SignRequest`/`Signer` contracts created by the old version keep
  the old choice shape. Sequence the upgrade in the plan.
- **`daml-vault-poc`** — `RequestDeposit` / `RequestWithdrawal` gain args and recompile against the new
  `daml-signer`. `ClaimDeposit` / `CompleteWithdrawal` unchanged.
- **Codegen** — `pnpm codegen:daml` after Daml changes; `pnpm codegen:api` if API bindings shift.
- **Tests** — the DevNet e2e (`test/src/test/devnet-e2e.test.ts`) now needs the requester funded with
  CC and the receiver's preapproval + featured-app right standing.
- **Vetting order** — vendored interface DARs and the new `daml-signer` / `daml-vault` versions must be
  uploaded and vetted on the participant before the new flow runs.

---

## 12. Testing strategy

- **Daml Script (unit):** fee charged on `Execute`; `Execute` aborts when holdings are insufficient /
  preapproval missing (no `SignBidirectionalEvent` created); forged `SignerFeeConfig` (wrong
  signatory / wrong `sigNetwork`) rejected; `UpdateFee` reprices and old cid is rejected afterward.
- **Anti-forgery regression:** assert sigNetwork is still a non-signatory observer on `SignRequest` /
  `SignBidirectionalEvent` after the change.
- **Mutation test:** delete the `TransferFactory_Transfer` line → the fee-enforcement test must fail.
  Flip the binding assertion (`==` → `/=`) → the forged-config test must fail.
- **Oracle/golden:** the off-chain `fee_cc` computation (§6.3: gross `cost_usd` → ÷ `amuletPrice` →
  × (1 + `coverage` + 0.10)) checked against a reference calc, including the buffer and profit terms.
- **Spike + e2e:** §10 spike on CN Quickstart, then full deposit + withdraw with a real CC charge and
  reward attribution.

---

## 13. Open questions (resolve in the plan)

1. Exact Splice version to pin the vendored interface DARs to (must match the target network's vetted
   `splice-amulet`).
2. Confirm the canonical download source for the interface DARs (Splice release vs. extracted from a
   running participant).
3. Whether to use `WalletUserProxy`-style featured attribution or direct preapproval-provider
   attribution for the reward (per `featured-app-rewards.md`) — confirm against the live token-standard
   API on the target Splice version.
4. Fee-config validity-window length and pre-publish overlap policy (§4) — operational tuning for the
   ~10-min `UpdateFee` so in-flight requests never straddle a gap. _(The disclosure model itself is
   decided: the client fetches the current envelope from sigNetwork's endpoint, not a hardcoded cid;
   contract keys are ruled out as cross-participant.)_
5. **Empirical pricing baseline** — measure billable bytes of `Respond` / `RespondBidirectional` (Scan
   CIP-0104 traffic API or `MemberTraffic` delta on DevNet/TestNet) to fix the `bytes` constant, and
   size the `coverage` buffer from observed `amuletPrice` volatility over one re-peg interval +
   post-back latency. Re-measure `bytes` whenever the evidence-contract shapes change.

---

## 14. References

- `proposals/canton-transaction-flow.md` — submit/confirm/commit flow, traffic pricing.
- `proposals/featured-app-rewards.md` — CIP-0104/0107 rewards, TransferPreapproval, inert `deposit`.
- `SETUP.md` — CN Quickstart local Splice stack (the runtime that vets amulet/token-standard).
- Token Standard (CIP-0056): `Splice.Api.Token.HoldingV1`, `…TransferInstructionV1`
  (`TransferFactory`, `TransferFactory_Transfer`), `…MetadataV1`.
- CIP-0104 (featured-app rewards), CIP-0107 (`TransferPreapproval_SendV2`), CIP-0078 (zeroed CC fees).
- In-repo anchors: `Signer.daml:55,130,159`; `Erc20Vault.daml:171,217,269,325`.
