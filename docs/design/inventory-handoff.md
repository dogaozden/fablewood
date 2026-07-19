# Inventory System — Design Handoff (execute-ready)

> Provenance: authored by the loot-keeper agent (Opus 4.8, retired under the Fable-only policy) at the end of full codebase recon, 2026-07-19 night, delivered post-quota-wall. This is the binding execution spec for the Fable that implements task #26 (inventory / gold / potions, D&D rarity schema — the author's directive). File:line refs are against master `7c726cc`; re-verify anchors against HEAD before editing. Isolation rules (worktree, never port 5173 / state/ / .state-e2e/) apply in full.

All file:line refs are against master HEAD 7c726cc. The recon worktree `.../scratchpad/inventory-wt` (branch `inventory`) is clean/zero-edits — the Fable can reuse it or make its own; `git worktree remove` it if unused. ISOLATION (absolute): never touch port 5173 / state/ / .state-e2e/ / main tree; own server on 5178+ with STATE_DIR=<scratch> JUDGE_MODE=stub; Playwright 5175 is shared.

## 1. ITEM SCHEMA (types → inventory/catalog.ts)
```ts
type Rarity = 'common'|'uncommon'|'rare'|'very_rare'|'legendary';
type ItemType = 'consumable'|'tool'|'trinket'|'relic';
// consumable=field-usable heal; tool=trial-only encounter aid (deferred); trinket=sellable loot; relic=quest keepsake, unsellable
type ItemEffect =
  | {kind:'heal'; amount:number}        // amount HP; use 999 for "full"
  | {kind:'reveal_option'} | {kind:'retry_cast'} | {kind:'streak_shield'}  // trial (deferred)
  | {kind:'none'};
interface ItemDef { id:string; name:string; rarity:Rarity; type:ItemType; effect:ItemEffect;
  flavor:string; value:number; icon:string; use:'field'|'trial'|null; sellable:boolean; }
```
`use` derives from effect (heal→field; reveal/retry/shield→trial; none→null) but keep it explicit for the UI. IDs are kebab-case + STATE-REFERENCED → never rename/renumber a shipped id (project hard rule: state/ precious).

## 2. RARITY → COLOR (preserves D&D semantics, 100% Fablewood palette, zero neon)
| Rarity | Palette name | hex | char | why |
|---|---|---|---|---|
| common | stone-grey | #8a8078 | n | plain/unremarkable |
| uncommon | moss | #7c9c46 | m | D&D-green → THE signature Fablewood green |
| rare | water-blue | #4c6c96 | a | D&D-blue → palette cool blue |
| very_rare | orchid | #9a6ec8 | o | D&D-purple → palette's explicit "arcane/potion" purple, not neon |
| legendary | lantern-gold | #f7ce6b | G | D&D-orange → Fablewood treasure gold |

Use for rarity chip + item-name text + icon accent. berry-red #c4443e is "loudest, use least" → reserve for HP/danger, NOT a rarity. Chip = mirror `.box0..box5` pill in shell.css:303-320 (min-width 2.9rem, border-radius 999px, 1px dark border), recolored. Text-on-chip: dark ink on light tiers, parchment on dark tiers — verify contrast by eye.

## 3. STARTING CATALOG (12 items; every rarity+type covered)
CONSUMABLES (use:field, sellable:false):
- `embermend-draught` Embermend Draught · common · heal+6 · value 20 · "A warm cordial that knits small hurts by the fire's memory."
- `lanternoil-tonic` Lantern-Oil Tonic · uncommon · heal+12 · value 45 · "Bottled hearthlight — drink deep and the ache recedes."
- `wardancers-restorative` Wardancer's Restorative · rare · heal 999(full) · value 90 · "Full vigor, distilled from a Warden's mercy."

TOOLS (use:trial=DEFERRED, sellable:false):
- `scriveners-hint` Scrivener's Hint · common · reveal_option · value 25 · "A margin-note that strikes one false answer from the page."
- `second-wind-seal` Second Wind Seal · uncommon · retry_cast · value 50 · "Break the wax and try the cast again."
- `ward-of-focus` Ward of Focus · rare · streak_shield · value 85 · "Holds your streak unbroken through one stumble."

