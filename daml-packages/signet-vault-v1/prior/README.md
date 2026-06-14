# SCU upgrade baselines (`prior/`)

When cutting a **new version** of `signet-vault-v1`, place the **previously released
DAR** here so the build and CI can verify the new version is a valid Smart
Contract Upgrade of it.

## Release workflow

1. Bump `version:` in `../daml.yaml`. Keep `name:` **unchanged** — the package
   name is the SCU upgrade key and the `#signet-vault-v1:Module:Tmpl` refs in the
   TS client and the e2e test rely on it staying stable across versions. A
   _breaking_ change ships as a new name (`signet-vault-v2`), not a bump here.
2. Copy the last released DAR into this directory:
   ```
   cp <released>/signet-vault-v1-0.0.1.dar prior/
   ```
3. (Optional build-time gate) Uncomment the matching `upgrades:` line in
   `../daml.yaml` so `dpm build` itself fails fast on an incompatible change.
4. `dpm build --all`, then `bash scripts/scu-upgrade-check.sh` (CI runs this) to
   assert compatibility against every baseline in this folder.

On the **first** release there is no baseline, so this folder holds only this
README and the check is skipped (not failed).

> `.dar` baselines are committed intentionally — the check needs them, and they
> are not covered by the repo's `.daml/` ignore rule. Keep only the baseline(s)
> you want enforced; switch to fetching from a release artifact / DAR registry
> if repo size becomes a concern.
