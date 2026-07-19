// Sprite registry: every code-drawn (Lane A) sprite the engine builds into a
// texture (+ animations) at boot. Add a sprite by (1) authoring + critiquing its
// grid(s) via docs/art-reviews/_tools/render_sprite.py, archiving the PASS in
// docs/art-reviews/, then (2) listing it below. Keys per style-contract §8.
// Fan-out agents deliver per-set modules (set-enemies.ts, set-combat.ts,
// set-hamlet-props.ts, set-characters.ts) exporting SpriteDef[]; the art director
// imports + spreads them here — this index stays single-writer (no parallel edits).
import { keeperIdleDown } from './keeper';
import { tileGrass, tilePath, tileWater } from './hamletTiles';

export interface SpriteAnim {
  /** global animation key, e.g. 'char.keeper.walk.down' */
  name: string;
  /** inclusive frame index range into `frames` */
  from: number;
  to: number;
  frameRate: number;
  /** -1 = loop forever */
  repeat: number;
}

export interface SpriteDef {
  /** texture key scenes use, e.g. this.add.image(x, y, 'char.keeper') */
  key: string;
  /** one or more palette-indexed string grids (rows equal length, chars in
   *  PAL_CHAR or '.'); all frames must share dimensions. frames[0] is the base. */
  frames: readonly (readonly string[])[];
  /** native bake multiplier: 1 for 16px-native (hamlet + camera zoom), 3 for
   *  48px-native (combat CELL=48). Characters stay scale 1 (combat scales ×3 at
   *  render, bottom-center origin — orchestrator D2). Default 1. */
  scale?: number;
  /** animations over `frames` (multi-frame sprites only). */
  anims?: readonly SpriteAnim[];
}

export const SPRITES: readonly SpriteDef[] = [
  // The Keeper (player). Reviewed: docs/art-reviews/keeper-idle-down.md. char.keeper
  // is 16×24 everywhere (D2); combat display-scales ×3 with bottom-center origin.
  // TODO(art-director): expand to full idle×2 + walk×4×4-dir sheet + anims.
  { key: 'char.keeper', frames: [keeperIdleDown], scale: 1 },
  // Hamlet ground tiles — keys match hamlet/textures.ts; auto-upgrade the hamlet
  // floor once buildTextures(this) runs in BootScene. Hamlet-only, no combat clash.
  { key: 'tile.grass', frames: [tileGrass], scale: 1 },
  { key: 'tile.path', frames: [tilePath], scale: 1 },
  { key: 'tile.water', frames: [tileWater], scale: 1 },
];

/** All base texture keys buildTextures() produces — consumers may check textures.exists(key). */
export const TEXTURE_KEYS: readonly string[] = SPRITES.map((s) => s.key);
