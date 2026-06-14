# Reviewing the CC signature-fee changes — a Canton newcomer's guide

_Covers branch `feat/cc-deposit-charge` (vs `main`): the atomic Canton Coin fee charged by
`Signer.RequestSignature`, the `signet-api-fee-v1` / `signet-fee-amulet` packages, and the
`canton-sig` fee client. Two parts: the Canton concepts you actually need (no more), then a
concrete review path with the questions to ask at each step. Concepts are contrasted with
Solidity/EVM where it helps._

---

## Part 1 — How the concept works on Canton

### The mental model shift from EVM

Canton has no global state, no `msg.sender`, no native gas-like fee you can charge in-protocol.
Instead:

- **State = contracts.** A Daml contract is an immutable signed record (template + field values).
  You never mutate one; you archive it and create a successor. There is no "balance mapping" —
  Canton Coin is held as **`Holding` contracts, UTXO-style**: spending consumes input holdings and
  creates new ones (payment + change).
- **Code = choices on templates.** A `choice` is like a method. `consuming` archives the contract
  when exercised; `nonconsuming` leaves it active (the Signer and the fee collector are long-lived
  singletons, so all their choices are nonconsuming).
- **A submission is a transaction tree, atomic end-to-end.** Exercising a choice whose body
  exercises other choices nests like EVM internal calls, and any `abort`/failed `assertMsg`
  anywhere rolls back everything. This is the property the whole feature leans on: _fee charge and
  sign-event creation are in one tree, so "no fee settled → no event" is structural, not
  bookkeeping_ (the "fail-closed" claim in `daml-packages/signet-signer-v1/FEE.md`).

### Authority — the one concept you must internalize

Where Solidity asks "who is `msg.sender`?", Daml authorization is declarative, per party:

- **signatory** — parties whose authority was needed to _create_ the contract; archiving needs all
  of them.
- **observer** — can see it, can't act.
- **controller** — who may exercise a given choice. `controller operators, requester` is a
  _conjunction_: all of them must authorize, which happens naturally when the exercise sits inside
  another choice body that already carries their authority.
- **Ambient authority**: inside a choice body, the available authority = the contract's
  signatories ∪ the choice's controllers, and it flows _down_ the tree into nested exercises.

This branch uses ambient authority as its core trick, twice:

1. `sigNetworkFA` (the featured-app party) co-signs the `Signer` once, at creation
   (`SignerProposal`/`AcceptSigner` ceremony). From then on, every `RequestSignature` body runs
   with `sigNetworkFA`'s authority _ambiently_ — so the `SignBidirectionalEvent` gets
   `sigNetworkFA` as a signatory (making it a CIP-0104 confirmer that earns featured-app rewards)
   **without sigNetworkFA ever co-submitting anything**. Crucially it is never a _controller_, so
   it can't initiate or forge requests.
2. Inside `FeeCollector_Charge`, the `CcFeeCollector`'s signatory (`sigNetworkFA`) is ambient,
   which is what authorizes the `fetch` of the FA-signed `FeePriceConfig`
   (`daml-packages/signet-fee-amulet/daml/Signet/Fee/Amulet.daml:119`).

The corollary that explains a small diff you'd otherwise find odd: because the event now has
`sigNetworkFA` as a signatory, the Vault's claim path can no longer plain-`archive` it (archive
needs _all_ signatories) — hence the new delegated `Consume_SignBidirectional` choice, where
sigNetworkFA pre-consents in the template and the actor is gated to operators/requester.

### Privacy and disclosed contracts

On EVM everything is public. On Canton you only see contracts you're a stakeholder of. The
requester is _not_ a stakeholder of the Signer, the `FeeCollectorRegistration`, the collector, the
`FeePriceConfig`, or Amulet's `AmuletRules`/`OpenMiningRound` — yet their submission must
fetch/exercise all of them. The mechanism is **explicit disclosure**: serialized contract blobs
(`createdEventBlob`) attached to the command, letting the submitting participant validate
contracts it can't otherwise see. Disclosure grants _visibility only_ — all the authorization
rules above still apply.

