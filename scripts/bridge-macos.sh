#!/usr/bin/env bash
# Local Context Bridge — macOS launcher (native or Docker)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${BRIDGE_VERSION:-0.1.0}"
PORT="${BRIDGE_PORT:-32178}"
BASE_URL="http://127.0.0.1:${PORT}"
DATA_DIR="${LOCAL_CONTEXT_BRIDGE_DATA:-${HOME}/Library/Application Support/LocalContextBridge}"
PID_FILE="${DATA_DIR}/bridge.pid"
LOG_FILE="${DATA_DIR}/bridge.log"
COMPOSE_FILE="${ROOT}/docker/compose.yaml"
ARCH="$(uname -m)"
# Finder / Rosetta can report x86_64 on Apple Silicon — prefer real hardware.
if [[ "$(sysctl -n hw.optional.arm64 2>/dev/null || true)" == "1" ]]; then
  ARCH="arm64"
fi

usage() {
  cat <<EOF
Local Context Bridge ${VERSION}

Usage:
  $(basename "$0") start [--docker] [--quiet] [--project /absolute/path/to/project] [--alias NAME]
  $(basename "$0") stop
  $(basename "$0") status
  $(basename "$0") logs
  $(basename "$0") open
  $(basename "$0") setup
  $(basename "$0") install-host [--extension-id EXTENSION_ID]

Notes:
  - Prefer the Local Context Bridge.app for first-time setup (no Terminal).
  - Extension: chrome://extensions → Load unpacked → extension/dist (stable id via manifest key).
  - install-host registers Native Messaging (also done by the .app on launch).
  - --project is optional; without it the companion starts and you approve a folder in /setup.
EOF
}

die() { echo "error: $*" >&2; exit 1; }

