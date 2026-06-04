# CC Signature Fee — Operations Runbook

**Audience:** the sigNetwork operator. **Companion to:** [`cc-signature-fee.md`](./cc-signature-fee.md) (design) and [`featured-app-rewards.md`](./featured-app-rewards.md) (rewards model).

This is the off-ledger infrastructure the on-ledger fee charge depends on. The Daml side
(`SignRequest.Execute` charging the fee) is **fail-closed**: if any piece below lapses, `Execute`
aborts and no `SignBidirectionalEvent` is created — deposits and withdrawals stop until it is
restored. Everything here is operated by sigNetwork; nothing requires a Daml change.

> Throughout, `feeReceiver` is the party named in `SignerFeeConfig.feeReceiver`. Today it equals the
> MPC `sigNetwork` party; in the future it becomes a dedicated featured-app party `sigNetworkFA`
> (§5). The runbook is written so that "stand this up for `feeReceiver`" is the only thing that
> changes at that migration.

---

## 1. Components sigNetwork must operate

| # | Component | Purpose | Cadence |
| - | --------- | ------- | ------- |
| 1 | `FeaturedAppRight` for `feeReceiver` | Earn featured-app rewards on the fee-transfer confirmation traffic (CIP-0104). | One-time request; keep approved. |
| 2 | Self-provided `TransferPreapproval` for `feeReceiver` | One-step settlement: the requester's CC transfer credits `feeReceiver` without it signing at request time (CIP-0107). | Renew before 90-day expiry. |
| 3 | `SignerFeeConfig` + reprice job | Hold the current `feeAmount`; re-peg it to CC economics. | `UpdateFee` ~every 10 min. |
| 4 | Fee-disclosure endpoint | Serve the current `SignerFeeConfig` disclosure to requesters (they can't read the sigNetwork-only contract). | Online; response rotates per reprice. |

All four must be live for the flow to work. (1) and (2) are standing Splice/wallet state; (3) and (4)
are sigNetwork services backed by the `daml-signer` package.

---

## 2. One-time bootstrap

### 2.1 Vet the packages

Upload and vet the vendored token-standard interface DARs and the new `daml-signer` / `daml-vault`
versions on sigNetwork's participant (and confirm they are vetted on the requesters' participants):

```
splice-api-token-metadata-v1-1.0.0.dar
splice-api-token-holding-v1-1.0.0.dar
splice-api-token-transfer-instruction-v1-1.0.0.dar
daml-signer-0.0.1.dar          # SignerFeeConfig + the new Execute/SignBidirectional choice shapes
daml-vault-poc-0.0.1.dar       # RequestDeposit/RequestWithdrawal with the fee args
```

`CantonClient.uploadDar(path)` (`vetAllPackages=true`) is idempotent on re-upload. The heavy
`splice-amulet` implementation (where `AmuletRules`, `TransferFactory`, `TransferPreapproval`,
`OpenMiningRound` live) is **not** vetted by us — it is already vetted on CN Quickstart / DevNet.

### 2.2 `FeaturedAppRight` for `feeReceiver`

Featured status is approved by the Foundation / Tokenomics Committee at
`sync.global/featured-app-request`; on approval the DSO places a `FeaturedAppRight` contract on-ledger
for `feeReceiver`. The DSO reads active `FeaturedAppRight`s at the start of each mining round, so the
party only earns once the right is live.

- Confirm `feeReceiver` is approvable as a featured app for this use (open question §13.1 of the
  design — resolve before mainnet).
- Featured status is **revocable** for abuse — the fee is a real price for real signing traffic, not
  manufactured volume (`cc-signature-fee.md` §7).

### 2.3 Self-provided `TransferPreapproval` for `feeReceiver`

`feeReceiver` pre-approves incoming CC **to itself** via its validator/wallet, so the requester's
transfer settles in one step inside `Execute` (the receiver does not sign at request time).

- Provider = receiver = `feeReceiver`. The provider pays the preapproval fee (~$1/yr) and the 90-day
  expiry applies (CIP-0107).
