#!/usr/bin/env bash
# Build the release installer: macos/build/Voka-<version>.pkg (universal; installs the input
# method to /Library/Input Methods and its entry to /Applications).
#
# Without credentials the result is an unsigned package for local testing. For a public release set:
#   VOKA_SIGN_IDENTITY       "Developer ID Application: … (TEAMID)"
#   VOKA_INSTALLER_IDENTITY  "Developer ID Installer: … (TEAMID)"
#   VOKA_NOTARY_PROFILE      keychain profile created with `xcrun notarytool store-credentials`
set -euo pipefail
umask 022

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
BUILD_DIR="$MACOS_DIR/build"
APP_BUNDLE="$BUILD_DIR/Voka.app"

VOKA_ARCHS="${VOKA_ARCHS:-arm64 x86_64}" bash "$MACOS_DIR/scripts/build_app.sh"

VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP_BUNDLE/Contents/Info.plist")"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_BUNDLE/Contents/Info.plist")"
PKG="$BUILD_DIR/Voka-$VERSION.pkg"
STAGE="$BUILD_DIR/pkg"

rm -rf "$STAGE" "$PKG"
mkdir -p "$STAGE/root/Library/Input Methods" "$STAGE/scripts"
ditto --norsrc --noextattr --noqtn "$APP_BUNDLE" "$STAGE/root/Library/Input Methods/Voka.app"
rm -rf "$APP_BUNDLE"
mkdir -p "$STAGE/root/Applications"
ditto --norsrc --noextattr --noqtn "$BUILD_DIR/launcher/Voka.app" "$STAGE/root/Applications/Voka.app"
rm -rf "$BUILD_DIR/launcher"
cp "$MACOS_DIR/pkg/postinstall" "$STAGE/scripts/postinstall"
chmod +x "$STAGE/scripts/postinstall"

# Never relocate: both bundles must land where they belong even if another copy exists elsewhere.
pkgbuild --analyze --root "$STAGE/root" "$STAGE/component.plist" >/dev/null
for index in 0 1; do
  /usr/libexec/PlistBuddy -c "Set :$index:BundleIsRelocatable false" "$STAGE/component.plist"
done

SIGN_FLAGS=()
if [ -n "${VOKA_INSTALLER_IDENTITY:-}" ]; then SIGN_FLAGS=(--sign "$VOKA_INSTALLER_IDENTITY" --timestamp); fi
pkgbuild --root "$STAGE/root" --component-plist "$STAGE/component.plist" --scripts "$STAGE/scripts" \
  --identifier "$BUNDLE_ID" --version "$VERSION" --install-location / --ownership recommended \
  ${SIGN_FLAGS[@]+"${SIGN_FLAGS[@]}"} "$PKG"
# The staged copies must not stay known to LaunchServices.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then
  "$LSREGISTER" -u "$STAGE/root/Library/Input Methods/Voka.app" >/dev/null 2>&1 || true
  "$LSREGISTER" -u "$STAGE/root/Applications/Voka.app" >/dev/null 2>&1 || true
fi
rm -rf "$STAGE"

if [ -n "${VOKA_NOTARY_PROFILE:-}" ]; then
  echo "==> Notarizing"
  xcrun notarytool submit "$PKG" --keychain-profile "$VOKA_NOTARY_PROFILE" --wait
  xcrun stapler staple "$PKG"
else
  echo "Not notarized (VOKA_NOTARY_PROFILE is not set): Gatekeeper will warn about this package."
fi

echo "Built $PKG"
shasum -a 256 "$PKG"
