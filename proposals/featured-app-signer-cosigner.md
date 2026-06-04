# Design: `sigNetworkFA` as an enforced co-signatory on the Signer layer

> Status: proposed (2026-06-04). Implements the "be a featured confirmer on the
> byte-heavy signing traffic" idea from [`featured-app-rewards.md`](./featured-app-rewards.md),
> but anchored in the generic `daml-signer` package so it applies to **every**
> consumer, not just the Vault.

## 1. Goal & non-goals

**Goal.** Introduce a new party, `sigNetworkFA` (Signet's Featured-App provider
party, distinct from the MPC's `sigNetwork`), and **enforce at the Signer layer**
that it is a **signatory** on every Signer-flow contract:

- `Signer` (the singleton)
- `SignRequest` (transient authority bridge)
- `SignBidirectionalEvent` (what the MPC watches — the byte-heaviest envelope)
- `SignatureRespondedEvent`, `RespondBidirectionalEvent` (response evidence)

Being a signatory makes `sigNetworkFA`'s participant a **confirmer** on that
traffic, which is the precondition to earn CIP-0104 app rewards (see
`featured-app-rewards.md` §1). Enforcing it in `daml-signer` means any consumer
(`daml-vault` today; future integrations) inherits it and none can bypass it.

**Non-goals.**

- Co-signing the **value layer** (`Erc20Holding`, `Pending*`). Deliberately out of
  scope: `SignBidirectionalEvent` is the byte-heaviest envelope, so signing the
  Signer layer captures the bulk of the reward surface **without** direct
  co-ownership of user funds. The value layer stays `signatory operators`.
- The **PreApproval Canton Coin payment** ("the deposit `sigNetworkFA` holds").
  That is a separate workstream; this spec only leaves a clean seam for it (§9).
- Featured-app **registration** (provisioning a `FeaturedAppRight` for
  `sigNetworkFA`) — operational, covered in `featured-app-rewards.md`.
- Reward automation (MintingDelegations, beneficiary splits).

## 2. Background: the current signing flow and its authority model

Verified against `daml-packages/daml-signer/daml/Signer.daml` and
`daml-packages/daml-vault/daml/Erc20Vault.daml` as of this writing.

Today a consumer drives signing in two steps:

1. The consumer (e.g. `Vault.RequestDeposit`, `Erc20Vault.daml:211`) **creates a
   transient `SignRequest`** (`signatory operators, requester`; `Signer.daml:124`).
   The consumer can do this because its own body already holds `operators`
   authority (the `Vault` is `signatory operators`) and `requester` is the choice
   controller.
2. The consumer **exercises `Signer.SignBidirectional`** (`Signer.daml:55`,
   `controller requester`), which delegates to `SignRequest.Execute`
   (`Signer.daml:130`). `Execute` computes `sender = computeOperatorsHash …` and
   **creates `SignBidirectionalEvent`** (`signatory operators, requester`;
   `Signer.daml:160`).

The MPC (`sigNetwork`) is only an **observer** of `SignBidirectionalEvent`
(`Signer.daml:161`). It later calls `Signer.Respond` / `RespondBidirectional`
(`controller sigNetwork`, `Signer.daml:63,83`), which create the evidence
contracts (`signatory sigNetwork`, `Signer.daml:191,214`).

**The anti-forgery property** (`Signer.daml:159`): `SignBidirectionalEvent`'s
signatories are `operators + requester` — *not* `sigNetwork` — so a compromised
MPC cannot forge a sign request. This property must be preserved.

### Why we cannot just add `sigNetworkFA` to the signatory lists

A `create` requires the authority of **all** the new contract's signatories, and
in Daml a signatory's authority is only available **inside a choice on a contract
that party signs** — it cannot be "pulled" into a caller's body. In the path
above, `SignBidirectionalEvent` is created inside `SignRequest.Execute`, a body
whose authority is `{operators, requester}` only. **There is no point in that path
where `sigNetworkFA`'s authority exists.** Adding it to the signatory list would
make the create fail.

We therefore need a body that simultaneously holds `{operators, requester,
sigNetworkFA}`. The clean way to get that is a choice on a contract **co-signed by
`sigNetworkFA`** (so its authority is ambient) whose **controllers are `operators`
+ `requester`** (so they remain the active authorizers).

## 3. Core mechanism

1. **Co-sign the `Signer` singleton** with `sigNetworkFA` (`signatory sigNetwork,
   sigNetworkFA`). This is the single authority root.
2. **Relocate `SignRequest` construction into a new `Signer` choice**,
   `RequestSignature`, whose `controller` is `operators, requester`. Inside that
   choice the body authority is `{sigNetwork, sigNetworkFA} ∪ {operators,
   requester}` — enough to build a `SignRequest`/`SignBidirectionalEvent` stamped
   with `sigNetworkFA`, while `operators + requester` remain the authorizing gate.
3. **Add `sigNetworkFA` to the signatory lists** of `SignRequest`,
   `SignBidirectionalEvent`, `SignatureRespondedEvent`, `RespondBidirectionalEvent`.
4. The **evidence events need no flow change**: once `Signer` is co-signed,
   `Signer.Respond` / `RespondBidirectional` bodies (authority `{sigNetwork,
   sigNetworkFA}`) can already stamp `sigNetworkFA`.

`sigNetworkFA` grants its authority **once**, when the `Signer` is created. After
that it is **ambient** — `sigNetworkFA` does not co-submit any transaction. Its
participant only needs to be online to **confirm** (which is the reward-earning
act). The requester and the MPC keep driving submissions exactly as today.

## 4. Detailed changes — `daml-packages/daml-signer/daml/Signer.daml`

### 4.1 `Signer` (co-sign + creation ceremony)

```daml
template Signer
  with
    sigNetwork   : Party
    sigNetworkFA : Party        -- NEW: featured-app provider party
  where
    signatory sigNetwork, sigNetworkFA
```

Creation now needs both parties' authority. Mirror the existing `VaultProposal`
multi-party pattern with a minimal propose/accept (MPC proposes, FA accepts):

```daml
template SignerProposal
  with
    sigNetwork   : Party
    sigNetworkFA : Party
  where
    signatory sigNetwork
    observer sigNetworkFA
    choice AcceptSigner : ContractId Signer
      controller sigNetworkFA
      do create Signer with sigNetwork; sigNetworkFA
```

### 4.2 New choice `Signer.RequestSignature` (replaces `SignBidirectional`)

```daml
-- on Signer (signatory sigNetwork, sigNetworkFA)
nonconsuming choice RequestSignature : ContractId SignBidirectionalEvent
  with
    operators                   : [Party]
    requester                   : Party
    txParams                    : TxParams
    caip2Id                     : Text
    keyVersion                  : Int
    path                        : Text
    algo                        : Text
    dest                        : Text
    params                      : Text
    outputDeserializationSchema : Text
    respondSerializationSchema  : Text
  controller operators, requester     -- anti-forgery gate UNCHANGED; sigNetworkFA is NOT a controller
  do
    -- body authority = {sigNetwork, sigNetworkFA} ∪ {operators, requester}
    signReqCid <- create SignRequest with
      operators; requester; sigNetwork; sigNetworkFA
      txParams; caip2Id; keyVersion; path; algo; dest; params
      outputDeserializationSchema; respondSerializationSchema
    exercise signReqCid Execute
```

- All `operators` are controllers, so every one of them must authorize — identical
  to today's requirement that all `operators` sign the `SignRequest`. No new
  burden: consumers already bring `operators` authority.
- `sigNetworkFA` is **not** a controller — it cannot censor individual requests; it
  pre-authorized all of them by co-signing the `Signer`.
- The old `SignBidirectional` choice (`Signer.daml:55`) is **removed**. With
  `SignRequest` now `signatory … sigNetworkFA`, no consumer can construct one
  directly anyway (it lacks `sigNetworkFA` authority), so this is also what closes
  the bypass.

### 4.3 `SignRequest` (+ `sigNetworkFA`; created only inside the Signer)

```daml
template SignRequest
  with
    operators    : [Party]
    requester    : Party
    sigNetwork   : Party
    sigNetworkFA : Party        -- NEW
    txParams     : TxParams
    -- … unchanged fields …
  where
    signatory operators, requester, sigNetworkFA   -- + sigNetworkFA
    observer sigNetwork
    ensure not (null operators) && unique operators && validTxParams txParams

    choice Execute : ContractId SignBidirectionalEvent
      controller requester
      do
        let sender = computeOperatorsHash (map partyToText operators)
        create SignBidirectionalEvent with
          operators; requester; sigNetwork; sigNetworkFA; sender
          txParams; caip2Id; keyVersion; path; algo; dest; params
          outputDeserializationSchema; respondSerializationSchema
```

`Execute` body authority = `signatories(SignRequest) ∪ {requester}` =
`{operators, requester, sigNetworkFA}` → can create the co-signed event.
`SignRequest` is kept (not inlined) to preserve its audited `ensure` and the
`sender` computation with the smallest diff; inlining is a possible later cleanup.

### 4.4 `SignBidirectionalEvent` (+ `sigNetworkFA`)

```daml
  where
    -- operators + requester are the active authorizers (controllers of
    -- Signer.RequestSignature). sigNetworkFA is an ambient co-signatory from the
    -- co-signed Signer. sigNetwork is still NOT an authorizer and cannot forge.
    signatory operators, requester, sigNetworkFA   -- + sigNetworkFA
    observer sigNetwork
    ensure … (unchanged)
```

Update the anti-forgery comment at `Signer.daml:159` accordingly.

### 4.5 Evidence events (+ `sigNetworkFA`, no flow change)

```daml
template SignatureRespondedEvent      -- and RespondBidirectionalEvent identically
  with
    sigNetwork   : Party
    sigNetworkFA : Party              -- NEW
    -- … unchanged …
  where
    signatory sigNetwork, sigNetworkFA   -- + sigNetworkFA
    observer operators, requester
```

`Signer.Respond` / `RespondBidirectional` keep the **same parameters** and are
still `controller sigNetwork`; their bodies now have `sigNetworkFA` ambient and
populate the new field. The MPC's call is byte-for-byte identical.

## 5. Consumer impact (`daml-vault` is the example)

No signatory changes to `Vault`, `Erc20Holding`, or the `Pending*` anchors. Only
the two call sites change from a 2-step to a 1-step exercise:

`Erc20Vault.daml:211-219` (`RequestDeposit`) and `:319-325` (`RequestWithdrawal`):

```daml
-- before: create SignRequest … ; exercise signerCid SignBidirectional with …
-- after:
signEventCid <- exercise signerCid RequestSignature with
  operators; requester
  txParams = EvmType2TxParams evmTxParams; caip2Id; keyVersion
  path = fullPath; algo; dest; params
  outputDeserializationSchema; respondSerializationSchema
```

The `Vault` body has `{operators, requester}` authority (it is `signatory
operators`; `requester` is the choice controller), which satisfies the
`operators, requester` controllers of `RequestSignature`. Downstream
(`fetch signEvent` → `requestId` → `create PendingDeposit`) is unchanged.

## 6. MPC node impact

**None.** `RequestSignature` produces a `SignBidirectionalEvent` with the same
fields the indexer reads (`sender`, `txParams`, `caip2Id`, …); `sigNetwork` is
still an observer and can read it. `Respond` / `RespondBidirectional` keep their
signatures. No change to `mpc/.../stream/ops.rs` or the indexers.

## 7. Security analysis

- **Anti-forgery preserved.** Creating a `SignBidirectionalEvent` still requires
  `operators + requester` to authorize (they are the controllers of
  `RequestSignature`). Neither `sigNetwork` nor `sigNetworkFA` can supply that, so
  a compromise of either cannot forge a sign request. The event additionally
  carries `sigNetworkFA` as an ambient signatory, which only **adds** a required
  signer — it never weakens the gate.
- **Independence requirement.** `sigNetworkFA` MUST be a genuinely independent key
  and participant from the MPC's `sigNetwork`. If they share fate, co-signing just
  widens the MPC's authority and the separation is illusory.
- **`sigNetworkFA` is a blanket co-signer, not a per-tx approver.** It consents
  once (at `Signer` creation) and cannot selectively block individual requests at
  the authority level — good for authorization liveness.
- **Liveness/freeze blast radius is now the whole signing layer.** Because
  `sigNetworkFA` is a signatory on every sign event and evidence event for every
  consumer, its participant must **confirm** all of them. If its node is down, no
  consumer can obtain a signature; if its key is lost, the `Signer` singleton is
  frozen (cannot be archived/replaced without it). Mitigate with HA hosting and a
  threshold/replicated key for `sigNetworkFA`.

## 8. Migration

Adding a signatory is an **authorization change, not a backward-compatible Smart
Contract Upgrade** — partners must re-integrate. Sequence:

1. Publish the new `daml-signer` package (new `(name, version)`); rebuild
   dependents (`daml-vault`).
2. Re-create the `Signer` via `SignerProposal` → `AcceptSigner` (two-party).
3. Re-disclose the new `Signer` (new `createdEventBlob`) to consumers.
4. Update consumers to call `RequestSignature`.
5. Update `test/.env` (`MPC_CANTON_SIGNER_CONTRACT_ID`, `_TEMPLATE_ID`,
   `_CREATED_EVENT_BLOB`) and regenerate bindings (`pnpm codegen:daml`).
6. Drain or dual-run any in-flight old-version `SignBidirectionalEvent`s before
   retiring the old package (their claim choices belong to the old templates).

`canton-sig` disclosure mechanics are unchanged — the disclosed `Signer` simply
has two signatories now.

## 9. Seam for the PreApproval Canton Coin payment (other workstream)

`sigNetworkFA` is also the intended **recipient/holder** of a Canton Coin
service-fee/deposit paid via a token-standard PreApproval path (separate agent).
To maximize reward and atomicity, that CC transfer to `sigNetworkFA` should ideally
be **composed into the same transaction** as `RequestSignature` (or the consumer
choice that calls it), so `sigNetworkFA` also confirms the transfer's traffic and
the fee is collected atomically with the signing request. This spec only reserves
the seam; it does not design the CC path.

## 10. Testing plan

- **Daml** (`TestSigner.daml`, `TestVault.daml`): allocate `sigNetworkFA`; create
  the `Signer` via `SignerProposal`/`AcceptSigner`; assert `RequestSignature`
  stamps `sigNetworkFA` as a signatory on `SignBidirectionalEvent` and on both
  evidence events.
- **Enforcement (negative):** assert a consumer cannot create a `SignRequest` or a
  `SignBidirectionalEvent` without `sigNetworkFA`, and cannot reach the old bypass.
- **Anti-forgery (negative):** assert `sigNetwork` alone — and `sigNetworkFA` alone
  — cannot create a sign event (still needs `operators + requester`).
- **Mutation checks:** drop an operator from the controller set / remove a
  signatory and confirm the relevant tests fail.
- **TS oracle suites:** logic unaffected; regenerate codegen types.
- **DevNet e2e:** redeploy + re-disclose; verify on Scan that `sigNetworkFA`
  appears as a confirmer on the intended views.

## 11. Open questions

1. `Signer` creation ceremony: confirm propose/accept (`SignerProposal`) over a
   direct two-party command submission.
2. Keep `SignRequest` as a relocated transient (this spec) vs. inline it into
   `RequestSignature` later.
3. Migration cutover: hard switch vs. dual-run window for in-flight events.
