#!/usr/bin/env bash
# Restart the installed input method process.
set -euo pipefail

DEST_APP="$HOME/Library/Input Methods/Voka.app"
[ -x "$DEST_APP/Contents/MacOS/VokaIME" ] || DEST_APP="/Library/Input Methods/Voka.app"
USER_ID="$(id -u)"

if [ ! -x "$DEST_APP/Contents/MacOS/VokaIME" ]; then
  echo "Voka is not installed." >&2
  exit 1
fi
codesign --verify --deep --strict "$DEST_APP"

OLD_PIDS="$(pgrep -u "$USER_ID" -x VokaIME || true)"
for pid in $OLD_PIDS; do kill "$pid" 2>/dev/null || true; done
for pid in $OLD_PIDS; do
  for ((attempt = 0; attempt < 30; attempt++)); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 0.1
  done
  if kill -0 "$pid" 2>/dev/null; then
    echo "The running Voka process did not exit; try again in a moment." >&2
    exit 1
  fi
done

# macOS starts the input method again by itself while it is the current input source. Opening an
# application that is running asks it to show its window, so it is opened only when it is not.
sleep 0.3
if ! pgrep -u "$USER_ID" -x VokaIME >/dev/null; then
  /usr/bin/open -g "$DEST_APP"
fi
for ((attempt = 0; attempt < 30; attempt++)); do
  if pgrep -u "$USER_ID" -x VokaIME >/dev/null; then
    echo "Voka is running. Select it from the input menu."
    exit 0
  fi
  sleep 0.1
done
echo "Voka did not start; look for VokaIME in Console." >&2
exit 1
