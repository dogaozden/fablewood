// keepsake.ts — Death's Door keepsake picker, Concordance Ch. I.
// Pure: no Phaser, no services. Picks one carried trinket to be taken by the
// Fade on a wipe; relics/consumables/tools are never eligible (catalog law:
// trinkets are the sellable class; relics are protected story trophies).
import { mulberry32 } from '../combat/rng';

export function pickKeepsake(
  stacks: Record<string, number>,
  defOf: (id: string) => { type: string } | undefined,
  seed: number,
): string | null {
  const ids = Object.keys(stacks)
    .filter((id) => defOf(id)?.type === 'trinket' && stacks[id] > 0)
    .sort();
  if (ids.length === 0) return null;
  return ids[Math.floor(mulberry32(seed)() * ids.length)];
}
