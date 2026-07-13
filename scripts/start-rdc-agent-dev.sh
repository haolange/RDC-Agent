#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
NODE_EXE=$(command -v node 2>/dev/null || true)
for candidate in \
  "$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" \
  "$HOME/Library/Caches/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
do
  [ -n "$NODE_EXE" ] && break
  [ -x "$candidate" ] && NODE_EXE=$candidate
done
[ -n "$NODE_EXE" ] || { echo '[RDC-Agent] Node.js >=22.13.0 is missing.' >&2; exit 1; }
exec "$NODE_EXE" "$ROOT/scripts/launch-rdc-agent.mjs" --mode desktop-dev "$@"
