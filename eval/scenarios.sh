#!/usr/bin/env bash
# Run eval/scenarios.ts in parallel shards and print the merged report.
#   bash eval/scenarios.sh [-v] [-n LINES_PER_GENRE]
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
JOBS="${JOBS:-$(( $(sysctl -n hw.ncpu 2>/dev/null || nproc) - 2 ))}"
[ "$JOBS" -ge 1 ] || JOBS=1
TSC="node_modules/typescript/bin/tsc"
rm -rf .devout
node "$TSC" -p eval/tsconfig.json >/dev/null || true
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
PASS=()
for a in "$@"; do [ "$a" = "-v" ] || PASS+=("$a"); done
for ((i = 0; i < JOBS; i++)); do
  node --import ./eval/register.mjs .devout/eval/scenarios.js "${PASS[@]+"${PASS[@]}"}" --shard "$i/$JOBS" --dump "$TMP/$i.json" &
done
wait
node --import ./eval/register.mjs .devout/eval/scenarios.js "$@" --merge "$TMP"/*.json
