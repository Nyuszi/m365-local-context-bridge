#!/usr/bin/env bash
# Assemble release directory layout for distribution.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${1:-0.1.0}"
OUT="${ROOT}/packaging/out/local-context-bridge-${VERSION}"
rm -rf "$OUT"
mkdir -p "$OUT"/{extension,native,docker,scripts,docs}

# Extension
if [[ -d "${ROOT}/extension/dist" ]]; then
  cp -R "${ROOT}/extension/dist" "$OUT/extension/"
else
  mkdir -p "$OUT/extension/dist"
  echo "WARNING: extension/dist missing — run extension build first" >&2
fi

# Native binaries if present
for rid in macos-arm64 macos-x64 windows-x64 linux-x64 linux-arm64; do
  if [[ -d "${ROOT}/native/${rid}" ]]; then
    mkdir -p "$OUT/native/${rid}"
    cp -R "${ROOT}/native/${rid}/." "$OUT/native/${rid}/"
  else
    mkdir -p "$OUT/native/${rid}"
    echo "Place published companion binary here" > "$OUT/native/${rid}/README.txt"
  fi
done

# macOS-app sources + build script
if [[ -d "${ROOT}/native/macos-app" ]]; then
  mkdir -p "$OUT/native/macos-app"
  cp -R "${ROOT}/native/macos-app/." "$OUT/native/macos-app/"
  chmod +x "$OUT/native/macos-app/"*.sh 2>/dev/null || true
fi

cp -R "${ROOT}/docker/." "$OUT/docker/"
cp "${ROOT}/scripts/bridge-macos.sh" "${ROOT}/scripts/bridge-linux.sh" "${ROOT}/scripts/bridge-windows.ps1" "$OUT/scripts/"
chmod +x "$OUT/scripts/"*.sh
cp "${ROOT}/README.md" "${ROOT}/SECURITY.md" "${ROOT}/THREAT_MODEL.md" "$OUT/" 2>/dev/null || true
[[ -d "${ROOT}/docs" ]] && cp -R "${ROOT}/docs/." "$OUT/docs/" || true

# Build Local Context Bridge.app when on macOS
if [[ "$(uname -s)" == "Darwin" ]]; then
  "${ROOT}/native/macos-app/build-app.sh" "$OUT" || echo "WARNING: .app build failed" >&2
fi

echo "Release tree: $OUT"
