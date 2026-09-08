#!/usr/bin/env bash
set -euo pipefail

MODE="${1:-build}"
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
PREVIEW_ROOT="${FW_NATIVE_PREVIEW_ROOT:-/private/tmp/fablewood-goal1-native-preview}"
CARGO_CACHE_DIR="$ROOT_DIR/src-tauri/target"
CONFIG_FILE="$PREVIEW_ROOT/tauri.preview.json"
APP_BUNDLE="$CARGO_CACHE_DIR/debug/bundle/macos/Fablewood Preview.app"
INFO_PLIST="$APP_BUNDLE/Contents/Info.plist"
APP_BINARY="$APP_BUNDLE/Contents/MacOS/fablewood"
LATEST_RUN="$PREVIEW_ROOT/latest-run"

mkdir -p "$PREVIEW_ROOT"

write_config() {
  cat >"$CONFIG_FILE" <<'JSON'
{
  "productName": "Fablewood Preview",
  "identifier": "realm.ledger.fablewood.goal1-preview",
  "app": {
    "windows": [{
      "label": "main",
      "title": "FABLEWOOD — GOAL 1 PREVIEW",
      "width": 1280,
      "height": 800,
      "minWidth": 960,
      "minHeight": 600,
      "resizable": true
    }]
  },
  "bundle": {
    "active": true,
    "targets": ["app"]
  }
}
JSON
}

bundle_id() {
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$INFO_PLIST"
}

require_preview_bundle() {
  if [[ ! -x "$APP_BINARY" || ! -f "$INFO_PLIST" ]]; then
    echo "preview bundle missing; run $0 build first" >&2
    exit 1
  fi
  local actual
  actual="$(bundle_id)"
  if [[ "$actual" != "realm.ledger.fablewood.goal1-preview" ]]; then
    echo "refusing launch: unexpected bundle id $actual" >&2
    exit 1
  fi
}

build_preview() {
  write_config
  (
    cd "$ROOT_DIR"
    CARGO_PROFILE_DEV_DEBUG=0 \
      CARGO_PROFILE_TEST_DEBUG=0 \
      CARGO_INCREMENTAL=0 \
      CARGO_TARGET_DIR="$CARGO_CACHE_DIR" \
      npx tauri build \
      --debug \
      --bundles app \
      --config "$CONFIG_FILE" \
      --ci \
      --no-sign
  )
  require_preview_bundle
  echo "preview_bundle=$APP_BUNDLE"
  echo "bundle_id=$(bundle_id)"
}

