#!/usr/bin/env bash
# Pack extension/dist into a signed CRX for Chrome External Extensions install.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIST="${ROOT}/extension/dist"
KEY="${ROOT}/native/macos-app/extension-signing.pem"
OUT_CRX="${ROOT}/native/macos-app/LocalContextBridge.crx"
CHROME="${CHROME_PATH:-/Applications/Google Chrome.app/Contents/MacOS/Google Chrome}"

[[ -d "$DIST" ]] || { echo "error: build extension first (extension/dist missing)" >&2; exit 1; }
[[ -f "$KEY" ]] || { echo "error: missing $KEY" >&2; exit 1; }
[[ -x "$CHROME" ]] || { echo "error: Google Chrome not found at $CHROME" >&2; exit 1; }

rm -f "${ROOT}/extension/dist.crx" "${ROOT}/extension/dist.pem"
"$CHROME" --pack-extension="$DIST" --pack-extension-key="$KEY"
[[ -f "${ROOT}/extension/dist.crx" ]] || { echo "error: Chrome did not write dist.crx" >&2; exit 1; }
mv "${ROOT}/extension/dist.crx" "$OUT_CRX"
rm -f "${ROOT}/extension/dist.pem"
# Also stage next to native publish output for companion resolution
mkdir -p "${ROOT}/native/macos-arm64"
cp "$OUT_CRX" "${ROOT}/native/macos-arm64/LocalContextBridge.crx"
echo "Wrote $OUT_CRX"
