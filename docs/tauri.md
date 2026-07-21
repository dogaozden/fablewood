# FABLEWOOD Desktop (Tauri v2)

The game runs as a native macOS app. Same engine, same save format, same Clerk —
the only thing that changes is the transport behind the bridge.

## Architecture: one frontend, two transports

The web app's entire backend surface is five operations, all funneled through two
files: `app/src/bridge/client.ts` (state read/write, packs list, pack assets) and
`app/src/judge/client.ts` (the Laconic Clerk). Each call picks its transport at
runtime:

- **Browser** (dev server, e2e, static build): `fetch('/api/…')` → the vite
  middleware plugins, exactly as before. Zero behavior change.
- **Tauri webview**: `window.__TAURI_INTERNALS__` exists → the call routes to a
  Rust command instead (`app/src/bridge/native.ts`, `app/src/judge/native.ts`).

| HTTP (web) | Rust command (native) | Semantics |
| --- | --- | --- |
| `GET /api/state/:name` | `state_read` | missing/bad file → null |
| `PUT /api/state/:name` | `state_write` | atomic tmp+rename, mkdir -p |
| `GET /api/packs` | `packs_list` | bad pack.json skipped, id = meta.id or dir |
| `GET /api/packs/:id/assets/:path` | `pack_asset` | traversal-rejected, bytes + mime-by-extension |
| `POST /api/judge` | `judge_grade` | spawns `claude -p --model haiku`, MCP-free, 20s cap |

The Rust side (`src-tauri/src/bridge.rs`, `judge.rs`) is a 1:1 port of the vite
plugins — same name validation, same atomic write, same prompt, same strict-JSON
parse, same fallback contract (any judge failure → deterministic stub + "the Clerk
is momentarily away from his desk"). No API keys anywhere: the Clerk is the
subscription `claude` CLI, resolved from FABLEWOOD_CLAUDE_BIN → PATH →
`~/.local/bin/claude` → `/opt/homebrew/bin/claude` → `/usr/local/bin/claude` →
`~/.claude/local/claude` (a Finder-launched .app has a minimal PATH).

## Running

```sh
npm run tauri:dev     # dev: native window against vite on port 5219 (5173 untouched)
npm run tauri:build   # bundle: src-tauri/target/release/bundle/macos/Fablewood.app
```

`tauri:dev` starts its own vite on **5219** (`dev:native`), so a live `npm run dev`
session on 5173 is never disturbed. Even in dev mode, state/packs/judge go through
the Rust commands (the webview has Tauri internals), so what you test in `tauri:dev`
is what the bundled app does.

## Where files live in native mode

| | default | override |
| --- | --- | --- |
| state | `~/Library/Application Support/realm.ledger.fablewood/state/` | `STATE_DIR=<dir>` |
| packs | dev: `<repo>/packs` · bundled: `<App>.app/Contents/Resources/packs/` (shipped via `tauri.conf.json` `bundle.resources`, read-only) — falls back to `~/Library/Application Support/realm.ledger.fablewood/packs/` if the bundle has none | `PACKS_DIR=<dir>` |

`packs_list` prints one line to stdout every call — `[packs] N found in <dir>` — so a
terminal launch of the bundle proves at a glance whether it saw the bundled content.

**Carrying over the existing save** (the repo's `state/`): launch with the env var —

```sh
# dev
STATE_DIR="$PWD/state" npm run tauri:dev

# bundled .app, run straight from the build output (env vars don't survive Finder;
# launch from a terminal) — the binary inside the bundle is lowercase `fablewood`
# even though the bundle/product name is `Fablewood.app`:
STATE_DIR="$HOME/AI_Projects/learning/state" PACKS_DIR="$HOME/AI_Projects/learning/packs" \
  ./src-tauri/target/release/bundle/macos/Fablewood.app/Contents/MacOS/fablewood

# or the same, if you've dragged the bundle to /Applications:
STATE_DIR="$HOME/AI_Projects/learning/state" PACKS_DIR="$HOME/AI_Projects/learning/packs" \
  /Applications/Fablewood.app/Contents/MacOS/fablewood
```

State files are interchangeable between web and native (same JSON, same merge-write
discipline in the stores), so pointing both at the same dir is safe — just don't run
both simultaneously against it, same as the two-browser-tabs rule.

## Dev instrumentation (FW_AUTOPILOT)

`FW_AUTOPILOT=<path-to-js-file> npm run tauri:dev` polls that file and evaluates its
contents in the webview on every change — the native cousin of the e2e suite's
`page.evaluate`, used to drive/probe the native window from a terminal (synthetic
input, `__FABLEWOOD_STATE` probes, canvas screenshots). Evaluated JS reports back via
`__TAURI_INTERNALS__.invoke('probe_report', {tag, data})`, which prints to the tauri
dev stdout. Off unless the env var is set; never active in normal play.

## Notes

- `JUDGE_MODE=stub` is a dev-server concern (e2e); the native judge always spawns
  the real Clerk and falls back to the stub only on error/timeout.
- The webview needs one real keypress/click before audio starts (same first-gesture
  unlock as the browser); both leitmotifs and the mute toggle work unchanged.
- CSP is disabled in `tauri.conf.json` (local-only app; Phaser/Tone need blob/data
  freedoms). Revisit if the app ever loads remote content.
