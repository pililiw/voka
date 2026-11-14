#!/usr/bin/env bash
# Remove Voka. Remove it from System Settings > Keyboard > Text Input first.
set -euo pipefail

INPUT_METHOD_ID=sh.pili.inputmethod.Voka
LAUNCHER_ID=sh.pili.Voka

bundle_id() {
  [ -f "$1/Contents/Info.plist" ] || return 0
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null || true
}
# Only a copy of Voka is removed: another application that happens to be called Voka.app is left alone.
is_voka() { [ -d "$1" ] && [ "$(bundle_id "$1")" = "$2" ]; }
report_other() {
  if [ -e "$1" ] && ! is_voka "$1" "$2"; then echo "Left alone, not Voka: $1" >&2; fi
}

pkill -u "$(id -u)" -x VokaIME 2>/dev/null || true

for entry in "$HOME/Library/Input Methods/Voka.app|$INPUT_METHOD_ID" "$HOME/Applications/Voka.app|$LAUNCHER_ID"; do
  path="${entry%|*}"
  id="${entry#*|}"
  if is_voka "$path" "$id"; then rm -rf "$path"; else report_other "$path" "$id"; fi
done

SYSTEM_COPIES=()
for entry in "/Library/Input Methods/Voka.app|$INPUT_METHOD_ID" "/Applications/Voka.app|$LAUNCHER_ID"; do
  path="${entry%|*}"
  id="${entry#*|}"
  if is_voka "$path" "$id"; then SYSTEM_COPIES+=("$path"); else report_other "$path" "$id"; fi
done
if [ "${#SYSTEM_COPIES[@]}" -gt 0 ]; then
  echo "Removing the copies installed for all users (needs an administrator password):"
  printf '  %s\n' "${SYSTEM_COPIES[@]}"
  sudo rm -rf "${SYSTEM_COPIES[@]}"
  sudo pkgutil --forget "$INPUT_METHOD_ID" >/dev/null 2>&1 || true
fi

defaults delete "$INPUT_METHOD_ID" >/dev/null 2>&1 || true
echo "Voka removed. Log out and back in to clear it from the input menu."
