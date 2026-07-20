# Best-Practice Pipeline for TRUE, Game-Ready Pixel-Art Sprites with gpt-image-2 (Codex CLI, No Paid Services, Apple Silicon)

## TL;DR
- **The single most important finding:** For general-purpose models (gpt-image-2 / GPT-4o), prompting for a "crisp NxN-block pixel grid" does NOT produce genuinely grid-aligned output that box-downscales cleanly — this is a myth. The reliable pipeline is: prompt for a *clean, flat, limited-palette* look at large size → run a **grid-detection / content-aware downscaler** (Astropulse k-centroid or the unfake.py "dominant color voting" method) → **remap to your fixed 32-color palette in a perceptual color space (OKLab/CIELAB), dither OFF** → scripted alpha/outline cleanup. This directly fixes your speckle-noise (failure 1) and hue-shift (failure 2) problems.
- **Animation reality:** Do NOT expect gpt-image-2 to generate a coherent ~18-frame 16×24 walk sheet. Practitioners (incl. the OpenAI dev forum) report persistent identity drift and left/right limb confusion. The realistic, source-backed approach is **generate ONE master sprite, then animate by hand or in code** (frame offsetting / limb rigging in Phaser), reserving the model for keyframe references.
- **Free/local supplements:** gpt-image-2 stays your primary generator via Codex CLI (subscription, no API key). A zero-cost local supplement on your Mac is **Draw Things** (Apple-native, Metal) or ComfyUI running SDXL + the free **Pixel Art XL LoRA** — useful as a comparison/backup, but gpt-image-2 + a strong cleanup pipeline is sufficient.

## Key Findings

1. **Prompting for literal pixel grids is unreliable.** Multiple practitioners confirm general models make "pixel-*ish* art": pixels drift, sizes wobble, corners round, edges are anti-aliased. Even the explicit "enlarge the pixel blocks" technique produced "decent but messy" output that "still needed Photoshop grid-enforcement" (Sarthak Mishra devblog, sarthakmishra.com, Jan 2026). The correct role of the prompt is to minimize gradients, anti-aliasing, and palette sprawl — not to fake a grid.

