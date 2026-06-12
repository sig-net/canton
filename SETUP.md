# CN Quickstart Local Setup

Local Canton Network environment for development and testing. Runs a full multi-participant Canton topology with Keycloak OAuth2, Splice validators, and PQS — the closest thing to a production Canton deployment you can run locally.

Tested on macOS Sequoia 15.4 (Apple Silicon M3 Max, 128 GB RAM).

## Prerequisites

| Tool           | Version                             | Purpose                                                  |
| -------------- | ----------------------------------- | -------------------------------------------------------- |
| Docker Desktop | >= 27.0, **8 GB+ memory allocated** | Runs all Canton services as containers                   |
| Nix            | >= 2.33                             | Reproducible dev toolchain (JDK, Node, Gradle, Daml SDK) |
| direnv         | >= 2.37                             | Auto-activates Nix shell when you `cd` into the project  |

### 1. Docker Desktop

Install from [docker.com](https://www.docker.com/products/docker-desktop/). Start it and verify:

```bash
docker info | grep 'Server Version'
```

Ensure at least 8 GB memory is allocated (Docker Desktop > Settings > Resources). 16 GB+ recommended if enabling observability.

### 2. Install Nix

**macOS Sequoia (15.x):** Both the official curl installer and the Determinate curl installer fail due to SIP restrictions on `/etc/synthetic.conf`. Use the Determinate Systems .pkg installer:

1. Download: https://install.determinate.systems/determinate-pkg/stable/Universal
2. Run the .pkg — it handles SIP, APFS volume creation, and shell profile setup
3. Restart your terminal
4. Verify: `nix --version`

Determinate Nix is made by the creator of Nix (Eelco Dolstra). It enables flakes by default and supports clean uninstall via `/nix/nix-installer uninstall`.

**Other macOS / Linux (if Sequoia .pkg isn't needed):**

```bash
sh <(curl -L https://nixos.org/nix/install)
```

Canton docs reference: https://docs.digitalasset.com/build/3.5/quickstart/download/cnqs-installation.html

### 3. Enable Nix flakes

Determinate Nix enables flakes by default — skip this step if you used the .pkg installer.

For official Nix:

```bash
mkdir -p ~/.config/nix
echo 'experimental-features = nix-command flakes' > ~/.config/nix/nix.conf
```

### 4. Install direnv

```bash
nix profile install nixpkgs#direnv
```

Add the shell hook to `~/.zshrc` (or `~/.bashrc`):

```bash
echo 'eval "$(direnv hook zsh)"' >> ~/.zshrc
```

Restart your terminal.

## Quick Start (prerequisites already installed)

If Nix, direnv, and Docker are already installed and running:

```bash
cd cn-quickstart
direnv allow
cd quickstart
cat > .env.local << 'EOF'
OBSERVABILITY_ENABLED=false
AUTH_MODE=oauth2
PARTY_HINT=signet-mpc-1
TEST_MODE=off
EOF
make build
make start
make status
```

## Setup (first time)

### 1. Clone and activate the Nix dev shell

```bash
git clone https://github.com/digital-asset/cn-quickstart.git
cd cn-quickstart
direnv allow
```

The first `direnv allow` downloads the full Nix dev shell (JDK 21, Node 20/22, Gradle, Daml SDK, gcloud SDK, TypeScript, yq, etc.). Takes a few minutes the first time — subsequent activations are instant.

### 2. Configure the environment

```bash
cd quickstart
make setup
```

Interactive prompts:

- **Observability**: `n` (saves ~2 GB Docker memory — enable later with `make setup` if needed)
- **OAuth2**: `y` (enables Keycloak — production-like auth)
- **Party hint**: enter a name like `signet-mpc-1` (see format rules below)
- **Test mode**: `n`

**Or skip the prompts** by creating `.env.local` directly:

```bash
cat > .env.local << 'EOF'
OBSERVABILITY_ENABLED=false
AUTH_MODE=oauth2
PARTY_HINT=signet-mpc-1
TEST_MODE=off
EOF
```

**PARTY_HINT format:** Must match `<organization>-<function>-<integer>` where organization and function are alphanumeric and enumerator is an integer. Examples: `signet-mpc-1`, `myorg-dev-1`. Invalid examples: `signet-canton-mpc` (three segments without integer), `my_org-dev-1` (underscores). Splice will crash in a restart loop with `INVALID_ARGUMENT` if the format is wrong.

### 3. Build

```bash
make build
```

Builds Daml DARs, Java backend (Spring Boot), React frontend, and Docker images. Takes several minutes on first run. Subsequent builds are incremental.

### 4. Start

```bash
make start
```

Pulls Docker images (first run: ~5 GB from `ghcr.io` and Docker Hub) and starts all services. If image pulls time out, just re-run `make start` — partially downloaded layers are cached.

Verify all containers are healthy:

```bash
make status
```

You should see ~17 containers, all healthy. The `splice` container takes the longest to initialize (~60-90 seconds after canton is healthy).

### 5. (Optional) Capture logs

In a separate terminal:

```bash
cd cn-quickstart/quickstart
make capture-logs
```

Blocks until Ctrl+C. Logs go to `logs/` directory.

## Services

| Service               | URL                                          |
| --------------------- | -------------------------------------------- |
| App Provider UI       | http://app-provider.localhost:3000           |
| App User Wallet       | http://wallet.localhost:2000                 |
| App Provider Wallet   | http://wallet.localhost:3000                 |
| Keycloak Admin        | http://keycloak.localhost:8082 (admin/admin) |
| Scan UI               | http://scan.localhost:4000                   |
| SV UI                 | http://sv.localhost:4000                     |
| Swagger (JSON API v2) | http://localhost:9090                        |

All `*.localhost` domains resolve to `127.0.0.1` natively on macOS/Linux.

### Canton Ports

| Party           | Ledger API (gRPC) | Admin API (gRPC) | JSON API (HTTP) | Validator API |
| --------------- | ----------------- | ---------------- | --------------- | ------------- |
| App User        | 2901              | 2902             | 2975            | 2903          |
| App Provider    | 3901              | 3902             | 3975            | 3903          |
| Super Validator | 4901              | 4902             | 4975            | 4903          |

### Auth (Keycloak)

With `AUTH_MODE=oauth2`, Keycloak runs at http://keycloak.localhost:8082 with two realms:

| Realm       | Users                                             | Purpose            |
| ----------- | ------------------------------------------------- | ------------------ |
| AppProvider | `app-provider`, service accounts                  | Provider-side auth |
| AppUser     | `app-user` (password: `abc123`), service accounts | Consumer-side auth |

Canton participants validate JWTs via JWKS (`jwt-jwks`) against Keycloak's JWKS endpoint.

## Common Commands

```bash
make status            # container health
make stop              # stop all containers
make restart           # stop + start
make canton-console    # interactive Canton REPL
make shell             # Daml Shell (PQS queries)
make build-daml        # rebuild Daml only
make restart-backend   # rebuild + restart Java backend
make restart-frontend  # rebuild + restart React frontend
make clean-all         # full reset (containers + volumes + build artifacts)
```

All `make` commands must be run from the `quickstart/` directory.

## Troubleshooting

**Splice container unhealthy / restart loop:**

1. Check logs: `docker logs splice 2>&1 | grep '"level":"ERROR"' | tail -5`
2. Most common cause: invalid `PARTY_HINT` format (see format rules above)
3. Fix: `make stop && make clean-docker`, fix `.env.local`, then `make start`

**Image pull timeouts:** Re-run `make start` — Docker caches partially downloaded layers.

**Containers unhealthy (general):** Ensure Docker Desktop has >= 8 GB memory. Nuclear option: `make clean-all && make build && make start`.

**Port conflicts:** Check nothing else is using ports 2000-4999, 5432, 8082, 9090.

**Stale state between sessions:** Run `make clean-docker` (or `make clean-all` for full reset) before `make start`.

**Docker Desktop 4.38.0 bug:** Causes NullPointerException on Canton startup. Upgrade Docker Desktop.

## Uninstall

### Stop and remove containers

```bash
cd quickstart
make clean-all
```

### Remove Nix

Determinate Nix:

```bash
/nix/nix-installer uninstall
```

Official Nix: see https://nix.dev/manual/nix/latest/installation/uninstall

### Remove direnv hook

Remove `eval "$(direnv hook zsh)"` from `~/.zshrc`.

### Remove the repo

```bash
rm -rf cn-quickstart
```
