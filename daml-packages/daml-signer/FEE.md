# Canton Coin signature fee

_Part of [`daml-signer`](./README.md) — the fee layer charged by `Signer.RequestSignature`._

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
  (repriced ~every 10 min off-ledger by the reprice job running as `sigNetworkFA`; `feeAmount = 0.0`
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

## Fee security model and accepted trade-offs

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
