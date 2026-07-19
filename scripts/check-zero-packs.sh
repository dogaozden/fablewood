#!/usr/bin/env bash
set -euo pipefail

# Proves the engine builds and its logic passes with ZERO packs installed
# (Fable_SPEC.md §2: CI enforces engine-builds-empty).
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[zero-packs] production build (packs are never imported)…"
npm run build

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/empty-packs"

echo "[zero-packs] test suite with PACKS_DIR=$TMP/empty-packs STATE_DIR=$TMP/state…"
PACKS_DIR="$TMP/empty-packs" STATE_DIR="$TMP/state" npm test

echo "[zero-packs] OK — engine builds and passes with zero packs installed."
