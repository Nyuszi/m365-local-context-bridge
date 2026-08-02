#!/usr/bin/env bash
# Local Context Bridge — Linux launcher (native or Docker)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="${BRIDGE_VERSION:-0.1.0}"
PORT="${BRIDGE_PORT:-32178}"
BASE_URL="http://127.0.0.1:${PORT}"
DATA_DIR="${LOCAL_CONTEXT_BRIDGE_DATA:-${XDG_DATA_HOME:-$HOME/.local/share}/LocalContextBridge}"
PID_FILE="${DATA_DIR}/bridge.pid"
LOG_FILE="${DATA_DIR}/bridge.log"
COMPOSE_FILE="${ROOT}/docker/compose.yaml"
ARCH="$(uname -m)"

usage() {
  cat <<EOF
Local Context Bridge ${VERSION}

Usage:
  $(basename "$0") start [--docker] --project /absolute/path/to/project [--alias NAME]
  $(basename "$0") stop | status | logs | open
EOF
}

die() { echo "error: $*" >&2; exit 1; }

require_abs_project() {
  local p="$1"
  [[ -n "$p" ]] || die "missing --project"
  [[ "$p" = /* ]] || die "project path must be absolute"
  [[ -d "$p" ]] || die "project directory does not exist: $p"
}

native_dir() {
  case "$ARCH" in
    x86_64|amd64) echo "${ROOT}/native/linux-x64" ;;
    aarch64|arm64) echo "${ROOT}/native/linux-arm64" ;;
    *) die "unsupported arch: $ARCH" ;;
  esac
}

wait_healthy() {
  local i
  for i in $(seq 1 60); do
    curl -fsS "${BASE_URL}/health" >/dev/null 2>&1 && return 0
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
    >/dev/null || die "failed to register project root"
}

cmd_start() {
  local use_docker=0 project="" alias="project"
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --docker) use_docker=1; shift ;;
      --project) project="${2:-}"; shift 2 ;;
      --alias) alias="${2:-}"; shift 2 ;;
      *) die "unknown argument: $1" ;;
    esac
  done
  require_abs_project "$project"
  mkdir -p "$DATA_DIR"

  if [[ "$use_docker" -eq 1 ]]; then
    command -v docker >/dev/null || die "docker not found"
    cat > "${DATA_DIR}/.env.bridge" <<EOF
PROJECT_HOST_PATH=${project}
BRIDGE_PRIMARY_ALIAS=${alias}
EOF
    (cd "${ROOT}/docker" && docker compose --env-file "${DATA_DIR}/.env.bridge" --profile bridge -f "$COMPOSE_FILE" up -d --build)
    wait_healthy || die "companion unhealthy"
    register_project "/workspace/primary" "$alias" || true
  else
    local dir bin
    dir="$(native_dir)"
    bin="${dir}/LocalContextBridge.Api"
    if [[ ! -x "$bin" ]]; then
      if command -v dotnet >/dev/null; then
        local rid
        rid=$( [[ "$ARCH" =~ arm|aarch ]] && echo linux-arm64 || echo linux-x64 )
        mkdir -p "$dir"
        (cd "${ROOT}/companion" && dotnet publish src/LocalContextBridge.Api/LocalContextBridge.Api.csproj -c Release -r "$rid" -o "$dir")
      else
        die "native binary missing and dotnet not installed: $bin"
      fi
    fi
    export LOCAL_CONTEXT_BRIDGE_DATA="$DATA_DIR"
    export ASPNETCORE_URLS="http://127.0.0.1:${PORT}"
    nohup "$bin" >>"$LOG_FILE" 2>&1 &
    echo $! >"$PID_FILE"
    wait_healthy || die "start failed; see $LOG_FILE"
    register_project "$project" "$alias"
  fi
  echo "Healthy at ${BASE_URL}"
  echo "Load unpacked extension from: ${ROOT}/extension/dist"
  command -v xdg-open >/dev/null && xdg-open "${BASE_URL}/local" || true
}

cmd_stop() {
  [[ -f "${DATA_DIR}/.env.bridge" ]] && (cd "${ROOT}/docker" && docker compose --env-file "${DATA_DIR}/.env.bridge" --profile bridge -f "$COMPOSE_FILE" down) 2>/dev/null || true
  [[ -f "$PID_FILE" ]] && kill "$(cat "$PID_FILE")" 2>/dev/null || true
  rm -f "$PID_FILE"
  echo "Stopped."
}

case "${1:-}" in
  start) shift; cmd_start "$@" ;;
  stop) cmd_stop ;;
  status) curl -fsS "${BASE_URL}/health" && echo || { echo offline; exit 1; } ;;
  logs) tail -n 200 "$LOG_FILE" 2>/dev/null || docker compose --profile bridge -f "$COMPOSE_FILE" logs --tail=200 ;;
  open) xdg-open "${BASE_URL}/local" 2>/dev/null || true ;;
  *) usage ;;
esac
