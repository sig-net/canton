# Featured App Rewards Findings

> **Updated for the 2026 tokenomics change.** Canton app rewards are now
> **traffic-based** (CIP-0104), not activity-marker-based. The earlier version
> of this note — built on activity markers ("Path 1") and a CC service fee
> ("Path 2") — is **superseded**; several of its conclusions have changed. The
> throughline that survives: Signet earns only if its featured party is a
> **confirmer** on the relevant transactions.

> **Implementation status (2026-06-11, `feat/cc-deposit-charge`).** Two pieces
> of this note have since shipped: **(1)** the featured party is now a dedicated
> `sigNetworkFA` (split from the MPC's `sigNetwork`) that co-signs — i.e.
> **confirms** — `SignBidirectionalEvent` and both MPC evidence events. This
> captures the byte-heavy request envelope while resolving §4's Tier-2 tension:
> the confirmer is a separate FA party, not `sigNetwork`, so the anti-forgery
> property is intact. **(2)** The CC service fee of §7 is implemented exactly as
> recommended — an atomic token-standard transfer inside `Signer.RequestSignature`,
> fail-closed (see [`daml-signer` README § CC signature fee](../daml-packages/daml-signer/README.md#cc-signature-fee)).
> §3 reflects the shipped roles. Tier 1 (co-signing the vault value layer)
> remains unimplemented strategy.

This note summarizes the current, verified understanding of Canton Featured App
rewards for Signet's Canton/MPC bridge architecture.

## TL;DR

- App rewards are governed by **CIP-0104 (approved 2026-02-12, rolling out on
  MainNet)**: an app earns a share of the **confirmation traffic (envelope
  bytes)** on state-changing views where its **featured provider party appears
  as a confirmer**. There is no value term and no per-transaction marker.
- **Confirmer = signatory / acting party. An observer earns nothing.**
- Reward is a **pooled share** of a fixed per-round issuance, and the
  **submitter pays** the traffic while the **confirmer earns** it.
- For Signet: register a `FeaturedAppRight`, then make the Signet provider
  party a **confirmer (signatory)** on the traffic worth monetizing. As
  shipped, `sigNetworkFA` confirms the request event and both MPC evidence
  events (§3); the high-value asset movements in the vault are still confirmed
  by operators/users only — the open Tier-1 surface.

## 1. The current reward model (verified against official docs)

**Gate — featured status.** Since CIP-0078, only featured applications earn app
rewards. Approval is via the Foundation / Tokenomics Committee
(`sync.global/featured-app-request`); it places a `FeaturedAppRight` contract
on-ledger for the provider party. The DSO reads active `FeaturedAppRight`s at
the start of each mining round to determine which parties qualify.

**Earning — traffic, attributed to confirmers.** Per CIP-0104:

> "the traffic cost of a successful confirmation request is granted to the app
> provider parties proportional to the envelope sizes of the envelopes on which
> they appear as confirmers"

> "Distribute app activity weights only among the confirming app providers of a
> view instead of sharing them among all featured app providers that are
> informees"

Mechanics that matter:

- **Bytes, not value.** The reward formula has no value term — only traffic:
  `per_app_minting_allowance0 = (total_app_traffic / 1e6) *
traffic_price_in_CC_per_MB * issuance_per_featured_app_weight`. It measures
  "the actual burn contributed by all activity of an app provider party by
  default."
- **Confirmer = signatory or acting party.** In Canton, signatories and the
  acting parties of a choice are the confirming parties; observers are
  informees that do **not** confirm. Observer status earns nothing.
- **Pooled share.** `issuance_per_featured_app_weight` reflects the round's
  app-reward issuance spread across total app traffic, so payout is pro-rata:
  ≈ your confirmed bytes ÷ total network app-bytes × the pool. More network
  traffic dilutes everyone.
- **Submitter pays, confirmer earns.** "The sequencer continues to charge the
  traffic cost of a submission to the submitting validator node." Only
  confirmation _responses_ became free; the confirmation _request_ traffic you
  earn on is paid by whoever submits.
- **Threshold & coupon.** Per-party rewards below `appRewardCouponThreshold`
  (default $0.50/round) are burned; otherwise SV automation creates exactly one
  `AppRewardCoupon` per party per round (`appRewardCouponLifetime` 24h). Minting
  can be automated via `MintingDelegations` (CIP-73).

**Rollout status (as of mid-2026).** Increment 1 (free confirmation responses)
shipped in Splice 0.5.11 (~Mar 2); Increments 2–3 (per-envelope traffic cost and
app activity records on Scan) shipped in 0.5.18. Increment 4 — the actual switch
of reward _computation_ to traffic, which removes marker/coupon creation from
`splice-amulet` — must land ≥30 days after Increment 2 and was not confirmed
live at the time of writing. **Until Increment 4 cuts over, activity markers
remain the live earning mechanism**, so the superseded mechanisms below still
function in the interim.

## 2. What this overturns from the previous version of this note

- **Activity markers (old "Path 1") are being removed.** The per-transaction
  `FeaturedAppRight_CreateActivityMarker { beneficiaries }` API is deprecated;
  `splice-amulet` stops creating `FeaturedAppActivityMarker` / `AppRewardCoupon`
  the old way at the Increment-4 cutover. Do not build new work on markers.
- **The "good vs bad marker points" rule is obsolete.** Markers were governed
  by a fair-use rule ("only asset transfers or equivalent; no intermediate
  steps"). Traffic-based rewards have **no value/intermediary gate** — any
  state-changing view you confirm earns by its bytes. The SVs removed the gate
  deliberately ("app markers were found to be too limiting"). _But the value
  layer is still strategically best — see §4._
- **Passive beneficiary earning is dead.** Beneficiaries survive only as a way
  for a **confirming earner** to split its own round allowance at minting time
  (the same construction used for SV-reward beneficiaries; automation left to
  the app). A party that does not confirm **cannot** earn by being named a
  beneficiary. So "integrator marks an event and lists Signet as a 60%
  beneficiary" no longer earns Signet anything on its own — it degrades to a
  voluntary revenue-share contingent on the integrator's confirming activity.
- **CC service fee (old "Path 2") is no longer a distinct reward path.**
  CIP-0107 (approved 2026-03-10) changed featured CC transfers to create a
  `FeaturedAppActivityMarker` instead of a direct `AppRewardCoupon`, pinned
  `extraFeaturedAppRewardAmount` == `featuredAppActivityMarkerAmount` (both $1),
  and deprecated the `transfer-preapproval/prepare-send` and `/submit-send`
  validator endpoints. Post-cutover, a CC transfer simply generates confirmation
  traffic like any other transaction — you earn on it only if your featured
  party confirms it. Charging a real CC fee remains a fine _business_ model, but
  it is not a separate rewards lever.
- **"The signer is a weak reward surface" partially flips.** Under markers
  (value-based) the signing layer was weak. Under traffic (byte-based), the
  signing-evidence contracts are byte-heavy (calldata, serialized output, DER
  signatures) and **do** earn — _if_ Signet confirms them. See §3–§4.

## 3. Where Signet confirms today (code mapping)

Signet now runs two parties: `sigNetwork` (the MPC service) and `sigNetworkFA`
(the featured provider party holding the `FeaturedAppRight`; co-signs the Signer
once via `SignerProposal`/`AcceptSigner` and is thereafter an ambient
co-signatory). Reward eligibility per contract, as the templates stand today:

| Contract                                    | `sigNetworkFA` role today                    | Confirmer? | Earns? |
| ------------------------------------------- | -------------------------------------------- | ---------- | ------ |
| `SignBidirectionalEvent` (`Signer.daml`)    | **signatory** (ambient via co-signed Signer) | yes        | ✅     |
| `SignatureRespondedEvent` (`Signer.daml`)   | **signatory**                                | yes        | ✅     |
| `RespondBidirectionalEvent` (`Signer.daml`) | **signatory**                                | yes        | ✅     |
| `Vault` (`Erc20Vault.daml`)                 | not a stakeholder                            | no         | ❌     |
| `Erc20Holding` (`Erc20Vault.daml`)          | not a stakeholder                            | no         | ❌     |

Key points: the byte-heaviest envelope — the request event, with calldata and
schemas — is **submitted and paid by the requester** while `sigNetworkFA`
confirms it: the good direction (submitter pays, confirmer earns). The response
evidence is also FA-confirmed, but `sigNetwork` submits those transactions, so
Signet pays that traffic itself (the CC signature fee prices this in — see §7).
The high-value asset movements (`ClaimDeposit` → `Erc20Holding`,
`CompleteWithdrawal`) are still submitted by the `requester` and confirmed by
`operators` only — **not** Signet; that is the remaining Tier-1 surface.

## 4. Recommended strategy — tiered by custody cost

**Tier 0 — Get featured; harvest what Signet already signs.** Register a
`FeaturedAppRight` for `sigNetwork`. The `Respond` / `RespondBidirectional`
evidence Signet already confirms then starts earning. No authorization change,
no security regression. Caveat: Signet is the submitter of those transactions,
so it pays their traffic; the net gain is the featured-app subsidy margin, and
the per-op byte volume is modest. Worth taking, but not the prize.

**Tier 1 — Co-sign the value layer (the prize; recommended).** Make the Signet
provider party a **signatory** on the asset-movement contracts — minimally
`Erc20Holding`, ideally the claim/withdraw result views:

```daml
template Erc20Holding
  with
    operators      : [Party]
    signetProvider : Party
    owner          : Party
    erc20Address   : BytesHex
    amount         : BytesHex
  where
    signatory operators, signetProvider
    observer owner
```

Then Signet confirms the genuine, byte-heavy, **user-submitted** asset
movements: the `requester` pays the traffic, Signet earns it. This is the
durable, high-volume reward surface. Costs to accept:

- Signet enters the value-authorization path → more custodial; reverses the
  deliberate "domain contracts decoupled from MPC layer" decision at
  `Erc20Vault.daml:80`.
- The value-creating transactions now need Signet's authority — via Signet
  co-controlling the choice or a pre-authorization/delegation contract — which
  changes partner workflows.
- Signet's confirming node becomes a liveness dependency for those flows.
- Adding a signatory is an authorization change, **not** a simple additive Smart
  Contract Upgrade; partners must re-integrate.

**Tier 2 — Co-sign `SignBidirectionalEvent` with `sigNetwork` (not
recommended).** It is the byte-heaviest envelope (`sigNetworkFA` already
co-signs it), but making `sigNetwork` a signatory regresses the deliberate
anti-forgery property — "sigNetwork is still NOT an authorizer — a compromised
sigNetwork cannot forge sign requests at the ledger level" (`Signer.daml:209`).
Not worth it for marginal extra bytes; capture request-side value via Tier 1.

**Maximization tactics (inside fair use):**

- **Be the sole _featured_ confirmer.** Keep `operators` as non-featured
  signatories: they confirm (fine for authorization) but, lacking a
  `FeaturedAppRight`, do not dilute Signet's `num_app_confirmers`. Signet then
  captures the full app-weight on those envelopes.
- **Route genuine, user-paid, byte-heavy state changes** through views Signet
  confirms. Do **not** manufacture traffic: the submitter pays for it and it
  dilutes the shared pool, so self-farming is economically self-defeating.
- **Aggregate above the $0.50/round threshold** under one provider party;
  sub-threshold rewards are burned.
- **Use beneficiaries the other direction** — when Signet is the confirming
  earner, split its allowance _out_ to integrators/operators as a revenue-share
  (a payout tool, downstream of earning).

## 5. Custody & governance tradeoff (updated)

Earning under traffic-based rewards _requires_ confirmer status, and confirmer
status _is_ co-authorization — so the reward goal and a minimal-authority,
non-custodial signing design are in direct tension. The balanced position is
**shared authorization**: `operators` remain the multisig authority, and the
Signet provider party is additionally required only on the Signet-backed
value-layer contracts (Tier 1) — not on the authority-critical
`SignBidirectionalEvent` (Tier 2). This keeps the anti-forgery property while
making Signet a confirmer where the rewardable traffic actually is.

## 6. Anti-abuse / fair use (updated)

Per-transaction value governance is gone. It is replaced by:

- **Economic self-limiting** — the submitter pays traffic, and rewards are a
  pooled share, so generating meaningless traffic costs more than it returns.
- **Featured-app status governance** — featured status is approved and
  **revocable** by the Tokenomics Committee. Egregious traffic-farming is not
  blocked per transaction but can cost Signet its `FeaturedAppRight`.

## 7. CC service fee and the `deposit` field (verified)

> **Shipped.** The recommendation below is implemented: `Signer.RequestSignature`
> charges a CC signature fee as an atomic token-standard transfer (requester →
> `feeReceiver`), fail-closed before the `SignBidirectionalEvent` is created.
> See [`daml-signer` README § CC signature fee](../daml-packages/daml-signer/README.md#cc-signature-fee).
> The `deposit`-field analysis below remains true — the node-side field is not,
> and must never be, the collection mechanism.

The MPC node hardcodes the Canton deposit to zero —
`SignBidirectionalEvent::Canton(_) => 0` in
`mpc/chain-signatures/node/src/stream/ops.rs:129`, because the Canton event
carries no such field (`indexer_canton/mod.rs`). That is correct, and putting a
value in that field would **not** charge anyone:

- The `deposit` field is **not a collection mechanism** — it mirrors a value the
  _source chain_ enforces, used only as a gate. On EVM, Solana, and Hydration
  the indexer does `if deposit == 0 { skip sign request }`
  (`indexer_eth/mod.rs:375`, `indexer_sol.rs:168/241`,
  `indexer_hydration.rs:128/253`); the funds are held/enforced by the
  source-chain contract.
- The Canton path has **no such gate** and discards the value, so a non-zero
  number there is inert — no CC moves, nobody pays Signet.

**To charge a real CC service fee on Canton**, do what the source chains do, but
in Daml: compose an on-ledger **token-standard Canton Coin transfer** of the fee
to the Signet party as part of the request flow — atomically, or as a verified
precondition, before `SignBidirectionalEvent` is created. That puts the
"no fee → no signature" gate on-ledger where Canton value actually moves. The
node-side `deposit` may then _mirror_ that amount for parity with other chains;
it reflects a real payment, never is one. Use token-standard transfers, not the
`TransferCommand` `prepare-send`/`submit-send` endpoints deprecated by CIP-0107.

**Survival.** A CC service fee is **durable revenue** — payment for Signet's
service, untouched by CIP-0104/0107. But it is _revenue, not a reward_: any
protocol reward on the fee transfer comes solely from Signet **confirming that
transfer's traffic** (modest — one small transfer), not from a dedicated CC
reward path. The real reward surface remains Tier 1 (§4).

## 8. Open questions to confirm with the Foundation

1. Is Signet approved (or approvable) as a featured app for its intended
   confirming scope (MPC response evidence + co-signed bridge/vault value
   layer)?
2. Is Signet confirming its own MPC response evidence (Tier 0) considered
   acceptable fair use, given Signet both submits and confirms it?
3. What is the Increment-4 cutover timing on the network(s) Signet targets, so
   we know when marker-based behavior stops and traffic-based earning begins?
4. Expectations for beneficiary-split automation (left to apps by CIP-0104) if
   Signet revenue-shares with integrators.
5. Any reporting / anti-abuse expectations tied to featured status under the
   traffic model.

## 9. Recommended Signet plan

1. Apply for / confirm featured-app status and provision a `FeaturedAppRight`
   for the Signet provider party.
2. **Tier 0 now (shipped):** `sigNetworkFA` co-signs the request event and both
   MPC evidence events, so featured status immediately earns on all three.
3. **Tier 1 as a designed change:** make the Signet provider party a signatory
   (confirmer) on `Erc20Holding` and the claim/withdraw result views; design the
   partner authorization/delegation so value transactions carry Signet's
   authority without breaking the operator multisig.
4. Keep `operators` non-featured so they don't dilute Signet's app-weight.
5. Do **not** pursue Tier 2 (signatory on `SignBidirectionalEvent`) — it
   regresses anti-forgery.
6. Automate minting via `MintingDelegations`; use beneficiaries only to
   revenue-share rewards Signet has already earned.
7. **CC service fee (durable revenue — shipped):** charged as an on-ledger
   token-standard Canton Coin transfer to the fee receiver, composed atomically
   in the request flow — **not** by setting the node `deposit` field (which is
   inert for Canton; see §7). Treat it as revenue; the only reward on it is the
   traffic from Signet confirming that transfer.
8. Validate on DevNet/TestNet: confirm Signet's party appears as a confirmer on
   the intended views and that coupons attribute to it; inspect Scan traffic /
   app-activity-record streams.

## References

Current model:

- CIP-0104 (traffic-based app rewards):
  https://github.com/canton-foundation/cips/blob/main/cip-0104/cip-0104.md
- CIP-0107 (transfer/preapproval changes; `extraFeaturedAppRewardAmount`
  pinning):
  https://github.com/canton-foundation/cips/blob/main/cip-0107/cip-0107.md
- Canton confirmation model (signatories/actors confirm; observers do not):
  https://docs.daml.com/canton/architecture/overview.html
- Splice release notes (increment ship versions):
  https://github.com/hyperledger-labs/splice/blob/main/docs/src/release_notes.rst
- Minting delegations (CIP-73):
  https://docs.sync.global/validator_operator/validator_delegations.html
- Featured App request:
  https://canton.foundation/featured-app-request/

Legacy / pre-CIP-0104 (markers + CC-transfer reward — being retired):

- Tokenomics overview:
  https://docs.sync.global/background/tokenomics/overview_tokenomics.html
- Featured App activity markers:
  https://docs.sync.global/background/tokenomics/feat_app_act_marker_tokenomics.html
- FeaturedAppRightV2 API:
  https://docs.sync.global/app_dev/api/splice-api-featured-app-v2/Splice-Api-FeaturedAppRightV2.html
- CC transfer reward path:
  https://docs.sync.global/background/tokenomics/cc_transfer_splice_wallet_tokenomics.html
