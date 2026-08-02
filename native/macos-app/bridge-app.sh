#!/usr/bin/env bash
# Local Context Bridge.app entry point — registers NM host, starts companion, opens /setup.
set -euo pipefail

# Finder launches apps with a minimal PATH. Keep absolute tools + user .NET discoverable.
export PATH="/usr/bin:/bin:/usr/sbin:/sbin:${HOME}/.dotnet:${PATH:-}"
if [[ -x "${HOME}/.dotnet/dotnet" ]]; then
  export DOTNET_ROOT="${HOME}/.dotnet"
fi

SELF="$(cd "$(dirname "$0")" && pwd)"
# Prefer Resources next to MacOS binary inside the .app
RESOURCES="$(cd "${SELF}/../Resources" 2>/dev/null && pwd || true)"
if [[ -n "${RESOURCES:-}" && -f "${RESOURCES}/scripts/bridge-macos.sh" ]]; then
  ROOT="$RESOURCES"
elif [[ -f "${SELF}/../../scripts/bridge-macos.sh" ]]; then
  ROOT="$(cd "${SELF}/../.." && pwd)"
else
  # Dev: running from native/macos-app/
  ROOT="$(cd "${SELF}/../.." && pwd)"
fi

SCRIPT="${ROOT}/scripts/bridge-macos.sh"
EXT_ID_FILE="${ROOT}/native/macos-app/extension-id.txt"
if [[ ! -f "$EXT_ID_FILE" && -f "${RESOURCES:-}/extension-id.txt" ]]; then
  EXT_ID_FILE="${RESOURCES}/extension-id.txt"
fi
PORT="${BRIDGE_PORT:-32178}"
BASE_URL="http://127.0.0.1:${PORT}"
DATA_DIR="${LOCAL_CONTEXT_BRIDGE_DATA:-${HOME}/Library/Application Support/LocalContextBridge}"
APP_LOG="${DATA_DIR}/bridge-app.log"
CURL="/usr/bin/curl"

chrome_installed() {
  [[ -d "/Applications/Google Chrome.app" ]] || [[ -d "${HOME}/Applications/Google Chrome.app" ]]
}

install_nm_host() {
  local ext_id=""
  if [[ -f "$EXT_ID_FILE" ]]; then
    ext_id="$(tr -d '[:space:]' <"$EXT_ID_FILE")"
  fi
  [[ -n "$ext_id" ]] || ext_id="cbpoofaeifiplkedkndehafpnghoalce"
  if [[ -x "$SCRIPT" ]]; then
    "$SCRIPT" install-host --extension-id "$ext_id" >>"$APP_LOG" 2>&1 || true
  else
    local host_dir="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
    local host_script="${ROOT}/native/macos-arm64/nm-host.sh"
    mkdir -p "$host_dir"
    chmod +x "$host_script" 2>/dev/null || true
    cat >"${host_dir}/com.localcontextbridge.host.json" <<EOF
{
  "name": "com.localcontextbridge.host",
  "description": "Local Context Bridge companion launcher",
  "path": "${host_script}",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://${ext_id}/"]
}
EOF
  fi
}

ensure_companion() {
  if "$CURL" -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    return 0
  fi
  if [[ ! -x "$SCRIPT" ]]; then
    echo "missing launcher script: $SCRIPT" >>"$APP_LOG"
    return 1
  fi
  # Run start in foreground so we wait for health (start --quiet blocks until healthy).
  set +e
  "$SCRIPT" start --quiet >>"$APP_LOG" 2>&1
  local rc=$?
  set -e
  if [[ "$rc" -eq 0 ]] && "$CURL" -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    return 0
  fi
  # Extra poll in case the process is still binding the port.
  local i
  for i in $(seq 1 60); do
    if "$CURL" -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.25
  done
  echo "ensure_companion failed rc=${rc}" >>"$APP_LOG"
  return 1
}

open_setup() {
  # Prefer status app when already configured; otherwise first-run setup.
  local target="${BASE_URL}/setup"
  if curl -fsS "${BASE_URL}/api/v1/local/setup-state" 2>/dev/null | grep -q '"ready":true'; then
    target="${BASE_URL}/app"
  fi
  if chrome_installed; then
    open -a "Google Chrome" "$target" 2>/dev/null || open "$target"
  else
    open "$target" 2>/dev/null || true
    open "https://www.google.com/chrome/" 2>/dev/null || true
  fi
}

mkdir -p "$DATA_DIR"
{
  echo "---- $(date -u +%Y-%m-%dT%H:%M:%SZ) launch ----"
  echo "ROOT=$ROOT"
  echo "PATH=$PATH"
  echo "DOTNET_ROOT=${DOTNET_ROOT:-}"
} >>"$APP_LOG"

install_nm_host
if ! chrome_installed; then
  osascript <<'EOF' 2>/dev/null || true
display dialog "Google Chrome is required for Local Context Bridge.

Click OK to open the official Chrome download page." buttons {"OK"} default button 1 with title "Local Context Bridge"
EOF
  open "https://www.google.com/chrome/" 2>/dev/null || true
fi

if ensure_companion; then
  open_setup
else
  osascript <<EOF 2>/dev/null || true
display dialog "Could not start the local companion.

Check the log:
  ${APP_LOG}

Or from Terminal:
  \"${SCRIPT}\" start --quiet
Then open ${BASE_URL}/setup" buttons {"OK"} default button 1 with title "Local Context Bridge"
EOF
fi