start_preview() {
  require_preview_bundle
  local run_dir state_dir autopilot clerk_log stdout_log pid
  run_dir="$(mktemp -d "$PREVIEW_ROOT/run.XXXXXX")"
  state_dir="$run_dir/state"
  autopilot="$run_dir/autopilot.js"
  clerk_log="$run_dir/clerk.log"
  stdout_log="$run_dir/native.stdout.log"
  mkdir -p "$state_dir"
  cat >"$autopilot" <<'JAVASCRIPT'
(() => {
  const started = Date.now();
  const report = (tag, data) => window.__TAURI_INTERNALS__.invoke('probe_report', {
    tag,
    data: JSON.stringify(data),
  });
  const probe = () => {
    const realm = document.querySelector('.realm');
    const canvas = document.querySelector('.realm-canvas canvas');
    const dialog = document.querySelector('.realm-dialog');
    if ((!window.__FABLEWOOD_READY || !realm || !canvas) && Date.now() - started < 30000) {
      setTimeout(probe, 250);
      return;
    }
    const rect = canvas?.getBoundingClientRect();
    void report('native-ready', {
      title: document.title,
      ready: window.__FABLEWOOD_READY === true,
      realm: !!realm,
      canvas: canvas ? {
        width: canvas.width,
        height: canvas.height,
        cssWidth: Math.round(rect?.width ?? 0),
        cssHeight: Math.round(rect?.height ?? 0),
      } : null,
      webgl: !!canvas?.getContext('webgl2'),
      dialog: dialog ? {
        title: dialog.querySelector('h2')?.textContent?.trim() ?? null,
        primary: dialog.querySelector('.realm-primary')?.textContent?.trim() ?? null,
      } : null,
      visibleMarkers: [...document.querySelectorAll('.realm-marker')]
        .filter(node => getComputedStyle(node).display !== 'none').length,
      body: { width: document.body.clientWidth, height: document.body.clientHeight },
    });
    void Promise.allSettled([
      window.__TAURI_INTERNALS__.invoke('state_read_strict', { name: 'native-smoke-missing.json' }),
      window.__TAURI_INTERNALS__.invoke('judge_grade', {
        prompt: 'Name the neutral test token.',
        answer: 'lantern',
        rubric: 'lantern',
      }),
    ]).then(([strictRead, grade]) => report('native-ipc', {
      strictRead: strictRead.status === 'fulfilled' ? strictRead.value : { rejected: String(strictRead.reason) },
      grade: grade.status === 'rejected'
        ? { rejected: String(grade.reason) }
        : { unexpectedlyResolved: grade.value },
    }));
  };
  probe();
})();
JAVASCRIPT

  /usr/bin/open -n \
    -o "$stdout_log" \
    --stderr "$stdout_log" \
    --env "PATH=/usr/bin:/bin:/usr/sbin:/sbin" \
    --env "STATE_DIR=$state_dir" \
    --env "PACKS_DIR=$ROOT_DIR/packs" \
    --env "JUDGE_MODE=stub" \
    --env "FW_AUTOPILOT=$autopilot" \
    --env "FABLEWOOD_CLERK_LOG=$clerk_log" \
    "$APP_BUNDLE"
  for _ in {1..50}; do
    pid="$(pgrep -f "$APP_BINARY" | tail -n 1 || true)"
    [[ -n "$pid" ]] && break
    sleep 0.1
  done
  if [[ -z "$pid" ]]; then
    echo "preview process did not appear; inspect $stdout_log" >&2
    exit 1
  fi

  printf '%s\n' "$run_dir" >"$LATEST_RUN"
  printf '%s\n' "$pid" >"$run_dir/pid"
  echo "preview_pid=$pid"
  echo "run_dir=$run_dir"
  echo "state_dir=$state_dir"
  echo "clerk_log=$clerk_log"
  echo "stdout_log=$stdout_log"
}

status_preview() {
  require_preview_bundle
  echo "preview_bundle=$APP_BUNDLE"
  echo "bundle_id=$(bundle_id)"
  if [[ ! -f "$LATEST_RUN" ]]; then
    echo "run_status=never_started"
    return
  fi
  local run_dir pid
  run_dir="$(<"$LATEST_RUN")"
  pid="$(<"$run_dir/pid")"
  if kill -0 "$pid" 2>/dev/null; then
    echo "run_status=running"
  else
    echo "run_status=stopped"
  fi
  echo "preview_pid=$pid"
  echo "run_dir=$run_dir"
  if [[ -f "$run_dir/native.stdout.log" ]]; then
    tail -n 30 "$run_dir/native.stdout.log"
  fi
  if [[ -f "$run_dir/clerk.log" ]]; then
    tail -n 10 "$run_dir/clerk.log"
  fi
}

stop_preview() {
  if [[ ! -f "$LATEST_RUN" ]]; then
    echo "no preview run recorded"
    return
  fi
  local run_dir pid executable
  run_dir="$(<"$LATEST_RUN")"
  pid="$(<"$run_dir/pid")"
  if ! kill -0 "$pid" 2>/dev/null; then
    echo "preview already stopped: pid=$pid"
    return
  fi
  executable="$(lsof -a -p "$pid" -d txt -Fn 2>/dev/null | sed -n 's/^n//p' | head -n 1)"
  if [[ "$executable" != "$APP_BINARY" ]]; then
    echo "refusing stop: pid $pid no longer belongs to preview binary" >&2
    exit 1
  fi
  kill -TERM "$pid"
  echo "stopped preview pid=$pid"
}

case "$MODE" in
  build) build_preview ;;
  start) start_preview ;;
  status) status_preview ;;
  stop) stop_preview ;;
  *)
    echo "usage: $0 [build|start|status|stop]" >&2
    exit 2
    ;;
esac
