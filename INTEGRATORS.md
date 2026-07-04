# Integrators: running your consumer from your own Canton node

This is the deployment guide for teams building a Daml consumer package on top of [`signet-signer-v1`](daml-packages/signet-signer-v1/README.md) (with [`signet-vault-v1`](daml-packages/signet-vault-v1/README.md) as the worked example). It assumes you operate your own Canton node and know Daml — it covers only what is specific to integrating the Signer, up to a working deployment on DevNet/TestNet.

**Integrators run their own node.** Sig-net does not host integrator parties, users, or DARs on its participant — your parties live on your participant, your DARs are vetted there, and your clients talk to your own JSON Ledger API with your own auth. The two nodes meet on the shared synchronizer: disclosed contracts carry the Signer (and the fee contracts it charges through) to your submissions, and Canton delivers the MPC's evidence events to your participant because your parties are informees on them.

## Who runs what

|            | Sig-net (operator)                                           | You (integrator)                                                                                                                |
| ---------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Node       | Validator + participant hosting `sigNetwork`, `sigNetworkFA` | Your own validator + participant on the same network                                                                            |
| Contracts  | `Signer` (+ ceremony) and the fee contracts                  | Your consumer templates, your domain contracts, your pending anchors                                                            |
| Parties    | `sigNetwork` (MPC), `sigNetworkFA` (featured-app party)      | Your `operators` set and your requesters                                                                                        |
| Off-ledger | MPC cluster, disclosure endpoint                             | Your client (see [`canton-sig`](ts-packages/canton-sig/README.md)), disclosure serving for **your** contracts to **your** users |

## 0. Prerequisites

- **A Canton participant/validator node** connected to the target network, set up per the official Canton docs. Your participant's JSON Ledger API and its OIDC auth are yours to configure — sig-net never proxies your submissions.
- **Daml SDK (DPM) 3.5.1** for building your consumer package.
- **From sig-net** (ask us): the disclosure endpoint URL. Everything else you need is public.

Per-network values that are already public:

