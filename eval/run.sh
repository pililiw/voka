#!/usr/bin/env bash
# Transpile the engine and the evaluation scripts into .devout/ and run one of them on plain Node.
#   bash eval/run.sh eval/replay.ts            # behaviour spec: every case in eval/cases.ts
#   bash eval/run.sh eval/precision.ts         # must-fix and must-keep word lists
#   bash eval/run.sh eval/query.ts teh "I think "   # candidates for one token in a context
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
rm -rf .devout
node node_modules/typescript/bin/tsc -p eval/tsconfig.json >/dev/null || true
target="${1:?usage: run.sh <file.ts> [args...]}"; shift
exec node --import ./eval/register.mjs ".devout/${target%.ts}.js" "$@"
