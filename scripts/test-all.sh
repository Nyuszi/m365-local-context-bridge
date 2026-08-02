#!/usr/bin/env bash
# Run unit/integration tests for companion + extension + compose assertions.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Compose security assertions =="
bash "${ROOT}/scripts/assert-compose-security.sh"

echo "== Extension tests =="
if [[ -f "${ROOT}/extension/package.json" ]]; then
  (cd "${ROOT}/extension" && npm ci && npm test && npm run build)
else
  echo "extension not ready; skip"
fi

echo "== Companion tests =="
run_dotnet() {
  if command -v dotnet >/dev/null 2>&1; then
    (cd "${ROOT}/companion" && dotnet test --nologo)
  elif [[ -x "${HOME}/.dotnet/dotnet" ]]; then
    (cd "${ROOT}/companion" && "${HOME}/.dotnet/dotnet" test --nologo)
  else
    docker run --rm \
      -v "${ROOT}:/src" -w /src/companion \
      mcr.microsoft.com/dotnet/sdk:8.0 \
      dotnet test --nologo
  fi
}
run_dotnet

echo "All tests completed."
