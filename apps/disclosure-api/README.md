# @canton/disclosure-api

Public, read-only HTTP endpoint that serves Canton disclosed-contract blobs an MPC-vault integrator needs — the `Signer`, the `Vault`, and the CC fee contracts (`FeeCollectorRegistration`, `CcFeeCollector`, `FeePriceConfig`) — so a requester who cannot read the `sigNetwork`-only `Signer` in their own ACS can still attach it to `RequestDeposit` / `RequestWithdrawal`. Served **per network**.

## Endpoints

`GET /api/testnet` — the explicit per-network path is the only URL (no aliases; the bare root 404s). The route returns:

```jsonc
{
  "network": "testnet",
  "signer": {
    "templateId": "…",
    "contractId": "…",
    "createdEventBlob": "…",
    "synchronizerId": "…",
  },
  "vault": { "templateId": "…", "contractId": "…", "createdEventBlob": "…", "synchronizerId": "…" },
  "fee": [
    /* FeeCollectorRegistration, CcFeeCollector, FeePriceConfig */
  ],
}
```

To attach them all to a submission's `disclosedContracts`, a client builds `[signer, vault, ...fee]`. (There's intentionally no flattened copy — it would just duplicate these blobs.) An unknown network returns 404.

Public + cached (`Cache-Control: public, s-maxage=300, stale-while-revalidate=86400`), `CORS: *`. A `createdEventBlob` grants no authority — submitting with it still requires on-ledger authorization — so these payloads are safe to serve publicly.

## Data source

Each route serves `disclosures.<network>.ts` in this package — a generated module (`export default { signer, vault, fee }`) written by `test/src/scripts/deploy.ts` (step 6) on each (re)deploy of that network. Each route imports its network's module and selects by the `[network]` path segment. Vercel's Node builder compiles and bundles them into the function (a plain module import is reliably traced and bundled; a JSON import is not). So the endpoint needs **no ledger access, no OIDC secrets, and no Daml-generated code at runtime** — it just returns committed, ledger-public payloads. The modules are committed, so the served data is reviewable in git.

> **Production note:** `fee` is a convenience snapshot. The `FeePriceConfig` reprices (`UpdateFee`), so a static snapshot of it goes stale, and a non-stakeholder requester can't read it from the ledger anyway. In production this endpoint must resolve the fee **live** (read as `sigNetworkFA` via `getFeeCollectorContext`) rather than serve the baked-in module. The `Signer`/`Vault` are stable singletons, so serving those from the snapshot stays correct.

## Deploy (Vercel — build locally, deploy prebuilt)

The repo is a pnpm workspace whose install resolves codegen-only packages (`canton-sig`'s `@daml.js/*` `file:` deps) that don't exist in a fresh CI checkout, so a Vercel git build fails at `pnpm install`. We therefore **build locally and deploy the prebuilt output**:

```bash
# 0. one-time: link the Vercel project (run from apps/disclosure-api)
vercel link

# 1. after a contract (re)deploy, regenerate that network's data module
#    (writes apps/disclosure-api/disclosures.<network>.ts) and commit it
CANTON_NETWORK=testnet DOTENV_CONFIG_PATH=.env.testnet DEPLOY_CONFIRM=1 \
  pnpm --filter canton-mpc-test exec tsx src/scripts/deploy.ts                                                  # testnet

# 2. build locally (compiles disclosures.*.ts in) and deploy the prebuilt output
pnpm run deploy:prod   # = vercel build --prod && vercel deploy --prebuilt --prod
```

Every network's `disclosures.<network>.ts` module must exist at build time — they're committed, so a fresh checkout builds. After a (re)deploy, commit the regenerated module so the served data stays reviewable in git.

- **No environment variables / secrets** required.
- `pnpm dev` runs `vercel dev` for a local server; `pnpm run check:types` type-checks.