- Exact creation call is the validator wallet's create-transfer-preapproval flow on the **target
  Splice version** — confirm against that version (CIP-0107 deprecated the older
  `transfer-preapproval/prepare-send` / `/submit-send` endpoints; design §13.3).
- **Verification:** a top-level token-standard transfer of `feeAmount` from a funded test requester to
  `feeReceiver` must settle one-step (`TransferInstructionResult_Completed`). If it returns
  `Pending`, the preapproval is missing/expired — fix before enabling the flow.

### 2.4 Create the initial `SignerFeeConfig`

Compute the first `feeAmount` with the reprice kernel (§3.1), then create the config as `sigNetwork`:

```ts
// templateId: "#daml-signer:SignerFee:SignerFeeConfig"
await canton.createContract(userId, [sigNetwork], SignerFeeConfig.templateId, {
  sigNetwork,
  feeReceiver,                       // = sigNetwork today; = sigNetworkFA later
  instrumentAdmin,                   // CC/Amulet DSO admin party
  instrumentId: "Amulet",
  feeAmount,                         // from computeFeeCc(...)
  validFrom,                         // ≤ now
  validUntil,                        // now + window (see §3.1 overlap policy)
  version: "0",
});
```

`SignerFeeConfig` is **signatory sigNetwork** — a requester cannot forge a cheaper config, and
`Execute` binds the supplied config to the request's `sigNetwork` (`validateFeeConfig`).

---

## 3. Standing automation

### 3.1 Reprice loop (~10 min ≈ one `OpenMiningRound` cycle)

