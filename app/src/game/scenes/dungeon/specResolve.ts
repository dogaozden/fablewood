/**
 * Pure resolution of a pack's dungeon spec: which asset file holds it, which
 * quest supplies the boss reward, and a tolerant runtime shape-check so a
 * malformed pack file toasts instead of crashing the scene. No Phaser — node-testable.
 */
import type { DungeonSpec, DungeonRoom } from '../../contracts';
import type { Pack, Quest } from '../../../packs/types';
import { isEnemyArchetype, knownArchetypes } from '../../combat/units';

/** "The Preference Vaults" → "the-preference-vaults". */
export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Drop a leading article so "the-preference-vaults" → "preference-vaults". */
export function stripLeadingArticle(slug: string): string {
  return slug.replace(/^(the|a|an)-/, '');
}

/**
 * Ordered, de-duplicated candidate dungeon-spec filenames for a pack. The loader
 * tries each in turn, so the exact slug rule never has to match perfectly.
 * Article-stripped first (blueprint §4 canonical: `preference-vaults.dungeon.json`),
 * then the full region slug, then the pack id as a last resort.
 */
export function candidateDungeonFiles(pack: Pack): string[] {
  const region = (pack.quests ?? []).map((q) => q.region).find((r): r is string => !!r);
  const stems: string[] = [];
  if (region) {
    const slug = slugify(region);
    stems.push(stripLeadingArticle(slug), slug);
  }
  if (pack.meta?.id) stems.push(slugify(pack.meta.id));

  const seen = new Set<string>();
  const files: string[] = [];
  for (const stem of stems) {
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);
    files.push(`${stem}.dungeon.json`);
  }
  return files;
}

/** The quest whose reward the boss (the Vault-Warden) hands out on victory. */
export function bossQuest(pack: Pack): Quest | undefined {
  const quests = pack.quests ?? [];
  return (
    quests.find((q) => /warden|boss|term.?sheet/i.test(`${q.id} ${q.title}`)) ??
    quests[quests.length - 1]
  );
}

/** Human-readable reward line from a quest reward (string or `{xp, item}`). */
export function rewardText(quest: Quest | undefined): string | null {
  const reward = quest?.reward;
  if (!reward) return null;
  if (typeof reward === 'string') return reward;
  if (typeof reward === 'object') {
    const rec = reward as Record<string, unknown>;
    const item = typeof rec.item === 'string' ? humanize(rec.item) : undefined;
    const xp = typeof rec.xp === 'number' ? rec.xp : undefined;
    if (item && xp !== undefined) return `${item} (+${xp} XP)`;
    if (item) return item;
    if (xp !== undefined) return `+${xp} XP`;
  }
  return null;
}

/** The numeric XP component of a quest reward (Task 5) — same shape-tolerance as rewardText's
 *  own extraction, kept in sync with it here rather than duplicated at each call site. */
export function rewardXp(quest: Quest | undefined): number | undefined {
  const reward = quest?.reward;
  if (!reward || typeof reward !== 'object') return undefined;
  const xp = (reward as Record<string, unknown>).xp;
  return typeof xp === 'number' ? xp : undefined;
}

function humanize(slug: string): string {
  return slug
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(' ');
}

/** Tolerant: enough to know the file is a usable spec, not full schema validation. */
export function isDungeonSpec(x: unknown): x is DungeonSpec {
  if (!x || typeof x !== 'object') return false;
  const s = x as Record<string, unknown>;
  if (typeof s.id !== 'string' || typeof s.name !== 'string') return false;
  if (!Array.isArray(s.rooms) || s.rooms.length === 0) return false;
  return s.rooms.every(isDungeonRoom);
}

function isDungeonRoom(x: unknown): x is DungeonRoom {
  if (!x || typeof x !== 'object') return false;
  const r = x as Record<string, unknown>;
  return typeof r.id === 'string' && typeof r.name === 'string' && Array.isArray(r.enemies);
}

/**
 * Ch. VIII — every enemy-archetype id this spec's rooms name that the engine's closed
 * `EnemyArchetype` enum has no entry for, de-duplicated in first-seen order across all rooms.
 * Empty = the spec names only buildable creatures.
 *
 * Deliberately NOT folded into isDungeonSpec above: that guard answers "is this file a usable
 * spec at all", and a false there makes the loader silently try the next candidate filename.
 * A typo'd archetype is a spec that IS the right file and IS well-formed — the author should
 * be told which word is wrong, by name, not have their map quietly skipped. Hence a separate
 * check the caller runs on the spec it already chose (see archetypeError below).
 *
 * Shape-tolerant like every other reader here: a room with no `enemies`, a null entry, or a
 * missing/non-string `archetype` must not throw — a malformed pack file toasts, never crashes.
 * A non-string archetype is reported by its String() form so the author can still find it.
 */
export function unknownArchetypes(spec: DungeonSpec): string[] {
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const room of spec.rooms ?? []) {
    const enemies = (room as { enemies?: unknown }).enemies;
    if (!Array.isArray(enemies)) continue;
    for (const e of enemies) {
      if (!e || typeof e !== 'object') continue;
      const a = (e as { archetype?: unknown }).archetype;
      if (a === undefined || a === null || isEnemyArchetype(a)) continue;
      const label = String(a);
      if (seen.has(label)) continue;
      seen.add(label);
      bad.push(label);
    }
  }
  return bad;
}

/**
 * Ch. VIII — the load-time error for a spec naming archetypes the engine cannot build, or null
 * when it is clean. Names the offending id, the first room that carries it, and the legal set,
 * so an author learns what they MAY write rather than only that something was wrong.
 *
 * The caller throws this at spec-load (DungeonScene.loadSpec), which is the whole point: today
 * a typo survives the load, rides the room into CombatLaunch, and only dies inside makeEnemy —
 * `ENEMY_STATS[typo]` is undefined, `s.hp` throws — as an unexplained crash at combat launch,
 * possibly rooms later. Same in-world register as loadSpec's own "no charted map" throw beside it.
 */
export function archetypeError(spec: DungeonSpec, packId: string): string | null {
  const bad = unknownArchetypes(spec);
  if (!bad.length) return null;
  const first = bad[0];
  const room = (spec.rooms ?? []).find((r) =>
    Array.isArray((r as { enemies?: unknown }).enemies) &&
    r.enemies.some((e) => e && typeof e === 'object' && String((e as { archetype?: unknown }).archetype) === first),
  );
  const where = room ? ` in room "${room.id}"` : '';
  const rest = bad.length > 1 ? ` (and ${bad.length - 1} more: ${bad.slice(1).map((b) => `"${b}"`).join(', ')})` : '';
  return (
    `The map for "${packId}" names a creature the Ledger has no entry for: "${first}"${where}${rest}. ` +
    `Known entries: ${knownArchetypes().join(', ')}.`
  );
}
