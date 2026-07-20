#!/usr/bin/env python3
"""
palette_map.py — hue-preserving fixed-palette mapping in OKLab space.

Why: naive nearest-RGB mapping trades hue for lightness (crimson->orange,
moss->khaki). OKLab (Ottosson, https://bottosson.github.io/posts/oklab/) is
hue-uniform; nearest-neighbor there preserves hue identity far better, and an
optional chroma up-weight (--chroma-weight) biases matches to the right hue
family even when lightness must give.

Palette file: text file, one hex color per line (#rrggbb), '#' comments allowed.
Subsets: --subset takes indices or hex values to restrict candidates per asset
("this tree only maps to the greens/browns").

Usage:
  python3 palette_map.py in.png out.png --palette warm32.hex
  python3 palette_map.py tree.png out.png --palette warm32.hex --subset 4,5,6,12,13
  python3 palette_map.py in.png out.png --palette warm32.hex --chroma-weight 2.0
"""
import argparse

import numpy as np
from PIL import Image


# --- sRGB <-> OKLab, reference math from https://bottosson.github.io/posts/oklab/ ---

def srgb_to_linear(c):
    c = c / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_srgb_to_oklab(rgb):
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt(l), np.cbrt(m), np.cbrt(s)
    return np.stack([
        0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
        1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
        0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ], axis=-1)


def srgb_to_oklab(rgb_u8):
    return linear_srgb_to_oklab(srgb_to_linear(rgb_u8.astype(np.float64)))


def _is_hex6(tok):
    return len(tok) == 6 and all(ch in "0123456789abcdefABCDEF" for ch in tok)


def load_palette(path):
    """Parse hex colors from a file: any whitespace/comma separated #rrggbb tokens.
    Lines starting with '# ' (hash-space) are comments."""
    colors = []
    for line in open(path):
        line = line.strip()
        if line.startswith("#") and not _is_hex6(line[1:7]):
            continue  # comment line
        for tok in line.replace(",", " ").split():
            tok = tok.lstrip("#")
            if _is_hex6(tok):
                colors.append(tuple(int(tok[i:i + 2], 16) for i in (0, 2, 4)))
    if not colors:
        raise SystemExit(f"no colors parsed from {path}")
    return np.array(colors, dtype=np.uint8)


def _oklch_distance_sq(lab_a, lab_b, wL=1.0, wC=1.0, wH=1.0):
    """Distance in OKLCh terms: separate lightness, chroma-magnitude, and hue-angle
    errors (hue arc scaled by geometric-mean chroma, as in CIEDE2000's H' term).
    A large wH punishes hue flips specifically — chroma up-weighting alone cannot,
    because dark colors have compressed chroma in OKLab.
    lab_a: (..., 3) pixels; lab_b: (N, 3) palette."""
    La, aa, ba = lab_a[..., 0:1], lab_a[..., 1:2], lab_a[..., 2:3]
    Lb, ab, bb = lab_b[:, 0], lab_b[:, 1], lab_b[:, 2]
    Ca = np.sqrt(aa ** 2 + ba ** 2)
    Cb = np.sqrt(ab ** 2 + bb ** 2)
    ha = np.arctan2(ba, aa)
    hb = np.arctan2(bb, ab)
    dh = np.abs(ha - hb)
    dh = np.where(dh > np.pi, 2 * np.pi - dh, dh)
    dH = 2 * np.sqrt(Ca * Cb) * np.sin(dh / 2)          # hue arc length
    return (wL * (La - Lb)) ** 2 + (wC * (Ca - Cb)) ** 2 + (wH * dH) ** 2


def map_to_palette(img: Image.Image, palette: np.ndarray, chroma_weight: float = 1.0,
                   lightness_weight: float = 1.0, hue_weight: float = 1.0) -> Image.Image:
    """Nearest-neighbor in OKLab/OKLCh with optional axis weights.
    Transparent pixels pass through."""
    arr = np.array(img.convert("RGBA"))
    rgb, alpha = arr[..., :3], arr[..., 3]
    lab_img = srgb_to_oklab(rgb)                         # H x W x 3
    lab_pal = srgb_to_oklab(palette.astype(np.float64))  # N x 3
    d = _oklch_distance_sq(lab_img, lab_pal,
                           wL=lightness_weight, wC=chroma_weight, wH=hue_weight)
    idx = d.argmin(axis=-1)                              # H x W
    out = arr.copy()
    opaque = alpha >= 128
    out[..., :3][opaque] = palette[idx][opaque]
    return Image.fromarray(out, "RGBA")


def nearest_rgb(color, palette):
    """Naive sRGB Euclidean nearest — kept for A/B comparison."""
    d = ((palette.astype(int) - np.array(color, dtype=int)) ** 2).sum(axis=1)
    return tuple(int(v) for v in palette[d.argmin()])


def nearest_oklab(color, palette, chroma_weight=1.0, hue_weight=1.0):
    lab_c = srgb_to_oklab(np.array([color], dtype=np.float64))
    lab_p = srgb_to_oklab(palette.astype(np.float64))
    d = _oklch_distance_sq(lab_c, lab_p, wC=chroma_weight, wH=hue_weight)[0]
    return tuple(int(v) for v in palette[d.argmin()])


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--palette", required=True, help="hex palette file, one #rrggbb per line")
    ap.add_argument("--subset", help="comma-separated palette indices (or hex values) to allow")
    ap.add_argument("--chroma-weight", type=float, default=1.0,
                    help="weight on chroma-magnitude error (default 1.0)")
    ap.add_argument("--lightness-weight", type=float, default=1.0)
    ap.add_argument("--hue-weight", type=float, default=1.0,
                    help="weight on hue-angle error; 2-4 punishes hue flips like "
                         "crimson->orange (default 1.0)")
    args = ap.parse_args()

    palette = load_palette(args.palette)
    if args.subset:
        toks = [t.strip() for t in args.subset.split(",")]
        if all(t.isdigit() for t in toks):
            palette = palette[[int(t) for t in toks]]
        else:
            want = {t.lstrip("#").lower() for t in toks}
            keep = [i for i, c in enumerate(palette)
                    if "%02x%02x%02x" % tuple(c) in want]
            palette = palette[keep]

    img = Image.open(args.input)
    out = map_to_palette(img, palette, args.chroma_weight, args.lightness_weight,
                         args.hue_weight)
    out.save(args.output)
    print(f"wrote {args.output} using {len(palette)} palette colors")


if __name__ == "__main__":
    main()
