#!/usr/bin/env python3
"""
cleanup.py — post-snap sprite hygiene at 1:1 texel scale.

Operations (each optional, run in this order):
  --key #ff00ff        chroma-key: pixels near the key color -> transparent
  --despill            edge texels still tinted toward the key hue get replaced by
                       the majority color of their non-key neighbors
  --binary-alpha       alpha -> {0,255} at threshold 128 (no semi-transparency)
  --deorphan           orphan pixels (lone 1px islands of a color, 4-connectivity)
                       replaced by majority neighbor color (Astropulse "Adopt Pixels" style)
  --outline #2a1d2e    add a 1px outline BEHIND the sprite (dilate alpha by 1)

Run this on the downscaled, true-resolution sprite (16x24 etc.), never on the
1024px original — "1px" then means one texel.

Usage:
  python3 cleanup.py in.png out.png --key "#00ff00" --despill --binary-alpha --deorphan
  python3 cleanup.py in.png out.png --outline "#2a1d2e"
"""
import argparse

import numpy as np
from PIL import Image
from scipy import ndimage


def hex_to_rgb(s):
    s = s.lstrip("#")
    return tuple(int(s[i:i + 2], 16) for i in (0, 2, 4))


def key_distance(rgb, key):
    """Normalized chromaticity distance to the key color — robust to lightness of spill."""
    rgbf = rgb.astype(np.float64) + 1e-6
    keyf = np.array(key, dtype=np.float64) + 1e-6
    rc = rgbf / rgbf.sum(axis=-1, keepdims=True)
    kc = keyf / keyf.sum()
    return np.sqrt(((rc - kc) ** 2).sum(axis=-1))


def chroma_key(arr, key, tol=0.08):
    d = key_distance(arr[..., :3], key)
    sat = arr[..., :3].astype(int)
    strong = (sat.max(axis=-1) - sat.min(axis=-1)) > 40  # only saturated pixels can be key
    arr[..., 3] = np.where((d < tol) & strong, 0, arr[..., 3])
    return arr


def despill(arr, key, tol=0.16):
    """Replace opaque pixels still leaning toward the key hue with the majority
    color among their non-keyish opaque neighbors (8-neighborhood)."""
    h, w = arr.shape[:2]
    d = key_distance(arr[..., :3], key)
    opaque = arr[..., 3] >= 128
    spill = opaque & (d < tol)
    out = arr.copy()
    for y, x in zip(*np.nonzero(spill)):
        best, bestn = None, 0
        votes = {}
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                if dy == dx == 0:
                    continue
                yy, xx = y + dy, x + dx
                if 0 <= yy < h and 0 <= xx < w and opaque[yy, xx] and not spill[yy, xx]:
                    c = tuple(arr[yy, xx, :3])
                    votes[c] = votes.get(c, 0) + 1
        for c, n in votes.items():
            if n > bestn:
                best, bestn = c, n
        if best is not None:
            out[y, x, :3] = best
    return out


def binary_alpha(arr, threshold=128):
    arr[..., 3] = np.where(arr[..., 3] >= threshold, 255, 0)
    return arr


def deorphan(arr, min_size=2):
    """Recolor connected components (per exact RGBA color, 4-connectivity) smaller
    than min_size to the majority color of surrounding opaque pixels."""
    h, w = arr.shape[:2]
    opaque = arr[..., 3] >= 128
    colors = {tuple(c) for c in arr[opaque].reshape(-1, 4)}
    out = arr.copy()
    struct = np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])
    for color in colors:
        mask = (arr == np.array(color)).all(axis=-1)
        labels, n = ndimage.label(mask, structure=struct)
        for i in range(1, n + 1):
            comp = labels == i
            if comp.sum() >= min_size:
                continue
            ring = ndimage.binary_dilation(comp, structure=np.ones((3, 3))) & ~comp & opaque
            ring_px = out[ring][:, :4]
            if len(ring_px) == 0:
                continue
            vals, counts = np.unique(ring_px.reshape(-1, 4), axis=0, return_counts=True)
            out[comp] = vals[counts.argmax()]
    return out


def outline(arr, color):
    op = arr[..., 3] >= 128
    ring = ndimage.binary_dilation(op, structure=np.array([[0, 1, 0], [1, 1, 1], [0, 1, 0]])) & ~op
    arr[ring, 0], arr[ring, 1], arr[ring, 2], arr[ring, 3] = (*color, 255)
    return arr


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--key", help="chroma key color, e.g. '#00ff00'")
    ap.add_argument("--key-tol", type=float, default=0.08)
    ap.add_argument("--despill", action="store_true")
    ap.add_argument("--binary-alpha", action="store_true")
    ap.add_argument("--deorphan", action="store_true")
    ap.add_argument("--min-cluster", type=int, default=2)
    ap.add_argument("--outline", help="outline color, e.g. '#2a1d2e'")
    args = ap.parse_args()

    arr = np.array(Image.open(args.input).convert("RGBA"))
    if args.key:
        arr = chroma_key(arr, hex_to_rgb(args.key), args.key_tol)
        if args.despill:
            arr = despill(arr, hex_to_rgb(args.key))
    if args.binary_alpha:
        arr = binary_alpha(arr)
    if args.deorphan:
        arr = deorphan(arr, args.min_cluster)
    if args.outline:
        arr = outline(arr, hex_to_rgb(args.outline))
    Image.fromarray(arr, "RGBA").save(args.output)
    print(f"wrote {args.output}")


if __name__ == "__main__":
    main()
