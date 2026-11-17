#!/usr/bin/env bash
# Remove Voka. It has to be removed from System Settings > Keyboard > Text Input first: an input
# method that is deleted while it is enabled stays half-enabled, and installing it again then needs a
# new login before the input menu has it.
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

for app in "$HOME/Library/Input Methods/Voka.app" "/Library/Input Methods/Voka.app"; do
  is_voka "$app" "$INPUT_METHOD_ID" || continue
  status="$("$app/Contents/MacOS/VokaIME" --input-source-status 2>/dev/null || true)"
  if grep -q '"enabled":true' <<<"$status"; then
    if grep -q '"inMenu":false' <<<"$status"; then
      echo "The input menu does not have Voka, so it cannot be removed as it is." >&2
      echo "Remove Voka in System Settings > Keyboard > Text Input > Edit… if it is listed there," >&2
      echo "otherwise log out and back in first. Then run this script again." >&2
      open "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" 2>/dev/null || true
      exit 1
    fi
    echo "Voka is still in your input sources. Remove it first:" >&2
    echo "  System Settings > Keyboard > Text Input > Edit…, select Voka, click −." >&2
    echo "Then run this script again." >&2
    open "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" 2>/dev/null || true
    exit 1
  fi
done

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
echo "Voka removed."
