#!/usr/bin/env bash
# Print the installed version and the state of the input source.
set -euo pipefail
for app in "$HOME/Library/Input Methods/Voka.app" "/Library/Input Methods/Voka.app"; do
  if [ -x "$app/Contents/MacOS/VokaIME" ]; then
    exec "$app/Contents/MacOS/VokaIME" --input-source-status
  fi
done
echo "Voka is not installed." >&2
exit 1
