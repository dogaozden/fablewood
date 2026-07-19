// Sprite registry: every code-drawn (Lane A) sprite the engine builds into a
// texture at boot. Add a sprite by (1) authoring + critiquing its grid via
// docs/art-reviews/_tools/render_sprite.py, archiving the PASS in docs/art-reviews/,
// then (2) dropping its grid file here and listing it below. Keys are kebab-case
// slugs (style-contract §7); scenes reference these keys.
import { keeperIdleDown } from './keeper';
import { tileGrass, tilePath, tileWater } from './hamletTiles';

export interface SpriteDef {
  /** texture key scenes use, e.g. this.add.image(x, y, 'char.keeper') */
  key: string;
  /** palette-indexed string grid; rows equal length, chars in PAL_CHAR or '.' */
  grid: readonly string[];
  /** native bake multiplier: 1 for 16px-native scenes (hamlet + camera zoom),
   *  3 for 48px-native scenes (combat, CELL=48). Default 1. */
  scale?: number;
}

export const SPRITES: readonly SpriteDef[] = [
  // Neutral key for now (does NOT claim combat's `char.keeper` until the char
  // footprint contract is pinned — see coordination note to orchestrator).
  { key: 'keeper-idle-down', grid: keeperIdleDown, scale: 1 },
  // Hamlet ground tiles — keys match hamlet/textures.ts; auto-upgrade the hamlet
  // once buildTextures(this) runs in BootScene. Hamlet-only keys, no combat clash.
  { key: 'tile.grass', grid: tileGrass, scale: 1 },
  { key: 'tile.path', grid: tilePath, scale: 1 },
  { key: 'tile.water', grid: tileWater, scale: 1 },
];

/** All texture keys buildTextures() produces — consumers may check textures.exists(key). */
export const TEXTURE_KEYS: readonly string[] = SPRITES.map((s) => s.key);
