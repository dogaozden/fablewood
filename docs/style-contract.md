# FABLEWOOD — Art Style Contract (v1, BINDING)

**Ground truth:** `docs/art/fablewood-mood-v1.png` (the mood canon). When words and canon disagree, the canon wins — go look at it.
**Scope:** every visible asset in the project passes this contract. No asset ships without a passing review file (§6).
**Owner of this file & `docs/art/palette.json`:** the art director. Both are the single source of truth; engine code imports the palette, never re-declares colors.

---

## 1. Register — what "cozy-whimsical high fantasy" means here

Fablewood is **warm light held inside a cool dusk**. The canon is a lantern-lit hamlet in a forest clearing at twilight: a violet-to-peach sky, huge gnarled trees arching into a protective frame, moss-roofed rounded cottages with amber cross-hatched windows, a cobbled path, a little stone bridge over a stream, fireflies and flowers. Every building has a soft belly and a friendly silhouette — no hard corners, no menace. Warmth is **emitted, not ambient**: pools of golden lantern glow punch out of a mauve-shadowed world, and that contrast *is* the mood. The feeling is **storybook safety on the edge of a big dark wood** — snug, hand-tended, a little magical. Whimsy shows as roundness, moss, glow, and small living details (a hanging sign, flower boxes, stacked barrels), never as gags or cartoon bounce. When danger comes (provinces beyond the hamlet), render it **moody, not grimdark**: deeper dusk, colder shadow, a wraith's silhouette — but keep the warm-light-in-cool-dark structure. If an asset feels cold, sharp, plastic, garish, or grim, it is wrong regardless of subject.

**One-line test:** *Would this sit comfortably inside the mood canon at dusk, lit by the same lanterns?* If not, revise.

---

## 2. Global palette (32 colors — see `docs/art/palette.json` for machine copy)

**Hard rule:** Lane-A (code-drawn pixel) assets use **ONLY** these 32 hex values. No off-palette color, no alpha blends that produce off-palette pixels (except deliberate anti-alias against transparent on Lane-B exports). Lane-B (painterly) assets are not pixel-quantized to this list, but must **read as this palette** — same hues, same warm-in-cool value structure.

`.` (period) = **transparent**, reserved by the engine, never a color.

| Ramp | Colors (light → dark) · `char` |
|---|---|
| **Glow** (golds/ambers — the emitted warmth) | glow-core `W` `#FFF1C6` · lantern-gold `G` `#F7CE6B` · amber `A` `#EEA23F` · ember `e` `#D2792C` · deep-ember `E` `#A65420` |
| **Green** (moss/foliage — the Fablewood signature) | leaf-highlight `l` `#A8C44E` · moss `m` `#7C9C46` · leaf-green `g` `#588234` · forest-green `f` `#37602A` · deep-forest `F` `#21401C` |
| **Brown** (bark/timber — structure & earth) | timber-light `t` `#B47E46` · timber `T` `#8C5C34` · bark `k` `#684628` · dark-bark `K` `#452F1C` · bark-shadow `b` `#2A1D13` |
| **Dusk** (sky/cool shadow — the ambient) | dusk-deep `D` `#34265A` · dusk-violet `v` `#6A4A8C` · dusk-mauve `u` `#9E5E96` · dusk-rose `r` `#CE7A8C` · dusk-peach `p` `#EEA67E` |
| **Water** (cool blues) | water-light `w` `#9EBAD4` · water-blue `a` `#4C6C96` · water-deep `y` `#29405E` |
| **Neutral** (stone/parchment) | parchment `c` `#EBD9B2` · path-stone `s` `#C6A476` · stone-grey `n` `#8A8078` |
| **Accent** (use sparingly, loudest last) | blossom-pink `i` `#E07AAE` · orchid `o` `#9A6EC8` · berry-red `R` `#C4443E` |
| **Dark** (outlines/shadow — never pure black) | outline-warm `x` `#241A14` · shadow-plum `z` `#1B1526` · void-black `X` `#100B0A` |

**Usage doctrine:** greens and browns are the *body* of the world; dusk tones are the *shadow and air*; glow is the *event* the eye lands on; accents are *spice* (a few pixels, never a field). Shadows lean cool (dusk/shadow-plum) even on warm objects — that warm-object/cool-shadow split is the whole look. The three dark tones are shared across all ramps for cohesion.

---

## 3. Lane A — code-drawn pixel art (precision in-engine assets)

For tiles, character sprites, walk cycles, props, UI icons — anywhere grid and palette discipline rule.

