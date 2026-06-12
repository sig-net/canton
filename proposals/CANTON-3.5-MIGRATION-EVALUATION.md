# Canton / Daml 3.4.11 → 3.5.1 Migration Evaluation

**Project:** `canton-mpc-poc` (Signet MPC custody PoC)
**Date:** 2026-06-01
**From:** SDK `3.4.11` — **Target:** Canton / Daml **3.5.1**
**Scope reviewed:** `daml-signer`, `daml-vault`, `daml-eip712`, `daml-abi`, `daml-uint256`, and the `canton-sig` TS client (`canton-client.ts`, generated `@daml.js` bindings). Also the **MPC node** (separate `mpc/` repo) — its Canton integration `chain-signatures/node/src/indexer_canton/*` + `rpc.rs` (see §6).

> Note: "Daml 3.5.1" here means **Canton 3.5.1** (released 2026-05-27), the first GA of the 3.5 line — i.e. the whole 3.4 → 3.5 generation jump. There is no separate Daml _SDK_ 3.5.1 GitHub release; `3.5.1` is the platform/`sdk-version`.

> **Implementation status (2026-06-11).** The toolchain migration is executed:
> all `daml.yaml`s + CI pin SDK `3.5.1`, every Daml/TS suite passes on it, and
> codegen is regenerated against the 3.5.1 OpenAPI (default Daml-LF target is
> unchanged at 2.2, so DARs stay PV-34-deployable). The 3.5 compiler's new
> `template-interface-depends-on-daml-script` warning prompted splitting the
> inline `daml-abi`/`daml-eip712`/`daml-uint256` tests into `*-tests` packages —
> shipped DARs no longer bundle `daml-script`. The MPC repo pins its CI sandbox
> to 3.5.1 and documents the `#daml-signer:Signer:Signer` template-id form
> (sandbox-verified on 3.5.1: package-id refs are **rejected on read filters**,
> still tolerated-deprecated on command submission — §6's read-side claim
> confirmed). Pending: the LF 2.3 retarget (`--target=2.3`, drops the crypto
> alpha flag) once the global synchronizer's LSU to PV 35 lands, and a DevNet
> e2e run against the redeployed baseline.

---

## TL;DR — Verdict

**Migrate.** The one compelling reason is **`DA.Crypto.Text` graduating from alpha → stable** (in Daml-LF 2.3); this codebase's on-ledger signature verification is built entirely on it. **Contract keys are a minor convenience, not a driver.** The migration is **low-risk** because the most expensive 3.5 breaking changes do not apply here.

| Driver                                   | Magnitude         | Notes                                                                                                            |
| ---------------------------------------- | ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| `DA.Crypto.Text` → stable                | **High**          | Removes alpha dependency from the security-critical crypto core. Requires LF 2.3 + PV 35.                        |
| Contract keys                            | Low               | Minor ergonomic win for `requestId`/`vaultId` correlation; cannot replace existing single-use/anti-replay logic. |
| Performance (ACHS, session signing keys) | None at PoC scale | Session signing keys only matter with KMS + external signing — not used here.                                    |

> **MPC node (Rust, separate `mpc/` repo):** the migration is effectively a **no-op** — no functional improvement, minimal burden. Its threshold-signing core is version-independent and its Canton integration is already 3.5-shaped. See **§6**.

---

## 1. Primary benefit — `DA.Crypto.Text` becomes stable

Every crypto-bearing `daml.yaml` carries `-Wno-crypto-text-is-alpha`, because the security model depends on **alpha** APIs:

- `Erc20Vault.ClaimDeposit` / `CompleteWithdrawal` verify the MPC signature on-ledger with **`secp256k1WithEcdsaOnly`**.
- `RequestId.daml` / `Eip712.daml` derive request IDs and EIP-712 hashes with **`keccak256`, `packHexBytes`, `byteCount`, `toHex`, `fromHex`**.
- Core types `BytesHex` / `SignatureHex` / `PublicKeyHex` come from `DA.Crypto.Text`.

In **Daml-LF 2.3 (3.5), `DA.Crypto.Text` is marked stable.** For a custody system whose safety depends on on-ledger verification, moving that foundation from "alpha, may change without notice" to semver-stable is a real production-readiness / auditability win. The `-Wno-crypto-text-is-alpha` suppression can be dropped.

**Dependency / caveat:** this is **not** free with the 3.5 binaries. Stable `DA.Crypto.Text` lives in **LF 2.3**, and LF 2.3 requires **protocol version 35**. So the benefit is coupled to retargeting (`--target=2.3`) and moving the synchronizer to PV 35.

---

## 2. Contract keys — modest benefit for this codebase

3.5 reintroduces contract keys (`lookupByKey`/`fetchByKey`/`exerciseByKey`, plus `lookupNByKey`/`lookupAllByKey` in `DA.ContractKeys`). For this project they are a **nice-to-have, not a reason to migrate**:

