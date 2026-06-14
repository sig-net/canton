# Canton Coin signature fee

_Part of [`signet-signer-v1`](./README.md) — the fee layer charged by `Signer.RequestSignature`._

Every `RequestSignature` (and therefore every Vault deposit/withdrawal request) charges the
requester a Canton Coin fee, paid requester → `feeReceiver` **atomically inside the same
transaction**. If the fee cannot settle, `RequestSignature` aborts and no event is created
(fail-closed).

- **Late-bound collector.** The Signer does not contain fee logic. It fetches the FA-signed
  `FeeCollectorRegistration` (the trust anchor — only `sigNetworkFA` can create one, so a hostile
  collector cannot be substituted), asserts it belongs to its own `sigNetworkFA`, and exercises
  `FeeCollector_Charge` (from the frozen `signet-api-fee-v1` package) on the registered collector.
  Interface exercises are late-bound: upgrading the implementation package changes live fee
  behaviour with **zero rebuilds** of `signet-signer-v1`, consumers, or clients.
- **Implementation: `signet-fee-amulet`.** `CcFeeCollector` reads the FA-signed `FeePriceConfig`
  (repriced ~every 10 min off-ledger by the reprice job running as `sigNetworkFA`; `feeAmount = 0.0`
  waives the charge), resolves the CC `TransferFactory` from `feeExtraArgs.context` (a decided
  hardening will move this to an FA-pinned cid in `FeePriceConfig`; see _Factory-cid pinning_ below), and requires the
  transfer to settle one-step via the receiver's `TransferPreapproval` — `Pending`/`Failed` abort.
- **Fee admin = `sigNetworkFA`.** The registration, collector, and price config are all signed by
  the featured-app party; a compromised `sigNetwork` (MPC identity) can neither forge requests nor
  touch pricing, payee, or collector binding.
- **Disclosures.** The FA fee endpoint serves `{registration, collector, priceConfig}` + an opaque
  charge context (registry shape); the CC token registry serves the factory/`AmuletRules`/
  `OpenMiningRound`. `canton-sig` assembles both: `getFeeCollectorContext`,
  `getTransferFactoryForFee`, `selectInputHoldings` / `holdingInputsFromEvents`, then
  `assembleFeeChoiceArgs` / `collectFeeDisclosures`.

## Fee endpoint contract

`POST /fee/v1/collector` (`FEE_COLLECTOR_ENDPOINT_PATH` in `canton-sig`), no request body. The FA
operates it with fee-admin read authority; the response is the JSON serialization of the
`FeeCollectorContext` that `canton-sig`'s `getFeeCollectorContext` builds:

```jsonc
{
  "registrationCid": "00…", // active FeeCollectorRegistration → the feeRegistrationCid choice arg
  "collectorCid": "00…", // registered collector (disclosed; never a choice arg)
  "priceConfigCid": "00…", // current FeePriceConfig
  "priceConfig": {
    /* decoded FeePriceConfig record — feeAmount drives holding selection */
  },
  "choiceContextData": {
    /* opaque charge context — merge into feeExtraArgs untouched */
  },
  "disclosedContracts": [
    /* three JSON Ledger API DisclosedContract envelopes (standard `DisclosedContract`
       shape): registration, collector, price config */
  ],
}
```

A requester-side client consumes the response as a `FeeCollectorContext` and continues with
`selectInputHoldings` → `getTransferFactoryForFee` → `assembleFeeChoiceArgs` /
`collectFeeDisclosures`. A client that itself holds fee-admin read authority (single-party
DevNet) can call `getFeeCollectorContext` directly instead — same shape.

## Fee contracts and what may change

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
  effect on the **live** collector contract with zero rebuilds of `signet-signer-v1`, consumers, or
  clients. An incompatible redesign instead ships a new template/package + a fresh collector + a
  rotated registration.
- **Evolves by rotation (no package change):** `FeePriceConfig` values; the registration →
  collector binding; the endpoint's charge-context keys (impl-internal — third-party code must
  treat `feeExtraArgs` as opaque).
- **Evolves by new name (last resort):** a breaking fee-API change ships as `signet-api-fee-v2`
  alongside v1, never as an upgrade.
- **Upgrade checking is off until a v-next exists — by construction, not oversight.**
  `signet-fee-amulet` / `signet-api-fee-v1` are new package names (no prior version to diff
  against); `signet-signer-v1` / `signet-vault-v1` keep main's name **and** `0.0.1` but change it
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

## Fee admin runbook (`sigNetworkFA`, off-ledger)

