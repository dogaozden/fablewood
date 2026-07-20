# Ledger-Realms voice audit v1 — 251 strings reviewed, 55 flagged

**Date:** 2026-07-20 · **Worker:** register-audit Sonnet (+3 sub-Sonnets, identical calibration bar) ·
**Calibration sources:** style-contract §1, Fable_SPEC §§1-3, hamlet/content.ts, Dashboard.tsx,
inventory/catalog.ts, magic-combat-depth.md §7 blurb pattern. Read-only audit; nothing was edited.

## Orchestrator disposition (2026-07-20, AFK window)

| Tier | Disposition |
|---|---|
| **T1 — objective bugs** (Moss/Gift headers; raw verdict/tier readout; DungeonScene raw error toast; judge/client AWAY_LINE gap; `box ${n}` fallbacks vs the file's own BOX_LABELS) | Fix-wave Sonnet, post-merge-batch (hud/CombatScene strings live in queued phase branches — fixing master first would manufacture conflicts) |
| **T2 — established-term consistency** (bare Streak→Hearth ×6; gold→coin ×4; HP→vigor; battle→trial; facts/records→fables; the 'Continue' button vs sibling '… ▸' verbs) | Same fix-wave — enforcing terms the author already shipped and loves, not new voice |
| **T3 — creative renames** (tabs 'The Ledger'/'Realms'/'The Study'; Hushed/Singing mute; ms→'grains'; 'Victory!'→'The foe falls, Keeper.'; blurb rewrites; worldmap prompt polish) | **PARKED — the author's decision menu.** New voice is the director's call, not a provisional one |

Also noted: `fixtures.ts` Moss Lore content legitimately reaches players only in the zero-pack demo state
(register.ts:75 fallback) — acceptable, revisit if a packless first-run ever ships.

---

## THE 5 WORST OFFENDERS (worker's ranking)

1. **`encounters/kinds.ts:381-382` — hardcoded match column headers `'Moss'`/`'Gift'` [CRITICAL].**
   Real vc-law Binding Weave encounters render under dev-fixture headers (engine/content-split breach).
   Fix: domain-neutral `'Claim'` / `'True Name'`.
2. **`shell/Settings.tsx:102-104` — raw dev readout** `"verdict: pass · tier: native"`. Fix: render the
   already-computed in-voice `lastGrade.line` ("The Ledger is satisfied.") — zero new copy.
3. **Bare "Streak" vs established "hearth streak" — 6 sites, 4 files** (hud.ts ×2, CombatScene.ts,
   VaultView.ts ×2, shopPane.ts). The most-repeated inconsistency in the audit.
4. **`CombatScene.ts:1143`** victory toast `'The vault opens — Victory!'` — hype register AND steals
   VaultView's true-finale banner phrase. Fix: `'The foe falls, Keeper.'` *(T3 — new copy, the author's call)*
5. **`kinds.ts` shared `'Continue'` button** — highest-frequency string in the combat loop; every sibling
   uses directional verb + ▸. Fix: `'Onward ▸'`.

## Full findings by file

### kinds.ts (encounters)
- L381-382 CRITICAL Moss/Gift headers (above). Shared 'Continue' HIGH (above).
- Cleared: verdictBanner lines, 'The Ledger records', 'You cast', Clerk-deliberates copy, seal buttons, dom.ts hints.
- Systemic note (design look, not a break): overlay quality banner + damage.ts combat banner narrate the same
  event twice in different words (e.g. 'The weave holds.' then 'Full — the weave binds all.').

### Settings.tsx (shell)
- L102-104 CRITICAL raw verdict/tier (above). L106-111 HIGH "grade/session/latency" → 'No verdict yet — …
  the Clerk's swiftness will appear here.' L67 HIGH title 'Settings' → 'The Study' *(T3)*. L98-101 MOD
  "340ms" → "340 grains" *(T3)*. L71/95 LOW eyebrow glyphs. L87-90 MOD mute vocabulary → Hushed/Singing
  *(T3, moves with App.tsx)*.

### CombatScene.ts
- L1143 HIGH victory toast *(T3)*. L1144 MOD bare "Streak" *(T2)*. L494 MOD 'no target in range' →
  'no foe within reach'. Cleared: turn/lantern/satchel/Warden/Fade/defeat banners, float texts.