- **Grid:** base tile **16×16**. Characters **16×24** (1 tile wide, 1.5 tall). Rendered in-engine at **3× integer zoom** (→ 48×48 / 48×72 on screen). Never non-integer scale; never rotate a pixel sprite.
- **Outline:** **1px `outline-warm` (`#241A14`)** around every character, NPC, and free-standing prop — a warm near-black, **never** `void-black` and **never** pure `#000000`. **No outline on ground/floor tiles** (they must tile seamlessly edge-to-edge); interior detail uses *selective* outlining, not a full grid of lines.
- **Silhouette first:** design the black shape before any interior color — it must read at 1× what it is. Rounded, friendly, bottom-heavy forms (canon cottages). If the silhouette is ambiguous, no amount of shading saves it.
- **Light direction:** **warm top-left** (consistent with the canon's hanging lanterns). Highlights top-left, cool shadow bottom-right. Every sheet obeys the same key.
- **Shading:** 3 tones per material minimum (highlight / body / shadow) drawn from one ramp; borrow a neighbor ramp's dark tone for the deepest occlusion. Warm objects take **cool** shadows.
- **Dithering:** only for **large gradients** (skies, big walls, water) — a 50% checker between two adjacent ramp steps. Never dither small sprites or icons; never as texture-filler.
- **Animation minimums:** idle **2 frames** (subtle breathe/flicker); walk **4 frames per direction**, **4 directions** (down/up/left/right — left may be a horizontal flip of right). Lantern/fire/water get a 2–4 frame loop. Anim must not break the silhouette or the outline.

**Storage format (mandatory — zero binary sprite assets):**
Sprites are **palette-indexed string grids in TypeScript**: each character is one palette `char` (see table / `palette.json`), `.` = transparent. Rows are equal-length strings; the array's height/width equal the sprite's pixel dims. A shared `app/src/art/palette.ts` exports the hex table **and** the `char → name` map (both generated from / matching `palette.json`); a `compileSprite(grid)` helper rasterizes grid → texture at load. Result: every sprite is **diffable in git, hand-editable in a text editor, and impossible to take off-palette**.

```ts
// 16×24 lantern-keeper, facing down, idle frame 0 — illustrative
export const keeperIdle0 = [
  "......xxxx......",   // x = outline-warm, . = transparent
  ".....xTTTTx.....",   // T = timber (hood)
  "....xTtttTTx....",   // t = timber-light (lit top-left)
  "....xtccctx.....",   // c = parchment (face)
  // …24 rows total, each 16 chars, only palette chars + '.'
] as const;
```

---

## 4. Lane B — gpt-image-2 painterly (organic / high-detail assets)

For key art, backdrops, combat backdrops, NPC portraits, location vignettes — via the `gen-image` skill / `codex-image.md` (ChatGPT login, **no API key**). The canon is itself a Lane-B output: **detailed storybook illustration with a pixel-art soul** — that hybrid, not soft watercolor, is the target so Lane B sits harmoniously beside the crisp 16px sprites.

**Mandatory prompt template** (fill `{SUBJECT}` / `{FRAMING}`; keep the style + negative blocks verbatim; attach or name `fablewood-mood-v1.png` as the style reference every time):

> **{SUBJECT}, {FRAMING}.** Style: cozy-whimsical high-fantasy **storybook illustration with a pixel-art soul**, matching the attached reference. Warm lantern glow as the light source — pools of golden `#F7CE6B`/`#EEA23F` light punching out of a cool **dusk-violet-to-peach** twilight. Mossy rounded friendly silhouettes, gnarled framing trees, soft edges, gentle vignette. Muted-but-warm woodland palette: forest greens, bark browns, amber glow, dusk purples, parchment cream. Emitted warmth, cool shadows, storybook softness, hand-tended detail (lanterns, moss, flowers). Coherent readable value structure.
>
> **Negative (always):** no photorealism, no 3D render / plastic / CGI look, no harsh pure black `#000000` (shadows stay warm-dark or dusk-toned), no neon or oversaturated candy colors, no text / letters / watermark / signature / UI, no modern objects, no grimdark / gore / horror, no flat vector / corporate-clipart look, no lens flare or photographic bokeh.

**Post-processing recipe (required before engine use):**
1. **Downscale** to the scene's internal render resolution (Fablewood is a 16px-grid game; backdrops render *behind* the tile layer). Target the internal buffer — roughly **320–512 px wide** for the vertical slice; **never ship a raster > 2× the internal buffer** (kills the pixel register and the file size). Use nearest or area downscale, not smooth bicubic that muddies edges. Final buffer size is the engine's call; when unsure, ask before baking.
2. **Palette harmonize (optional but preferred for backdrops):** quantize toward the 32-color palette (or a per-scene 16-color subset) so painterly art and pixel sprites share pigment. Portraits/key art may keep full range if they read as the palette.
3. **Cutouts / transparency:** generate on a **pure `#00FF00`** field, then chroma-key to transparent with a tight tolerance and a 1px despill to kill green fringe. (gpt-image-2 transparency is unreliable — chroma-key is the path.)
4. Save the **pre-processed original** in the asset's review folder; ship only the processed PNG.

**Framing rules:** **Portraits** — bust/shoulders-up, subject centered, soft vignette darkening to the frame edge, eyes on the upper third. **Backdrops/combat backdrops** — value structure must keep the **center and lower third readable and mid-value** so HP bars, unit sprites, and UI overlays sit legibly on top; push detail and darks to the periphery (canon's tree-frame vignette does exactly this).

---

## 5. Per-asset-class specs

| Class | Lane | Pixel size | Frames | Must-haves |
|---|---|---|---|---|
| Ground / floor tile | A | 16×16 | 1 (2–4 if animated: water, flowers) | Seamless 4-edge tile; **no outline**; subtle internal variation, no busy noise |
| Wall / prop / object | A | 16×16 (multiples for big props) | 1–4 | 1px `outline-warm`; top-left key; readable at 1×; cool cast shadow if free-standing |
| Character walk sheet | A | 16×24 | idle ×2 + walk ×4 × **4 dirs** | 1px outline; stable silhouette across frames; top-left key; bottom-heavy friendly form |
| NPC portrait | B | ~128×128 (downscaled) | 1 (opt. 2-frame blink) | Bust framing; soft vignette; palette-reading; warm key light on face |
| Location vignette | B | ≤512 wide | 1 | Vignette frame; center readable; establishes place in one glance; canon-cohesive |
| Combat backdrop | B | internal-buffer wide | 1 | Mid-value playable center/lower third; darks to edges; no detail that fights unit sprites |
| UI frame / icon | A | 16×16 icons; 9-slice frames | 1 | On-palette; `parchment`/`timber` ground, `outline-warm` edge; legible at 1×; ≥3-value contrast |
| Title / key art | B | full res → downscale per use | 1 | The canon's equal; strongest statement of register; the emotional promise of the game |

---

## 6. The critique gate (render → screenshot → critique → revise)

**No asset — Lane A or B — ships on its first draft.** Every asset is rendered, screenshotted **at true game zoom** (Lane A at 3×; Lane B composited into a real scene/UI mock), scored on the six axes below, revised, and re-scored. This loop is the project's quality guarantee; the review file *is* the evidence.

**Six axes, scored 1–5 each:**
1. **Palette compliance** — Lane A: *only* the 32 colors, correct outline tone. Lane B: reads as the palette, no off-register hues, no pure black.
2. **Silhouette readability** — reads as what it is at 1× / true zoom, from shape alone.
3. **Register fit** — cozy-whimsical high fantasy: warm, rounded, storybook; not cold/sharp/plastic/grim/gaggy.
4. **Value contrast at game zoom** — legible in motion at 3×; warm-light-in-cool-dark structure intact; UI-overlay areas stay readable.
5. **Cohesion with the mood canon** — sits comfortably inside `fablewood-mood-v1.png`; same light, same pigment, same soul.
6. **Craft** — Lane A: clean pixels, no stray/off-grid pixels, no accidental anti-alias, smooth loops. Lane B: clean brushwork, clean chroma-key edges, no artifacts.

**PASS gate (all three required):**
- **Every axis ≥ 4**, and
- **≥ 2 critique iterations** recorded (draft + at least one revision — a first draft never ships), and
- Every axis scored **with the screenshot in view** and a written, *specific* reason (no bare numbers).

Any axis < 4 → revise and re-score. An asset may only be called "done" when a review file shows a final iteration meeting the gate.

**Archive format — one file per asset at `docs/art-reviews/<asset-slug>.md`.** Copy-paste template:

```markdown
# Art Review — <asset-slug>

- **Class:** <ground tile | portrait | …>   **Lane:** <A | B>
- **Ships to:** <app/src/art/… | app/public/art/… | packs/<id>/assets/…>
- **Spec:** <size · frames · special reqs from §5>
- **Status:** IN REVIEW | PASSED (iter N)

## Iteration 1 — DRAFT
- **Screenshot:** <path/to/iter1.png>  (at true game zoom)
- **Scores:** palette _/5 · silhouette _/5 · register _/5 · value _/5 · cohesion _/5 · craft _/5
- **Critique:** <specific, per-axis where < 4 — what's wrong and why>
- **Changing:** <the concrete edits for next iter>

## Iteration 2 — REVISION
- **Screenshot:** <path/to/iter2.png>
- **Scores:** palette _/5 · silhouette _/5 · register _/5 · value _/5 · cohesion _/5 · craft _/5
- **Critique:** <what improved, what remains>
- **Changing:** <edits, or "none — PASS">

## Verdict
PASS at iteration N — all axes ≥ 4. Final asset: <path>. (Lane B: original pre-process at <path>.)
```

---

## 7. File & naming conventions

- **Engine-owned art** (hamlet, generic UI, generic effects — anything domain-neutral):
  - Lane-A sprite data (TS string-grids): `app/src/art/`
  - Lane-B / rasterized PNGs: `app/public/art/`
  - Shared palette + charmap module: `app/src/art/palette.ts` (matches `docs/art/palette.json`)
- **Pack-owned art** (province-specific NPCs, backdrops, vignettes): `packs/<pack-id>/assets/`
- **Reviews:** `docs/art-reviews/<asset-slug>.md`. **Style source of truth:** this file + `docs/art/palette.json` + the mood canon.
- **Naming:** kebab-case slugs, describe subject then variant then state: `cottage-moss-roof`, `keeper-walk-down`, `merchant-princess-portrait`, `preference-vaults-backdrop`, `ui-frame-parchment`. Walk frames: `<slug>-<dir>-<n>`. No spaces, no caps, no version noise in shipped names (versions live in git).

---

## 8. Engine integration — texture keys, native sizes, scale (binding for sprite producers)

Two render conventions coexist and are reconciled here: **hamlet is 16px-native with a 3× camera zoom; combat is 48px-native (`CELL=48`, 3× baked in, no zoom).** Both display a 16px grid at 3× on screen. **Rule: author every sprite once at 16px-native; `app/src/art/buildTextures.ts` bakes it at `scale` per consuming scene — `scale:1` for hamlet keys, `scale:3` for combat keys** (nearest-neighbor).

**Auto-upgrade path:** each scene's placeholder generator (combat `ensureTextures`, hamlet `ensurePlaceholders`) SKIPS any key that already exists. `buildTextures(this)` runs in `BootScene.create()` before scenes and registers real art under the SAME key → real art wins, zero scene edits. Producing an asset = author grid → gate it (§6) → add to `app/src/art/sprites/index.ts` with `{key, grid, scale}`.

**Hamlet keys** (scale 1; bottom-origin unless noted):

| key | native px | lane | notes |
|---|---|---|---|
| `tile.grass` `tile.path` `tile.water` | 16×16 | A tile | no outline, seamless |
| `prop.tree` | 20×28 | A | |
| `prop.cottage` | 48×50 | A | big prop |
| `prop.tavern` | 48×54 | A | acorn sign |
| `prop.records-office` | 48×50 | A | cool palette |
| `prop.south-gate` | 48×52 | A | road into the dark |
| `prop.wellspring` | 46×38 | A | **centred** origin |
| `prop.lantern-post` | 12×28 | A | |
| `char.keeper` `char.mira` `char.clerk` `char.berry` `char.alder` | 16×24 | A char | scale 1 EVERYWHERE (D2); bottom-centre origin; walk anims `char.<who>.walk.<down\|up\|left\|right>` (+ `.idle`) |
| `fx.glow` 64×64 · `fx.spark` 8×8 | — | glow fx | painterly/code ok |

**Combat keys** (scale 3 = 16-src ×3):

| key | native px | lane | notes |
|---|---|---|---|
| `char.keeper` `char.mira` (SAME 16×24 textures as hamlet) | 16×24 | A char | scale 1; combat DISPLAY-scales via `CELL/frame.width`, origin bottom-centre (D2) |
| `enemy.wisp` `enemy.construct` (16×16) · `enemy.wraith` (16×24) · `enemy.warden` (24×32, boss) | 16-native | A | scale 3 bake; threats taller/colder; warden overhangs the cell |
| `tile.vault-floor` `tile.vault-wall` `tile.gold-heap` `tile.lantern` | 48×48 | A tile | |
| `icon.strike` `icon.weave` `icon.sequence` `icon.cast` `icon.parley` `icon.wait` | 36×36 | A UI | 36px — off the 16-grid; the UI-icon exception |

**D2 RESOLVED (orchestrator, 2026-07-19):** every character/companion/NPC is ONE 16×24-native texture (`scale: 1`) used EVERYWHERE. The hamlet consumes it natively (16px grid + 3× camera zoom); combat DISPLAY-scales each unit by `CELL / frame.width` with origin bottom-centre `(0.5, 1)` so bodies overhang the cell (standard tactics look) — this handles any native height, so 16-native chars and 48-native (`scale: 3`) enemies both render correctly. No shared-key size conflict remains.

---

*Contract v1 — derived from `fablewood-mood-v1.png`, 2026-07-19 (§8 integration contract added same day). Reopen only by the art director with a new mood canon.*
