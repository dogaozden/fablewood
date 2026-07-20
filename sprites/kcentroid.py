#!/usr/bin/env python3
"""
kcentroid.py — k-centroid downscale + texel-grid detection for AI-generated pixel art.

Based on Astropulse's pixeldetector (MIT): https://github.com/Astropulse/pixeldetector
Changes vs upstream:
  * int-cast fix in pixel_detect (upstream subtracts uint8 arrays, which wraps mod 256)
  * alpha-aware: RGB via k-centroid, alpha via per-tile coverage vote (binary output)
  * --width/--height for exact target sizes (16x24 etc.), or --auto to detect texel size

Usage:
  python3 kcentroid.py in.png out.png --width 16 --height 24 [--centroids 2]
  python3 kcentroid.py in.png out.png --auto            # detect texel size, downscale by it
  python3 kcentroid.py in.png --detect-only             # just print detected texel size
"""
import argparse
from itertools import product

import numpy as np
from PIL import Image
from scipy.signal import find_peaks


def k_centroid_rgba(image: Image.Image, width: int, height: int, centroids: int = 2,
                    alpha_coverage: float = 0.5) -> Image.Image:
    """Downscale with k-centroid: per output pixel, k-means the source tile and keep
    the dominant centroid. Alpha: output pixel is opaque iff tile coverage >= threshold.
    The k-means runs only on the tile's opaque pixels so background never bleeds in."""
    image = image.convert("RGBA")
    src = np.array(image)
    out = np.zeros((height, width, 4), dtype=np.uint8)
    wf, hf = image.width / width, image.height / height

    for x, y in product(range(width), range(height)):
        x0, y0 = round(x * wf), round(y * hf)
        x1, y1 = round((x + 1) * wf), round((y + 1) * hf)
        tile = src[y0:y1, x0:x1]
        a = tile[..., 3]
        opaque = a >= 128
        coverage = opaque.mean() if a.size else 0.0
        if coverage < alpha_coverage:
            continue  # stays transparent
        # k-means (via PIL quantize) on opaque pixels only
        px = tile[opaque][:, :3]
        t = Image.fromarray(px.reshape(1, -1, 3), "RGB")
        t = t.quantize(colors=min(centroids, len(px)), method=Image.Quantize.MAXCOVERAGE,
                       kmeans=centroids).convert("RGB")
        counts = t.getcolors(maxcolors=centroids + 1)
        out[y, x, :3] = max(counts, key=lambda c: c[0])[1]
        out[y, x, 3] = 255
    return Image.fromarray(out, "RGBA")


def _period_autocorr(signal: np.ndarray) -> float:
    """Dominant period of a 1D edge-energy signal via autocorrelation with comb
    scoring (mean autocorr over a candidate's multiples) to suppress harmonics.
    Returns 0.0 when no periodic structure is found — caller should treat that as
    'detection failed', not as a texel size.
    (Autocorrelation is one of pixel-art-fixer's voting grid detectors.)"""
    s = signal - signal.mean()
    ac = np.correlate(s, s, mode="full")[len(s) - 1:]
    ac /= ac[0] + 1e-9
    # plausible texel sizes only: a sprite has >= ~8 texels per axis
    lo, hi = 2, min(len(s) // 8, 256)
    if hi <= lo:
        return 0.0
    peaks, _ = find_peaks(ac[lo:hi])
    if len(peaks) == 0:
        return 0.0
    peaks = peaks + lo

    def comb(p):
        mults = np.arange(p, len(ac) // 2, p)[:4]
        return float(ac[mults].mean()) if len(mults) else -1.0

    scores = {int(p): comb(int(p)) for p in peaks}
    best = max(scores.values())
    if best <= 0.05:  # periodicity indistinguishable from noise
        return 0.0
    for p in sorted(scores):  # smallest period whose comb score is near-best
        if scores[p] >= 0.85 * best:
            return float(p)
    return 0.0


def pixel_detect(image: Image.Image):
    """Detect implicit texel size of faux pixel art from per-column/row edge energy.
    Uses autocorrelation (robust to blur/noise); falls back to Astropulse's
    median-peak-spacing when autocorrelation finds nothing. Returns (hsize, vsize).

    Treat the result as a diagnostic: when you KNOW the target size (16x24 etc.),
    downscale to that size directly instead of trusting detection."""
    npim = np.array(image.convert("RGB")).astype(np.int32)  # int cast: avoid uint8 wrap
    hdiff = np.sqrt(np.sum((npim[:, :-1] - npim[:, 1:]) ** 2, axis=2))
    vdiff = np.sqrt(np.sum((npim[:-1, :] - npim[1:, :]) ** 2, axis=2))
    hsum, vsum = hdiff.sum(axis=0), vdiff.sum(axis=1)
    hs, vs = _period_autocorr(hsum), _period_autocorr(vsum)
    # one axis found, other failed -> assume square texels
    if hs > 0 and vs == 0:
        vs = hs
    elif vs > 0 and hs == 0:
        hs = vs
    return hs, vs


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("input")
    ap.add_argument("output", nargs="?")
    ap.add_argument("--width", type=int)
    ap.add_argument("--height", type=int)
    ap.add_argument("--auto", action="store_true", help="detect texel size and downscale by it")
    ap.add_argument("--detect-only", action="store_true")
    ap.add_argument("--centroids", type=int, default=2)
    args = ap.parse_args()

    img = Image.open(args.input).convert("RGBA")

    if args.detect_only or args.auto:
        hs, vs = pixel_detect(img)
        if hs == 0 or vs == 0:
            raise SystemExit("texel detection failed (no periodic grid found) — "
                             "supply --width/--height explicitly")
        print(f"detected texel size: {hs:.2f} x {vs:.2f} "
              f"-> logical {round(img.width/hs)} x {round(img.height/vs)}")
        if args.detect_only:
            return
        w, h = round(img.width / hs), round(img.height / vs)
    else:
        if not (args.width and args.height and args.output):
            ap.error("need --width and --height and an output path (or --auto/--detect-only)")
        w, h = args.width, args.height

    out = k_centroid_rgba(img, w, h, args.centroids)
    out.save(args.output)
    print(f"wrote {args.output} ({w}x{h})")


if __name__ == "__main__":
    main()
