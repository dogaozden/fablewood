# True Pixel-Art Sprites from gpt-image-2: Best-Practice Pipeline

**Scope**: gpt-image-2 via Codex CLI (ChatGPT subscription, no API keys), free local tools only (Apple-silicon Mac), Phaser 3, 16px texel grid, 3× integer zoom, nearest-neighbor, ~32-color warm palette, chroma-keyed transparency. Asset targets: 16×16 tiles, 16×24 characters (+walk sheets), 20×28 trees, 12×28 props, ~48×50 buildings, 128×128 portraits.

**Method note**: findings below come from practitioner writeups, tool source code, and official docs (cited inline). Every recipe involving the four bundled scripts (`kcentroid.py`, `palette_map.py`, `cleanup.py`, `sprite_lint.py`) was **implemented and smoke-tested locally** on synthetic faux-pixel-art input during this research — results in §9. Anything I could not verify is flagged ⚠️ and collected in §10.

---

## 1. Executive summary — what changes and why

The single most consistent finding across every practitioner source: **no image model, not even purpose-trained ones, emits true on-grid pixel art — the winning pipelines all prompt a chunky pixel *style* at high resolution, then recover the true grid deterministically in post.** Retro Diffusion's founder (Astropulse), who trains dedicated pixel-art models, says even his models "still have trouble being specifically limited to a set number of colors" and ships a clustering downscale + quantization post-pass as the mandatory last mile ([Runware interview](https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale)); the same "generate then snap" shape appears in the most complete public GPT-image game-sprite pipeline ([chongdashu's ai-game-spritesheets](https://github.com/chongdashu/ai-game-spritesheets), [video walkthrough](https://www.youtube.com/watch?v=nIAIxvNUrdU)) and in HN practitioner threads ([discussion](https://news.ycombinator.com/item?id=44207304)).

Mapped to your five failure modes:

| # | Your failure | Root cause | Fix (section) |
|---|---|---|---|
| 1 | 1px speckle from painterly→downscale | Box averaging invents in-between colors per cell; painterly input has no cluster structure to recover | Prompt the *chunky pixel look*, not painterly (§3); replace box with dominant-color/k-centroid downscale (§4) |
| 2 | Crimson→orange, moss→khaki quantize | Nearest-RGB has no hue axis; trades hue for lightness | OKLab/OKLCh hue-weighted mapping + per-asset palette subsets + palette ramp audit (§4.2) |
| 3 | AA edges & soft glows vs texel grid | Model default rendering + prompt not forbidding it | "no anti-aliasing / flat color planes" prompt block (§3) + dominant-color downscale + binary alpha (§5) |
| 4 | Character identity drift across frames | Independent generations share no state | Reference-image anchoring per frame + snap + manual align; drop to 4 frames/direction (§6) |
| 5 | Faux pixel art, off-grid texels | Fundamental to diffusion/AR image models | Grid rescue: `unfake` / `pixel-art-fixer` / k-centroid at known target size (§5) |

Two hard platform facts to bake in:

- **gpt-image-2 does not support transparent backgrounds.** Official docs: "gpt-image-2 doesn't currently support transparent backgrounds. Requests with `background: 'transparent'` aren't supported for this model" ([OpenAI image guide](https://developers.openai.com/api/docs/guides/image-generation) — verified directly during this research). Your chroma-key approach is not a hack — it's the sanctioned path: OpenAI's own Codex `$imagegen` skill generates on a flat chroma background (default `#00ff00`) and ships a `remove_chroma_key.py` ([codex repo skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md)).
- **Codex CLI's built-in `image_gen` tool exposes almost nothing** — no `background`, no `quality`, and no deterministic size control in the app path ([issue #18636](https://github.com/openai/codex/issues/18636), [issue #19175](https://github.com/openai/codex/issues/19175)). Sizes: arbitrary W×H exist at the API level (multiples of 16, max edge 3840, ≤3:1 aspect — [docs](https://developers.openai.com/api/docs/guides/image-generation)), but on the subscription path you steer size via the prompt and accept what you get. Plan on chroma-bbox cropping rather than exact canvas control. Also budget-relevant: image turns burn ChatGPT plan limits **3–5× faster than text turns** ([Codex CLI docs](https://developers.openai.com/codex/cli/features)).

---

## 2. Deliverable 1 — the recommended end-to-end pipeline

### One-time setup (Stage 0)

**0a. Audit the 32-color palette for ramps.** This is the root fix for crimson→orange. My local A/B test (§9) showed that when the palette lacks a lightness-appropriate swatch in the right hue family, *no* distance metric — RGB, OKLab, even hue-weighted OKLCh — will keep a bright crimson red; the metric answer is genuinely "orange is closer." Pixel-art doctrine says palettes are built as **hue-shifted ramps** of 2–4 lightness steps per material family ([Slynyrd, Pixelblog #1](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes)). Check: does every hue family you care about (reds, greens, sky, wood, stone, skin) have at least a dark/mid/light step? If crimson keeps mapping to orange, your palette has a red-shaped hole.

**0b. Write the palette file** (one or more `#rrggbb` per line; `# `-prefixed comment lines allowed) and a small **asset manifest** of per-asset palette subsets — "trees map only to the green/brown ramp indices", "roofs only to red/brown". Per-material color assignment is standard pixel-art ramp practice ([Slynyrd](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes)); automating it as palette *subsets* per asset class is an engineering extension (⚠️ no published precedent found for the automated form, but it is the only fix that survived my crimson stress test).

**0c. Make grid-anchor reference images** — one checkerboard per asset size, e.g. for 16×24 at 64×/texel:

```bash
magick -size 16x24 pattern:gray50 -filter point -resize 6400% grid_16x24.png
```

Two independent sources report that attaching a checkerboard/pixel-grid image as a reference "works like a ruler" for pixel-block discipline ([chongdashu's south-anchor template](https://raw.githubusercontent.com/chongdashu/ai-game-spritesheets/main/prompts/02-south-anchor.md): "Image 1 role: pixel-grid anchor… Do not copy its content"; [SpriteCook](https://www.spritecook.ai/blog/tiny-pixel-art-animations): "A plain checkerboard at the grid size you want works like a ruler").

**0d. Install the toolchain** (all free, all local):

```bash
pip install unfake pillow numpy scipy --break-system-packages   # unfake: MIT, Rust-accelerated
brew install imagemagick
# plus the four scripts bundled with this report
```

`unfake` ([PyPI](https://pypi.org/project/unfake/), [repo](https://github.com/painebenjamin/unfake.py) — Python port of [jenissimo's unfake.js](https://github.com/jenissimo/unfake.js)) is the closest single-tool drop-in: grid detection (runs-GCD + Sobel-edge methods), grid snapping, dominant-color downscale, fixed-palette quantization, alpha binarization, morphological cleanup. The bundled scripts do the same steps transparently and add the OKLCh hue-weighted mapping `unfake` lacks.

### Per-asset flow (Stages 1–8)

```
1. GENERATE   codex: template prompt (§3) + grid-anchor image, chroma bg, 1024px-class output
2. CROP       chroma bounding-box crop (never trust canvas placement)
3. DOWNSCALE  k-centroid to exact target size  ->  16x24 true-res sprite
4. CLEAN      chroma key -> despill -> binary alpha -> de-orphan
5. QUANTIZE   OKLCh hue-weighted map to palette (per-asset subset)
6. OUTLINE    optional scripted 1px outline
7. LINT       sprite_lint.py gate; fail -> regenerate (cheap) or hand-fix (when close)
8. SHIP       Phaser: pixelArt: true, integer zoom, NEVER rescale the PNG itself
```

Concrete commands for one character sprite:

```bash
# 2. bbox crop (ImageMagick): flatten near-key pixels, trim to content
magick raw.png -fuzz 12% -transparent "#FF00FF" -trim +repage cropped.png

# 3-5. downscale + clean + quantize (bundled scripts)
python3 kcentroid.py cropped.png snapped.png --width 16 --height 24
python3 cleanup.py snapped.png clean.png --key "#FF00FF" --despill --binary-alpha --deorphan
python3 palette_map.py clean.png final.png --palette warm32.hex --hue-weight 2 --subset 2,3,8,9,24,25

# 6. optional outline (or do it in cleanup.py --outline "#2a1d2e")
# 7. gate
python3 sprite_lint.py final.png --size 16x24 --palette warm32.hex --max-colors 16
```

Alternative one-tool version of stages 3–5 (no OKLCh mapping, but battle-tested):

```bash
python3 -c "
import unfake
unfake.process_image_sync('cropped.png', max_colors=16,
    downscale_method='dominant', detect_method='edge',
    fixed_palette=['#7a3b4d','#8a2432', ...], transparent_background=True)"
```

([unfake.py API](https://github.com/painebenjamin/unfake.py); it matches in **RGB**, so keep the per-asset subset narrow if you use it for the final mapping.)

**Phaser side**: `pixelArt: true` in the game config (sets nearest-neighbor + `roundPixels`), zoom locked to 3, sprite positions on integers. Ship the 1:1 PNG and let the engine scale — "do all upscaling inside your game engine with nearest-neighbor" is the consistent advice ([Renoise guide](https://renoise.ai/guides/ai-pixel-art) ⚠️ commercial source, but this specific point is uncontroversial and matches [nerijs pixel-art-xl's](https://huggingface.co/nerijs/pixel-art-xl) integer-downscale rule).

**Chroma color choice**: pick the key per asset class — the key must be absent from the asset. Magenta `#FF00FF` for terrain/trees/props/characters (nothing in a warm storybook palette is magenta); green `#00FF00` only for assets with no foliage and no green. This halves despill work. (OpenAI's own skill defaults to green but makes it configurable — [imagegen SKILL.md](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md).)

---

## 3. Deliverable 2 — prompt templates (Research question A)

### What verifiably works, in one paragraph

Direct answer to A: **prompt the final chunky-pixel look at large size; never prompt painterly intending to downscale.** The "logical N×N sprite delivered large, each pixel a clean block" pattern is in production use — but always **with a grid-anchor reference image and a post-snap**, never trusted alone ([chongdashu template](https://raw.githubusercontent.com/chongdashu/ai-game-spritesheets/main/prompts/02-south-anchor.md); [SpriteCook](https://www.spritecook.ai/blog/tiny-pixel-art-animations)). No practitioner report exists of pure-text prompting yielding exactly grid-aligned output (⚠️ verified by absence across all sources; even trained pixel models produce "pixels [of] different sizes" — [Astropulse](https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale)). gpt-image models have **no negative-prompt field**; state exclusions declaratively — "no watermark", "no anti-aliasing" — per OpenAI's own prompting guide ([cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide)). Style keywords that pull the distribution the right way: `game sprite`, `16-bit`, `SNES-era`, `limited palette`, `chunky readable silhouette`, `crisp pixel edges`, `flat colors` ([Sprite-AI prompting guide](https://www.sprite-ai.art/blog/advanced-prompting-tips) ⚠️ vendor; [GPT-Image2 gallery prompt](https://github.com/wuyoscar/GPT-Image2-Skill/blob/main/skills/gpt-image/references/gallery-pixel-art.md); [chongdashu](https://raw.githubusercontent.com/chongdashu/ai-game-spritesheets/main/prompts/02-south-anchor.md)).

### Shared blocks (compose every template from these)

```
[STYLE]  flat 2D pixel-art game sprite, SNES-era, cozy storybook-fantasy register,
         warm limited palette (~{N} colors), chunky readable silhouette, crisp hard
         pixel edges, flat color planes, no anti-aliasing, 1px darker outline around
         the silhouette, consistent top-left light source
[SCALE]  the artwork is one logical {W}x{H}-pixel sprite delivered at {OUTPUT} so that
         each logical pixel reads as one large clean square block on a uniform grid
[BG]     the entire background is a single flat solid {#FF00FF} color with no scenery,
         shadows, gradients, vignette, borders, UI, text, logo, or watermark
[AVOID]  Avoid: photorealism, painterly blending, soft airbrushed shading, anti-aliased
         halos, gradients, glow effects, drop shadows, texture noise, extra objects
[ANCHOR] Image 1 is a pixel-grid anchor: use it only to enforce uniform pixel-block
         size and grid alignment. Do not copy its content.
```

Per-class palette hint: name 4–8 actual hex values from the relevant ramp in the prompt ("palette: #8a2432 crimson, #c14b3a brick, …"). The claim that gpt-image-2 follows an explicit palette "as a hard rule" comes from one commercial guide (⚠️ [Renoise](https://renoise.ai/guides/ai-pixel-art), unreproduced) — treat it as *bias, not guarantee*, and let Stage 5 enforce.

### Terrain tile (16×16) — logical 16×16 at 1024×1024 (64×)

1. **Single tile**: `[STYLE] + [SCALE 16x16 @ 1024] +` "one seamlessly tileable grass terrain tile for a top-down cozy fantasy game, soft meadow green with 2–3 subtle tuft clusters, must tile perfectly with itself on all four edges, palette: {greens/browns ramp hexes} `+ [BG] + [AVOID]`" — ⚠️ *seamlessness is not reliably honored by any general model; no source verified clean AI tiling. Always run the seam check (§8) and expect to hand-fix edge texels.*
2. **Variation sheet**: same, but "a 3×3 grid of nine variations of the same grass terrain tile, identical palette and density, separated by wide flat {#FF00FF} gutters" — then chroma-bbox-split. Grids of *items/tiles* hold up much better than character sheets ([one-shot 100-item grid report](https://x.com/ProperPrompter/status/2046534215311970694) ⚠️ X post, prompt not retrievable).
3. **Transition tile**: "a terrain transition tile, grass on the upper-left diagonal half flowing into dirt path on the lower-right, same grid, same palette, hard pixel boundary with 1-texel dithered transition band" (ordered-dither transition bands are the one sanctioned dither use at this scale — see §4.3).
4. **Anti-cram variant** (if output is busy): append "very low detail density: at most 4 distinct clusters, large flat areas of a single color".

### Character (16×24) — logical 16×24 at ~768×1152, or centered on 1024²

1. **South anchor** (the master — everything else derives from it): `[STYLE] + [SCALE 16x24] +` "a young herbalist villager, front-facing (south), standing idle, full body with head, torso, legs and feet fully inside frame, arms at sides, {2-3 sentence outfit/color description naming ramp hexes}" `+ [BG] + [AVOID] + [ANCHOR]`. (Pattern: [chongdashu's south-anchor](https://raw.githubusercontent.com/chongdashu/ai-game-spritesheets/main/prompts/02-south-anchor.md).)
2. **Direction variant via edit** (identity lock): attach the *snapped, cleaned* south sprite as Image 2 + grid anchor as Image 1: "Same character as Image 2. Redraw facing left (west profile). Preserve Image 2's identity, outfit, colors, and proportions exactly; change only the facing direction. Transfer nothing from Image 1 except pixel-block discipline." Identity-preservation phrasing per [OpenAI cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) and the [gpt-image-2 sprite-sheet thread](https://community.openai.com/t/developing-sprite-sheets-with-gpt-image-2/1379831).
3. **East = horizontal flip of west.** Don't generate it; `magick west.png -flop east.png`. Halves your consistency exposure ([chongdashu](https://github.com/chongdashu/ai-game-spritesheets)).
4. **North**: as (2), "back view (north), back of head and shoulders, no face visible".
5. **Recovery variant** (drift): "normalize this character to match Image 2 exactly in identity, palette and proportions, keeping the current pose" ([forum-tested phrasing](https://community.openai.com/t/developing-sprite-sheets-with-gpt-image-2/1379831)).

### Tree (20×28) and prop (12×28)

1. `[STYLE] + [SCALE 20x28] +` "a round-canopy apple tree, cozy storybook proportions: canopy occupies the top two-thirds as 3–4 large overlapping leaf-cluster blobs (no individual leaves), short sturdy trunk, palette: {green/brown ramp}" `+ [BG magenta] + [AVOID] + [ANCHOR]` — "no individual leaves / large cluster blobs" is the anti-speckle clause for foliage.
2. Prop: `[SCALE 12x28] +` "a wooden lamppost with a small warm glowing lantern; the glow is drawn as 2–3 concentric flat rings of lighter color, not a soft radial gradient" — flat-ring glow is how pixel art fakes emission without AA fighting your grid.
3. Variation: "same tree, autumn variant, identical silhouette and cluster structure, swap leaf ramp to {oranges}".

### Building (~48×50) — your worst case, and the class that most needs the SCALE block

Buildings fail because the model crams illustration-density detail into what must become ~2,400 texels. The fix is aggressive detail rationing in the prompt:

1. `[STYLE] + [SCALE 48x50 @ ~1024] +` "a small cozy cottage, front elevation, storybook fantasy: exactly one door, two windows, one chimney; thatched roof drawn as 4–6 large flat color bands with a single row of edge-highlight pixels; walls are large flat plaster planes with at most 6 half-timber beams; no brick-by-brick or shingle-by-shingle detail" `+ [BG] + [AVOID] + [ANCHOR]`.
2. **Two-pass detail control**: generate at logical 24×25 (half resolution, forces simplification), snap, then upscale 2× nearest and run one *edit* pass: "add sparse pixel-level detail: window frames, door hinge, 3–5 roof texture clusters; keep all shapes and palette identical."  ⚠️ *This two-pass trick is my synthesis (it mirrors the blockout→refine split practitioners describe — [gamineai](https://gamineai.com/blog/how-to-make-pixel-art-with-ai-for-games)); no direct source demonstrates it on buildings. Cheap to try, easy to drop.*
3. **Component assembly** (most control): generate roof / wall / door / window as separate chroma-keyed pieces, snap each, assemble in-editor on the texel grid. This is where experienced pipelines put hand-work for architecture (§7).

### Dialogue portrait (128×128) — logical 128×128 at 1024×1024 (8×)

The friendliest class: 8× scale is exactly the regime pixel-art LoRAs operate at ([nerijs: "downscale 8 times…"](https://huggingface.co/nerijs/pixel-art-xl)).

1. `[STYLE] + [SCALE 128x128 @ 1024] +` "bust portrait of {character}, three-quarter view facing slightly left, head and shoulders, warm parchment-toned flat background panel of a single solid color, expressive but simple face: eyes as 2–3 pixel clusters, single-pixel-line mouth, palette: {full 32}, cel-shaded in exactly 2 shade steps per material" `+ [AVOID]`.
2. **Expression variants via edit** from the master portrait: "change only the mouth and eyebrows to a {surprised} expression; every other pixel identical." (`input_fidelity` is fixed at high for gpt-image-2 — [docs](https://developers.openai.com/api/docs/guides/image-generation).)
3. Portraits are the one class where a whisper of ordered dithering on large color transitions is acceptable (§4.3) — at 128px you have room for it.

---

## 4. Deliverable 3 — the downscale + quantize recipe (Research questions B, D)

### 4.1 Downscale: k-centroid (or dominant-per-cell), not box, not Lanczos

**Why box fails you** (your failure #1): box/`-scale` averages every source pixel in the cell — on off-grid AI output, cells straddle texel boundaries, so adjacent output pixels get alternating blends: 1px speckle. Lanczos adds ringing on top. Every AI→pixel-art tool surveyed uses a **voting/clustering** downscaler that cannot emit a color absent from the cell: k-centroid ([Astropulse's pixeldetector](https://github.com/Astropulse/pixeldetector), MIT — algorithm: per output pixel, k-means the source tile with k=2, keep the most common centroid), `dominant` mode in [unfake](https://github.com/painebenjamin/unfake.py), majority-vote cells in [Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper), contrast-aware modes in [PixelOE](https://github.com/KohakuBlueleaf/PixelOE) (`pip install pixeloe`, Apache-2.0).

**Local verification** (§9): on synthetic faux input with per-texel checker detail, blur and noise, box recovered 97.4% of ground-truth pixels; k-centroid recovered **100%**. ⚠️ No rigorous *third-party* box-vs-k-centroid benchmark exists in the wild — only creator-produced comparisons ([itch page](https://astropulse.itch.io/k-centroid)) — which is why I tested it locally rather than citing one.

**Recipe**: `python3 kcentroid.py cropped.png out.png --width W --height H` (alpha-aware version bundled; k=2 default, raise `--centroids` to 3–4 for portrait-scale tiles with legitimate interior detail). Since your targets are known, **always give the exact size — never auto-detect when you don't have to.** Detection is a diagnostic (`--detect-only`), and honest failure is a feature: on heavily blurred input, detection *should* refuse rather than guess (mine returns "failed", upstream pixeldetector confidently returns nonsense — see §9).

**ImageMagick footnote** (exact semantics, per the [legacy resize docs](https://legacy.imagemagick.org/Usage/resize/)): `-scale` = box average; `-sample` = point sampling at cell midpoints (the right primitive *only after* grid+phase are already perfect); `-resize` = filtered resampling. None does dominant-color voting; that's why the Python step exists.

### 4.2 Quantize: OKLab/OKLCh nearest with hue weighting + per-asset subsets

**Why nearest-RGB betrays hue** (your failure #2): RGB has no hue axis, so Euclidean distance happily trades a hue flip for a lightness match — documented as the classic failure of plain RGB matching ("selects colours that are too dark or too blue" — [compuphase redmean](https://www.compuphase.com/cmetric.htm); same failure class in [Aseprite's indexed-matching bug](https://github.com/aseprite/aseprite/issues/1385)). OKLab was designed for hue uniformity (hue RMS error 0.49 vs CIELAB's 0.69 — [Ottosson](https://bottosson.github.io/posts/oklab/); independent review: [Levien](https://raphlinus.github.io/color/2021/01/18/oklab-critique.html)), and production quantizers have converged on it ([quantette](https://github.com/Ivordir/quantette), [zenquant](https://github.com/imazen/zenquant)). CIEDE2000, counter-intuitively, is *not* the answer for palette snapping — the canonical dithering writeup reports it misfires ("yellow scattered pixels" — [Yliluoma](https://bisqwit.iki.fi/story/howto/dither/jy/)).

**What my local testing added** (§9): plain OKLab fixes some flips but not all; uniform chroma up-weighting can't fix crimson→orange because *dark reds have compressed chroma in OKLab*. Two things worked:

1. **Explicit hue-angle term** (OKLCh decomposition, hue arc scaled by geometric-mean chroma, CIEDE2000-style): `--hue-weight 2` flipped moss→khaki back to moss→green in the A/B test. ⚠️ Hue-axis up-weighting for palette snapping has no published practitioner precedent — it's principled (per [Ottosson's constant-hue gamut-mapping rules](https://bottosson.github.io/posts/gamutclipping/)) and verified here on synthetic cases, but you are the field test.
2. **Per-asset palette subsets** — the only fix that survives the hard case where the palette has no lightness-appropriate swatch of the right hue. Restrict each asset to its material ramps and wrong-hue candidates simply don't exist.

**Recipe**: `python3 palette_map.py in.png out.png --palette warm32.hex --hue-weight 2 --subset <ramp indices>`.

**Tool caveats that justify the custom script**: ImageMagick's `-remap` always matches in **RGB** — "`-quantize` colorspace… is only used for the selection of colors, not its mapping" ([IM quantize docs](https://usage.imagemagick.org/quantize/); workaround via `-colorspace` round-trip: [maintainer discussion](https://github.com/ImageMagick/ImageMagick/discussions/6619)). Pillow's `Image.quantize(palette=…)` matches in RGB through a lossy **6-bit-per-channel cache** that can mis-map even exact palette colors ([Pillow #1852](https://github.com/python-pillow/Pillow/issues/1852), open for years ⚠️ status in 2025–26 releases unverified) and **dithers by default** — if you ever use it, pass `dither=Image.Dither.NONE`. pngquant/libimagequant cannot remap to a fixed user palette at all ([libimagequant docs](https://pngquant.org/lib/)).

**Order**: downscale first (cluster-aware), quantize second — the community-standard order ([Retro Diffusion's pipeline](https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale): clustering downscale "*followed by* advanced color quantization"; same order in [ComfyUI-PixelArt-Detector](https://github.com/dimtoneff/ComfyUI-PixelArt-Detector)). Quantize-then-downscale only makes sense if the downscale is pure nearest-neighbor on an already-perfect grid.

### 4.3 Dither: almost never

Professional consensus at your sizes: **don't.** "Some sprites are simply too small to dither… I would not recommend dithering for most character sprites, especially those that will need to be animated" ([Pixel Parmesan](https://pixelparmesan.com/blog/dithering-for-pixel-artists)); "be careful with small sprites (16×16 or less)… don't use on character outlines" ([Pixnote](https://pixnote.net/en/learn/dithering/)). If you dither anywhere, it's ordered/Bayer only (position-stable across animation frames — error diffusion "churns" between frames: [IM quantize docs](https://usage.imagemagick.org/quantize/), [Yliluoma](https://bisqwit.iki.fi/story/howto/dither/jy/), [GIMP docs on positioned dithering for animations](https://docs.gimp.org/2.10/en/gimp-image-convert-indexed.html)) and only on 128×128 portrait gradients or terrain transition bands. Free fixed-palette Bayer if wanted: [hitherdither](https://github.com/hbldh/hitherdither).

---

## 5. Grid rescue & cleanup (Research question C)

### Detecting and snapping faux pixel art

For salvaging existing faux-pixel assets (unknown texel size), three open tools, strongest first:

- **[pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer)** (MIT, Python+Rust, Retro Diffusion's own org — effectively Astropulse's production cleanup logic, open-sourced): three voting detectors (boundary autocorrelation with comb scoring, run-length soft-GCD, shift self-similarity), arbitrated by spectral/variance/"distillability" scoring, phase solving, variance-minimizing boundary placement. `python -m pixelfixer.cli input.png --extract out.png`.
- **[unfake.py](https://github.com/painebenjamin/unfake.py)** (`pip install unfake`, MIT): runs-GCD or Sobel-edge detection, grid snap via crop, dominant-color cells, fixed palettes, `--transparent-background` flood fill, `--alpha-threshold`, morphological + jaggy cleanup. The best CLI ergonomics of the three.
- **[Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper)** (MIT, Rust CLI + [free web tool](https://www.spritefusion.com/pixel-snapper)): edge-peak median spacing + per-line "walk cuts" that follow wobbly AI grids ([algorithm writeup](https://www.spritefusion.com/pixel-snapper/how-to-fix-ai-pixel-art)); `--pixel-size` manual override.

For your *forward* pipeline you rarely need detection — you know the target is 16×24 — so k-centroid at the known size is both simpler and more robust. Phase/offset handling: only Pixel Snapper (walk cuts) and unfake (snap-crop) handle grid phase at all; naive median-spacing detection ([pixeldetector](https://github.com/Astropulse/pixeldetector)) ignores it entirely, which is another reason known-size downscale wins.

### Cleanup at 1:1 (bundled `cleanup.py`, all steps verified locally)

Run *after* downscale, on the true-res sprite, so "1px" = one texel:

1. **Chroma key**: chromaticity-distance keying (robust to lightness variation in the flat bg).
2. **Despill**: edge texels still tinted key-ward get replaced by the majority color of their non-key neighbors — texel-appropriate, unlike broadcast-style spill suppression. (ImageMagick alternative for green: clamp G to max(R,B); [Fred Weinhaus's greenscreen script](http://www.fmwconcepts.com/imagemagick/greenscreen/index.php) exists but ⚠️ is **non-commercial-use-only** — avoid for a shipped game.)
3. **Binary alpha**: threshold at 128 → {0,255}. "No partial transparency" is part of Astropulse's definition of real pixel art ([interview](https://medium.com/curiouserinstitute/ai-art-profiles-cody-claus-retro-diffusion-8cb9f45e939a)). IM equivalent: `-channel A -threshold 50% +channel`.
4. **De-orphan**: recolor sub-2px islands to majority neighbor — the same operation as Astropulse's [Adopt Pixels](https://astropulse.itch.io/adopt-pixels) extension.
5. **1px outline** (optional): dilate alpha by one texel behind the sprite, fill with your dark outline color. IM recipe with `-morphology dilate` + `CopyOpacity`: [IM discussion #6367](https://github.com/ImageMagick/ImageMagick/discussions/6367). Aseprite CLI can also batch this via `app.command.Outline` in a `--script` ([CLI docs](https://www.aseprite.org/docs/cli/), [Outline API](https://www.aseprite.org/api/command/Outline)).

Orphan removal at texel level via IM, if you prefer no Python: `-connected-components` with `area-threshold` ([IM docs](https://imagemagick.org/script/connected-components.php)).

---

## 6. Deliverable 4 — animation workflow with realistic expectations (Research question E)

### The expectation reset, stated plainly

**No credible firsthand report exists of AI-generated multi-frame walk cycles shipped unedited.** Across the OpenAI forum, HN threads, and devlogs: frame-by-frame beats one-shot sheets for correctness but drifts identity; one-shot sheets hold identity better but repeat poses, swap left/right limbs, and misalign cells ([gpt-image-2 sprite-sheet thread](https://community.openai.com/t/developing-sprite-sheets-with-gpt-image-2/1379831)); 9-frame contact sheets work, 18 frames "good but face changes between sheets", 36 frames "completely lost its mind" ([GPT-4o keyframes test](https://dev.to/_senhorbento/generating-keyframes-with-chatgpt-4o-3ejn)); grid-described animations hit "85–90%" success for *simple subjects* but cells still need crop-margin rescue ([mikeesto's grid tests](https://mikeesto.com/posts/animating-gpt4o-image-grids/)); HN users on a dedicated sprite-animation product: "you will have to edit the result frame by frame… Still, a huge time boost" ([HN thread](https://news.ycombinator.com/item?id=44204181)). The most complete GPT-image sprite pipeline's own summary: **"Image gen ≈ 20% of the work. The other 80% is the pipeline"** ([chongdashu](https://github.com/chongdashu/ai-game-spritesheets)). Even Retro Diffusion's purpose-built animation model outputs 4-frame cycles with residual wobble and awkward north-facing frames ([Scenario docs](https://help.scenario.com/en/articles/retro-diffusion-models-the-essentials), [Sorceress review](https://sorceress.games/blog/ai-sprite-generator-pixel-walk-cycles-idles-and-vfx)).

### Drop 18 frames. The genre standard at your size is 4 per direction.

At 16×24 there aren't enough pixels for 18 distinguishable phases: "8 frames strikes a solid balance… anything beyond 8 is an aesthetic choice" for *large* sprites ([Slynyrd Pixelblog #50](https://www.slynyrd.com/blog/2024/5/24/pixelblog-50-human-walk-cycle)); for top-down RPG sprites specifically, **4-frame walk, 8-frame run, and only 3 unique directions — side view mirrored for left/right** ([Slynyrd Pixelblog #22](https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites)); the classic RPG cycle is 3 unique frames played step-idle-step-idle ([finalbossblues](http://finalbossblues.com/walk-cycles-p1/)); Stardew Valley NPCs: 16×32, 4 frames × 4 directions ([modding reference](https://lemurkat.wordpress.com/2020/10/09/npc-creation-sprites/)). **Your whole cast needs 12 unique drawn frames per character (4 × 3 directions), not 18 per direction.** This one decision does more for your consistency problem than any prompt engineering.

### The workflow (per character, ~30–60 min realistic)

1. **Master sprites** (§3 templates): south anchor → west via reference-edit → east via `-flop` → north via reference-edit. Snap + clean + quantize each (Stages 2–5). This is the AI-leveraged part.
2. **Walk frames — two options**:
   - **Hand-shift (recommended, fastest at this size)**: in [LibreSprite](https://github.com/LibreSprite/LibreSprite) (free, GPLv2) or Aseprite (source-available; compiling for personal use is sanctioned — [FAQ](https://www.aseprite.org/faq/), [EULA](https://github.com/aseprite/aseprite/blob/main/EULA.txt)), make frames 2 and 4 from the idle master: legs swapped 1–2px, torso bobbed 1px, arms counter-swung 1px. At 16×24 each frame differs from idle by maybe 20 pixels — this is minutes of work per direction and gives you *perfect* identity by construction.
   - **AI contact sheet then heavy rescue**: prompt a 4×1 sheet per direction ("four equal cells left to right: contact, down, pass, up-swing walk phases, same character…" + `[ANCHOR]` + wide flat gutters), extract frames by **chroma bounding box, never by fixed grid slicing** (cells drift — [chongdashu](https://github.com/chongdashu/ai-game-spritesheets)), snap each frame, then align on a common foot baseline with onion-skinning. Expect 2–3 regenerations per usable sheet ([forum reports](https://community.openai.com/t/developing-sprite-sheets-with-gpt-image-2/1379831)) and hand-editing regardless.
3. **Anti-flicker pass**: quantize all frames against the same palette subset, and lock static regions (pixels identical in ≥3 of 4 frames get copied from frame 1) to kill AI temporal jitter — the trick from a full pipeline writeup ([sarthakmishra](https://sarthakmishra.com/blog/building-animated-sprite-hero)). Scriptable in ~15 lines of numpy on top of the bundled tools.
4. **Juice in the engine**: Phaser tweens for bob/squash/lean cost zero frames and read as animation polish at cozy-game pacing ([Phaser tweens](https://docs.phaser.io/phaser/concepts/tweens); [phaser3-juice-plugin](https://github.com/RetroVX/phaser3-juice-plugin), MIT).

**Codex CLI mechanics**: input images are supported (`codex -i south.png "…"` / `--image a.png,b.png` — [CLI docs](https://developers.openai.com/codex/cli/features)), which is what makes the reference-edit workflow possible on subscription. ⚠️ Whether the built-in `image_gen` treats attachments as true pixel-level edit references (vs. loose style conditioning) is not officially documented — community results say conditioning is real but approximate; mask-based inpainting is API-only.

---

## 7. The hybrid boundary & dedicated models (Research question F)

**Where experienced pipelines draw the line**: model generates *identity, composition, palette suggestion* at high res; deterministic code does *grid, palette enforcement, alpha*; humans do *animation nuance, readability passes, tile seams, final polish*. Nobody credible claims a straight model→game path; Astropulse himself iterates generations "then refine[s] it by hand" ([podcast](https://whizpill.substack.com/p/whiz-pill-podcast-42-astro-pulse)); the gamineai guide formalizes it as palette-lock before generation + histogram/silhouette gates after ([guide](https://gamineai.com/blog/how-to-make-pixel-art-with-ai-for-games) ⚠️ single source for the specific gate list). ⚠️ No shipped-game postmortem quantifying "% hand-touched" was found anywhere.

**Retro Diffusion**: use as *technique reference*, not a purchase. Its production insight — model gets close, clustering downscale + quantization finishes — is fully replicated by the free MIT tools above (pixeldetector, K-Centroid, pixel-art-fixer, Adopt Pixels are all Astropulse/RD-org code). The $65 Aseprite extension runs statically offline (min 16 GB Apple-silicon RAM) but animation is cloud-credit-only ([itch page](https://astropulse.itch.io/retrodiffusion)); web app is ~1¢/image with 50 free signup credits (⚠️ exact tier pricing unverified, JS-rendered site).

**Zero-cost local generation on Apple silicon** (viable second engine, especially for tiles/props/variations without burning ChatGPT quota):

- **[Draw Things](https://apps.apple.com/us/app/draw-things-offline-ai-art/id6444050820)** (free Mac app, fully offline) + **[nerijs/pixel-art-xl](https://huggingface.co/nerijs/pixel-art-xl)** SDXL LoRA (OpenRAIL-M — commercial output use allowed): generate at 1024, integer 8× nearest downscale per the author, then your Stages 4–5.
- **[flow-pixl](https://github.com/flow-industries/pixl)** (`cargo install flow-pixl`, MIT/Apache-2.0, runs on Metal): SDXL-Turbo + pixel-art LoRA + built-in grid snap and Lab-space palette limiting in one command — the most turnkey free-local option found.
- Community read on quality: dedicated/local pixel models win on grid/palette *authenticity*, GPT-class models win on *prompt fidelity and semantics*; both need the same post-processing ([HN](https://news.ycombinator.com/item?id=44207304)). ⚠️ No formal head-to-head benchmark exists.

---

## 8. Research question G — the automatable quality gate

Bundled `sprite_lint.py` (JSON report, nonzero exit for CI) implements the checks that separate real pixel art from upscaled slop, sourced from practitioner doctrine and one academic paper:

| Check | Rule | Source |
|---|---|---|
| Exact size | == target W×H | trivial |
| Alpha hygiene | zero semi-transparent pixels | RD's "no partial transparency" definition ([interview](https://medium.com/curiouserinstitute/ai-art-profiles-cody-claus-retro-diffusion-8cb9f45e939a)) |
| Palette discipline | every opaque color ∈ fixed palette; count ≤ budget | palette-lock + histogram gate practice ([gamineai](https://gamineai.com/blog/how-to-make-pixel-art-with-ai-for-games)); trivial with `Image.getcolors()` / `identify -format %k` |
| Speckle / orphans | orphan rate ≤ 2% (4-connectivity, per exact color) | saint11: orphan pixel = "a lone pixel that doesn't touch any pixel cluster", avoid ([glossary](https://saint11.art/blog/glossary/), [tweet](https://x.com/saint11/status/861656625807056898)) |
| Cluster deliberateness | component-size histogram; heavy 1–2px tail = slop | cluster doctrine ([Slynyrd Pixelblog #5](https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics)) |
| Silhouette | single connected component; fill ratio sanity | silhouette-first sprite design ([the-pixel-artist](https://www.the-pixel-artist.com/articles/top-ten-things-new-pixel-artists-should-know)) |
| Grid uniformity | every k×k cell solid on integer-scaled exports; % damaged cells | the "Block Size Consistency / Reversibility" metrics formalized in [Applied Sciences 16(5):2314](https://www.mdpi.com/2076-3417/16/5/2314) |

Verified behavior (§9): the gate passes clean pipeline output and fails the faux 1024px input with 100% damaged cells. Thresholds worth tuning in production: orphan rate (2% default; deliberate single-pixel highlights are legitimate — whitelist eye glints), max parts (2+ for multi-part props). Two checks I recommend adding later, not bundled: tile seam test (blit 2×2 and diff interior vs edge rows — the "5×5 offset test" [gamineai] describes manually) and cross-frame identity drift (IoU of silhouette masks across walk frames — sketch in [§Q6 of the research notes](https://gamineai.com/blog/how-to-make-pixel-art-with-ai-for-games) ⚠️ my formalization).

---

## 9. What was verified locally during this research

Synthetic end-to-end test (`test_pipeline.py`, included): ground-truth 16×24 sprite with per-texel checker shading → simulated faux AI output (64× upscale, off-grid resample, blur, noise, chroma bg) → full pipeline:

- Texel detection (comb-scored autocorrelation — independently, the same approach pixel-art-fixer uses in production): **64×64 exact** on typical faux input; honest refusal (not a wrong guess) on pathologically blurred input. Upstream pixeldetector's naive method returned confidently wrong answers on both.
- Downscale accuracy vs ground truth: **box 97.4%, k-centroid 100%** — box's misses were exactly the checker-detail texels, i.e., your speckle failure reproduced and fixed.
- Chroma key + cleanup: 100% alpha-mask recovery, zero semi-transparent pixels.
- Hue identity: RGB and plain OKLab both mapped light moss → khaki; **OKLCh with hue-weight 2 mapped it to green**. Bright crimson vs a dark-red-only palette defeated *every* metric — fixed only by palette-subset restriction (and properly, by adding a mid-red to the palette). This nuance is not in any published source; treat §4.2's two-step recommendation as tested-but-novel.
- Lint: passes final sprites and integer-scaled exports; fails faux input (100% damaged cells).

Caveat: synthetic distortions approximate but don't equal real gpt-image-2 output; the first week of real generations should feed thresholds back into the lint.

## 10. Consolidated "could not verify" list

- Pure-text "each logical pixel is a 64×64 square" prompting yielding exactly grid-aligned output — no firsthand A/B anywhere; all production pipelines snap regardless. Assume it biases, never guarantees.
- Renoise's claim that gpt-image-2 holds hard pixel edges and strict palettes natively (commercial guide, unreproduced; contradicted in spirit by mixel reports).
- Whether Codex CLI's built-in `image_gen` passes attached images as true edit references vs loose conditioning (undocumented; community evidence says conditioning works approximately).
- Exact Retro Diffusion web pricing tiers and full ToS text (JS-rendered).
- Pillow palette-cache bug (#1852) status in current releases.
- Seamless-tile prompting reliability — no source demonstrates trustworthy AI tile seams; assume manual seam pass.
- The specific per-asset palette-subset automation and OKLCh hue-weighting as *named practitioner techniques* — both are principled extensions verified only by my local tests.
- r/aigamedev and most Reddit-native threads (unreachable in this environment; Reddit content arrived second-hand via interviews/aggregators).
- Aseprite CLI `--scale` downscale semantics; LibreSprite headless scripting parity.

## 11. Source index (primary ones)

Official/tool docs: [OpenAI image-gen guide](https://developers.openai.com/api/docs/guides/image-generation) · [OpenAI prompting cookbook](https://developers.openai.com/cookbook/examples/multimodal/image-gen-models-prompting-guide) · [Codex CLI features](https://developers.openai.com/codex/cli/features) · [Codex imagegen skill](https://github.com/openai/codex/blob/main/codex-rs/skills/src/assets/samples/imagegen/SKILL.md) · [IM resize semantics](https://legacy.imagemagick.org/Usage/resize/) · [IM quantize/-remap](https://usage.imagemagick.org/quantize/) · [Aseprite CLI](https://www.aseprite.org/docs/cli/)

Tools (all free/local): [unfake.py](https://github.com/painebenjamin/unfake.py) · [unfake.js](https://github.com/jenissimo/unfake.js) · [pixel-art-fixer](https://github.com/Retro-Diffusion/pixel-art-fixer) · [pixeldetector](https://github.com/Astropulse/pixeldetector) · [K-Centroid Aseprite](https://github.com/Astropulse/K-Centroid-Aseprite) · [Sprite Fusion Pixel Snapper](https://github.com/Hugo-Dz/spritefusion-pixel-snapper) · [PixelOE](https://github.com/KohakuBlueleaf/PixelOE) · [flow-pixl](https://github.com/flow-industries/pixl) · [hitherdither](https://github.com/hbldh/hitherdither) · [LibreSprite](https://github.com/LibreSprite/LibreSprite)

Practitioner/community: [chongdashu ai-game-spritesheets](https://github.com/chongdashu/ai-game-spritesheets) (+ [prompts](https://raw.githubusercontent.com/chongdashu/ai-game-spritesheets/main/prompts/02-south-anchor.md), [video](https://www.youtube.com/watch?v=nIAIxvNUrdU)) · [gpt-image-2 sprite-sheet forum thread](https://community.openai.com/t/developing-sprite-sheets-with-gpt-image-2/1379831) · [GPT-4o keyframe grids](https://dev.to/_senhorbento/generating-keyframes-with-chatgpt-4o-3ejn) · [mikeesto grid animations](https://mikeesto.com/posts/animating-gpt4o-image-grids/) · [Retro Diffusion interview (Runware)](https://runware.ai/blog/retro-diffusion-creating-authentic-pixel-art-with-ai-at-scale) · [Astropulse profile (Medium)](https://medium.com/curiouserinstitute/ai-art-profiles-cody-claus-retro-diffusion-8cb9f45e939a) · [HN: AI pixel art](https://news.ycombinator.com/item?id=44207304) · [HN: sprite animation](https://news.ycombinator.com/item?id=44204181)

Pixel-art doctrine: [Slynyrd #1 palettes](https://www.slynyrd.com/blog/2018/1/10/pixelblog-1-color-palettes) · [#5 clusters](https://www.slynyrd.com/blog/2018/5/16/pixelblog-5-back-to-basics) · [#22 top-down sprites](https://www.slynyrd.com/blog/2019/10/21/pixelblog-22-top-down-character-sprites) · [#50 walk cycle](https://www.slynyrd.com/blog/2024/5/24/pixelblog-50-human-walk-cycle) · [saint11 glossary](https://saint11.art/blog/glossary/) · [Pixel Parmesan on dithering](https://pixelparmesan.com/blog/dithering-for-pixel-artists) · [finalbossblues walk cycles](http://finalbossblues.com/walk-cycles-p1/)

Color science: [Ottosson OKLab](https://bottosson.github.io/posts/oklab/) · [Ottosson gamut clipping](https://bottosson.github.io/posts/gamutclipping/) · [Levien OKLab review](https://raphlinus.github.io/color/2021/01/18/oklab-critique.html) · [compuphase redmean](https://www.compuphase.com/cmetric.htm) · [Yliluoma dithering](https://bisqwit.iki.fi/story/howto/dither/jy/) · [Pillow #1852](https://github.com/python-pillow/Pillow/issues/1852)

Academic: [Kopf & Shamir content-adaptive downscaling](https://johanneskopf.de/publications/downscaling/index.html) · [Structure-aware pixel-art scaling, Appl. Sci. 16(5):2314](https://www.mdpi.com/2076-3417/16/5/2314) · [Sprite Sheet Diffusion](https://arxiv.org/html/2412.03685v2)
