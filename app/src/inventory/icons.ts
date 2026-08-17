/**
 * Item icons (inventory-handoff §8): 16×16 palette-indexed string grids rendered
 * to data URLs for the DOM inventory/shop panes. No Phaser here — the satchel and
 * Mira's shop are pure DOM overlays (§7), so icons render straight to <img> via
 * canvas, the same frameCanvas approach as art/buildTextures.ts but data-URL'd
 * instead of registered as a Phaser texture.
 *
 * Gate-reviewed (all six axes ≥4, 2 iterations): docs/art-reviews/item-icons-v1.md (first 14
 * icons — draughts/tools/trinkets/relic families) and docs/art-reviews/item-icons-relics.md
 * (Wave 9 Ch. IX: 4 new relics + 2 new wares, plus the Warden Signet re-scored on the
 * parchment pane per the in-engine value law).
 * Grid sources + contact sheets: docs/art-reviews/item-icons-v1/*.json + *-iter{1,2}.png and
 * docs/art-reviews/item-icons-relics/*.json + *-iter{1,2}.png (+ in-engine pane screenshots).
 */
import { PAL_CHAR } from '../art/palette';

// ---- grids (16×16, palette chars only, '.' = transparent) ----------------

const embermendDraught = [
  '................',
  '......xxxx......',
  '.....xtttTx.....',
  '.....xtTTKx.....',
  '......xcAx......',
  '......xnnx......',
  '.....xxcAxx.....',
  '....xcWAAAex....',
  '...xcWAAAAeex...',
  '...xcAAAAAeex...',
  '...xAAAAAeeEx...',
  '...xAAAAeeeEx...',
  '....xAeeeeEx....',
  '.....xxEExx.....',
  '......xxxx......',
  '................',
] as const;

const lanternoilTonic = [
  '................',
  '.......xx.......',
  '......xttx......',
  '......xTKx......',
  '......xcGx......',
  '......xAGx......',
  '......xcGx......',
  '.....xxcGxx.....',
  '....xcWWGGAx....',
  '....xcWWGGAx....',
  '....xcWGGGAx....',
  '....xGWGGGAx....',
  '....xGGGGAex....',
  '.....xGAAex.....',
  '......xxxx......',
  '................',
] as const;

const wardancersRestorative = [
  '................',
  '......xxxx......',
  '.....xtttTx.....',
  '......xccx......',
  '......xwax......',
  '.....xGGGGx.....',
  '....xxwwaaxx....',
  '...xwwaaWaayx...',
  '...xwaaWWWayx...',
  '...xwaaaWaayx...',
  '...xwaaaaaayx...',
  '....xaaaayyx....',
  '.....xxayxx.....',
  '......xxxx......',
  '................',
  '................',
] as const;

const wickTallow = [
  '................',
  '................',
  '.......e........',
  '......eEe.......',
  '.....xEEEx......',
  '....xTTTTTx.....',
  '....xTKKKTx.....',
  '....xTKccKTx....',
  '....xTKccKTx....',
  '....xTKKKKTx....',
  '....xTTTTTTx....',
  '.....xTTTTx.....',
  '......xxxx......',
  '................',
  '................',
  '................',
] as const;

const lanternBrand = [
  '................',
  '.......xx.......',
  '......xGGx......',
  '.....xGWWGx.....',
  '.....xAWWAx.....',
  '......xAAx......',
  '.......TTx......',
  '.......TKx......',
  '......xTKx......',
  '......xTKx......',
  '......xTKx......',
  '.....xxTKxx.....',
  '.....xTTTTx.....',
  '......xxxx......',
  '................',
  '................',
] as const;

const scrivenersHint = [
  '................',
  '..xxxxxxxxxxx...',
  '..xWWccccccsx...',
  '..xWkkckkccsx...',
  '..xccccccccsx...',
  '..xckkkckkcsx...',
  '..xccccccecsx...',
  '..xkkkceeccsx...',
  '..xcceeccccsx...',
  '..xceccccccsx...',
  '..xccccccccsx...',
  '..xsssssssssx...',
  '..xxxxxxxxxxx...',
  '................',
  '................',
  '................',
] as const;

const secondWindSeal = [
  '................',
  '................',
  '......xxxxx.....',
  '....xWWeeEx.....',
  '...xWWeeeeEx....',
  '...xWexxeeEx....',
  '...xeexxeEEx....',
  '...xeeeeEEEx....',
  '....xeEEEEx.....',
  '.....xxxxx......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
] as const;