That's why so much of the TS diff is disclosure plumbing: `getDisclosedContract`,
`collectFeeDisclosures`, and the FA fee endpoint whose entire job is to serve
`{registration, collector, priceConfig}` blobs to requesters (`ts-packages/canton-sig/src/fee.ts`).

### Interfaces and late binding — the upgrade story

A Daml `interface` is like a trait; templates provide `interface instance`s. When
`Signer.RequestSignature` exercises `FeeCollector_Charge` on `registration.collector`, it
dispatches **at runtime** to whatever implementation package the participants have vetted (think:
a proxy-upgrade pattern, but the "implementation pointer" is package governance, not a storage
slot). That's why the branch splits three packages:

| Package             | Role                                                        | Changes how                                                                                                             |
| ------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `signet-api-fee-v1` | interface + `FeeCollectorRegistration` (63 lines, no logic) | **frozen forever**; breaking change = ship `-v2`                                                                        |
| `signet-fee-amulet` | `CcFeeCollector` + `FeePriceConfig`                         | Smart Contract Upgrade; new code takes effect on the **live** collector contract, zero rebuilds of signer/vault/clients |
| `signet-signer-v1`  | exercises the interface via the registration anchor         | never needs to know the implementation                                                                                  |

"Vetting IS the fee-logic deploy" in `FEE.md` follows directly: which package's code runs is
decided by what participants have vetted, not by anything on-ledger.

### The Splice token standard (how you move Canton Coin at all)

There's no `transferFrom`. The token standard (CIP-0056, the vendored
`daml-packages/vendor/splice-api-token-*` DARs) works like this: an off-ledger **registry HTTP
endpoint** hands you a `TransferFactory` contract id + an opaque `choiceContext` + disclosures;
you exercise `TransferFactory_Transfer` (controller = just the _sender_) with input holdings; the
result is `Completed`, `Pending`, or `Failed`. `Pending` means a two-step offer the receiver must
accept later — useless for an atomic fee — so the charge requires `Completed`, which only happens
when the receiver has a standing **`TransferPreapproval`** (roughly ERC-20 `approve`, but
inverted: the _receiver_ pre-approves incoming transfers).

### Walk one deposit through the tree

This is the whole feature in one picture — authority accumulates downward, any abort kills
everything:

```
Vault.RequestDeposit                    controller: requester; Vault signatories: operators
└─ Signer.RequestSignature              controller: operators+requester; ambient: sigNetwork, sigNetworkFA
   ├─ assertMsg validTxParams
   ├─ fetch FeeCollectorRegistration    (FA-signed; disclosed) ── trust anchor
   ├─ assert registration.sigNetworkFA == signer.sigNetworkFA
   ├─ FeeCollector_Charge               interface exercise → late-bound to CcFeeCollector
   │  ├─ fetch FeePriceConfig           (FA-signed; cid from opaque feeExtraArgs.context)
   │  ├─ validate admin + time window;  feeAmount == 0.0 → waive, done
   │  └─ TransferFactory_Transfer       (factory cid from context; expectedAdmin from FA config)
   │     └─ Amulet spends requester's holdings → feeReceiver   must return Completed
   └─ create SignBidirectionalEvent     signatories: operators+requester+sigNetworkFA
```

Client-side, `canton-sig` assembles what this tree needs before submission: FA endpoint context →
holding selection → registry factory → merge into the three opaque choice args + six disclosures
(`ts-packages/canton-sig/src/fee.ts`, composed exactly this way in the e2e's `prepareFeeInputs`,
`test/src/test/devnet-e2e.test.ts:374`).

---

## Part 2 — How to approach the review

### Step 0: verify the ground before reading

```bash
dpm build --all && pnpm run daml:test          # Daml suites, per-package
pnpm -r --filter='@canton/*' --filter='canton-sig' run test   # TS oracle suites
pnpm run check                                  # types, eslint, knip, prettier
```

Green tests turn your review from "does this work?" into "does this do the right thing?" — a much
better use of attention. (The devnet e2e needs live env + `MPC_CANTON_LIVE_MUTATE=1`; skip it for
a code review.)

Then read `daml-packages/signet-signer-v1/FEE.md` once, _as a claims list, not as truth_ — your
review's job is to check the code against its claims. Note the claims that matter most:
fail-closed, "the view is never trusted", "a requester cannot substitute a hostile collector",
"compromised sigNetwork can't touch pricing".

