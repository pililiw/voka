#!/usr/bin/env bash
# Build macos/build/Voka.app (the input method) and macos/build/launcher/Voka.app (its Applications entry).
#   VOKA_ARCHS          architectures to build, e.g. "arm64 x86_64" (default: this machine's; more than one needs Xcode)
#   VOKA_SIGN_IDENTITY  code signing identity (default: "-", ad-hoc). A Developer ID identity also
#                       turns on the hardened runtime and a secure timestamp, as notarization requires.
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MACOS_DIR="$ROOT_DIR/macos"
APP_BUNDLE="$MACOS_DIR/build/Voka.app"
RESOURCES="$APP_BUNDLE/Contents/Resources"
LAUNCHER_BUNDLE="$MACOS_DIR/build/launcher/Voka.app"
SIGN_IDENTITY="${VOKA_SIGN_IDENTITY:--}"

echo "==> Bundling the engine"
(cd "$ROOT_DIR" && node scripts/build-engine-bundle.mjs)

echo "==> Compiling"
ARCH_FLAGS=()
for arch in ${VOKA_ARCHS:-}; do ARCH_FLAGS+=(--arch "$arch"); done
(cd "$MACOS_DIR" && swift build --disable-sandbox -c release ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"})
BIN_PATH="$(cd "$MACOS_DIR" && swift build --disable-sandbox -c release ${ARCH_FLAGS[@]+"${ARCH_FLAGS[@]}"} --show-bin-path)/VokaIME"

echo "==> Assembling $APP_BUNDLE"
rm -rf "$APP_BUNDLE"
mkdir -p "$APP_BUNDLE/Contents/MacOS" "$RESOURCES"
cp "$BIN_PATH" "$APP_BUNDLE/Contents/MacOS/VokaIME"
cp "$MACOS_DIR/Resources/Info.plist" "$APP_BUNDLE/Contents/Info.plist"
cp "$MACOS_DIR/Resources/engine.js" "$ROOT_DIR/data/dict.json" "$RESOURCES/"
# The language model is compiled for Core ML; the app loads lm.mlmodelc.
"$(dirname "$BIN_PATH")/VokaModelCompiler" "$ROOT_DIR/data/lm.mlpackage" "$RESOURCES"
cp "$ROOT_DIR/data/lm-tokenizer.json" "$RESOURCES/"
# The notices of the dictionary sources and the model travel with the application.
cp "$ROOT_DIR/THIRD_PARTY_NOTICES.md" "$ROOT_DIR/LICENSE" "$RESOURCES/"
cp "$MACOS_DIR/Resources/Icons/Voka.icns" "$MACOS_DIR/Resources/Icons/MenuIcon.pdf" "$RESOURCES/"

# System Settings takes the name shown in the input source list from these strings.
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_BUNDLE/Contents/Info.plist")"
for lang in en zh_CN; do
  mkdir -p "$RESOURCES/$lang.lproj"
  printf '"CFBundleName" = "Voka";\n"CFBundleDisplayName" = "Voka";\n"%s" = "Voka";\n' "$BUNDLE_ID" \
    > "$RESOURCES/$lang.lproj/InfoPlist.strings"
done

echo "==> Signing ($SIGN_IDENTITY)"
SIGN_FLAGS=(--force --sign "$SIGN_IDENTITY" --entitlements "$MACOS_DIR/Resources/Voka.entitlements")
if [ "$SIGN_IDENTITY" != "-" ]; then SIGN_FLAGS+=(--options runtime --timestamp); fi
codesign "${SIGN_FLAGS[@]}" "$APP_BUNDLE"
codesign --verify --deep --strict "$APP_BUNDLE"
"$APP_BUNDLE/Contents/MacOS/VokaIME" --validate-bundle

# The build copy has the installed app's bundle identifier; it must not be registered as a second Voka.
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -u "$APP_BUNDLE" >/dev/null 2>&1 || true; fi

# "Voka" for the Applications folder: opens the input method's window. It has its own identifier and
# is not an input method.
echo "==> Assembling $LAUNCHER_BUNDLE"
rm -rf "$LAUNCHER_BUNDLE"
mkdir -p "$LAUNCHER_BUNDLE/Contents/MacOS" "$LAUNCHER_BUNDLE/Contents/Resources"
cp "$(dirname "$BIN_PATH")/VokaLauncher" "$LAUNCHER_BUNDLE/Contents/MacOS/Voka"
cp "$MACOS_DIR/Resources/Launcher-Info.plist" "$LAUNCHER_BUNDLE/Contents/Info.plist"
cp "$MACOS_DIR/Resources/Icons/Voka.icns" "$LAUNCHER_BUNDLE/Contents/Resources/"
LAUNCHER_SIGN_FLAGS=(--force --sign "$SIGN_IDENTITY")
if [ "$SIGN_IDENTITY" != "-" ]; then LAUNCHER_SIGN_FLAGS+=(--options runtime --timestamp); fi
codesign "${LAUNCHER_SIGN_FLAGS[@]}" "$LAUNCHER_BUNDLE"
codesign --verify --deep --strict "$LAUNCHER_BUNDLE"
if [ -x "$LSREGISTER" ]; then "$LSREGISTER" -u "$LAUNCHER_BUNDLE" >/dev/null 2>&1 || true; fi

echo "Built $APP_BUNDLE"