### hud.ts
- L202 HIGH 'Mira: ATK +1 (mastery)' → 'Mira: fighting fiercer (mastery)'. L203 MOD bare Streak → Hearth.
- Cleared: Clerk line, THE RETINUE, HP ratios, lantern grace.

### App.tsx
- L53 HIGH 'Dashboard' → 'The Ledger' *(T3)*; MOD 'Game' → 'Realms' *(T3, lower confidence)*; HIGH
  '⚙ Settings' *(T3, with pane)*. L63 MOD '♪ on/off' third mute vocabulary *(T3)*. Cleared: aria-labels
  (correctly plain).

### Library.tsx
- L38 HIGH raw `box ${N}` → index Dashboard's BOX_LABELS *(T1)*. L135 MOD 'facts' vs own 'fable' 13 lines
  up *(T2)*. L110 MOD 'No packs installed' vs 'No province has been settled' *(T2)*. L32-34/46/49 LOW-MOD
  'due now'/'in Nh'/'unseen' → 'ready to cast'/spelled durations/'uncast' *(T2/T3 mix)*.

### VaultView.ts
- L194/583 MOD bare Streak ×2 *(T2)*. L434 MOD 'faded record(s)' → fables *(T2)*. L437 LOW 'Close' →
  'Withdraw ▸' *(T3)*. L455 LOW '→' arrow → "to". Cleared: Camp copy, THE VAULT OPENS (correct here).

### DungeonScene.ts
- L178-180 HIGH raw spec-error toast (filenames + pack id shown to player) → 'The archive holds no charted
  map for "${packId}" — its vaults remain unmarked.' *(T1)*. L373-374/425-426 MOD bare "gold" ×4 → coin
  *(T2)*. L399 LOW unlabeled '(-1)'.

### combat/types.ts (action blurbs)
- L74 HIGH 'Cross AoE. (match the pairs)' → 'A cross of binding light. (match the pairs)'. L82/86 LOW
  lower-confidence idiom notes (Cast/Parley) — possibly intentional per-Art characterization *(T3)*.

### damage.ts
- L81/92 MOD the two Partial banners drop into tactical shorthand while Full/Miss are poetic → 'Partial —
  only the nearest thread binds.' / 'Partial — the lance falls short.' *(T3 — banner copy)*. Otherwise the
  best-written combat file.

### shopPane.ts
- L17 HIGH 'Restores N HP' → vigor *(T2)*. L19/21/23 MOD '(trial)' tags folded into sentences; one bare
  streak *(T2)*.

### combatSatchelPane.ts
- L32 HIGH 'Cancel' → 'Never Mind' (Mira's decline phrasing) *(T2/T3 border — sibling panes use Close ✕)*.
  L37 MOD 'mid-battle' → 'in this trial' *(T2)*. Cleared: register/ledger wordplay line (keep!).

### inventoryPane.ts
- L48 LOW 'Trial-use' → 'Trial-bound' *(T3)*. Rest exemplary.

### worldmap.ts
- L87 MOD 'rest & save' → 'rest & record' *(T2/T3)*. L88 LOW 'talk to' → 'call on' *(T3)*. L178 MOD
  'Browse wares' → 'weigh the wares' *(T3)*.

### specResolve.ts / roomFlow.ts
- specResolve L65/67 LOW latent '+N XP' (mechanic that doesn't exist — only fires on pack-supplied xp).
  roomFlow L39 LOW near-unreachable RangeError surface.

### Dashboard.tsx (calibration source)
- L310 HIGH raw `box ${w.box}` fallback contradicting its own L34 BOX_LABELS — same bug as Library, fix
  both via one shared labeling helper *(T1)*.

## Cross-cutting terminology table
- Streak → **hearth streak** (6 bare sites) · box N → **BOX_LABELS names** (2 files) · gold → **coin** (4) ·
  HP → **vigor** · facts/records → **fables** · battle → **trial** · mute states → ONE vocabulary ·
  'the vault opens' reserved for the finale · judge tiers have no in-fiction names (only surfaces in
  Settings; T1 fix hides the enum).

## Non-voice correctness catch (route to fix-wave, not copy work)
`judge/client.ts` web/HTTP fallback never assigns AWAY_LINE on failure (native.ts does) — a browser player
can receive a normal-looking verdict while the judge was unreachable. Verify against crucible findings and
fix with a test.