| Input                                                   | DevNet                                                                                                      | Testnet                                         |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Disclosure endpoint (`{ network, signer, vault, fee }`) | `https://disclosure-api.vercel.app` (alias of `/api/devnet`)                                                | `https://disclosure-api.vercel.app/api/testnet` |
| MPC root public key                                     | signet.js [`ROOT_PUBLIC_KEYS.TESTNET_DEV`](https://github.com/sig-net/signet.js/blob/main/src/constants.ts) | signet.js `ROOT_PUBLIC_KEYS.TESTNET`            |
| Destination-chain `caip2Id` the MPC accepts             | `eip155:1` only (see the [`RequestSignature` field table](daml-packages/signet-signer-v1/API.md#signer))    | same                                            |

Root keys are NAJ-encoded (`secp256k1:…`); convert with signet.js `normalizeToUncompressedPubKey` before deriving addresses or the response-verification key.

## 1. Build your consumer against the release DARs — never rebuild ours from source

Download the DARs from the [GitHub release assets](https://github.com/sig-net/canton/releases) (currently `v0.0.1`) and verify them against `SHA256SUMS.txt`. These are **byte-exact the packages vetted on DevNet and testnet**; the release notes list the package-id of each.

> **Why this matters:** a Daml package-id is a hash of the package source. If you rebuild `signet-signer-v1` from a clone of this repo at any commit that differs from the release, you get a _different_ package-id under the _same_ `name`+`version` — and Canton refuses to vet two same-name+version packages with different package-ids (`KNOWN_PACKAGE_VERSION`). Your consumer DAR embeds the dependency's package-id at compile time, so building against the wrong bytes produces a package that can never be vetted next to the deployed one. Always compile against the downloaded release assets.

`daml.yaml` for a consumer package (mirrors the [signer README quickstart](daml-packages/signet-signer-v1/README.md#quickstart), with downloaded paths):

```yaml
sdk-version: 3.5.1
name: my-consumer
version: 0.0.1
source: daml
dependencies:
  - daml-prim
  - daml-stdlib
data-dependencies:
  - ./dars/signet-signer-v1-0.0.1.dar
  - ./dars/signet-eip712-0.0.1.dar # transitive — required at compile time
  - ./dars/signet-api-fee-v1-1.0.0.dar
  - ./dars/splice-api-token-metadata-v1-1.0.0.dar
  - ./dars/splice-api-token-holding-v1-1.0.0.dar
  # optional: signet-abi (calldata decoding), signet-vault-v1 (to extend the worked example)
build-options:
  - -Wno-crypto-text-is-alpha
```

The Daml-level integration contract lives with the signer package: the [README](daml-packages/signet-signer-v1/README.md) (authority model, lifecycle), its [API reference](daml-packages/signet-signer-v1/API.md), and the [security checklist](daml-packages/signet-signer-v1/SECURITY.md). This document only covers deployment. In API calls, reference templates by package name (`#signet-signer-v1:Signer:Signer`) — Canton resolves name refs to the highest vetted version, so later releases don't break your queries or commands. When we release new versions, new DAR assets appear on the GitHub release; vet them on your participant (existing contracts keep working).

## 2. Vet the DARs on your participant

Upload via `POST /v2/dars?vetAllPackages=true` (or `canton-sig`'s `uploadDar`); each upload vets the DAR's full dependency closure and is idempotent. Vet:

- your consumer DAR (its closure pulls in `signet-signer-v1`, `signet-eip712`, `signet-api-fee-v1`, and the splice token interfaces),
- `signet-fee-amulet-0.0.1.dar` — the signature-fee charge executes in a subtree your participant confirms,
- `signet-vault-v1-0.0.2.dar` only if you use the Vault.

As general vetting hygiene: **vet only official packages from trusted sources** — the checksum-verified release assets here, and Splice/token-standard packages from your own validator deployment. Treat vetting anything else like a production deploy approval.

## 3. Wire your client

Follow the [`canton-sig` README](ts-packages/canton-sig/README.md) — with these own-node specifics:

- **Ledger + auth are yours.** `CantonClient` points at your participant's JSON API; `options.getToken` uses your IdP. Your requester parties and their ledger users live on your participant — sig-net is not involved.
- **Disclosed contracts come from the disclosure endpoint.** It serves everything your submissions must attach: the `Signer` envelope, the fee-contract envelopes, and the `Vault` envelope if you use ours. Attach them on your request choice (`[yourContractDisclosure, signerDisclosure, ...feeDisclosures]`); your claim/completion choice needs only your own contract's disclosure. Parties are not disclosed — a party is just an identifier, and the normal flow needs no sig-net party ids at all.
- **Disclosures of your contracts to your users** (who can't read them from their own ACS) are yours to serve — [`apps/disclosure-api`](apps/disclosure-api/README.md) is a copyable pattern.
- **The signature fee rides along automatically.** Your request choice forwards three fee arguments to `RequestSignature`; fill them from what the disclosure endpoint serves, as [`test/src/test/devnet-e2e.test.ts`](test/src/test/devnet-e2e.test.ts) does.

## 4. Prove it on DevNet, then TestNet

Deploy your DAR and run your real flow — request → MPC signature → broadcast → verified outcome → your domain effect — against the live Signer and MPC on DevNet first, then TestNet. These networks exist for exactly this: exercising them is expected and harmless, and a full loop completing there **is** the integration test — if it works there, it works. Move to MainNet once the same flow is green on both.

How you test is up to you; as reference implementations to model your own checks on, this repo has [`test/src/test/devnet-e2e.test.ts`](test/src/test/devnet-e2e.test.ts) (the canonical client-side deposit/withdraw loop against DevNet) and [`test/src/scripts/cn-quickstart-integrator-check.ts`](test/src/scripts/cn-quickstart-integrator-check.ts) (the cross-participant flow we validate ourselves against a local [CN Quickstart](SETUP.md) stack).

## Checklist

- [ ] Node live on the target network; authenticated JSON API call works
- [ ] Release DARs downloaded and checksum-verified; consumer package compiles against them (SDK 3.5.1)
- [ ] Consumer DAR + `signet-fee-amulet` (+ `signet-vault-v1` if used) vetted on your participant
- [ ] Disclosure endpoint reachable
- [ ] Client wired: your auth, disclosure fetching and attachment
- [ ] Full loop green on DevNet, then TestNet
- [ ] [Security checklist](daml-packages/signet-signer-v1/SECURITY.md) reviewed for your consumer templates

## Troubleshooting

| Symptom                                                             | Likely cause                                                                                                     | Fix                                                                                    |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| DAR upload rejected with `KNOWN_PACKAGE_VERSION` / vetting conflict | You compiled against a rebuilt signet DAR instead of the release asset (same name+version, different package-id) | Rebuild your consumer against the downloaded release DARs                              |
| `CONTRACT_NOT_FOUND` on your request choice                         | Missing disclosure attachment                                                                                    | Attach `[yourContractDisclosure, signerDisclosure, ...feeDisclosures]` on the exercise |
| Request choice aborts inside the fee charge                         | Stale fee context (the charge is fail-closed)                                                                    | Re-fetch the fee envelopes from the disclosure endpoint and retry                      |
| Signer disclosure rejected as stale                                 | The `Signer` was rotated                                                                                         | Re-fetch from the disclosure endpoint rather than caching long-term                    |
