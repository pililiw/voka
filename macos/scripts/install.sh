#!/usr/bin/env bash
# Build Voka and install it for the current user (~/Library/Input Methods, ~/Applications).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
APP_SRC="$MACOS_DIR/build/Voka.app"
DEST_APP="$HOME/Library/Input Methods/Voka.app"

LAUNCHER_DEST="$HOME/Applications/Voka.app"

# Installing replaces what is at the two destinations. Only a copy of Voka may be there: another
# application that happens to be called Voka.app is left alone.
bundle_id() {
  [ -f "$1/Contents/Info.plist" ] || return 0
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$1/Contents/Info.plist" 2>/dev/null || true
}
require_voka_or_nothing() {
  [ -e "$1" ] || return 0
  local found
  found="$(bundle_id "$1")"
  if [ "$found" != "$2" ]; then
    echo "$1 is not Voka (bundle identifier: ${found:-none}). Move it away and run this again." >&2
    exit 1
  fi
}
require_voka_or_nothing "$DEST_APP" sh.pili.inputmethod.Voka
require_voka_or_nothing "$LAUNCHER_DEST" sh.pili.Voka

# Two copies of an input method share one identifier, and macOS then serves neither reliably.
if [ -d "/Library/Input Methods/Voka.app" ]; then
  echo "Voka is installed for all users in /Library/Input Methods. Run macos/scripts/uninstall.sh first." >&2
  exit 1
fi

bash "$MACOS_DIR/scripts/build_app.sh"

echo "==> Installing to $DEST_APP"
mkdir -p "$DEST_APP"
rsync -a --delete "$APP_SRC/" "$DEST_APP/"
codesign --verify --deep --strict "$DEST_APP"
"$DEST_APP/Contents/MacOS/VokaIME" --validate-bundle

# Only the installed copy may exist: macOS can start an input method from any copy it knows about.
# The installed path is registered again so that its record matches the bundle that is there now.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -u "$APP_SRC" >/dev/null 2>&1 || true
  "$LSREGISTER" -f "$DEST_APP" >/dev/null 2>&1 || true
fi
rm -rf "$APP_SRC"

# The entry in the Applications folder, so that Voka can be found with Spotlight.
mkdir -p "$LAUNCHER_DEST"
rsync -a --delete "$MACOS_DIR/build/launcher/Voka.app/" "$LAUNCHER_DEST/"
rm -rf "$MACOS_DIR/build/launcher"
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -f "$LAUNCHER_DEST" >/dev/null 2>&1 || true; fi

"$DEST_APP/Contents/MacOS/VokaIME" --register-input-source
bash "$MACOS_DIR/scripts/restart.sh"

echo
"$DEST_APP/Contents/MacOS/VokaIME" --input-source-status
echo
echo "First install: the Voka window opens; click Enable Voka. To add it by hand instead:"
echo "System Settings > Keyboard > Text Input > Edit… > + > English > Voka > Add, then Allow."