- **Bootstrap (once per deployment):** as `sigNetworkFA`, create the `CcFeeCollector`, its
  `FeeCollectorRegistration`, and the first `FeePriceConfig`; stand up the fee endpoint
  ([contract above](#fee-endpoint-contract)); ensure the
  `feeReceiver`'s `TransferPreapproval` and the `FeaturedAppRight` are live. The MPC needs no
  fee-related changes — no fee data feeds `requestId` or the events.
- **Repricing:** run the reprice job (`pnpm --filter canton-sig reprice`) as `sigNetworkFA` every
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
  Increment 4 cuts over; traffic-based afterwards).

## Factory-cid pinning — decided hardening (not yet implemented)

> **Status — decided, not yet in code.** The shipped charge still resolves the `TransferFactory` from
> caller-supplied `feeExtraArgs.context`; the _Legacy_ section below documents that behavior and the
> bypass it permits. This section is the agreed target design.

**Decision.** Pin the CC `TransferFactory` contract id inside the FA-signed `FeePriceConfig`, and have
`CcFeeCollector` read the factory from that config instead of from the caller's `feeExtraArgs.context`.
This brings the factory in line with the collector: just as a requester cannot choose the collector
(`RequestSignature` reads `registration.collector`, not a choice arg), it can no longer choose the
factory the charge exercises.

**Why it closes the bypass.** The documented bypass needs the requester to supply a _permissive_
factory that returns `Completed` without moving funds. Once the factory cid comes from the FA-signed
config the requester can't substitute one — the genuine factory runs. It still consumes the
`OpenMiningRound` / `AmuletRules` / `TransferPreapproval` the requester relays through the context, but
those are DSO-signed (a `createdEventBlob` is bound to its cid — unforgeable) and the genuine impl
validates them, so the only outcomes are a real transfer or an abort. The transfer's `sender` /
`receiver` / `amount` / `expectedAdmin` are already set by the charge from the FA-signed price config,
never from the context, so a relayed context can only enable settlement, not redirect it.

**Why it holds structurally, not just by validation.** Forcing the genuine `ExternalPartyAmuletRules`
also flips _who confirms_ the settlement: that factory and the holdings it moves are DSO-signed, so the
transfer sub-view's informees include the DSO / super-validators, and the disclosed factory blob is
itself cid-authenticated (a requester cannot present a permissive contract under the pinned cid). The
requester therefore loses the unilateral control the bypass relied on — over both confirmation _and_ SCU
package selection: it can no longer vet a permissive `splice-amulet` _version_ and have it run at the
pinned cid, because the selected package must be vetted by every informee, now including the SVs who vet
only genuine Amulet. It is the legacy informee/vetting argument (below) run in reverse.

**Why it's feasible (the load-bearing fact).** The Amulet token-standard `TransferFactory` is
`ExternalPartyAmuletRules`, a long-lived DSO singleton "intended to get archived and recreated as
rarely as possible"; the short-lived `OpenMiningRound`s it consumes (≈10–30 min, several valid at
once) travel in the choice context as disclosures, **not** in the factory cid. So the pinned value is
stable and the FA can keep it fresh cheaply. (Verified against the Splice `splice-amulet` source +
docs; confirm the rotation cadence empirically on the target network before relying on it.)

**Pin only the factory.** Do **not** pin the rounds/rules/preapproval — they rotate too fast and the
now-guaranteed-genuine factory validates them by signature anyway. The other two caller-relayed cids
already have defenses: `FeePriceConfig` is forgery-proof by its `sigNetworkFA` signatory check after
fetch, and the collector by the registration pin. The factory was the lone caller-controlled cid with
neither — pinning it is the targeted fix.

**Refresh cadence.** The reprice job (`fee-reprice.ts`, ~10 min) resolves the current factory from the
registry and stamps it into each new `FeePriceConfig` alongside the price (including in
`feeAmount = 0.0` free mode — the charge skips the factory then, but stamping a live cid anyway keeps a
later flip to a paid fee valid mid-window). On the rare
`ExternalPartyAmuletRules` rotation, trigger an immediate re-pin (watch for its archival) so the
fail-closed gap is seconds rather than up to one reprice interval.

**Scope (baseline change, frozen API untouched).** Confined to `signet-fee-amulet`. Nothing is deployed
yet — this package has no prior version to upgrade from (see _Upgradability rules_: upgrade checking is
off until a v-next exists), so this is a **baseline** definition, not an SCU. Add
`transferFactoryCid : ContractId TransferFactory` to `FeePriceConfig` as a **mandatory** field (not
`Optional`): mandatory forces every bootstrap and every `UpdateFee` reprice to set it, so the type
system guarantees a config can never be posted without a pinned factory — there is no `None` branch that
could silently fall back to a caller-supplied factory. Baking it into the baseline now also avoids ever
needing the append-`Optional` dance later. Then read it in `feeCollector_chargeImpl`, add a mandatory
`newTransferFactoryCid` arg to `UpdateFee`, and adjust `canton-sig` (`getFeeCollectorContext` /
`assembleFeeChoiceArgs` stop placing the factory in the context; the reprice job resolves + stamps it).
`signet-api-fee-v1` does not change.

