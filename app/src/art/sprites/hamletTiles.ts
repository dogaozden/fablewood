// Hamlet ground tiles (16×16, no outline, seamless — style-contract §3/§5).
// Reviewed and PASSED iter 2 (all axes >=4): docs/art-reviews/hamlet-ground-tiles.md.
// Keys match hamlet/textures.ts (tile.grass/path/water), scale 1 (16px-native).
export const tileGrass: readonly string[] = [
  'mmmmmmmmmmmmmmmm',
  'mmmmmmggmmmmmmmm',
  'mmlmmmggmmmmmlmm',
  'mmlmmmmmmmffmmmm',
  'mmmmmmmmmmffmmmm',
  'mmmmmlmmmmmmmmmm',
  'mggmmlmmmmmmmglm',
  'mggmmmmmmlmmmmlm',
  'mmmmmmmmmlmmmmmm',
  'mmmmmmmmmmmmmmmm',
  'mmlmmmffmmmmmggm',
  'mmlmmmffmmmmmggm',
  'mmmmmmmmmlmmmmmm',
  'mgmmmmmmmlmmmmmm',
  'mgmmmlmmmmmmmmmm',
  'mmmmmmmmmmmmmmmm',
];

export const tilePath: readonly string[] = [
  'kkkkkkkkkkkkkkkk',
  'kttssssskttsssss',
  'ktssssssktssssss',
  'ksssssssksssssss',
  'ksssssssksssssss',
  'ksssssssksssssss',
  'ksssssssksssssss',
  'ksssssskkssssssk',
  'kkkkkkkkkkkkkkkk',
  'kttssssskttsssss',
  'ktssssssktssssss',
  'ksssssssksssssss',
  'ksssssssksssssss',
  'ksssssssksssssss',
  'ksssssssksssssss',
  'ksssssskkssssssk',
];

export const tileWater: readonly string[] = [
  'aaaaaaaaaaaaaaaa',
  'aawwaaaaaaaayyaa',
  'aaaaaaaawwaaaaaa',
  'aaayyaaaaaaaaaaa',
  'aaaaaaaaaawwaaaa',
  'awwaaaaaaaaaaaya',
  'aaaaaaaaaaaaaaaa',
  'aaaaaawwaaaaaaaa',
  'aayyaaaaaaaawwaa',
  'aaaaaaaaaaaaaaaa',
  'awwaaaaaaayyaaaa',
  'aaaaaaaawwaaaaaa',
  'aaaaayyaaaaaaaaa',
  'aaaaaaaaaawwaaaa',
  'awwaaaaaaaaaaaaa',
  'aaaaaaaaaaaaaaaa',
];
