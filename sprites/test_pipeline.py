#!/usr/bin/env python3
"""Smoke test: simulate faux AI pixel-art output and verify the pipeline rescues it."""
import numpy as np
from PIL import Image, ImageFilter

from kcentroid import k_centroid_rgba, pixel_detect
from palette_map import nearest_rgb, nearest_oklab, load_palette, map_to_palette
from cleanup import chroma_key, binary_alpha, deorphan
import sprite_lint

rng = np.random.default_rng(7)

# ---------- 1. Ground-truth 16x24 sprite (deliberate pixel art, tiny palette) ----------
W, H = 16, 24
truth = np.zeros((H, W, 4), dtype=np.uint8)
BODY = (200, 60, 70)      # crimson-ish tunic
SKIN = (240, 200, 160)
HAIR = (110, 70, 40)
DARK = (60, 30, 50)
yy, xx = np.mgrid[0:H, 0:W]
head = ((xx - 8) ** 2 + (yy - 6) ** 2) < 20
body = (yy >= 10) & (yy < 20) & (xx > 4) & (xx < 12)
legs = (yy >= 20) & (yy < 24) & (((xx > 5) & (xx < 8)) | ((xx > 8) & (xx < 11)))
hair = head & (yy < 5)
for mask, col in [(head, SKIN), (hair, HAIR), (body, BODY), (legs, DARK)]:
    truth[mask] = (*col, 255)
# deliberate per-texel detail: checker shading on the tunic (box-downscale's nemesis)
SHADE = (150, 40, 55)
checker = body & (((xx + yy) % 2) == 0)
truth[checker] = (*SHADE, 255)
truth_img = Image.fromarray(truth, "RGBA")
truth_img.save("truth_16x24.png")

# ---------- 2. Simulate faux AI output ----------
# upscale x64 on green chroma bg -> off-grid resample -> blur -> noise
GREEN = (0, 255, 0)
flat = truth.copy()
flat[truth[..., 3] == 0] = (*GREEN, 255)
big = Image.fromarray(flat, "RGBA").convert("RGB").resize((W * 64, H * 64), Image.NEAREST)
# off-grid: resample to a non-integer-related size and back (simulates model grid drift)
big = big.resize((W * 64 + 37, H * 64 + 53), Image.BILINEAR).resize((W * 64, H * 64), Image.BILINEAR)
big = big.filter(ImageFilter.GaussianBlur(4.0))
noisy = np.array(big).astype(np.int16) + rng.integers(-18, 18, np.array(big).shape)
faux = Image.fromarray(np.clip(noisy, 0, 255).astype(np.uint8), "RGB").convert("RGBA")
faux.save("faux_1024.png")

# ---------- 3. Texel detection ----------
# mild distortion (typical faux AI output: crisp-ish chunky pixels, wobbly grid)
mild = Image.fromarray(flat, "RGBA").convert("RGB").resize((W * 64, H * 64), Image.NEAREST)
mild = mild.resize((W * 64 + 37, H * 64 + 53), Image.BILINEAR).resize((W * 64, H * 64), Image.BILINEAR)
mild = mild.filter(ImageFilter.GaussianBlur(1.5))
m = np.array(mild).astype(np.int16) + rng.integers(-6, 6, np.array(mild).shape)
mild = Image.fromarray(np.clip(m, 0, 255).astype(np.uint8), "RGB")
print(f"[detect] mild faux: texel ~ {pixel_detect(mild)} (true: 64)")
print(f"[detect] harsh faux: texel ~ {pixel_detect(faux)} (0 = honest failure)")

# ---------- 4. Downscale: box vs k-centroid ----------
box = faux.convert("RGB").resize((W, H), Image.BOX).convert("RGBA")
kc = k_centroid_rgba(faux, W, H, centroids=2)

def accuracy(img):
    a = np.array(img.convert("RGB")).astype(int)
    t = truth.copy(); t[truth[..., 3] == 0] = (*GREEN, 255)
    t = t[..., :3].astype(int)
    return (np.abs(a - t).max(axis=-1) <= 12).mean()  # near-exact per-pixel match

print(f"[downscale] box accuracy:        {accuracy(box):.1%}")
print(f"[downscale] k-centroid accuracy: {accuracy(kc):.1%}")

# ---------- 5. Chroma key + cleanup on the k-centroid result ----------
arr = np.array(kc)
arr = chroma_key(arr, GREEN, tol=0.10)
arr = binary_alpha(arr)
arr = deorphan(arr)
keyed = Image.fromarray(arr, "RGBA")
keyed.save("rescued_16x24.png")
alpha_match = (np.array(keyed)[..., 3] == truth[..., 3]).mean()
print(f"[key] alpha mask matches truth: {alpha_match:.1%}")

# ---------- 6. Palette: crimson/moss hue-identity A/B ----------
with open("warm32.hex", "w") as f:
    f.write("""# warm storybook 32 (test palette)
2a1d2e 4a2c3a 7a3b4d 8a2432 c14b3a e07038 f0a05a f5d5a0
6b4a2a 8a6a3a b08a4a d4b483 3a4a2a 55703a 7a955a a8c07a
2a3a4a 3a5a6a 5a8a9a 8ab5c0 5a4a6a 7a6a8a a898b8 d0c0d8
f5efe0 c0b5a5 8a8075 55504a e8c840 b85a70 e89ab0 4a3550
""")
pal = load_palette("warm32.hex")
crimson, moss = (172, 30, 55), (110, 130, 60)
for name, c in [("crimson", crimson), ("moss", moss)]:
    print(f"[palette] {name} {c}: RGB-> {nearest_rgb(c, pal)}, "
          f"OKLab-> {nearest_oklab(c, pal)}, OKLab w2-> {nearest_oklab(c, pal, 2.0)}")

# full-image mapping runs
mapped = map_to_palette(keyed, pal, chroma_weight=1.0)
mapped.save("final_16x24.png")

# ---------- 7. Lint: rescued sprite should pass; faux upscale should fail grid ----------
rep, ok = sprite_lint.lint("final_16x24.png", size="16x24", palette_path="warm32.hex",
                           max_colors=32, max_parts=1)
print(f"[lint] final sprite pass={ok} colors={rep['distinct_colors']} "
      f"orphan_rate={rep['clusters']['orphan_rate']}")

# integer-upscaled export should pass grid check; faux should fail
Image.open("final_16x24.png").resize((W * 3, H * 3), Image.NEAREST).save("final_x3.png")
rep2, ok2 = sprite_lint.lint("final_x3.png", texel=3, max_parts=1)
print(f"[lint] x3 export grid check pass={ok2} damaged={rep2['grid']['damaged_pct']}%")
rep3, ok3 = sprite_lint.lint("faux_1024.png", texel=64, max_parts=99, max_orphan_rate=1.0)
print(f"[lint] faux 1024 grid check pass={ok3} damaged={rep3['grid']['damaged_pct']}% (should FAIL)")
