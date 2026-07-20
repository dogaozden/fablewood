#!/usr/bin/env python3
"""
sprite_lint.py — automated quality gate: real pixel art vs upscaled slop.

Checks (JSON report + nonzero exit on failure):
  size            exact expected dimensions (--size 16x24)
  alpha           binary alpha only (no semi-transparent pixels)
  palette         every opaque color ∈ fixed palette (--palette warm32.hex)
  colors          distinct color count <= budget (--max-colors 32)
  speckle         orphan-pixel rate: 1px islands per exact color, 4-connectivity
                  (saint11: "orphan pixel = a lone pixel that doesn't touch any
                  pixel cluster" — deliberate art has few)
  clusters        connected-component size histogram (heavy 1-2px tail = slop)
  silhouette      single connected silhouette (or --max-parts), plus fill ratio
  grid            for UPSCALED input (--texel 3): every k x k block must be solid
                  -> % damaged cells; catches faux/off-grid pixel art

Usage:
  python3 sprite_lint.py sprite.png --size 16x24 --palette warm32.hex --max-colors 32
  python3 sprite_lint.py shipped_x3.png --texel 3        # verify integer-scaled export
"""
import argparse
import json
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

FOUR = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])


def _is_hex6(tok):
    return len(tok) == 6 and all(c in "0123456789abcdefABCDEF" for c in tok)


def load_palette(path):
    colors = []
    for line in open(path):
        line = line.strip()
        if line.startswith("#") and not _is_hex6(line[1:7]):
            continue
        for tok in line.replace(",", " ").split():
            tok = tok.lstrip("#")
            if _is_hex6(tok):
                colors.append(tuple(int(tok[i:i + 2], 16) for i in (0, 2, 4)))
    return set(colors)


def lint(path, size=None, palette_path=None, max_colors=None, texel=None,
         max_orphan_rate=0.02, max_parts=1):
    img = Image.open(path).convert("RGBA")
    arr = np.array(img)
    report, ok = {"file": path, "size": f"{img.width}x{img.height}"}, True

    def fail(check, msg):
        nonlocal ok
        ok = False
        report[check] = {"pass": False, "detail": msg}

    # --- size ---
    if size:
        w, h = map(int, size.lower().split("x"))
        if (img.width, img.height) != (w, h):
            fail("size", f"expected {w}x{h}, got {img.width}x{img.height}")
        else:
            report["size_check"] = {"pass": True}

    # --- alpha hygiene ---
    semi = int(((arr[..., 3] > 0) & (arr[..., 3] < 255)).sum())
    if semi:
        fail("alpha", f"{semi} semi-transparent pixels (want binary alpha)")
    else:
        report["alpha"] = {"pass": True}

    opaque = arr[..., 3] == 255
    op_colors = arr[opaque][:, :3]
    uniq = np.unique(op_colors, axis=0) if len(op_colors) else np.zeros((0, 3), int)

    # --- palette membership ---
    if palette_path:
        pal = load_palette(palette_path)
        off = [tuple(c) for c in uniq if tuple(c) not in pal]
        if off:
            fail("palette", f"{len(off)} off-palette colors, e.g. "
                 + ", ".join("#%02x%02x%02x" % c for c in off[:5]))
        else:
            report["palette"] = {"pass": True}

    # --- color budget ---
    report["distinct_colors"] = int(len(uniq))
    if max_colors and len(uniq) > max_colors:
        fail("colors", f"{len(uniq)} colors > budget {max_colors}")

    # --- speckle / cluster deliberateness ---
    if len(uniq) > 256:
        report["clusters"] = {"skipped": f"{len(uniq)} colors — not quantized yet; "
                              "cluster analysis only meaningful post-quantize"}
    elif opaque.any():
        orphans, comp_sizes = 0, []
        for color in np.unique(arr[opaque].reshape(-1, 4), axis=0):
            mask = (arr == color).all(axis=-1)
            labels, n = ndimage.label(mask, structure=FOUR)
            if n:
                sizes = np.bincount(labels.ravel())[1:]
                comp_sizes.extend(sizes.tolist())
                orphans += int((sizes == 1).sum())
        total = int(opaque.sum())
        rate = orphans / total if total else 0
        hist = np.bincount(np.clip(comp_sizes, 0, 8))
        report["clusters"] = {
            "orphan_pixels": orphans, "orphan_rate": round(rate, 4),
            "size_histogram_1to8plus": hist[1:].tolist(),
            "components": len(comp_sizes),
        }
        if rate > max_orphan_rate:
            fail("speckle", f"orphan rate {rate:.1%} > {max_orphan_rate:.1%} "
                 "(1px speckle noise; not deliberate clusters)")

        # --- silhouette ---
        labels, n = ndimage.label(opaque, structure=FOUR)
        fill = total / (img.width * img.height)
        report["silhouette"] = {"parts": int(n), "fill_ratio": round(fill, 3)}
        if n > max_parts:
            fail("silhouette", f"{n} disconnected parts (floating fragments?)")

    # --- texel-grid uniformity (for upscaled exports / faux-pixel detection) ---
    if texel:
        k = texel
        if img.width % k or img.height % k:
            fail("grid", f"dimensions not divisible by texel {k}")
        else:
            cells = arr.reshape(img.height // k, k, img.width // k, k, 4).swapaxes(1, 2)
            flat = cells.reshape(cells.shape[0], cells.shape[1], -1, 4)
            damaged = int((np.ptp(flat, axis=2).max(axis=-1) > 0).sum())
            ncells = flat.shape[0] * flat.shape[1]
            report["grid"] = {"texel": k, "damaged_cells": damaged,
                              "damaged_pct": round(100 * damaged / ncells, 2)}
            if damaged:
                fail("grid_uniformity",
                     f"{damaged}/{ncells} cells not solid — off-grid or mixels")

    report["pass"] = ok
    return report, ok


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("--size")
    ap.add_argument("--palette")
    ap.add_argument("--max-colors", type=int)
    ap.add_argument("--texel", type=int)
    ap.add_argument("--max-orphan-rate", type=float, default=0.02)
    ap.add_argument("--max-parts", type=int, default=1)
    args = ap.parse_args()
    report, ok = lint(args.input, args.size, args.palette, args.max_colors,
                      args.texel, args.max_orphan_rate, args.max_parts)
    print(json.dumps(report, indent=2))
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
