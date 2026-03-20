#!/usr/bin/env bash
set -euo pipefail
bunx changeset version
node scripts/sync-version.mjs