const wardOfFocus = [
  '......xxx.......',
  '......xGx.......',
  '.....xxxxx......',
  '....xwwaayx.....',
  '...xwwaaaayx....',
  '...xwaaGGaayx...',
  '...xwaGWWGayx...',
  '...xwaaGGaayx...',
  '...xwaaaaaayx...',
  '....xaaaayyx....',
  '.....xayyx......',
  '......xxxx......',
  '................',
  '................',
  '................',
  '................',
] as const;

const fadedCoinCache = [
  '................',
  '......xxx.......',
  '.....xtktx......',
  '......xkx.......',
  '.....xxtxx......',
  '....xttTTkx.....',
  '...xtttTTTkx....',
  '...xttTTTKkx....',
  '...xtTTTKKkx....',
  '...xtTTKKKkx....',
  '....xTxxxxKx....',
  '...xAAGGAAeex...',
  '...xGAGAGAeex...',
  '....xeeeeeex....',
  '.....xxxxxx.....',
  '................',
] as const;

const mossboundLocket = [
  '...s.......s....',
  '....s.....s.....',
  '.....s...s......',
  '......xsx.......',
  '.....xxnxx......',
  '....xmlnnsx.....',
  '...xmmlnnnsx....',
  '...xgmnKnnsx....',
  '...xgmnKnnsx....',
  '...xgnnKnnsx....',
  '....xgnKnsx.....',
  '.....xgssx......',
  '......xGx.......',
  '................',
  '................',
  '................',
] as const;

const clerksSilverNib = [
  '................',
  '................',
  '.....xxxxxx.....',
  '....xWwwwnnx....',
  '....xwwwwnnx....',
  '....xwwyynax....',
  '....xwwyynax....',
  '.....xwyynx.....',
  '.....xwyynx.....',
  '......xyyx......',
  '......xynx......',
  '.......xx.......',
  '................',
  '................',
  '................',
  '................',
] as const;

const amberWritSeal = [
  '................',
  '...........o....',
  '...o.xxxxx......',
  '....xWWAAex.....',
  '...xWWAAAAex....',
  '...xWAKkAAex....',
  '...xAAkKAeex....',
  '...xAAAAeeEx....',
  '....xAeeeEx.....',
  '.....xxxxx......',
  '................',
  '................',
  '................',
  '................',
  '................',
  '................',
] as const;

const gildedLedgerBead = [
  '.......kk.......',
  '....W..kk.......',
  '.....xxkkxx.....',
  '....xWWGGAx.....',
  '...xWWGGGGAx....',
  '...xWGGGGAAx....',
  '...xGGGGAAex....',
  '...xGGAAAeex....',
  '....xGAAeeEx....',
  '.....xxkkxx.....',
  '.......kk.......',
  '.......kk.......',
  '................',
  '................',
  '................',
  '................',
] as const;

const wardenSignetOfTerms = [
  '................',
  '....xxxxxxx.....',
  '...xGKKKKKGx....',
  '...xGKGGGKGx....',
  '...xGKKGKKGx....',
  '....xxxxxxx.....',
  '....xWx..xex....',
  '....xGx..xex....',
  '....xGx..xEx....',
  '....xGx..xEx....',
  '.....xGxxEx.....',
  '......xAEx......',
  '.......xx.......',
  '................',
  '................',
  '................',
] as const;

// -- Wave 9 (Concordance Ch. IX): 4 new relics + 2 new wares, gate-reviewed on the parchment
// pane per the in-engine value law: docs/art-reviews/item-icons-relics.md.

const unbrokenClasp = [
  '................',
  '......xTTx......',
  '......xTTx......',
  '..xxxxxxxxxxxx..',
  '..xttttttttttx..',
  '..xtkkkkkkkktx..',
  '..xtkAAAAAAktx..',
  '..xtkkkkkkkktx..',
  '..xTTTTTTTTTTx..',
  '..xxxxxxxxxxxx..',
  '......xTTx......',
  '......xTTx......',
  '................',
  '................',
  '................',
  '................',
] as const;

const waymarkHeel = [
  '................',
  '.....xxxxxx.....',
  '.....xnnnnx.....',
  '....xnssssnx....',
  '....xnkkssnx....',
  '....xnssssnx....',
  '...xnssssssnx...',
  '...xnssssssnx...',
  '...xnnnnnnnnx...',
  '..xgmgmgmgmgmx..',
  '..xxxxxxxxxxxx..',
  '................',
  '................',
  '................',
  '................',
  '................',
] as const;

const marginLamp = [
  '................',
  '.......xx.......',
  '......xTTx......',
  '......xTTx......',
  '.....xTGGTx.....',
  '....xTGWWGTx....',
  '....xTGWWGTx....',
  '....xTGGGGTx....',
  '.....xTAATx.....',
  '......xEEx......',
  '...xcTTTTTTcx...',
  '...xKKKKKKKKx...',
  '................',
  '................',
  '................',
  '................',
] as const;