2. **"Generate large + downscale" beats "generate at target size," but only with a smart downscaler.** Naive box/nearest downscale of a painterly render is exactly what creates your 1px speckle. The community-proven fix is a **content-aware, cluster/vote-based downscale**: Astropulse's **k-centroid** (k-means dominant color per output cell) or unfake.py's **dominant-color voting** (assign the block's winning color if it beats runner-up by >5%, else mean-blend).

3. **Grid "unfaking" tools exist and are free/local.** `unfake.py` (Python port of jenissimo's unfake.js, MIT) does scale detection (Sobel-edge + tile voting), grid snapping, content-aware downscale, quantization, and alpha cleanup from one CLI. Astropulse's `pixeldetector` (Python) and Retro-Diffusion's open-source `pixel-art-fixer` do the same. These are the "pixel detect / unfake" tools you were looking for.

4. **Hue-preserving quantization requires a perceptual color space.** Pillow's default `quantize` uses Euclidean RGB distance, which is exactly why crimson→orange and moss→khaki. Fixes: quantize/remap in **OKLab or CIELAB**. ImageMagick can remap in a controlled colorspace; the `hquant` library does CIELAB-based nearest-color matching against a fixed palette; unfake.py uses Wu quantization / libimagequant.

5. **Dithering hurts at your sizes.** Practitioner consensus (Pixel Parmesan, Lospec-adjacent guides, Planet Centauri devblog): don't dither sprites ≤16×16, don't dither on outlines, and never dither animated regions (patterns crawl frame-to-frame). Your 16×16–48×50 assets should use **flat color steps, dither OFF**.

6. **gpt-image-2 cannot output transparency directly** — the Codex `$imagegen` skill itself works around this with a chroma-key two-step, confirming your current approach is correct in principle. Best practice: generate on flat #00FF00 (or #FF00FF for green subjects), then despill + alpha-binarize in code.

## Details

### A. Prompting: what actually works

**Verdict on the "each logical pixel = 64×64 block" myth:** Not real for gpt-image-2/GPT-4o. The models learned what pixel art *looks like*, not what it *is*; pixel sizes come out *implied, not actual*. The existence of an entire ecosystem of cleanup tools (unfake, pixeldetector, pixel-art-fixer, Pixel Snapper, ComfyUI PixelArt-Detector) is itself proof that no prompt removes the need for a downscale/snap pass. Renoise's marketing page claims gpt-image-2 "holds hard pixel edges without anti-aliasing... the cleanest of any model," but that is a vendor claim about *appearance*, not verified grid-alignability.

**What the prompt SHOULD do** (verified to measurably help): (a) name a limited palette as a hard rule ("strict 16-color palette, no other colors"); (b) demand "hard edges, no anti-aliasing, flat color fills, no gradients, no soft glows"; (c) name an era/console ("SNES/16-bit"); (d) single centered subject on a flat chroma background; (e) generate LARGE (1024²+) so the smart downscaler has clean clusters to vote on. Generating large + downscaling is the correct strategy — *because* it gives the cleanup step material to work with — but the crispness comes from the downscaler, not the prompt.

**Lessons from the SD/Flux community that generalize:** The Pixel Art XL LoRA README's guidance is the canonical recipe and applies conceptually to any generator's output — "Downscale 8 times to get pixel-perfect images (use Nearest Neighbors)" and pair with Astropulse PixelDetector. The principle: the model generates at ~8× the native resolution, then a dedicated tool reduces it.

### B. Downscaling algorithms compared

- **Box/area averaging:** blends colors → muddy, introduces off-palette intermediate colors. Your current speckle source.
- **Nearest-neighbor:** picks one source pixel per cell → aliased/noisy on painterly input; fine only for integer upscaling of already-clean art.
- **Lanczos/bicubic:** sharpening resamplers designed for photos → ringing/halos, worst for pixel art.
- **k-centroid (Astropulse):** k-means finds the most representative color per output tile; retains lines and edges, kills noise/blur. Free, cross-platform (Windows/macOS/Linux); Aseprite Lua extension + open-source repo (`Astropulse/K-Centroid-Aseprite`).
- **Dominant-color voting (unfake.py / unfake.js):** count colors per block; if one dominates by >5% use it, else mean-blend. Content-adaptive, crisp.
- **PixelOE (KohakuBlueleaf, MIT):** contrast-aware outline-expansion pixelization, works in LAB, preserves edges/outlines — strong for a "deliberate 1px outline" look.
- **Retro-Diffusion pixel-art-fixer:** best-in-class per its own benchmark (recovers exact native resolution on a majority of test images where others fail; detected grid lines land on the true grid the vast majority of the time; color error within a barely-perceptible CIELAB delta). Two-stage: detect grid via autocorrelation/run-lengths/self-similarity, then decouple structure from color.

**Free, locally runnable on your Mac (all zero-cost):** `unfake.py` (`pip install .`, needs Python 3.9+, numpy, scipy, opencv-python, Pillow, Rust toolchain); Astropulse `pixeldetector` (Python); Retro-Diffusion `pixel-art-fixer` (Python `pixelfixer.cli`, or a faster Rust core); ImageMagick for palette remap; PIL for glue.

### C. Grid rescue / "unfaking" + cleanup

**Named tools (verified):**
- **unfake.js** by jenissimo (Eugeniy Smirnov, ex-CPO at Playkot), MIT-licensed, 789 stars / 50 forks per its GitHub releases page; the Rust→WASM `unfake-core` uses imagequant, with a Python port (`unfake.py`, by painebenjamin) claiming a "10-20% speedup over the JS version." The reference implementation. CLI: `unfake input.png -c 32 -m dominant --cleanup morph,jaggy --palette palette.txt`. Does scale detection (`runs`/`edge`/`auto`), grid snapping, content-aware downscale, quantization, morphological + jaggy cleanup, and alpha binarization.
- **Astropulse/pixeldetector** — downscale + restore pixel art.
- **Retro-Diffusion/pixel-art-fixer** — grid detection + neural fixer (browser, free).
- **ComfyUI-PixelArt-Detector** (dimtoneff) and **ComfyUI-Unfake-Pixels** (tauraloke) / **PixelArt-Unfaker** — ComfyUI nodes if you go the ComfyUI route; the underlying algorithms are also available standalone via unfake.py so you don't need ComfyUI.
- **mono-pix / pixel-snapper** — additional browser tools.

**How detection works (jenissimo's method, so you can script/trust it):** convert to grayscale → Sobel X/Y edge maps → collapse to 1D row/column edge profiles → histogram the distances between peaks (common steps like 8/12/16/24 emerge) → that's the pseudo-pixel size → brute-force the grid offset (0…scale-1) that best aligns to the edge peaks → crop so dimensions divide evenly.

**Cleanup passes you should script:**
- **Chroma despill + alpha:** flood-fill from corners on the chroma color, binarize alpha (hard 0/255, no semi-transparent fringe), then "RGB-scrub" fully-transparent pixels so no green survives at the edge. The Codex `$imagegen` skill's `transparent verify --expected-matte-color` check confirms this is the sanctioned pattern.
- **1px outline enforcement:** optional PixelOE pass or morphological close to make outlines deliberate and continuous.
- **Orphan-pixel removal:** Astropulse's "Adopt Pixels" concept / unfake's jaggy+morph cleanup removes stray single pixels (your speckle).

### D. Palette quantization preserving hue

**Root cause of your hue shift:** naive quantizers minimize RGB Euclidean distance, which is perceptually non-uniform — so a saturated crimson can map to a nearer-in-RGB orange. **Fix: operate in a perceptual space.**

**Concrete free options:**
- **ImageMagick remap in a controlled colorspace, dither OFF:** build a palette PNG (one pixel per color, or download a Lospec palette PNG), then `magick sprite.png -dither None -remap palette.png out.png`. Critically include `+dither`/`-dither None` *before* color ops or IM will dither. Operate in linear/appropriate colorspace via `-colorspace`.
- **hquant (PyPI):** drop-in high-quality quantizer for Pillow that matches colors in **CIELAB** (or YCbCr) instead of RGB — directly solves the hue problem against a *fixed* palette.
- **unfake.py `--palette palette.txt`:** locks output to your curated 32-color palette using libimagequant/Wu.
- **OKLab route:** several open pipelines (e.g., ubitux's median-cut-in-OKLab writeup; the Catlantean devblog's OKLab nearest-color remap) show OKLab gives the best perceptual palette mapping; you can implement OKLab nearest-color in ~30 lines of NumPy if hquant's CIELAB isn't close enough.

**Palette-lock vs. derive-per-image:** For a cohesive cozy-storybook game, **lock to one curated 32-color warm palette** (store as `palette.png`/`palette.txt`, share across ALL asset classes). Deriving per-image breaks cross-asset cohesion and is the other reason AI art "doesn't match." You may allow per-asset-class *sub-palettes* (subsets of the master) if a class needs specific hues.

**Dithering guidance for your sizes:** OFF for 16×16 terrain, 16×24 characters, 12×28 props, 20×28 trees. Consider *sparse, hand-placed* dither only on the ~48×50 buildings or 128×128 portraits if you want texture — and never in animated regions. Ordered/Bayer dither looks fine at high res but becomes noise ≤16px.

### E. Animation consistency (realistic expectations)

**What gpt-image-2 offers:** reference-image conditioning via `codex exec -i ref.png` (up to 16 reference images), and image-edit/pose-transfer prompts. The OpenAI dev-forum "sprite sheets with gpt-image-2" thread is the best primary source and is candid: "there still isn't a clear, reliable solution"; the model confuses the character's anatomical left/right with screen left/right; full-sheet generation yields "incomplete results with repeated poses"; frame-by-frame works better than whole-sheet; expect to **retry each frame 2–3×**; then run a "normalize the style, character consistency and size" edit pass over the assembled sheet.

**Realistic recommendation (source-grounded):** Generate ONE clean master sprite (the 16×24 idle), lock its palette and silhouette, then produce the ~18-frame walk cycle by **hand-editing in Aseprite or by procedural/code animation in Phaser** (limb/segment offsetting, squash-stretch, bob). This is more reliable than coaxing 18 coherent frames from the model. If you do use the model for in-betweens, use it for *keyframe references* only, then clean each frame through the Section-C pipeline and hand-fix identity drift. The "generate a 3×3 contact sheet" prompts circulating (dev.to keyframe tutorials) work at large sizes for concept/keyframes but still need per-frame cleanup and identity fixing.

### F. Where model stops and hand/code cleanup begins

**Recommended boundary:** Model generates the *look* (one hero frame per asset, large, flat, chroma bg). Everything discrete — grid, palette lock, alpha, outline, orphan removal, animation frames — is scripted/hand work. This matches how solo devs actually ship: "AI gets you 70% there, you finish the last 30%."

**Dedicated pixel-art models — free/local status:**
- **Retro Diffusion** (Astropulse): the best-known purpose-built pixel-art generator, trained on licensed pixel art. The **website (retrodiffusion.ai) is credit-based** — "Try 50 free credits!" (no credit card required); "Each credit generates an image up to 276x276 pixels, with cost scaling up with size." The **Aseprite extension is a flat one-time purchase** — $65 full / $20 "Lite," "No subscriptions and no credits required" (astropulse.itch.io/retrodiffusion) — and runs locally, but its results differ from the website. Its **pixel-art-fixer and k-centroid tools ARE free/open-source** — use those, not the paid generator.
- **Free local generation on Apple silicon:** **Draw Things** (free App Store app, launched 2023 by developer Liu Liu; native Metal/Swift). Per Draw Things' own engineering blog (Metal FlashAttention 2.0): "up to 20% improvement on inference for FLUX.1 models on M3 / M4 devices" and "up to 94% faster than ggml implementations"; an independent Mac Mini M4 Pro benchmark (heyuan110.com, Feb 15 2026) found "Draw Things beats ComfyUI by 20% on Apple Silicon." It supports SDXL/Flux/LoRAs/img2img/ControlNet and local LoRA training. Alternatively **ComfyUI** (by comfyanonymous, 2023) runs on PyTorch's Metal Performance Shaders backend, which InsiderLLM measures as "2-4x slower than NVIDIA CUDA" and "about 3x slower" than Draw Things for the same model on Mac — fully open but heavier. Load a free pixel-art LoRA: **Pixel Art XL v1.1 by NeriJS** (SDXL, listed at 89,043 downloads on CivitAI per CivArchive, model 120096, created 8/7/2023, updated 11/7/2025; README recipe: "Downscale 8 times to get pixel perfect images (use Nearest Neighbors)") or the Retro-Pixel Flux LoRA. This is a legitimate zero-cost supplement/backup and can be better at "native" pixel look, but adds a heavier local toolchain.

**Bottom line on tools:** gpt-image-2 via Codex stays primary (best instruction-following, no API key, subscription-covered). Keep Draw Things + Pixel Art XL as a comparison point; use Astropulse/unfake free tools for all cleanup.

### G. Objective, scriptable quality gate (lint/CI for sprites)

Build a Python (PIL + NumPy) linter that REJECTS an asset unless it passes:
1. **Exact dimensions:** width/height == the class target (16×16, 16×24, 20×28, 12×28, 48×50, 128×128). Hard fail otherwise.
2. **Palette discipline:** unique non-transparent colors ≤ 32 (or ≤ your per-class sub-palette size); every color ∈ master palette (zero off-palette colors after remap). Count via `np.unique`.
3. **Texel uniformity / "is it really 1:1":** run unfake.py/pixeldetector scale detection; assert detected pixel size == 1 (i.e., no residual pseudo-grid ≥2px). If detected scale >1, the asset is still "faux" and fails.
4. **Anti-aliasing / edge crispness:** check alpha channel is binary (only 0 and 255, no fringe) — `set(alpha.flatten()) ⊆ {0,255}`. Flag any pixel whose color is a near-blend of two palette neighbors not in the palette.
5. **Speckle / cluster deliberateness:** count orphan pixels (a colored pixel whose 4-neighbors are all different/transparent). Fail if orphan ratio exceeds a threshold (e.g., >5–8% of filled pixels) — this catches "AI upscale slop."
6. **Silhouette readability at 100%:** fill all non-transparent pixels black, downscale-preview, and assert the silhouette bounding box fills a reasonable fraction of the canvas and is contiguous (single connected component for characters/props). This is scriptable via connected-components (`scipy.ndimage.label`).

Wire this as a pre-commit/CI check; only assets passing all six enter the Phaser atlas.

## Recommended End-to-End Pipeline (exact steps)

**Stage 0 — One-time setup (Apple silicon, all free):**
```bash
brew install imagemagick python rust
pip install pillow numpy scipy opencv-python hquant
# grab unfake.py (Python port of unfake.js)
git clone https://github.com/painebenjamin/unfake.py && cd unfake.py && pip install .
# store your curated warm 32-color palette as palette.png AND palette.txt (hex per line)
# optional supplement: install Draw Things from the App Store + Pixel Art XL LoRA
```

**Stage 1 — Generate (Codex CLI, gpt-image-2, subscription, no API key):**
```bash
codex exec --sandbox workspace-write --skip-git-repo-check \
  '$imagegen [ASSET PROMPT — see templates], render on a perfectly flat pure #00FF00 background, \
   no shadows, no gradients, no glow, hard edges, flat color fills. Save to ./raw/asset.png' </dev/null
```
Generate at 1024² (or larger); explicitly name gpt-image-2 or Codex falls back to a lower-quality default. For characters, generate ONE idle master only.

**Stage 2 — Chroma key → alpha (Python/PIL):** flood-fill #00FF00 from corners, binarize alpha, RGB-scrub transparent pixels to kill green fringe.

**Stage 3 — Grid detect + content-aware downscale to a working native size (unfake.py):**
```bash
unfake ./keyed/asset.png -o ./native/asset.png -m dominant \
  --cleanup morph,jaggy --palette palette.txt
# for tiny targets, force scale if auto-detect wobbles: --scale N
```
(k-centroid via the Astropulse repo is an alternative for the downscale step.)

**Stage 4 — Snap to EXACT target size:** if unfake's native output isn't exactly your class target, do a final integer/nearest resize to the exact pixel dimensions (16×16, 16×24, etc.), never a fractional resize.

**Stage 5 — Palette lock in perceptual space (hquant CIELAB, or ImageMagick):**
```bash
# ImageMagick, dither OFF, remap to fixed palette:
magick ./native/asset.png -dither None -remap palette.png ./final/asset.png
# OR hquant (CIELAB matching) in Python for hue fidelity
```

**Stage 6 — Lint gate (Section G):** run the 6-check linter; reject & regenerate on fail.

**Stage 7 — Assemble in Phaser:** import PNGs into a texture atlas at native size; set `pixelArt: true` (nearest-neighbor), 3× integer zoom, 16px tile grid. Animate walk cycles in-engine/hand, not from the model.

## Battle-Tested Prompt Templates (gpt-image-2)

All share this suffix: *"…flat color fills, hard edges, no anti-aliasing, no gradients, no soft glows, strict limited warm palette, cozy storybook-fantasy style, single centered subject, rendered large and clean, on a perfectly flat pure #00FF00 chroma background, no shadows."*

1. **Terrain tile (→16×16):** "A seamless top-down [grass / cobblestone / dirt path] terrain tile, tileable edges, uniform texture, 16-bit SNES RPG look, [suffix]."
2. **Character (→16×24 master):** "A front-facing chibi [role, e.g., young herbalist] game character, full body, clear readable silhouette, distinct anatomical left/right, idle pose, warm cozy palette, 16-bit JRPG sprite, [suffix]." (Generate idle only; animate later.)
3. **Building (→48×50):** "A small cozy storybook [cottage / bakery], 3/4 or flat front view, chunky simplified forms, few large flat color planes, minimal micro-detail, readable at small size, 16-bit RPG town building, [suffix]." (Explicitly demand "few large flat color planes, minimal micro-detail" — this directly counters your worst-case building speckle.)
4. **Animation reference sheet (concept only, →per-frame cleanup):** "A 3×3 grid of the SAME character [describe], numbered frames, a smooth [walk] cycle, identical proportions/colors/style across all frames, consistent size and position, [suffix]." Expect to retry 2–3× and clean each frame; prefer hand/code animation for production.
5. **Dialogue portrait (→128×128):** "A warm bust portrait of [character], cozy storybook-fantasy, soft but FLAT shading in discrete color steps (no smooth gradients), limited warm palette, gentle expression, 16-bit visual-novel portrait, [suffix]."

## Recommendations (staged, with thresholds)

**Stage 1 (this week) — Rebuild the cleanup core.** Replace naive box-downscale + naive quantize with **unfake.py (dominant voting) → exact-size snap → hquant/ImageMagick CIELAB remap to your locked palette, dither OFF.** Benchmark on your worst building. *Threshold to proceed:* zero off-palette colors, orphan-pixel ratio down to <8%, no visible speckle at 3× zoom.

**Stage 2 — Add the 6-check linter** and gate all assets. *Threshold:* 100% of accepted assets pass exact-dimension + binary-alpha + ≤32-color checks.

**Stage 3 — Lock the character workflow to "one master + hand/code animation."** Only if per-frame cleanup + identity drift proves faster than hand animation should you keep generating full sheets. *Threshold to keep model-generated frames:* >70% of frames usable after ≤3 retries AND identity drift invisible after normalize pass; otherwise switch fully to hand/code.

**Stage 4 (optional) — Stand up Draw Things + Pixel Art XL** as a local comparison for the asset classes where gpt-image-2 struggles most (buildings, tiny props). *Threshold to adopt:* native output needs less cleanup than gpt-image-2 on the same asset in a blind A/B. If not, stay gpt-image-2-only.

**Do NOT:** rely on prompt tricks to fake the grid; dither ≤16px sprites; quantize in RGB; use fractional resizes; or trust full walk-sheets from the model without per-frame QA.

## Caveats

- **Vendor-claim flags:** Renoise's "gpt-image-2 is the cleanest pixel-art model" and Sprite Fusion / Sprite-AI "mixel" framing come from tools with commercial interest; treated as indicative, not authoritative. The independent evidence (Sarthak Mishra's direct test; the sheer number of cleanup tools) is what grounds the "prompting can't fake the grid" conclusion.
- **Retro-Diffusion pixel-art-fixer benchmark numbers** are self-reported by the tool authors on their own corpus; directionally credible but not independently audited.
- **Codex CLI specifics** (the `$imagegen` skill, `-i` reference-image flag, chroma-key two-step, "must name gpt-image-2 or it falls back") come from community writeups and the skill's own docs dated April–June 2026; exact flags may shift with CLI versions — verify against your installed `codex` version.
- **Could not fully verify:** first-hand Reddit/X threads on the "NxN block" prompt (search returned devblogs/forums/tool READMEs instead); a controlled quantified before/after of box-downscaling a "16×16 @1024" gpt-image render (evidence is qualitative). OKLab-vs-CIELAB superiority for *your specific* 32 warm colors should be confirmed empirically on your palette.
- **Animation consistency** claims from marketing pages (Ludo.ai, Sorceress, Nano Banana) were treated as overhyped; the grounded expectation comes from the OpenAI dev-forum thread and independent devblogs.