- **MPC watch loop** (Rust node, `indexer_canton/stream.rs`) is stream-driven — it watches _all_ `SignBidirectionalEvent`s via `/v2/updates` + an ACS catch-up scan. Keys add nothing to a "watch everything" loop.
- **Anti-replay / single-use** relies on explicit `ContractId` threading + `archive`-first + `ensure`/`requestId` validation (e.g. _"archive first: single-use guarantee against MPC-outcome replay"_). 3.5 keys are **non-unique with unvalidated negative lookups**, so they **cannot** replace this logic — every assertion stays.
- **The one place keys would help:** correlation — locating the `RespondBidirectionalEvent` / `SignatureRespondedEvent` for a given `requestId` (today: `getActiveContracts` + filter). Keying those by `requestId` (maintainer `sigNetwork`) would allow `fetchByKey` instead of scan-and-filter. Real but small, and it costs a template change + version bump.

**Recommendation:** defer contract keys; adopt later only if the correlation layer becomes a pain point.

---

## 3. Why this migration is low-risk — breaking changes that do NOT apply

| 3.5 breaking change                                                                                                                    | Affects us? | Why                                                                                                                                                                                                          |
| -------------------------------------------------------------------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Package-id rejected on read APIs** (the big one)                                                                                     | **No** ✅   | Codegen emits `.templateId = '#daml-signer:Signer:…'` (package-**name** form) and we use `.templateId` consistently in `getActiveContracts`/filters. Already on the correct form.                            |
| `filter`/`verbose` → `updateFormat`                                                                                                    | **No** ✅   | The TS client doesn't stream (ACS polling only); the Rust node's `/v2/updates` subscription already uses `updateFormat` (§6).                                                                                |
| External-signing changes (hashing scheme v3, physical `synchronizer_id`, `PartyToParticipant` consolidation, max-signatures-per-party) | **No** ✅   | No Canton interactive/external signing anywhere — the MPC submits as a **hosted party** via `submit-and-wait`. (Our "MPC signing" is of EVM txs, verified on-ledger — unrelated to Canton external parties.) |
| Daml Assistant removed (use `dpm`)                                                                                                     | **No** ✅   | Already on `dpm`.                                                                                                                                                                                            |
| ACS export/import & repair command signature changes                                                                                   | **No** ✅   | Not used by the client.                                                                                                                                                                                      |

---

## 4. Migration cost — required work

Mechanical, and safe for a PoC with no production ledger data:

1. **Stand up 3.5 + PV 35** (sandbox / synchronizer at protocol version 35).
2. **Retarget all packages to LF 2.3**: add `--target=2.3` (build-options) and remove `-Wno-crypto-text-is-alpha` in every `daml.yaml`. Rebuild and confirm the exact crypto function set compiles clean under LF 2.3.
   - This **changes every package-id** → re-vet DARs + bump versions. The existing `data-dependencies` / SCU chain (`daml-abi`/`daml-eip712`/`daml-signer` → `daml-vault`) already handles this.
3. **Regenerate OpenAPI types** (`pnpm codegen:api`) against the 3.5 spec — fields become newly-optional, so expect a few TS `??` / `!` fixes.
4. **Regenerate `@daml.js` bindings** (`pnpm codegen:daml`) after the DAR rebuild.
5. **Regression gate:** re-run the oracle (`pnpm -r test`), integration, and Sepolia e2e suites.

---

## 5. Recommended sequencing

```
3.5 binaries + PV 35
        ↓
--target=2.3 + drop -Wno-crypto-text-is-alpha  (all packages)
        ↓
rebuild DARs → re-vet → regenerate @daml.js + OpenAPI types
        ↓
green-light on oracle + integration + Sepolia e2e
        ↓
(later, optional) contract keys for requestId/vaultId correlation
```

Do it **for the crypto stabilization**; skip contract keys for now. Given how much of the 3.5 breaking surface this codebase already sidesteps, it is one of the cleaner 3.4 → 3.5 migrations available.

---

## 6. MPC node (Rust) — Canton integration (separate `mpc/` repo)

The threshold-signing node (`mpc/chain-signatures`, sig-net cait-sith / k256) integrates with Canton through `chain-signatures/node/src/indexer_canton/` + `rpc.rs`. **Verdict: the migration is effectively a no-op for the node** — the 3.5 benefits land on the Daml side, and the node's signing core is version-independent.

**What it does:** a JSON Ledger API v2 **indexer + responder** — subscribes to `/v2/updates` over WebSocket (`updateFormat`, **wildcard** party filter), matches events by **suffix** (`template_suffix_matches`), triggers MPC signing, and submits `Respond` / `RespondBidirectional` via `submit-and-wait` as a **hosted party + JWT**. No Canton external signing; no contract-key lookups.

### Why no 3.5 feature improves the node

| 3.5 feature                    | Improves node?       | Why                                                                                                                                                    |
| ------------------------------ | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contract keys                  | **No**               | Purely stream-driven (wildcard subscription); never looks a contract up by key.                                                                        |
| External / interactive signing | **No**               | Submits as a hosted party (`act_as` + JWT). The threshold sig is verified _in Daml_ (`secp256k1WithEcdsaOnly`), not at the Canton party layer.         |
| `DA.Crypto.Text` → stable      | **No (and no risk)** | Node hashing is its own Rust (`keccak256`, `k256`); LF 2.3 doesn't change `keccak256` output → **Rust ↔ Daml ↔ TS golden request-id match preserved**. |
| ACHS / perf                    | **No**               | Not relevant at PoC throughput.                                                                                                                        |

