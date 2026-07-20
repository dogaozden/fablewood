---
name: gen-pixel-sprite
description: Generate TRUE game-ready pixel-art sprites (tiles, props, buildings, characters) at exact logical sizes via gpt-image-2 + the sprites/ pipeline. Use for in-engine pixel assets; use gen-image (codex-image.md) for painterly key art and portraits.
---

# Pixel-art sprites via Codex CLI + the sprites/ pipeline

Deep reference: `sprites/pixel-art-pipeline-report.md` (binding — §3 prompt templates,
§2 pipeline). This skill is the operational recipe, field-tested 2026-07-20 on the
Gilded Acorn tavern: a template-driven raw beat the old painterly-downscale decisively.

## Preflight

1. `codex --version` && `codex login status` — ChatGPT login, NO API keys ever.
2. `python3 -c "import PIL, numpy, scipy"` — the sprites/ scripts need all three.
3. The toolchain lives at `sprites/` (kcentroid, palette_map, cleanup, sprite_lint)
   with the canonical palette `sprites/fablewood32.hex` (ramp indices in its header).

## Compose the prompt (the quality lever — this is where sprites are won)

Build from the report's §3 blocks, in this order:

- **SUBJECT** — name the asset and enumerate features with EXACT counts ("exactly one
  arched door… exactly four windows… no other objects"). The model honors counts;
  vagueness buys clutter.
- **STYLE** — "flat 2D pixel-art game sprite, SNES-era, cozy storybook-fantasy register,
  warm limited palette, chunky readable silhouette, crisp hard pixel edges, flat color
  planes, no anti-aliasing, 1px darker outline #241A14, consistent warm top-left light."
- **SCALE** — "one logical {W}x{H}-pixel sprite delivered large (~1024 on the long edge,
  {portrait/landscape} orientation) so each logical pixel reads as one large clean
  square block on a uniform grid."
- **DETAIL RATIONING** — the load-bearing block. Hard limits with REAL palette hexes
  from fablewood32 ("roof as 4–6 flat bands in #7C9C46/#37602A… at most 6 half-timber
  beams in #452F1C… no shingle-by-shingle detail"). Pick the ramp deliberately: the
  tavern run drifted light-and-cheery because it named the mid-timber ramp — for the
  moody register, name dark-bark/bark-shadow (#452F1C/#2A1D13) as the wall family.
- **CAMERA** — state the projection explicitly or the model picks its own: world props in
  this game read from a **high-angle top-down three-quarter view** (the shipped fountain);
  "front elevation" is correct only for building facades. A perspective mismatch
  disqualifies an otherwise-good sprite (2026-07-20 fountain field test: both candidates
  came out side-view and lost on that alone).
- **Detail rationing scales with size.** The hard-limits block is for LARGE dense
  subjects (48px buildings — where it won decisively). For small organic props
  (20×28 trees, 12×28 lanterns) keep 3–4 texture/cluster zones and moderate limits —
  over-rationed small props flatten into generic mobile-game shapes and LOSE to
  well-downscaled painterly versions (2026-07-20 plaza field test: shipped Lane-B
  tree/lantern beat all template regenerations).
- **BG** — "single flat solid {KEY} background, no scenery/shadows/gradients/text."
  KEY = magenta `#FF00FF` when the subject contains ANY green or foliage; green
  `#00FF00` only for green-free subjects.
- **AVOID** — photorealism, painterly blending, gradients, glow/bloom, drop shadows,
  texture noise, extra objects.
- End with: save path + "Do not ask clarifying questions; make reasonable choices."

## Invoke (traps included)

```bash
codex exec -C "$WORKDIR" -s workspace-write --skip-git-repo-check \
  "Use your image generation skill (gpt-image-2) to generate a game sprite. <PROMPT>. \
   Save the final PNG to ./raw/<slug>.png."
```

- **NEVER pass `-i`** — on codex ≥0.144 it means "prompt from stdin" and silently eats
  your prompt arg. There is NO reference-image attachment on the exec path — skip grid
  anchors; the SCALE + RATIONING blocks carry the discipline alone (verified: they do).
- Name gpt-image-2 explicitly or Codex falls back to a weaker default.
- ~1 min per image; set timeout ≥5 min. Verify the PNG exists AND look at it.
- **Point `-C` at a FRESH, EMPTY directory** containing nothing but what the run needs —
  with workspace-write the codex agent may "helpfully" modify sibling files (observed:
  it grid-snapped neighboring raws unasked). Its images ALWAYS land in
  `~/.codex/generated_images/<uuid>/` first; the workspace file is a copy its agent
  makes, so if a run dies mid-flight, salvage from there.
- **Run codex calls sequentially in the foreground.** Parallel `codex exec` children die
  with their parent shell/turn — a backgrounded agent firing three in parallel lost one
  generation and its own report (2026-07-20).
- **Quota: image turns burn the ChatGPT plan 3–5× faster than text. Max 3 attempts
  per asset; retry only structural failures (wrong subject, scenery bg, painterly
  mush), never taste — taste iterations happen in the next generation batch.**

## Pipeline (the PROVEN recipe — order matters)

```bash
python3 sprites/cleanup.py raw.png keyed.png --key "#FF00FF"      # key ONLY at this stage
python3 -c "from PIL import Image; im=Image.open('keyed.png'); im.crop(im.getbbox()).save('cropped.png')"
python3 sprites/kcentroid.py cropped.png native.png --width W --height H
python3 sprites/palette_map.py native.png mapped.png --palette sprites/fablewood32.hex --hue-weight 2
python3 sprites/cleanup.py mapped.png final.png --binary-alpha
python3 sprites/sprite_lint.py final.png --size WxH --palette sprites/fablewood32.hex --max-parts 2
```

- **DO NOT use `--despill` or `--deorphan` before palette mapping** — deorphan's
  exact-color island test pre-quantize marks nearly every texel an orphan and crushes
  the sprite dark (mean brightness −40%; ledger 2026-07-20). Reorder-after-quantize
  fix is pending in the research session's court.
- `--max-parts 2` for buildings with detached elements (chimney smoke, hanging signs).
- Lint with the CALIBRATED per-lane gates (docs/art-reviews/lint-calibration-v1.md):
  quantized buildings `--max-orphan-rate 0.12 --max-parts 4`; quantized world-props
  `--max-orphan-rate 0.10 --max-parts 2`; raw-painterly/tiles/fx get size-check only
  (palette/orphan gating is meaningless off the quantized lane). The director's eye
  still overrules lint — it triages, it doesn't verdict.

## Judge (the gate is law)

Build a @6x nearest-neighbor side-by-side vs the shipped/reference asset, critique
against `docs/style-contract.md` (register, palette, silhouette, legibility at game
scale), and archive the loop per `docs/art-reviews/` conventions before anything ships.
First drafts never ship. The engine renders crisp (`pixelArt: true`) — judge against
the crisp baseline, and ship the 1:1 PNG (the engine does all scaling).
