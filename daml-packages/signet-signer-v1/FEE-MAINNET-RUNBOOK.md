# Operating the CC signature fee on MainNet — FA / fee-admin runbook

_Operational companion to [`FEE.md`](./FEE.md) — the off-ledger half of the fee feature: how the
featured-app party (`sigNetworkFA`) acquires Canton Coin, stands up the receiver side
(`TransferPreapproval` + `FeaturedAppRight`), and keeps the app running. `FEE.md` is the design/spec;
this is the deploy + keep-alive guide. Everything here is `sigNetworkFA`-side; the MPC (`sigNetwork`)
needs no fee setup._

> **Status:** written while the Featured-App application is in flight. The `FeaturedAppRight` section
> is "what to do once granted"; until then, **self-feature** on a network that allows it to exercise the same paths.

---

## 0. The parties and the one rule that drives everything

| Party                    | Fee role                                                                                                                                                                      |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sigNetworkFA`           | Fee admin **and** `feeReceiver` **and** featured-app party **and** (recommended) `TransferPreapproval` provider. Signs the collector, registration, and price config.         |
| validator operator party | The party your validator node runs as. **Make this `sigNetworkFA`** (or host `sigNetworkFA` on your validator) — see §2, it decides whether preapproval renewal is automatic. |
| `sigNetwork` (MPC)       | None. No fee data feeds `requestId` or the events.                                                                                                                            |
| `operators`              | Vault signatories; ride passively.                                                                                                                                            |
| `requester`              | Pays the fee in native CC; needs CC `Holding`s in their own Canton wallet.                                                                                                    |

**The rule:** the charge is **fail-closed** (`Signet.Fee.Amulet`'s `feeCollector_chargeImpl` `abort`s on
anything but a one-step `Completed`, and the abort propagates up through `RequestSignature` — see
`FEE.md`). So every item in §5 is **availability-critical**: if pricing, the preapproval, your CC
balance, or vetting lapses, you don't silently undercharge — **every new signature request stops**.

---

## 1. How you (the FA) get Canton Coin

Native CC is **earned, never bought into existence** — minted as rewards every ~10 min
(one `OpenMiningRound`), fair-launch, no pre-mine. App providers get **62%** of the 2026 reward pool.
Your three inflows:

1. **Featured-app rewards** — once the `FeaturedAppRight` is granted (§3), each fee transfer that
   settles through your preapproval attributes an app reward to you. This is the economic point of
   `feeReceiver = sigNetworkFA = preapproval provider`.
2. **Validator liveness rewards** — just for running your node and staying connected. Requires MainNet
   onboarding (invite-only: a sponsor — Super Validator, validator, app provider, or the Canton
   Foundation — and Tokenomics-Committee approval).
3. **The fees themselves** — requesters → `feeReceiver`, the CC the whole feature moves.

**Bootstrap (chicken-and-egg).** You need _some_ CC before rewards flow, to pay sequencer traffic and to
**create the first `TransferPreapproval`** (~$1/yr, burned — §2). Sources: your first validator rewards
after onboarding, a sponsor seeding your wallet, or moving CC in OTC. Note: CC bought on an exchange or
held as a bridged token is **not** native on-ledger CC — it must reach your Canton wallet as real
`Amulet`/`Holding` contracts to be usable. **There is no MainNet faucet** (test networks only).

---

## 2. `TransferPreapproval` — the feeReceiver MUST have a live one

**Why it's load-bearing.** CC requires recipients to consent to receive. The charge demands a one-step
`Completed` transfer; that only happens when the receiver has a standing `TransferPreapproval`. Without
one the transfer comes back `Pending` → the charge `abort`s → **fail-closed → no signature**. This is
the single most common way to take your own app down.

**Lifetime & cost.**

- Default lifetime: **90 days**.
- Fee: proportional to lifetime, ~**$1/year**, **burned** on create/renew, set by SVs via the
  `transferPreapprovalFee` parameter.

**Creating it** (pick one):

- **Splice Wallet UI** — simplest for a locally-signed (non-external) party.
- **Validator API** for external-signing parties: create an `ExternalPartySetupProposal`
  (`POST /v0/admin/external-party/setup-proposal`), the party signs accept → yields a `ValidatorRight`
  - the `TransferPreapproval`.
- **Ledger API** — a `TransferPreapprovalProposal` via `/v2/commands/submit-and-wait` for custom
  provider arrangements.

**Renewal — the decision that determines your on-call burden:**

| Preapproval provider           | Renewal                                                                                                     |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| **= validator operator party** | **Automatic** — the validator app renews for another 90 days once expiry is < 30 days away. Nothing to run. |
| a different party              | **Manual** — you must run automation that periodically exercises `TransferPreapproval_Renew`.               |

> **Recommendation:** make `feeReceiver` = `sigNetworkFA` = your **validator operator party** (or host
> `sigNetworkFA` on your validator so it is the provider) → renewal is automatic. If `sigNetworkFA` is a
> standalone party that is _not_ the validator operator, you **own** the renewal cron, and a missed
> renewal is an outage.

**Cancel:** `TransferPreapproval_Cancel` (receiver or provider), or validator
`DELETE /v0/admin/transfer-preapprovals/by-party/{receiver-party}`.

**If you re-point the payee** (`FeePriceConfig.UpdateFee` with a new `feeReceiver`, e.g. a treasury):
the **new** receiver needs its **own** live preapproval before that config goes in-window, or the charge
fails closed for everyone.

---

## 3. `FeaturedAppRight` — you're applying now

**Getting it.** Fill in the featured-app application form → the **GSF Tokenomics Committee** reviews and,
if approved, your provider party gets a `FeaturedAppRight` contract. For testing _now_, **self-feature** (on a
network that allows it) to run the exact same reward paths.

**Wiring it up (once granted):**

- Depend on `splice-api-featured-app-v1.dar` and resolve the `FeaturedAppRight` interface package id.
- Query the ledger for the `FeaturedAppRight` contract whose provider is your app (`sigNetworkFA`) party.

**How it earns:**

- For **amulet transfers** (your fee charge is one), an `AppRewardCoupon` is attributed to the app
  facilitating the transfer — i.e. the **preapproval provider** (hence §2's "provider = `sigNetworkFA`").
- For **non-transfer** activity, you exercise `FeaturedAppRight_CreateActivityMarker`, setting a
  **beneficiary** (the party eligible to mint the CC) — optionally split across an `AppRewardBeneficiary`
  list.
- SV automation converts markers/coupons → mintable `AppRewardCoupon`s (DSO-signed) → minted in the
  normal ~10-min round.

> **Verify before relying on reward capture (open item):** the current charge builds the transfer with
> `meta = emptyMetadata` (`Signet.Fee.Amulet`) and the client sets no explicit app-reward beneficiary
> (`canton-sig/src/fee.ts`). So reward attribution currently rests on `sigNetworkFA` being the
> **preapproval provider + featured**, not on explicit beneficiary plumbing. Confirm on a self-featured
> test deployment that a preapproval-settled fee transfer actually produces an `AppRewardCoupon` for
> `sigNetworkFA`; if not, add explicit attribution.
> **Roadmap caveat:** `FEE.md` notes featured-app capture is "a ~$1 `AppRewardCoupon` per featured
> transfer until **CIP-0104 Increment 4** cuts over; traffic-based afterwards." The CIP-0104 spec
> defines that increment rollout; track its MainNet rollout status via GSF, because it changes how
> (and how much) you earn.

**Keep good standing** with the Committee's fair-usage policy — the right can be revoked.

---

## 4. Bootstrap checklist (once per deployment)

- [ ] Validator live on MainNet (sponsor secured, egress IP allowlisted, OIDC configured, wallet UI reachable).
- [ ] `sigNetworkFA` wallet funded with bootstrap CC (§1).
- [ ] `FeaturedAppRight` granted (or self-featured where allowed) and wired (§3).
- [ ] `feeReceiver` `TransferPreapproval` **live**, provider chosen for auto-renew (§2).
- [ ] Create, as `sigNetworkFA`: `CcFeeCollector`, its `FeeCollectorRegistration`, the first `FeePriceConfig`.
- [ ] Fee endpoint serving `POST /fee/v1/collector` (the `{registration, collector, priceConfig}` + context envelope).
- [ ] `signet-api-fee-v1`, `signet-fee-amulet`, and the genuine token-standard packages **vetted** on every confirming participant (and only conformant token impls vetted — see `FEE.md` security model).
- [ ] Reward minting automated (CIP-73 `MintingDelegation` or wallet automation).

---

## 5. Periodic maintenance — what to watch, cadence, and what breaks

| What                                                                                                                                         | Cadence                                                                                                | If it lapses                                                                                                                                                                                                                                |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reprice `FeePriceConfig`** — `pnpm --filter canton-sig reprice` as `sigNetworkFA`, overlapping windows (≈30-min validity / 10-min cadence) | ~10 min (≈ one `OpenMiningRound`)                                                                      | No in-window config → `getFeeCollectorContext` throws / charge aborts → **app down**. (`feeAmount = 0.0` = free mode, no transfer.)                                                                                                         |
| **Renew `feeReceiver` `TransferPreapproval`**                                                                                                | before the 90-day expiry (auto if provider = validator op; else your `TransferPreapproval_Renew` cron) | Transfers return `Pending` → fail-closed → **app down**.                                                                                                                                                                                    |
| **Keep CC balance funded**                                                                                                                   | continuous                                                                                             | Needed for sequencer **traffic**, preapproval renewal (~$1/yr), holding fees. Empty → node can't submit → **app down**.                                                                                                                     |
| **Collect / mint rewards**                                                                                                                   | each round (~10 min)                                                                                   | Automate via CIP-73 `MintingDelegation` / wallet. Unminted reward coupons **expire** unclaimed.                                                                                                                                             |
| **Package-vetting governance**                                                                                                               | on every fee-impl change                                                                               | Vet the new `signet-fee-amulet`; **unvet** superseded versions whose logic must die (a still-vetted old version can be pinned by a submitter — see the dispatch/vetting discussion). Gate vetting + registration-signing like prod deploys. |
| **Validator ops hygiene**                                                                                                                    | ongoing                                                                                                | OIDC/JWT cert rotation, egress-IP allowlist stays adopted, sequencer connectivity, node **uptime** (liveness rewards depend on it), DAR + protocol-version upgrades.                                                                        |
| **`FeaturedAppRight` standing + CIP-0104 Increment 4**                                                                                       | ongoing / roadmap                                                                                      | Policy violation → revocation. CIP-0104 cutover → reward model changes (activity-marker → traffic-based).                                                                                                                                   |
| **Renew the `FeaturedAppRight` itself** if your grant carries a term                                                                         | per grant terms                                                                                        | Loss of featured status → no app rewards (fee still charges; you just stop earning the reward).                                                                                                                                             |

---

## 6. One-paragraph mental model

The fee is **fail-closed by construction**, so operating it is mostly about keeping four things alive at
all times: a **current price config** (reprice job), a **live preapproval** for the receiver, a **funded
CC balance** for traffic + preapproval, and **correct package vetting**. Lose any one and new signature
requests stop — loudly, not silently. The `FeaturedAppRight` + being the preapproval provider is what
turns the fees you collect into _additional_ app rewards; it's upside, not a uptime dependency (losing it
costs revenue, not availability). Wire `feeReceiver = sigNetworkFA = validator operator party` and most of
§5 (preapproval renewal, reward minting) runs itself.

---

## Sources

- [`FEE.md`](./FEE.md) — fee design, security model, and the "Fee admin runbook" this expands.
- [Canton Coin Preapprovals — Splice docs](https://docs.dev.sync.global/background/preapprovals.html) — 90-day lifetime, ~$1/yr burned, auto-renew (provider = validator op), `TransferPreapproval_Renew`/`_Cancel`.
- [Featured Application Activity Marker — Splice docs](https://docs.sync.global/background/tokenomics/feat_app_act_marker_tokenomics.html) and [`Splice.Api.FeaturedAppRightV1`](https://docs.sync.global/app_dev/api/splice-api-featured-app-v1/Splice-Api-FeaturedAppRightV1.html) — `FeaturedAppRight_CreateActivityMarker`, beneficiaries, coupon conversion.
- [Validator Onboarding — Splice docs](https://docs.sync.global/validator_operator/validator_onboarding.html) — invite-only, sponsor, wallet.
- [Canton Coin: Rewarding Utility — canton.network](https://www.canton.network/blog/canton-coin-rewarding-utility) — earned-only, ~10-min mint, reward-pool split.