TRINKETS (use:null, sellable:true, effect none):
- `faded-coin-cache` Faded Coin-Cache · common · value 15 · "A knot of tarnished coppers from a forgotten till." (makes DungeonScene.ts:345 'Faded Coin' real)
- `mossbound-locket` Mossbound Locket · uncommon · value 40
- `clerks-silver-nib` Clerk's Silver Nib · rare · value 95
- `amber-writ-seal` Amber Writ-Seal · very_rare · value 200
- `gilded-ledger-bead` Gilded Ledger-Bead · legendary · value 500 (rare drop)

RELIC (use:null, sellable:false):
- `warden-signet-of-terms` Warden Signet of Terms · legendary · value 0 · "The Vault-Warden's own seal. Proof you argued the Terms and won." (= the existing boss reward, now real)

## 4. GOLD ECONOMY (numbers + reasoning)
Consts (economy.ts): `STARTING_GOLD=20` (friendly starter purse: buy one cheap draught pre-run — "Mira spots you a few coins"), `SELL_RATE=0.5`.

SOURCES: room-clear `roomGold=12+roomIndex*6+rng(0..6)` (~12-18 first room), +35% trinket loot roll → at DungeonScene.resolveCombat normal-clear branch DungeonScene.ts:340-347 (replace the hollow "You pocket a Faded Coin" toast). Boss: `BOSS_BOUNTY=60+rng(0..40)` + guaranteed `warden-signet-of-terms` + guaranteed boss-weighted trinket → DungeonScene.bossVictory DungeonScene.ts:384-391. Combat gold-heap tiles = DEFERRED spec (combat/**). Selling trinkets = the other source.

SINKS: Mira's shop buys consumables+tools at `value`. Trinkets' only purpose = sell at floor(value*0.5).

WIPE RULE ("lose the LOOT ROLL, never story progress", Fable_SPEC.md:31): gold+loot are granted AT clear and banked immediately to inventory.json; a wipe just means you never reached that clear → no roll. Cleared-room rewards already banked; dungeon progress persisted pre-combat (handoff.md:10). So the spec becomes literally true with NO escrow machinery — don't overbuild it.

PURE LOOT FNS (economy.ts, take an rng → testable): `RARITY_WEIGHTS={c55,u28,r12,vr4,leg1}`, `BOSS_RARITY_WEIGHTS={c10,u30,r35,vr20,leg5}`; `rollRarity(rng,weights)`, `roomClearLoot(i,rng)`, `bossLoot(rng)`. Pick trinket = filter CATALOG by type+rarity, fall down a tier if empty. Wallet: `canAfford/spend/earn` clamp ≥0, never negative. Grep for an existing mulberry32/seed PRNG first (combat/encounters use `seed:number`) and reuse; else add a 5-line local one.

## 5. STORE (inventory.json) — clone srs/store.ts (READ it, 213 lines)
`ObjectStore<T>` (store.ts:142-200) is NOT exported → go bespoke `InventoryStore`. Persist `{version:1, gold:number, stacks:Record<itemId,qty>}`, default `{version:1, gold:STARTING_GOLD, stacks:{}}`.

MUST replicate: ready() memoization `(this.loadPromise ??= this.load())` (store.ts:157); load() null→defaults / wrong-shape→backup-to-`corruptName(file,Date.now())`-then-defaults (copy the module-private helper store.ts:42-44) / good→`{...defaults,...raw,stacks:{...raw.stacks}}`; serialized merge-write on `writeChain` re-reading remote (store.ts:180-193) so unknown keys + 2-tab survive; warnOnce on putState=false.

Bridge: `import {getState,putState} from '../bridge/client'; const realBridge={getState,putState};` + `import type {Bridge} from '../srs/store'` (Bridge IS exported store.ts:19; realBridge is private). Constructor `(private bridge:Bridge=realBridge)`.

TRAP — DEEP-MERGE stacks: a shallow `{...base,...patch}` CLOBBERS the stacks sub-object when you patch gold only. addGold/grant/remove must compute the full next {gold,stacks} from freshest remote then putState the whole object (like SrsStore.record merges one level into facts, store.ts:119).

STATE_DIR: fully handled by bridge/plugin.ts:16-20 behind the /api/state/<name> fetch boundary — browser store never sees env. Just use filename 'inventory.json'; it auto-lands in .state-e2e/ under Playwright and your scratch dir on the manual server.

TESTS (store.test.ts, colocated sibling): copy FakeBridge from srs/store.test.ts:10-41 (Map<string,string>, offline/readDelayMs/writeDelayMs). Cover: default STARTING_GOLD; merge preserves foreign key (seed extra key, addGold, assert survives); corrupt backup (seed non-object, assert `inventory.corrupt-*.json` in b.keys()); ready() race (2nd ready during slow load sees persisted, not defaults). describe-by-guarantee; vi.restoreAllMocks in afterEach.

## 6. CONTRACTS + REGISTER
contracts.ts additive (GRANTED exception; keep purely additive, own `// ---- inventory ----` section, one Services field, nothing else):
```ts
export interface InventorySnapshot { gold:number; stacks:Record<string,number>; }
export interface UseResult { ok:boolean; message:string; }
export interface InventoryApi {
  ready():Promise<void>; getGold():number; snapshot():InventorySnapshot;
  addGold(d:number):Promise<number>; spendGold(cost:number):Promise<boolean>;
  grantItem(id:string,qty?:number):Promise<void>; removeItem(id:string,qty?:number):Promise<boolean>;
  countOf(id:string):number; useItem(id:string):Promise<UseResult>;
}
// + Services.inventory: InventoryApi
```
Keep Rarity/ItemDef/CATALOG in inventory/catalog.ts (all detail-consumers are your own UI) — only InventoryApi/InventorySnapshot/UseResult go in contracts (most minimal diff). SaveApi/SettingsApi (contracts.ts:128-149) are the shape models.

register.ts (new, mirror srs/register.ts exactly): `const store=new InventoryStore()`, then `services.inventory={ready,getGold,snapshot,addGold,spendGold,grantItem,removeItem,countOf,useItem}` as a module side-effect.

useItem heal (consume.ts) — replicate DungeonScene.applyHp math directly (reader 1: don't call the private method): `const cur=services.save.get().hp??16; const next=Math.max(0,Math.min(16,cur+amount)); if(next===cur) return {ok:false,message:'Already at full vigor.'}; await services.save.save({hp:next}); await store.remove(id,1); return {ok:true,message:\`Restored ${next-cur} vigor.\`};` Trial effects → `{ok:false,message:'Only usable in a trial.'}`.

TRAP — max HP=16 hardcoded 3× (store.ts:30, DungeonScene.ts:39 PARTY_MAX_HP, CombatScene.ts:198), no exported const. Hardcode 16 to match; do NOT invent a shared const in an orchestrator file.

ENTRY POINT — scenes/index.ts (ORCHESTRATOR-OWNED, FLAG): add one line `import '../../inventory/register';` beside `import '../../srs/register';` (line 8). Only place the side-effect install runs live. If orchestrator refuses, fall back to importing register from HamletScene.ts (yours). Add `services.inventory.ready()` into the existing Promise.all in HamletScene.ts:305 and DungeonScene (both yours) so the wallet warms where consumed (no BootScene edit).

## 7. UI (self-contained DOM panes → inventory/ui/) — DO NOT import encounters/**
encounters overlay internals (buildOverlay/el/ensureStyles) aren't exported and the module is forbidden. Replicate the tiny bits: copy `el()` shape from encounters/dom.ts:4-21 → ui/dom.ts; `ensureStyles()` injects `.inv-*` CSS ONCE mirroring encounters/styles.ts look — panel bg `linear-gradient(158deg, rgba(255,241,198,.6), rgba(237,222,186,1) 26%, rgba(235,217,178,1) 70%, rgba(214,184,140,.6))`, border 1.5px rgba(70,47,26,~.5), radius 20px, layered box-shadow `0 0 0 3px rgba(70,47,26,.30), 0 26px 64px -14px rgba(16,11,10,.78)` + inset highlights, serif `Georgia,'Iowan Old Style',serif`, ink #241a14; backdrop radial dusk gradient + blur(3px); z-index 9999. Own `--inv-*` vars (don't collide with .fw-*).

Open/close: append to document.body, return Promise resolving on close; ADD click-outside (e.target===root) + ESC close (browsing is non-punitive — encounters deliberately omits these).

CRITICAL Phaser bleed: DOM overlay over the canvas lets WASD/E leak. encounters uses depth-counted quietGameKeyboard (overlay.ts:33-40) you can't import — so the CALLER wraps every open: `this.input.keyboard!.enabled=false; await openX(...); this.input.keyboard!.enabled=true; this.input.keyboard!.resetKeys();`.

Inventory pane: header "Satchel" + gold "⟡ N"; scrollable owned-stack rows [icon <img data-url> | rarity-colored name | rarity chip | qty | flavor | "Use" btn]. Use enabled only for use:field (draughts); greyed title="Used in trials" for tools; absent for trinkets/relic. Use→useItem(id), re-render, show UseResult.message banner. Empty: "Your satchel is empty. Clear the Vaults to earn coin and loot."

Shop pane (Mira): header "Mira's Ledger — Wares & Trade" + gold. BUY section = 6 stock (3 draughts+3 tools): [icon|name(rarity)|effect|price|"Buy"(disabled if !canAfford)] → spendGold then grantItem. SELL section = owned trinkets: [icon|name|"Sell ⟡floor(value*.5)"] → removeItem then addGold. Transaction feedback = .fw-verdict-style banner (green ok / berry fail).

## 8. ITEM ICONS (16×16 palette-indexed → inventory/icons.ts) + ART GATE
Render (DOM, no Phaser): copy frameCanvas from buildTextures.ts:66-100 into icons.ts, `import {PAL_CHAR} from '../art/palette'` (char→int, palette.ts:47-80); `renderIconDataUrl(grid,scale=4)`→canvas.toDataURL 16→64px, imageSmoothingEnabled=false. `ICONS:Record<string,string[16]>`.

Conventions (style-contract §3/§5): 16×16, palette chars only, `.`=transparent, 1px `x`(outline-warm) silhouette, warm-light-top-left/cool-shadow-bottom-right, ≥3 values, legible at 1×; rarity char as a secondary accent (object legibility first).

GATE (mandatory, style-contract §6): render→screenshot→critique, ALL 6 axes ≥4, ≥2 iterations (first draft never ships), archive docs/art-reviews/item-icons-v1.md. Harness: `python3 docs/art-reviews/_tools/render_sprite.py <spec.json> <out.png>`, spec `{"name":"item.<slug>","scale":6,"grid":[16 rows]}` → contact sheet (1×@3×, 6×dusk, 6×checker) + auto palette-check (off-palette→magenta, exit 2). Open PNG with Read = the screenshot. 6 axes verbatim: Palette compliance, Silhouette readability, Register fit, Value contrast at game zoom, Cohesion with mood canon, Craft. Template: docs/art-reviews/hamlet-props.md.

Families (12 icons): 3 draughts=bottle silhouettes in rarity tints; 3 tools=margin-note/wax-seal/focus-ward; 5 trinkets=coin-knot/locket/silver-nib/writ-seal/ledger-bead; 1 relic=signet ring. Prioritize the 6 shop-visible consumables (they're in key screenshots). This loop is Fable-level creative work — critique with your own eyes.

TRAP — 12-vs-16px: style-contract §5 says 16×16 UI icons but shipped combat HUD icons are 12×12/scale-3 (set-combat.ts "§8 exception"). Chosen: 16×16 (matches the brief's "16px sprites"). Note it, don't silently pick.

## 9. HAMLET SHOP WIRING (Mira the Factor)
BIGGEST TRAP: Mira has NO hamlet presence — she's only a combat companion (combat/units.ts:60). Hamlet = 5 locations (cottage/tavern/records/gate/wellspring) in worldmap.ts BUILDINGS; NPCs (berry/clerk/alder) are decorative sprites HamletScene.buildNpcs HamletScene.ts:186-212; interaction fires on proximity+facing to a worldmap LocationSpec.door (HamletScene.ts:457-473), NOT on the sprite.

Steps:
1) worldmap.ts (PARTIALLY tree-art-owned — SURGICAL, FLAG at merge): APPEND one `LocationId` union member `'factor'` + one BUILDINGS entry (door at an open tile, center, label "Mira the Factor", prompt "Browse wares"). Append at end of union + end of array (separate region from the tree loop ~152-168) so it merges clean. 2-3 lines. No new prop art (set-hamlet-props.ts fully tree-art-owned) — Mira = her existing `char.mira` sprite (art/sprites/index.ts:69) placed via buildNpcs; the "door" is just her interaction zone.
2) HamletScene.ts: buildNpcs +`{key:'char.mira',x,y}`; setupInput +`this.keyI=kb.addKey(KC.I)`; update +`JustDown(keyI)`→open inventory (guard !locked like the E-check HamletScene.ts:464); enter()/conversationFor() +'factor'→doFactor(); doFactor() mirrors doGate HamletScene.ts:565-571 (`if(choice==='shop'){disable input; await openShop(); enable+resetKeys;}`); +inventory.ready() in the :305 Promise.all.
3) content.ts: `factorConv():Conversation` — speaker "Mira the Factor", 1-2 pages, choices `[{label:'Browse wares',value:'shop'},{label:'Never mind',value:'__cancel__'}]` (mirror alderConv content.ts:75-78). Conversation type {speaker?,pages[],choices?}.

POTION USE OUTSIDE COMBAT (playable immediately): (a) hamlet inventory "Use" btn; (b) vaults CAMP node — VaultView.showCampCard (VaultView.ts:436-455) currently button-less/click-to-dismiss; add an "Open Satchel" btn via the private `button(x,y,text,color,onClick)` helper (VaultView.ts:503-514, pattern in showResumeChoice:458-476) through a new NodeHandlers field → DungeonScene opens the inventory pane. Both dungeon/ files are in-scope (only combat/** + encounters/** forbidden).

## 10. DEFERRED COMBAT SATCHEL HOOK SPEC (combat-feel owns combat/** — DO NOT implement)
ACTION ENTRY: add 'satchel' to CombatScene ACTIONS (hotkey 'Q'; event handler CombatScene.ts:805-812) → opens a list of usable items from services.inventory.snapshot().

EFFECTS: heal → write services.save.save({hp:clamped}) then re-run pool→unit split (applyPoolHp CombatScene.ts:192-204), then removeItem. reveal_option / retry_cast / streak_shield touch the ENCOUNTER SURFACE (encounters/** forbidden) → implement via a handshake `services.inventory.consumePendingAid(kind):boolean` the encounter checks on open (avoids editing EncounterRequest).

HARD WALL (teeth-but-fair): reveal_option greys ONE wrong MCQ option but player still picks + SRS records the real pick; retry_cast affects the COMBAT outcome only, SRS grade stays honest (record first-attempt quality, or cap at 0.5 — never fake quality=1); streak_shield protects the streak METER (a game resource, not mastery) — fine. Spell this out to whoever wires combat.

## 11. FILE MAP
NEW app/src/inventory/: catalog.ts, economy.ts, store.ts, consume.ts, register.ts, icons.ts, ui/{dom.ts,styles.ts,inventoryPane.ts,shopPane.ts}, economy.test.ts, store.test.ts.

EDITS (worktree): contracts.ts (additive, exception—flag) · game/scenes/index.ts (+1 import line, orchestrator—flag) · scenes/hamlet/HamletScene.ts · scenes/hamlet/content.ts · scenes/hamlet/worldmap.ts (surgical, tree-art-adjacent—flag) · scenes/dungeon/DungeonScene.ts · scenes/dungeon/VaultView.ts.

## 12. VERIFY BAR
npm run build green; npx vitest run green (real economy+store tests). Persistence proof: earn/seed gold → buy draught → reload → still owned + gold correct (Playwright 5175 shared—retry or manual server). Manual: worktree server port 5178+, STATE_DIR=<scratch>, JUDGE_MODE=stub, kill after; seed scratch inventory.json + save.json{hp:6} to demo a heal. Screenshots (eyes + iterate): inventory pane, Mira's shop, potion-use hp-rise, + icon contact sheets.

## 13. TRAPS DIGEST
1 Mira absent from hamlet (needs worldmap.ts location). 2 worldmap.ts undifferentiated + tree-art-adjacent → additive only. 3 ObjectStore<T> not exported → bespoke. 4 maxHP=16 hardcoded 3×, no const → match 16. 5 contracts.ts + scenes/index.ts orchestrator-owned (contracts exception granted; index needs flagged 1-liner). 6 encounters overlay internals unexported + forbidden → replicate. 7 Phaser input bleeds → quiet keyboard caller-side per pane. 8 12-vs-16px icon conflict → chose 16. 9 deep-merge stacks or you clobber them. 10 item ids state-referenced → never rename. 11 combat gold-heap tiles pure terrain → deferred spec only.
