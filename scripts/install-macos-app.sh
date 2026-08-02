#!/usr/bin/env bash
# Build Local Context Bridge.app (if needed) and install it into /Applications.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_NAME="Local Context Bridge.app"
SRC_APP="${ROOT}/packaging/out/${APP_NAME}"
DEST_APP="/Applications/${APP_NAME}"
REBUILD=0
OPEN_AFTER=1

usage() {
  cat <<EOF
Usage: $(basename "$0") [--rebuild] [--no-open]

  Installs Local Context Bridge into /Applications so it appears in
  Launchpad and Spotlight like a normal Mac app.

  --rebuild   Force rebuild of the .app before installing
  --no-open   Do not launch the app after install
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --rebuild) REBUILD=1; shift ;;
    --no-open) OPEN_AFTER=0; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
done

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "This installer is for macOS only." >&2
  exit 1
fi

if [[ "$REBUILD" -eq 1 || ! -d "$SRC_APP" ]]; then
  echo "==> Building ${APP_NAME}…"
  "${ROOT}/scripts/sync-native.sh" --app
fi

if [[ ! -d "$SRC_APP" ]]; then
  echo "Build finished but ${SRC_APP} was not found." >&2
  exit 1
fi

echo "==> Installing to ${DEST_APP}"
# Prefer ditto for a clean .app copy on macOS.
if [[ -d "$DEST_APP" ]]; then
  rm -rf "$DEST_APP"
fi
ditto "$SRC_APP" "$DEST_APP"

# Clear quarantine so Gatekeeper does not block a locally built app.
xattr -dr com.apple.quarantine "$DEST_APP" 2>/dev/null || true

echo "Installed: ${DEST_APP}"
echo "You can also find it in Launchpad / Spotlight as “Local Context Bridge”."

if [[ "$OPEN_AFTER" -eq 1 ]]; then
  open "$DEST_APP"
fi