### Read order: smallest blast radius and longest commitment first

**1. `signet-api-fee-v1` (~63 lines) — the frozen layer.** Everything here is permanent by
policy, so it deserves the most scrutiny per line. Ask: is the interface _minimal_? Is anything
here that belongs in the implementation (it claims "no logic" — verify)? Every record carries
`Metadata` so future needs become map keys, not field changes — check nothing is missing that
would force a `-v2` soon. Note `FeeCollector_Charge`'s controller is just `payer` — then go find
the FEE.md paragraph explaining why standalone exercisability is harmless, and check you agree (it
only moves payer's own funds to the FA-configured receiver; Daml has no caller introspection so it
can't be prevented anyway).

**2. `daml-packages/signet-signer-v1/daml/Signer.daml` diff — the integration and the trust anchor.**
This is where the security argument lives. Verify, in the code, the exact chain: the only fee
input the Signer _trusts_ is `feeRegistrationCid`; it fetches it and asserts
`registration.sigNetworkFA == sigNetworkFA` (`Signer.daml:107`); it exercises the charge on
`registration.collector` and **never reads the collector's view** (interface views are
implementation-controlled — trusting one would be a hole). Check ordering: charge before `create`
(it is), and that nothing catches/recovers from a charge abort (Daml 3.x has no live exception
handling here, so aborts propagate — that's the fail-closed guarantee). Also confirm the result of
the charge is discarded (`_ <-`) — nothing downstream depends on what the implementation _says_ it
charged.

**3. `signet-fee-amulet` — the swappable implementation.** The key review lens: _every contract id
arriving via `extraArgs.context` is caller-supplied and untrusted_. For each one, ask "what's the
worst a malicious value does?":

- `priceConfigContextKey` → fetched, then validated against the collector's own `sigNetworkFA` +
  time window (`validatePriceConfig`). A foreign or expired config aborts. A _wrong-type_ cid
  (it's `coerceContractId`, an unchecked cast) fails at fetch → abort → still fail-closed. Fine,
  but you should consciously walk that path.
- `transferFactoryContextKey` → exercised with `expectedAdmin = priceCfg.instrumentAdmin` (from
  the FA-signed config — the one check the token standard lets you do). The residual — a
  _permissive factory implementation_ that returns `Completed` without moving funds — is the
  documented, accepted bypass. Your job as reviewer is not to fix it but to verify the claim that
  it's (a) real, (b) pre-existing in spirit, (c) mitigated by vetting governance + hosting
  topology, and that you find that acceptable for the deployment plan.
- Check the result handling is exhaustive: `Completed` passes, `Pending` and `Failed` abort, no
  default-true branch.
- Check the zero-fee waiver path skips the transfer entirely (free mode must not require a factory
  at all — the test proves it by omitting the factory from the context).

**4. `daml-packages/daml-vault/daml/Erc20Vault.daml` diff — plumbing.** Three fee args threaded
through `RequestDeposit`/`RequestWithdrawal` untouched (opacity is the design — flag any code that
_interprets_ `feeExtraArgs`), the `archive` → `Consume_SignBidirectional` swap (now you know why),
and the `sameHex` case-insensitivity fixes riding along (independent correctness fix: BytesHex
legitimately allows either case, and these comparisons gate value transfers).

**5. Tests as the spec.** Read test _names and comments_ before bodies — they encode the threat
model:

- `daml-packages/signet-fee-amulet-tests/daml/TestFeeAmulet.daml`: a mock `TransferFactory` drives
  all three settlement branches deterministically; window/admin/missing-key rejections; the forge
  tests (`test_requester_cannot_forge`, `test_mpc_party_cannot_forge`) are the on-ledger proof of
  "compromised sigNetwork can't touch pricing".
- `daml-packages/signet-signer-v1-tests/daml/TestSigner.daml` fee section:
  `FailsClosedWhenChargeAborts`, `RejectsForeignFeeRegistration`, and — the subtle one worth
  reading carefully — `RejectsSelfSignedFeeRegistration`: a requester _can_ create a registration
  naming itself as FA, and the explicit `sigNetworkFA` equality assert is the _only_ thing
  stopping the charge from routing to a requester-owned collector. That test is load-bearing.
- Ask the coverage question: is anything in the FEE.md threat list _not_ exercised by a test? And
  the mock-fidelity question: where does `MockTransferFactory` diverge from real Amulet, and does
  any divergence matter to what's being asserted?

**6. TS client (`fee.ts`, `fee-pricing.ts`, `fee-reprice.ts`).** Different risk class — this code
can't break the ledger's invariants, only cause bad submissions or bad pricing:

- `selectInputHoldings`: greedy largest-first, excludes locked/non-positive, scale-10 bigint math
  (viem `parseUnits`, never floats), fail-closed on insufficient/over-cap. Connect one dot FEE.md
  makes: greedy-largest-first means a tiny fee attaches your _biggest_ holding, which is exactly
  the blast radius if an FA-blessed collector ever went rogue — worth confirming you accept that
  pairing.
- Cross-layer consistency checks only a human will do: window bounds are inclusive on both ends in
  Daml (`now < validFrom`, `now > validUntil` reject) and in TS (`>= validFrom && <= validUntil`)
  — they match; `CC_DECIMALS = 10` matches Daml `Decimal` (Numeric 10);
  `PRICE_CONFIG_CONTEXT_KEY` strings match the Daml constants character-for-character.
- `fee-pricing.ts` uses float math _deliberately_ (off-ledger estimate with a coverage buffer;
  comments justify it) — don't flag it, but do check the input validation that prevents posting
  garbage.
- `getTransferFactoryForFee`: the registry wire shape is mirrored from Splice's reference CLI and
  explicitly flagged in FEE.md as "confirm against the target Splice version's live registry" —
  that's an open verification item to track, not a code defect.
- `fee-reprice.ts`: overlapping windows (30-min window, 10-min cadence) so a failed tick never
  strands requesters with no valid config; fail-soft loop. Check `findLatestPriceConfig`
  deliberately ignores the window (so the job can recover after an outage) while
  `getFeeCollectorContext` requires in-window — that asymmetry is intentional.

**7. Last pass: adversarial read of FEE.md with the code fresh.** Enumerate the parties —
`requester`, `sigNetwork` (MPC), `sigNetworkFA` (fee admin), `operators`, the instrument admin/DSO
— and for each ask "if this one is malicious or compromised, what does the code let it do?" Check
your answers against the document's. The design's central separation (fee admin = `sigNetworkFA` ≠
MPC identity) should fall out of the signatory lines alone.

### Daml-specific bug patterns to keep on a card

- **Fetch-without-binding**: fetching a caller-supplied cid and forgetting to assert whose
  contract it is. Every fetch in this diff should be followed by a party/field assertion — the
  self-signed-registration test exists precisely because of this class.
- **Trusting interface views** of contracts an adversary could implement — views are
  implementation-controlled, with no signatory accessor.
- **Fail-open branches**: any path returning success without the settlement side effect (here:
  only the explicit `0.0` waiver, FA-controlled).
- **`coerceContractId`**: unchecked casts — trace each to its failure mode.
- **Conjunction controllers**: `controller a, b` means _all_, not _any_ — easy to misread.
- **Time**: `getTime` is ledger-effective time (deterministic, slightly behind wall clock) — check
  window boundaries tolerate that.
- **Cross-language mirrors**: `computeRequestId` must match the Rust/TS implementations
  byte-for-byte; the repo's oracle/golden TS suites are the enforcement — confirm they ran.

### Reference material

The repo carries its own curated Canton reference under `../.claude/skills/` (`daml-language`,
`daml-canton`, `daml-typescript`, …) — written for Claude but a perfectly good human crib sheet
for exactly the topics above (authority, disclosure, interfaces, JSON Ledger API). For the token
standard, the vendored DARs under `daml-packages/vendor/` are the ground truth the code was
verified against; the public docs are docs.digitalasset.com (Daml/Canton) and docs.dev.sync.global
(Splice/CIP-0056). And `FEE.md` itself is the best single artifact in the branch — most of your
review is checking the code keeps its promises.