**If this instead lands after the baseline ships (SCU, not baseline).** SCU permits only _appended_
`Optional` fields, so `transferFactoryCid` would have to be `Optional` (losing the no-`None`-fallback
guarantee above), with a `signet-fee-amulet` version bump, `typecheck-upgrades:` / `upgrades:`, and
`dpm upgrade-check`. And the fix stays **cosmetic until the prior, context-trusting version is unvetted**
on every participant that confirms the charge — while it remains vetted a self-hosted requester can pin
it via `packageIdSelectionPreference` and bypass exactly as before (see _Vetting IS the fee-logic
deploy_). Baking it into the baseline now — mandatory field, nothing to unvet — avoids both.

**Residual costs.** Reprice liveness now depends on a registry factory-resolution call on the pricing
path; a bounded fail-closed window on factory rotation (≤ one reprice interval unless an event-driven
re-pin is added); and slightly tighter Amulet coupling (acceptable — this package is already
Amulet-specific). Trust shifts from "every vetted package is conformant + requester hosting/vetting" to
"the FA resolves the genuine factory," a party already trusted. The **collector-trust axis**
(registration-signing discipline) is unchanged and still applies.

**Standards posture — a deliberate deviation.** No Canton / Splice / Daml doc recommends pinning the
`TransferFactory` cid; the token standard is built for _dynamic_ per-transfer registry resolution, with
`expectedAdmin` validation + vetting of conformant implementations as the intended safeguard (the
_Legacy_ posture below). Pinning is an app-level hardening resting on the general Daml guidance to guard
caller-supplied disclosed contracts inside the choice body — unblessed, so we own what the registry would
otherwise handle (factory resolution and rotation tracking). Treat it as defense-in-depth layered on the
vetting / topology controls and the off-ledger detection, not a replacement.

## Legacy — fee security model & accepted trade-offs (current behavior; under review by Fable)

> **⚠️ Legacy / under review (Fable).** Documents the **currently-shipped** behavior, in which the
> `TransferFactory` is resolved from caller-supplied `feeExtraArgs.context`, and the trade-offs that
> follow. The _Factory-cid pinning_ decision above supersedes the **factory-bypass** analysis here once
> implemented — retained for Fable to review and prune. The collector-trust axis, the detection
> guidance, and the standalone-`FeeCollector_Charge` note below remain valid regardless.

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

**Threat model — one self-hosted requester is enough.** Honest infrastructure does not prevent this: the bypass
needs no compromise or collusion of `sigNetworkFA`, `sigNetwork`, or `operators`. A lone, solely-malicious
`requester` uses the genuine disclosed `Signer`, the genuine FA-signed registration/collector, and a Vault the
operators legitimately provisioned — `operators`' authority rides passively on the Vault's `signatory operators`,
so their honesty is irrelevant — supplying only a permissive factory via the caller-supplied `feeExtraArgs.context`.
The sole precondition is hosting: the fee sub-view is confirmed by the requester-hosting participant, so only a
_self-hosted_ requester controls the vetting that would reject the factory. A working bypass therefore implies the
requester controls a confirming participant — host the payer on an operator-controlled participant and the same
lone requester cannot bypass.

**Detecting and acting on a bypass (off-ledger).** `sigNetworkFA` and `sigNetwork` are independent and the request
is always signed, so there is no runtime gate — enforcement is post-hoc. Detect by _receiver-side reconciliation_
under `sigNetworkFA`'s read authority (the MPC party cannot see fee receipts): flag any `SignBidirectionalEvent`
whose creating update carried no matching CC receipt to `feeReceiver` of at least the in-force
`FeePriceConfig.feeAmount` (the `0.0` waiver expects none). It verifies that the money _arrived_, not how, so it
catches any bypass method. Escalation ladder, per offender: revoke service credentials / agreement / participant
peering and pursue the debt; optional FA-signed on-ledger `FeeDelinquency` evidence; targeted `Vault` freeze where
`operators` is operator-controlled (they are its signatories); an FA-key-maintained blacklist/allowlist check added
to `RequestSignature` if abuse recurs; `Signer` rotation as a last resort. These are the intended response, not yet
implemented.

**Standalone `FeeCollector_Charge`.** The choice is intentionally exercisable standalone (controller `payer`;
the collector is publicly disclosed) and is harmless — it only moves the payer's own holdings to the
FA-configured receiver and mints nothing the protocol reads. It cannot be restricted to "called from
`RequestSignature`" (Daml has no caller introspection).

**Deferred hardening — `FeeReceipt`.** An in-transaction receipt minted by the impl and validated + consumed
by `RequestSignature` would prove the charge body _ran_ independent of the impl version, at the cost of
freezing the receipt shape + validation logic into the stable zone. As noted above it does **not** close the
factory bypass; revisit it only for the collector-governance axis if registration/vetting discipline weakens.
