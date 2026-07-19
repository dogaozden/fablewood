// Fablewood art module (engine-owned). Palette generated from docs/art/palette.json;
// sprites are palette-indexed string grids gated through docs/art-reviews/.
// BootScene: call `buildTextures(this)` in create(); then reference texture keys
// from TEXTURE_KEYS in any scene.
export { PAL, PAL_CHAR, PAL_HEX, hex } from './palette';
export type { PaletteName } from './palette';
export { buildTextures } from './buildTextures';
export { SPRITES, TEXTURE_KEYS } from './sprites';
export type { SpriteDef } from './sprites';
