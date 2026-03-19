# opencode-workspace-env

Per-workspace environment injection for OpenCode.

`opencode-workspace-env` is an OpenCode plugin that injects per-workspace env vars into every shell execution via the `shell.env` hook. It lets one OpenCode server work across multiple repos, each with its own direnv or nix environment.

## What This Does

OpenCode agents often need different toolchains per workspace — different Node, Python, or system packages. This plugin resolves the nearest env source from the current working directory, loads env vars, and injects them into the shell command that is about to run.

Two env source paths are supported:

1. **`.envrc`** (primary) — runs `direnv export json`. The `.envrc` can contain anything direnv supports (`use flake`, `layout python`, plain exports, etc.).
2. **`flake.nix`** (fallback) — runs `nix print-dev-env --json` directly. No direnv needed.

```text
Agent runs shell command
→ plugin resolves env source from cwd (bounded by git root)
  → .envrc found?  → direnv export json
  → no .envrc, flake.nix found?  → nix print-dev-env --json
→ result cached by source file + flake.lock fingerprint
→ shell.env injects output.env
→ command runs with workspace-specific PATH and env vars
```

## Install

```bash
npm install opencode-workspace-env
```

Add it to `opencode.json`:

```json
{
  "plugin": ["opencode-workspace-env"]
}
```

Prerequisites:
- **direnv** — Required for the `.envrc` path. Must be installed globally on the host, not inside the devShell.
- **nix** — Required for the `flake.nix` fallback path. Also needed if your `.envrc` uses `use flake`.

## Usage

### With `.envrc` (recommended)

```bash
# in repo root
printf 'use flake\n' > .envrc
direnv allow
```

### With `flake.nix` only (no direnv needed)

```bash
# just have a flake.nix with devShells.default — plugin detects it automatically
git add flake.nix
```

With the plugin enabled, any OpenCode shell command run inside that repo gets the exported environment for that workspace. Resolution walks up from cwd and stops at the git root, so a parent directory outside the repo is never used.

## Architecture

```text
src/
├── index.ts    # Plugin entry. shell.env hook, dispatches envrc vs flake
├── resolve.ts  # cwd → ResolvedEnvSource (.envrc first, flake.nix fallback)
├── direnv.ts   # `direnv export json` → EnvExportResult
├── nix.ts      # `nix print-dev-env --json` → EnvExportResult
├── filter.ts   # Shared env key filter (DIRENV_*, NIX_BUILD_*, nix internals)
└── cache.ts    # In-memory cache keyed by source path + SHA-256 fingerprint (max 50 entries, FIFO eviction)
```

- Writes only to `output.env`, never `process.env`
- Caches successful exports only — failed results are retried on next call
- Fails silent when no env source found or tooling unavailable
- Invalidates cache when source file or `flake.lock` changes
- Filters nix build internals (`stdenv`, `builder`, `phases`, etc.) from both direnv and nix outputs

## Limitations

- Cache fingerprint tracks source file + `flake.lock`, not files sourced by `.envrc`
- `flake.nix` must be `git add`ed for nix to see it
- `direnv` must be globally installed, not inside the devShell
- `nix print-dev-env` can be slow on first eval (~10s+), cached after
- In-memory cache holds up to 50 workspaces; oldest entries are evicted first (FIFO)

## License

MIT
