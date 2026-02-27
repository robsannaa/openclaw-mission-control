#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-3333}"
HOST="${HOST:-127.0.0.1}"
SERVICE_NAME="openclaw-dashboard"

NO_SERVICE=0
DEV_MODE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-service)
      NO_SERVICE=1
      shift
      ;;
    --dev)
      DEV_MODE=1
      shift
      ;;
    --port)
      PORT="${2:-}"
      shift 2
      ;;
    --host)
      HOST="${2:-}"
      shift 2
      ;;
    -h|--help)
      cat <<EOF
Mission Control setup

Usage:
  ./setup.sh [--port 3333] [--host 127.0.0.1] [--dev] [--no-service]

Defaults:
  PORT=${PORT}
  HOST=${HOST}

Behavior:
  1) Installs dependencies
  2) Builds the dashboard (unless --dev)
  3) Starts it as a background service (unless --no-service)

Service support:
  - macOS: launchd user agent
  - Linux: systemd --user service
EOF
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

log() {
  printf "\033[1;36m[setup]\033[0m %s\n" "$*"
}

warn() {
  printf "\033[1;33m[warn]\033[0m %s\n" "$*" >&2
}

require_cmd() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Required command not found: $1" >&2
    exit 1
  fi
}

require_cmd node
require_cmd npm

if [[ "${EUID:-$(id -u)}" -eq 0 ]]; then
  warn "Running setup as root/sudo can cause permission and native dependency issues. Prefer a normal user shell."
fi

if ! command -v openclaw >/dev/null 2>&1; then
  warn "openclaw CLI was not found in PATH. Mission Control can still start, but data loading may fail."
fi

if [[ ! "$PORT" =~ ^[0-9]+$ ]]; then
  echo "Invalid port: ${PORT}" >&2
  exit 1
fi

cd "$ROOT_DIR"

check_lightningcss() {
  node -e 'require("lightningcss")' >/dev/null 2>&1
}

log "Installing dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci --include=optional --no-audit --no-fund
else
  npm install --include=optional --no-audit --no-fund
fi

if ! check_lightningcss; then
  warn "lightningcss native package was not detected. Retrying install with optional dependencies..."
  npm install --include=optional --no-audit --no-fund --no-save lightningcss
fi

if ! check_lightningcss; then
  cat >&2 <<'EOF'
[error] lightningcss native dependency is missing (required by Tailwind/Next build).
Try:
  1) rm -rf node_modules package-lock.json
  2) npm install --include=optional
  3) rerun ./setup.sh (without sudo)
EOF
  exit 1
fi

if [[ "$DEV_MODE" -eq 0 ]]; then
  log "Building production bundle..."
  npm run build
fi

start_foreground() {
  if [[ "$DEV_MODE" -eq 1 ]]; then
    log "Starting in development mode (foreground)..."
    exec npm run dev -- -H "$HOST" -p "$PORT"
  else
    log "Starting in production mode (foreground)..."
    exec npm run start -- -H "$HOST" -p "$PORT"
  fi
}

install_launchd_service() {
  local plist_dir="$HOME/Library/LaunchAgents"
  local plist_path="${plist_dir}/com.openclaw.dashboard.plist"
  mkdir -p "$plist_dir"

  local run_cmd
  if [[ "$DEV_MODE" -eq 1 ]]; then
    run_cmd="cd \"$ROOT_DIR\" && PORT=\"$PORT\" HOST=\"$HOST\" npm run dev -- -H \"$HOST\" -p \"$PORT\""
  else
    run_cmd="cd \"$ROOT_DIR\" && PORT=\"$PORT\" HOST=\"$HOST\" npm run start -- -H \"$HOST\" -p \"$PORT\""
  fi

  cat >"$plist_path" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple Computer//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.openclaw.dashboard</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/zsh</string>
    <string>-lc</string>
    <string>${run_cmd}</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${ROOT_DIR}</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>${ROOT_DIR}/.dashboard.log</string>
  <key>StandardErrorPath</key>
  <string>${ROOT_DIR}/.dashboard.err.log</string>
</dict>
</plist>
EOF

  launchctl unload "$plist_path" >/dev/null 2>&1 || true
  launchctl load -w "$plist_path"
}

install_systemd_user_service() {
  require_cmd systemctl
  local service_dir="$HOME/.config/systemd/user"
  local service_path="${service_dir}/${SERVICE_NAME}.service"
  mkdir -p "$service_dir"

  local exec_line
  if [[ "$DEV_MODE" -eq 1 ]]; then
    exec_line="/usr/bin/env bash -lc 'cd \"$ROOT_DIR\" && PORT=\"$PORT\" HOST=\"$HOST\" npm run dev -- -H \"$HOST\" -p \"$PORT\"'"
  else
    exec_line="/usr/bin/env bash -lc 'cd \"$ROOT_DIR\" && PORT=\"$PORT\" HOST=\"$HOST\" npm run start -- -H \"$HOST\" -p \"$PORT\"'"
  fi

  cat >"$service_path" <<EOF
[Unit]
Description=OpenClaw Mission Control Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=${ROOT_DIR}
ExecStart=${exec_line}
Restart=always
RestartSec=2
Environment=PORT=${PORT}
Environment=HOST=${HOST}

[Install]
WantedBy=default.target
EOF

  systemctl --user daemon-reload
  systemctl --user enable --now "${SERVICE_NAME}.service"
}

start_with_nohup() {
  log "Starting without service manager (nohup fallback)..."
  mkdir -p "${ROOT_DIR}/.run"
  local log_path="${ROOT_DIR}/.run/dashboard.out.log"
  if [[ "$DEV_MODE" -eq 1 ]]; then
    nohup npm run dev -- -H "$HOST" -p "$PORT" >"$log_path" 2>&1 &
  else
    nohup npm run start -- -H "$HOST" -p "$PORT" >"$log_path" 2>&1 &
  fi
  echo $! > "${ROOT_DIR}/.run/dashboard.pid"
}

if [[ "$NO_SERVICE" -eq 1 ]]; then
  start_foreground
fi

log "Configuring background service..."
if [[ "$(uname -s)" == "Darwin" ]]; then
  install_launchd_service
elif [[ "$(uname -s)" == "Linux" ]] && command -v systemctl >/dev/null 2>&1; then
  if systemctl --user status >/dev/null 2>&1; then
    install_systemd_user_service
  else
    warn "systemd --user is not available in this session."
    start_with_nohup
  fi
else
  warn "No supported service manager detected."
  start_with_nohup
fi

echo
log "Mission Control is ready."
echo "URL: http://${HOST}:${PORT}"
echo
echo "Remote tunnel example:"
echo "ssh -N -L ${PORT}:127.0.0.1:${PORT} user@your-server"
echo
