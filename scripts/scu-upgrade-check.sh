#!/usr/bin/env bash
# Smart Contract Upgrade (SCU) compatibility gate.
#
# For each upgradable template package, if one or more prior released DARs are
# staged under daml-packages/<pkg>/prior/, assert the freshly-built DAR is a
# valid SCU upgrade of each baseline. On the first release there is no baseline,
# so the package is skipped (not failed).
#
# Run from the canton repo root, after `dpm build --all`.
set -euo pipefail

# Upgradable template packages (keep in sync with each daml.yaml's
# `typecheck-upgrades` setting). Interface/frozen packages are intentionally
# excluded — they are never SCU-upgraded (a breaking change ships as a new
# name-versioned package, e.g. signet-api-fee-v2).
PACKAGES=(signet-signer-v1 signet-fee-amulet)

rc=0
for pkg in "${PACKAGES[@]}"; do
  dist="daml-packages/$pkg/.daml/dist"
  prior="daml-packages/$pkg/prior"

  new=$(ls "$dist/$pkg"-*.dar 2>/dev/null | head -n1 || true)
  if [ -z "$new" ]; then
    echo "✗ $pkg: no built DAR in $dist (run 'dpm build --all' first)"
    rc=1
    continue
  fi

  shopt -s nullglob
  baselines=("$prior"/*.dar)
  shopt -u nullglob
  if [ ${#baselines[@]} -eq 0 ]; then
    echo "↷ $pkg: no baseline in $prior/ — skipping SCU check (first release)"
    continue
  fi

  for old in "${baselines[@]}"; do
    echo "→ $pkg: upgrade-check $old → $new"
    if ! dpm upgrade-check --both "$old" "$new"; then
      echo "✗ $pkg: $new is NOT a valid upgrade of $old"
      rc=1
    fi
  done
done

exit "$rc"
