#!/usr/bin/env bash
# Publish companion + stage extension dist for native/macos-arm64 (and optional .app).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PATH="${HOME}/.dotnet:${PATH:-}"
export DOTNET_ROOT="${HOME}/.dotnet"

echo "==> Building extension"
(cd "${ROOT}/extension" && npm run build)

echo "==> Publishing companion → native/macos-arm64"
dotnet publish "${ROOT}/companion/src/LocalContextBridge.Api/LocalContextBridge.Api.csproj" \
  -c Release -r osx-arm64 --self-contained true -o "${ROOT}/native/macos-arm64"

echo "==> Staging extension/dist"
mkdir -p "${ROOT}/native/macos-arm64/extension"
rm -rf "${ROOT}/native/macos-arm64/extension/dist"
cp -R "${ROOT}/extension/dist" "${ROOT}/native/macos-arm64/extension/dist"

if [[ "${1:-}" == "--app" ]]; then
  echo "==> Building Local Context Bridge.app"
  "${ROOT}/native/macos-app/build-app.sh" "${ROOT}/packaging/out"
  echo "App: ${ROOT}/packaging/out/Local Context Bridge.app"
fi

echo "Done. Open http://127.0.0.1:32178/app after: ${ROOT}/scripts/bridge-macos.sh start --quiet"