### Already on the right side of the breaking changes

- **`updateFormat`** already used (not legacy `filter`/`verbose`). ✅
- **Audience-based JWT** — `auth.rs` always sends `audience` (required `MPC_CANTON_OIDC_AUDIENCE`), so 3.5's _scope-based-token_ deprecation doesn't bite. _(Optional: drop `MPC_CANTON_OIDC_SCOPE`; ensure the IdP issues an `aud` claim matching the participant's `target-audience`.)_ ✅
- **Suffix matching** on incoming events — robust to package-name vs package-id prefix. ✅
- **Wildcard update filter** — the stream sends no template-id, so "package-id rejected on read APIs" can't touch the hot path. ✅
- **Submission** uses the package-hash `signer_template_id`, which is fine — the package-id ban is read-side only; `ExerciseCommand.templateId` still accepts a package-id. ✅

### The one optional improvement

`signer_template_id` is configured as the **package-hash** form (`<hash>:Signer:Signer`) — the code notes it _"changes on every DAR upgrade, invalidating this value"_, forcing reconfigure + restart on every Daml upgrade. Switching it to the **package-name** form **`#daml-signer:Signer:Signer`** makes it **survive DAR upgrades** (SCU keeps names stable) and future-proofs the `fetch_active_contracts` read helper. _Caveat:_ the separate `signer_contract_id` **contract-id** pin (`verify_sign_event` check 3) still changes on redeploy — package-name doesn't fix that half.

### Node-side cost (maintenance, not improvement)

`indexer_canton/ledger_api.rs` is **hand-translated from the OpenAPI spec** and re-verified field-by-field against the 3.5.1 OpenAPI/AsyncAPI specs — newly-optional fields are absorbed by `#[serde(default)]` / `Option<…>`, and the node's Canton CI pins its sandbox to 3.5.1.

### Forward-looking (optional, not free)

Because the node is a secp256k1 threshold signer, 3.5's improved external-party / interactive submission (single `PartyToParticipant` tx, session signing keys, ECDSA external signing) _could_ later let the MPC sign Canton transactions directly as an **external party**, retiring the JWT-hosted-party + on-ledger `secp256k1WithEcdsaOnly` design. A redesign worth its own evaluation — the current design is sound and simpler.

---

## Evidence — files reviewed

- **Config:** `multi-package.yaml`, `daml-packages/*/daml.yaml` (now all `sdk-version: 3.5.1`; crypto-bearing packages carry `-Wno-crypto-text-is-alpha`; SCU `data-dependencies` present).
- **Templates:** `daml-signer/daml/Signer.daml` (Signer/SignBidirectionalEvent + response events), `daml-vault/daml/Erc20Vault.daml` (Vault deposit/withdraw, on-ledger `secp256k1WithEcdsaOnly`), `daml-signer/daml/RequestId.daml`, `daml-eip712/daml/Eip712.daml`.
- **Client:** `ts-packages/canton-sig/src/infra/canton-client.ts` (JSON Ledger API v2 via `openapi-fetch`; `submit-and-wait`, `/v2/state/active-contracts`).
- **Codegen:** `generated/model/daml-signer-0.0.1/lib/Signer/module.js` → `templateId: '#daml-signer:…'` (package-name) vs `templateIdWithPackageId: '<hash>:…'`; code uses `.templateId`.
- **MPC node (`mpc/` repo):** `chain-signatures/node/src/indexer_canton/ledger_api.rs` (hand-translated OpenAPI structs, re-verified against 3.5.1; bare `Module:Entity` suffix constants), `indexer_canton/stream.rs` (WebSocket `updateFormat`, wildcard filter, suffix matching, hosted-party submit), `indexer_canton/auth.rs` (OIDC client-credentials, audience-based JWT), `rpc.rs` (`fetch_active_contracts`, `submit_and_wait`, `exercise_choice` using `signer_template_id`), `indexer_canton/mod.rs` (config — `signer_template_id` = package-hash, noted to break on every DAR upgrade).

## Sources

- [Canton 3.5.1 release notes (digital-asset/canton)](https://github.com/digital-asset/canton/releases) — non-unique contract keys, LF 2.3 / stable `DA.Crypto.Text`, package-name enforcement on read APIs, `max-lookup-limit`, hashing scheme v3.
- [`DA.ContractKeys` — Daml 3.5 stdlib](https://docs.digitalasset.com/build/3.5/reference/daml/stdlib/DA-ContractKeys.html) — `lookupNByKey`, `lookupAllByKey`.
- [Upgrade to a new release — Daml/Canton 3.5](https://docs.digitalasset.com/operate/3.5/howtos/upgrade/index.html) — binary swap + forced DB migration; PV 34 still supported.
