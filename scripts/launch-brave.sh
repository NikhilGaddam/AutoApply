#!/usr/bin/env bash
# Launch Brave with the AutoApply extension loaded and CDP enabled on :9222.
# Re-running this script will kill any prior CDP-Brave instance and relaunch.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXT_DIR="$REPO_DIR/extension"
PROFILE_DIR="/tmp/brave-debug-profile"
CDP_PORT=9222
BRAVE="/Applications/Brave Browser.app/Contents/MacOS/Brave Browser"
TEST_URL="${1:-https://jobs.lever.co/spotify/69bf7240-0dfe-43df-a83b-0af1f5b3a892/apply?utm_source=jobright&jr_id=6a030935ed6a637463f4bb67}"

if [[ ! -d "$EXT_DIR" ]]; then
  echo "✗ Extension folder not found: $EXT_DIR" >&2
  exit 1
fi
if [[ ! -x "$BRAVE" ]]; then
  echo "✗ Brave not found at: $BRAVE" >&2
  exit 1
fi

# If a CDP-Brave instance is already running on this port, kill it so we can
# relaunch with --load-extension picking up any code changes.
if lsof -nP -iTCP:$CDP_PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "⟳ Killing existing Brave on port $CDP_PORT"
  pkill -f -- "--remote-debugging-port=$CDP_PORT" || true
  # Give the OS a moment to release the port
  for _ in 1 2 3 4 5; do
    sleep 0.4
    lsof -nP -iTCP:$CDP_PORT -sTCP:LISTEN >/dev/null 2>&1 || break
  done
fi

mkdir -p "$PROFILE_DIR"

echo "▸ Loading extension: $EXT_DIR"
echo "▸ Profile:           $PROFILE_DIR"
echo "▸ CDP port:          $CDP_PORT"
echo "▸ Opening:           $TEST_URL"

# nohup + detach so closing this terminal won't kill Brave
nohup "$BRAVE" \
  --remote-debugging-port=$CDP_PORT \
  --remote-allow-origins=* \
  --user-data-dir="$PROFILE_DIR" \
  --load-extension="$EXT_DIR" \
  --disable-extensions-except="$EXT_DIR" \
  --no-first-run \
  --no-default-browser-check \
  "$TEST_URL" \
  >/dev/null 2>&1 &
disown || true

# Wait for CDP to come up so callers can chain other commands
for i in $(seq 1 25); do
  if curl -sf "http://127.0.0.1:$CDP_PORT/json/version" >/dev/null 2>&1; then
    echo "✓ Brave is up. CDP: http://127.0.0.1:$CDP_PORT"
    echo "  Manage extensions: brave://extensions"
    exit 0
  fi
  sleep 0.3
done

echo "✗ Brave did not expose CDP within timeout" >&2
exit 1