require_abs_project() {
  local p="$1"
  [[ -n "$p" ]] || return 1
  [[ "$p" = /* ]] || die "project path must be absolute: $p"
  [[ -d "$p" ]] || die "project directory does not exist: $p"
  return 0
}

native_bin() {
  case "$ARCH" in
    arm64) echo "${ROOT}/native/macos-arm64/LocalContextBridge.Api" ;;
    x86_64) echo "${ROOT}/native/macos-x64/LocalContextBridge.Api" ;;
    *) die "unsupported macOS arch: $ARCH" ;;
  esac
}

dotnet_cmd() {
  if [[ -n "${DOTNET_ROOT:-}" && -x "${DOTNET_ROOT}/dotnet" ]]; then
    echo "${DOTNET_ROOT}/dotnet"
    return
  fi
  if [[ -x "${HOME}/.dotnet/dotnet" ]]; then
    export DOTNET_ROOT="${HOME}/.dotnet"
    echo "${HOME}/.dotnet/dotnet"
    return
  fi
  if command -v dotnet >/dev/null 2>&1; then
    echo "dotnet"
    return
  fi
  return 1
}

wait_healthy() {
  local i
  for i in $(seq 1 60); do
    if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

register_project() {
  local project="$1" alias="$2"
  local payload
  payload="$(python3 -c 'import json,sys; print(json.dumps({"path":sys.argv[1],"alias":sys.argv[2],"primary":True}))' "$project" "$alias")"
  curl -fsS -X POST "${BASE_URL}/api/v1/local/register-root" \
    -H 'Content-Type: application/json' \
    -H 'Origin: http://127.0.0.1:32178' \
    -d "$payload" \
    >/dev/null || die "failed to register project root (is the companion healthy?)"
}

open_pages() {
  open "${BASE_URL}/setup" 2>/dev/null || open "${BASE_URL}/local" 2>/dev/null || true
  # Attempt Chrome to configured Copilot URL; extension install remains manual.
  local copilot="https://m365.cloud.microsoft/chat"
  if [[ -d "/Applications/Google Chrome.app" ]]; then
    open -a "Google Chrome" "$copilot" 2>/dev/null || true
  fi
  echo ""
  echo "Setup (first time):"
  echo "  1. Prefer: open Local Context Bridge.app (or ${BASE_URL}/setup)"
  echo "  2. Open chrome://extensions → Developer mode → Load unpacked → ${ROOT}/extension/dist"
  echo "  3. On Copilot, click Start (auto-pairs) or use the popup"
  echo "  4. For E2E without Copilot: ${BASE_URL}/mock-chat/"
  echo ""
}

cmd_start() {
  local use_docker=0 quiet=0 project="" alias="project"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --docker) use_docker=1; shift ;;
      --quiet) quiet=1; shift ;;
      --project) project="${2:-}"; shift 2 ;;
      --alias) alias="${2:-}"; shift 2 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  mkdir -p "$DATA_DIR"

  # Fall back to last remembered project when --project omitted.
  if [[ -z "$project" && -f "${DATA_DIR}/last-project-path" ]]; then
    project="$(tr -d '\n' <"${DATA_DIR}/last-project-path")"
  fi
  if [[ -f "${DATA_DIR}/last-project-alias" ]]; then
    alias="$(tr -d '\n' <"${DATA_DIR}/last-project-alias")"
  fi

  if [[ "$use_docker" -eq 1 ]]; then
    [[ -n "$project" ]] || die "docker mode requires --project"
    require_abs_project "$project" || die "missing --project"
    command -v docker >/dev/null 2>&1 || die "docker not found"
    cat > "${DATA_DIR}/.env.bridge" <<EOF
PROJECT_HOST_PATH=${project}
BRIDGE_PRIMARY_ALIAS=${alias}
EOF
    (cd "${ROOT}/docker" && docker compose --env-file "${DATA_DIR}/.env.bridge" --profile bridge -f "$COMPOSE_FILE" up -d --build)
    wait_healthy || die "companion did not become healthy"
    # In Docker mode, primary root is the mounted /workspace/primary — register alias mapping inside container via API
    register_project "/workspace/primary" "$alias" || true
  else
    local bin rid
    rid=$( [[ "$ARCH" == "arm64" ]] && echo osx-arm64 || echo osx-x64 )
    bin="$(native_bin)"
    if [[ ! -x "$bin" && ! -f "${ROOT}/native/macos-${rid#osx-}/LocalContextBridge.Api.dll" ]]; then
      # Fall back to dotnet publish from source or dockerized publish (dev trees only).
      if [[ ! -d "${ROOT}/companion" ]]; then
        die "companion binary missing in package: $bin (rebuild Local Context Bridge.app)"
      fi
      if DOTNET="$(dotnet_cmd)"; then
        echo "Building native companion (${rid})..."
        (cd "${ROOT}/companion" && "$DOTNET" publish src/LocalContextBridge.Api/LocalContextBridge.Api.csproj -c Release -r "$rid" --self-contained true -o "${ROOT}/native/macos-${rid#osx-}")
        bin="$(native_bin)"
      else
        echo "dotnet SDK not found locally; using Docker SDK to publish..."
        mkdir -p "${ROOT}/native/macos-${rid#osx-}"
        docker run --rm \
          -v "${ROOT}:/src" -w /src/companion \
          mcr.microsoft.com/dotnet/sdk:8.0 \
          dotnet publish src/LocalContextBridge.Api/LocalContextBridge.Api.csproj -c Release -r "$rid" --self-contained true -o "/src/native/macos-${rid#osx-}"
        bin="$(native_bin)"
        if [[ ! -x "$bin" ]]; then
          bin="${ROOT}/native/macos-${rid#osx-}/LocalContextBridge.Api"
        fi
      fi
    fi
    export LOCAL_CONTEXT_BRIDGE_DATA="$DATA_DIR"
    export ASPNETCORE_URLS="http://127.0.0.1:${PORT}"
    # Prefer DOTNET_ROOT so framework-dependent apphost/dotnet can find the runtime.
    if [[ -x "${HOME}/.dotnet/dotnet" ]]; then
      export DOTNET_ROOT="${HOME}/.dotnet"
      export PATH="${DOTNET_ROOT}:${PATH}"
    fi
    native_dir="${ROOT}/native/macos-${rid#osx-}"
    dll="${native_dir}/LocalContextBridge.Api.dll"
    if curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
      echo "Companion already healthy at ${BASE_URL}"
    else
      export ASPNETCORE_CONTENTROOT="$native_dir"
      # Prefer the native apphost first (works self-contained without a visible SDK
      # — important when launched from Finder / .app with a minimal PATH).
      if [[ -x "$bin" || -f "$bin" ]]; then
        chmod +x "$bin" 2>/dev/null || true
        nohup "$bin" >>"$LOG_FILE" 2>&1 &
        echo $! >"$PID_FILE"
      elif [[ -f "$dll" ]] && DOTNET="$(dotnet_cmd)"; then
        nohup "$DOTNET" "$dll" >>"$LOG_FILE" 2>&1 &
        echo $! >"$PID_FILE"
      else
        die "native binary missing: $bin"
      fi
      wait_healthy || die "companion failed to start; see ${LOG_FILE}"
    fi
    if [[ -n "$project" ]]; then
      require_abs_project "$project" || die "invalid --project"
      register_project "$project" "$alias"
      printf '%s\n' "$project" >"${DATA_DIR}/last-project-path"
      printf '%s\n' "$alias" >"${DATA_DIR}/last-project-alias"
    fi
  fi

  echo "Local Context Bridge is healthy at ${BASE_URL}"
  if [[ "$quiet" -eq 0 ]]; then
    open_pages
  fi
}

cmd_stop() {
  if [[ -f "${DATA_DIR}/.env.bridge" ]] && command -v docker >/dev/null 2>&1; then
    (cd "${ROOT}/docker" && docker compose --env-file "${DATA_DIR}/.env.bridge" --profile bridge -f "$COMPOSE_FILE" down) 2>/dev/null || true
  fi
  if [[ -f "$PID_FILE" ]]; then
    kill "$(cat "$PID_FILE")" 2>/dev/null || true
    rm -f "$PID_FILE"
  fi
  # Best-effort: free the loopback port if a stale companion is still listening
  if command -v lsof >/dev/null 2>&1; then
    local stale
    stale="$(lsof -nP -iTCP:"${PORT}" -sTCP:LISTEN -t 2>/dev/null || true)"
    if [[ -n "$stale" ]]; then
      # shellcheck disable=SC2086
      kill $stale 2>/dev/null || true
      sleep 0.5
      # shellcheck disable=SC2086
      kill -9 $stale 2>/dev/null || true
    fi
  fi
  echo "Stopped (or already stopped)."
}

cmd_status() {
  if curl -fsS "${BASE_URL}/health" 2>/dev/null; then
    echo ""
    echo "status: healthy"
  else
    echo "status: offline"
    exit 1
  fi
}

cmd_logs() {
  if [[ -f "$LOG_FILE" ]]; then
    tail -n 200 "$LOG_FILE"
  else
    if command -v docker >/dev/null 2>&1; then
      docker compose --profile bridge -f "$COMPOSE_FILE" logs --tail=200 2>/dev/null || echo "No logs found."
    else
      echo "No logs found."
    fi
  fi
}

cmd_open() {
  open "${BASE_URL}/local" 2>/dev/null || true
}

cmd_setup() {
  if ! curl -fsS "${BASE_URL}/health" >/dev/null 2>&1; then
    cmd_start --quiet "$@"
  fi
  open "${BASE_URL}/setup" 2>/dev/null || true
}

cmd_install_host() {
  local ext_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --extension-id) ext_id="${2:-}"; shift 2 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  if [[ -z "$ext_id" && -f "${ROOT}/native/macos-app/extension-id.txt" ]]; then
    ext_id="$(tr -d '[:space:]' <"${ROOT}/native/macos-app/extension-id.txt")"
  fi
  [[ -n "$ext_id" ]] || die "missing --extension-id (from chrome://extensions)"
  local host_dir="${HOME}/Library/Application Support/Google/Chrome/NativeMessagingHosts"
  local host_script="${ROOT}/native/macos-arm64/nm-host.sh"
  if [[ "$(uname -m)" == "x86_64" && -f "${ROOT}/native/macos-x64/nm-host.sh" ]]; then
    host_script="${ROOT}/native/macos-x64/nm-host.sh"
  fi
  local manifest_path="${host_dir}/com.localcontextbridge.host.json"
  mkdir -p "$host_dir"
  chmod +x "$host_script"
  cat >"$manifest_path" <<EOF
{
  "name": "com.localcontextbridge.host",
  "description": "Local Context Bridge companion launcher",
  "path": "${host_script}",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://${ext_id}/"
  ]
}
EOF
  echo "Installed Native Messaging host:"
  echo "  $manifest_path"
  echo "  allowed_origins: chrome-extension://${ext_id}/"
  echo "Reload the extension, then use Start companion in the popup."
}

main() {
  local cmd="${1:-}"
  shift || true
  case "$cmd" in
    start) cmd_start "$@" ;;
    stop) cmd_stop ;;
    status) cmd_status ;;
    logs) cmd_logs ;;
    open) cmd_open ;;
    setup) cmd_setup "$@" ;;
    install-host) cmd_install_host "$@" ;;
    -h|--help|help|"") usage ;;
    *) die "unknown command: $cmd" ;;
  esac
}

main "$@"