const secondWick = [
  '................',
  '.....xttttx.....',
  '....xtTTTTtx....',
  '....xtTTTTtx....',
  '.....xxssxx.....',
  '....xtTTTTtx....',
  '....xtTTTTtx....',
  '.....xttttx.....',
  '......xTTx......',
  '.......xx.......',
  '........e.......',
  '................',
  '................',
  '................',
  '................',
  '................',
] as const;

const sealedPageGeyser = [
  '................',
  '.....xxxxxx.....',
  '....xEEEEEEx....',
  '...xEAAAAAAEx...',
  '...xEAAwwAAEx...',
  '...xEAAAAAAEx...',
  '....xEEEEEEx....',
  '.....xxxxxx.....',
  '...xnssssssnx...',
  '...xnssssssnx...',
  '....xnnnnnnx....',
  '................',
  '................',
  '................',
  '................',
  '................',
] as const;

const superiorDraught = [
  '................',
  '......xxxx......',
  '.....xtTTtx.....',
  '.....xKEEKx.....',
  '......xEEx......',
  '.....xcAAcx.....',
  '....xxcAAcxx....',
  '...xcWAAAAecx...',
  '..xcWAAAAAeecx..',
  '..xcAAAAAeeecx..',
  '...xAAAeeeEcx...',
  '....xAAeeEEx....',
  '....xAeeEEEx....',
  '.....xeEEEx.....',
  '......xxxx......',
  '................',
] as const;

/** itemId (catalog.ts) -> 16×16 grid. Every CATALOG entry has one. */
export const ICONS: Record<string, readonly string[]> = {
  'embermend-draught': embermendDraught,
  'lanternoil-tonic': lanternoilTonic,
  'wardancers-restorative': wardancersRestorative,
  'wick-tallow': wickTallow,
  'lantern-brand': lanternBrand,
  'scriveners-hint': scrivenersHint,
  'second-wind-seal': secondWindSeal,
  'ward-of-focus': wardOfFocus,
  'faded-coin-cache': fadedCoinCache,
  'mossbound-locket': mossboundLocket,
  'clerks-silver-nib': clerksSilverNib,
  'amber-writ-seal': amberWritSeal,
  'gilded-ledger-bead': gildedLedgerBead,
  'warden-signet-of-terms': wardenSignetOfTerms,
  'unbroken-clasp': unbrokenClasp,
  'waymark-heel': waymarkHeel,
  'margin-lamp': marginLamp,
  'second-wick': secondWick,
  'sealed-page-geyser': sealedPageGeyser,
  'superior-draught': superiorDraught,
};

/** One grid -> a canvas at `scale` (nearest-neighbor); '.' and off-palette = transparent. */
function frameCanvas(grid: readonly string[], scale: number): HTMLCanvasElement | null {
  const h = grid.length;
  const w = grid.reduce((m, r) => Math.max(m, r.length), 0);
  if (w === 0 || h === 0) return null;
  const src = document.createElement('canvas');
  src.width = w;
  src.height = h;
  const sctx = src.getContext('2d');
  if (!sctx) return null;
  const img = sctx.createImageData(w, h);
  for (let y = 0; y < h; y++) {
    const row = grid[y] ?? '';
    for (let x = 0; x < w; x++) {
      const ch = row[x];
      if (!ch || ch === '.') continue;
      const int = PAL_CHAR[ch];
      if (int === undefined) continue;
      const o = (y * w + x) * 4;
      img.data[o] = (int >> 16) & 0xff;
      img.data[o + 1] = (int >> 8) & 0xff;
      img.data[o + 2] = int & 0xff;
      img.data[o + 3] = 0xff;
    }
  }
  sctx.putImageData(img, 0, 0);
  if (scale === 1) return src;
  const out = document.createElement('canvas');
  out.width = w * scale;
  out.height = h * scale;
  const octx = out.getContext('2d');
  if (!octx) return null;
  octx.imageSmoothingEnabled = false;
  octx.drawImage(src, 0, 0, w * scale, h * scale);
  return out;
}

/** Render a 16×16 grid to a data URL at `scale`× (default 4 → 64px) for <img> tags. */
export function renderIconDataUrl(grid: readonly string[], scale = 4): string {
  const c = frameCanvas(grid, scale);
  return c ? c.toDataURL() : '';
}

const urlCache = new Map<string, string>();

/** Cached icon data URL for an item id ('' if the id has no icon). */
export function iconUrl(id: string, scale = 4): string {
  const key = `${id}@${scale}`;
  let url = urlCache.get(key);
  if (url === undefined) {
    const grid = ICONS[id];
    url = grid ? renderIconDataUrl(grid, scale) : '';
    urlCache.set(key, url);
  }
  return url;
}