Re-peg `feeAmount` to current CC economics. The only fast-moving input is `amuletPrice` (new
`OpenMiningRound` ~every 10 min), so re-pegging at that cadence keeps the coverage buffer small
(design §6.3, decision #2).

**Inputs (read off-chain from Scan / the current `OpenMiningRound`):**

- `bytes` — measured billable bytes of `Respond` + `RespondBidirectional` (Scan CIP-0104 traffic API
  or a `MemberTraffic` delta). **Measure it; never hand-calc.** Re-measure whenever those evidence
  contracts change shape.
- `extraTrafficPriceUsdPerMb`, `amuletPriceUsdPerCc`.
- `coverage` (~0.10–0.15, tuned to the worst `amuletPrice` move over one interval + post-back
  latency) and `profit` (0.10) — kept **separate** so a normal CC dip can't eat profit and then break
  coverage.

**Compute + post:**

```ts
import { computeFeeCc, getCurrentFeeDisclosure } from "canton-sig";

const { feeCc } = computeFeeCc({ bytes, extraTrafficPriceUsdPerMb, amuletPriceUsdPerCc, coverage, profit });

// find the live config (as sigNetwork) and reprice it
const { contractId, config } = await getCurrentFeeDisclosure(canton, sigNetwork);
await canton.exerciseChoice(userId, [sigNetwork], SignerFeeConfig.templateId, contractId, "UpdateFee", {
  newAmount: feeCc,
  newValidFrom: nowIso,
  newValidUntil: addMinutes(nowIso, WINDOW_MIN),   // see overlap policy below
});
```

`UpdateFee` archives the old config and creates a new one with `version + 1` and a **new contract
id** — which is exactly why the disclosure endpoint (§3.2) serves the *current* envelope rather than
a hardcoded cid.

**Validity-window + overlap policy (design §4, open question §13.4).** Give each config a
`[validFrom, validUntil]` window and **pre-publish the next interval's config with an overlapping
window**, so there is always an in-window config and in-flight submissions never straddle a gap.
`Execute` rejects an expired config (anti-replay) even if it is archived lazily. Suggested starting
point: window = ~30 min, repriced every ~10 min (≈3× overlap); tune from observed post-back latency.

The fee math runs **entirely off-chain** — only the resulting CC number is posted — so `Execute`
needs no `splice-amulet` build dependency (design §6.3).

### 3.2 Fee-disclosure endpoint

`SignerFeeConfig` is sigNetwork-only, so a requester cannot read it from its own ACS. sigNetwork
serves the current disclosure — the same handoff as the `Signer` envelope, but live:

```ts
// runs with sigNetwork's read authority; returns { config, contractId, disclosure }
const current = await getCurrentFeeDisclosure(canton /* reads as sigNetwork */, sigNetwork);
return current.disclosure; // { templateId, contractId, createdEventBlob, synchronizerId }
```

`getCurrentFeeDisclosure` picks the in-window config (highest `version` when windows overlap) and
returns the 4-field `DisclosedContract`. This is a **stable URL whose response rotates** with each
`UpdateFee` — the same pattern Scan uses to serve `OpenMiningRound` / `AmuletRules`. Document the
endpoint once; never publish a fee cid.

### 3.3 Preapproval renewal

The `TransferPreapproval` from §2.3 expires every 90 days (CIP-0107). Renew well ahead of expiry —
if it lapses, the requester's transfer can no longer settle one-step and `Execute` fail-closes. Alarm
on "preapproval expires in < 14 days".

---

## 4. Fail-closed behavior & alarms

`Execute` aborts (blocking the deposit/withdrawal) when:

| Condition | Symptom | Fix |
| --------- | ------- | --- |
| No in-window `SignerFeeConfig` | `getCurrentFeeDisclosure` throws "no in-window"; or `Execute` "not yet valid"/"expired" | Reprice job stalled — restart §3.1; widen overlap. |
| Preapproval missing/expired | `Execute` "Fee transfer did not settle one-step; receiver TransferPreapproval required" | Renew §2.3. |
| Requester has insufficient / too-fragmented CC | client `selectInputHoldings` throws; or `Execute` transfer fails | Requester funds / consolidates holdings (≤100 inputs). |
| Stale fee cid races an `UpdateFee` | `CONTRACT_NOT_FOUND` | Client refetches the current envelope (§3.2) and resubmits. |
| Wrong `sigNetwork` binding | `Execute` "Fee config belongs to a different sigNetwork" | Client used a foreign config — fetch from the correct endpoint. |

Recommended alarms: reprice job heartbeat (no `UpdateFee` in > 2 intervals), preapproval expiry
countdown, featured-right active, and a synthetic end-to-end deposit canary.

---

## 5. The `sigNetworkFA` split (future)

Today `feeReceiver = sigNetwork`. To move the payee to a dedicated featured-app party `sigNetworkFA`
**without any Daml change**:

1. Stand up `sigNetworkFA` with its own `FeaturedAppRight` (§2.2) and self-provided
   `TransferPreapproval` (§2.3).
2. `UpdateFee` (or create a fresh `SignerFeeConfig`) with `feeReceiver = sigNetworkFA`.
3. Point the reprice job and disclosure endpoint at the new config.

`Signer`, `SignRequest`, `Execute`, and the vaults are untouched — `feeReceiver` is just a field
(design §6 "Future party split").

---

## 6. Checklists

**Bring-up**

- [ ] Token-standard interface DARs + `daml-signer` / `daml-vault` vetted on all relevant participants (§2.1).
- [ ] `FeaturedAppRight` active for `feeReceiver` (§2.2).
- [ ] `TransferPreapproval` for `feeReceiver` live; one-step settlement verified (§2.3).
- [ ] Initial `SignerFeeConfig` created; `feeAmount` from `computeFeeCc` (§2.4).
- [ ] Reprice job running at ~10-min cadence with overlapping windows (§3.1).
- [ ] Fee-disclosure endpoint reachable; returns the current envelope (§3.2).
- [ ] End-to-end deposit canary passes (fee actually charged + settled).

**Daily / on-call**

- [ ] Reprice heartbeat green; `version` advancing.
- [ ] Preapproval expiry > 14 days.
- [ ] Featured-right still active (status is revocable).
- [ ] No spike in `Execute` fee-abort errors.
