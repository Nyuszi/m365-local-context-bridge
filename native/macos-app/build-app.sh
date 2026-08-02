#!/usr/bin/env bash
# Build Local Context Bridge.app into packaging/out (or native/macos-app/dist).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP_SRC="${ROOT}/native/macos-app"
OUT_DIR="${1:-${ROOT}/packaging/out}"
APP_NAME="Local Context Bridge.app"
APP_ROOT="${OUT_DIR}/${APP_NAME}"

rm -rf "$APP_ROOT"
mkdir -p "${APP_ROOT}/Contents/MacOS" "${APP_ROOT}/Contents/Resources"

# Entry point
cp "${APP_SRC}/bridge-app.sh" "${APP_ROOT}/Contents/MacOS/Local Context Bridge"
chmod +x "${APP_ROOT}/Contents/MacOS/Local Context Bridge"

# Bundle scripts + native host + companion binaries + extension dist + id
RESOURCES="${APP_ROOT}/Contents/Resources"
mkdir -p "${RESOURCES}/scripts" "${RESOURCES}/native/macos-arm64" "${RESOURCES}/native/macos-app" "${RESOURCES}/extension"

cp "${ROOT}/scripts/bridge-macos.sh" "${RESOURCES}/scripts/"
chmod +x "${RESOURCES}/scripts/bridge-macos.sh"

if [[ -d "${ROOT}/native/macos-arm64" ]]; then
  # Copy companion publish output + nm-host (may be large)
  rsync -a --exclude '*.pdb' "${ROOT}/native/macos-arm64/" "${RESOURCES}/native/macos-arm64/" 2>/dev/null \
    || cp -R "${ROOT}/native/macos-arm64/." "${RESOURCES}/native/macos-arm64/"
  chmod +x "${RESOURCES}/native/macos-arm64/nm-host.sh" 2>/dev/null || true
  chmod +x "${RESOURCES}/native/macos-arm64/LocalContextBridge.Api" 2>/dev/null || true
fi

cp "${APP_SRC}/extension-id.txt" "${RESOURCES}/native/macos-app/" 2>/dev/null || true
cp "${APP_SRC}/extension-id.txt" "${RESOURCES}/" 2>/dev/null || true

if [[ -d "${ROOT}/extension/dist" ]]; then
  cp -R "${ROOT}/extension/dist" "${RESOURCES}/extension/"
  # Also nest under native so the companion resolves dist next to its binary.
  mkdir -p "${RESOURCES}/native/macos-arm64/extension"
  rm -rf "${RESOURCES}/native/macos-arm64/extension/dist"
  cp -R "${ROOT}/extension/dist" "${RESOURCES}/native/macos-arm64/extension/dist"
fi

# Signed CRX for one-click External Extensions install
if [[ ! -f "${ROOT}/native/macos-app/LocalContextBridge.crx" ]]; then
  if [[ -x "${APP_SRC}/pack-extension.sh" ]]; then
    "${APP_SRC}/pack-extension.sh" || echo "WARNING: CRX pack skipped" >&2
  fi
fi
if [[ -f "${ROOT}/native/macos-app/LocalContextBridge.crx" ]]; then
  cp "${ROOT}/native/macos-app/LocalContextBridge.crx" "${RESOURCES}/extension/"
  cp "${ROOT}/native/macos-app/LocalContextBridge.crx" "${RESOURCES}/native/macos-arm64/" 2>/dev/null || true
fi

# Fix ROOT detection: bridge-macos.sh uses dirname/../.. from scripts/ → Resources is ROOT. Good.
# nm-host.sh looks for ROOT/scripts/bridge-macos.sh — with Resources as ROOT that works.

# App icon (Dock / Finder / Launchpad)
ICON_ICNS="${ROOT}/branding/icons/AppIcon.icns"
if [[ -f "$ICON_ICNS" ]]; then
  cp "$ICON_ICNS" "${RESOURCES}/AppIcon.icns"
else
  echo "WARNING: missing ${ICON_ICNS} — app will use the default document icon" >&2
fi

cat >"${APP_ROOT}/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleExecutable</key>
  <string>Local Context Bridge</string>
  <key>CFBundleIdentifier</key>
  <string>com.localcontextbridge.app</string>
  <key>CFBundleName</key>
  <string>Local Context Bridge</string>
  <key>CFBundleDisplayName</key>
  <string>Local Context Bridge</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>0.1.0</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
EOF

# PkgInfo
echo -n 'APPL????' >"${APP_ROOT}/Contents/PkgInfo"

echo "Built: ${APP_ROOT}"
