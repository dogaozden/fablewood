/**
 * The Hearth's night-rest flow at the Cottage (Wave 3 Task 3): doCottage() branches on
 * canRestTonight() to either bank a night's rest (one save patch — full heal, Embers
 * refilled, lastHearthAt stamped) or fall back to the existing checkpoint conversation
 * with an already-rested line appended. Unit-tests the flow decision only — services.save
 * fake pattern borrowed from DungeonScene.test.ts, Phaser stubbed the same way. doCottage()
 * never reaches create(), so nothing beyond services.save/player/dialogue needs faking.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('phaser', () => ({ default: { Scene: class {} } }));
vi.mock('../../../ready', () => ({ markReady: vi.fn() }));
vi.mock('../../../../music/instance', () => ({ music: { play: vi.fn(), stop: vi.fn() } }));
vi.mock('../../../../bridge/client', () => ({
  getPacks: vi.fn(async () => ({ packs: [] })),
  getPackAsset: vi.fn(async () => null),
}));
vi.mock('../../../../inventory/ui/inventoryPane', () => ({ openInventoryPane: vi.fn(async () => {}) }));
vi.mock('../../../../inventory/ui/shopPane', () => ({ openShopPane: vi.fn(async () => {}) }));

import { HamletScene } from '../HamletScene';
import { services, type SaveData } from '../../../contracts';
import { maxHpForLevel, emberMaxForLevel } from '../../../progression/xp';
import type { Conversation } from '../../../dialogue';

/** Only doCottage() is under test, and it is private — this is the narrowest honest way
 *  to reach it without standing up the full Phaser create() lifecycle (labels, camera,
 *  keyboard, tilemap) that the flow decision itself never touches. */
type SceneTestView = { doCottage(): Promise<void> };

function installSave(initial: Partial<SaveData>): { saveMock: ReturnType<typeof vi.fn> } {
  let data: SaveData = { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '', ...initial };
  const saveMock = vi.fn(async (patch: Partial<SaveData>): Promise<void> => {
    data = { ...data, ...patch };
  });
  services.save = {
    ready: async () => {},
    get: () => data,
    save: saveMock,
  };
  return { saveMock };
}

function makeScene(dialogueRun: ReturnType<typeof vi.fn>): HamletScene {
  const scene = new HamletScene();
  Object.assign(scene, {
    player: { x: 120, y: 340 },
    dialogue: { run: dialogueRun },
  });
  return scene;
}

describe('the Cottage banks the hearth (night rest)', () => {
  it('never-rested: one save patch heals, refills embers, stamps lastHearthAt — streak untouched', async () => {
    const before = Date.now();
    const { saveMock } = installSave({ lastHearthAt: undefined, hp: 3, embers: 0 });
    const dialogueRun = vi.fn(async (_conv: Conversation): Promise<string | undefined> => undefined);
    const scene = makeScene(dialogueRun);

    await (scene as unknown as SceneTestView).doCottage();
    const after = Date.now();

    // Wave 4 Task 5, wire 6 — banking a hearth night also grants the 'hearth-streak' XP source
    // (+30), via grantXp's own separate atomic save patch (grant.ts's documented contract: ONE
    // patch per grant, never merged into the caller's). Two save() calls total, not one.
    expect(saveMock).toHaveBeenCalledTimes(2);
    const patch = saveMock.mock.calls[0][0] as Partial<SaveData>;
    expect(patch.hp).toBe(16); // maxHpForLevel(1) — no level seeded, so L1
    expect(patch.embers).toBe(emberMaxForLevel(1));
    expect(patch).not.toHaveProperty('streak');
    const stamp = new Date(patch.lastHearthAt as string).getTime();
    expect(stamp).toBeGreaterThanOrEqual(before);
    expect(stamp).toBeLessThanOrEqual(after);

    // grantXp('hearth-streak'): +30 xp from an unset (0) baseline never crosses the L2
    // threshold (100), so this second patch carries no hp/level-up — just xp + the unchanged
    // level default.
    expect(saveMock.mock.calls[1][0]).toEqual({ xp: 30, level: 1 });

    expect(dialogueRun).toHaveBeenCalledTimes(1);
    const conv = dialogueRun.mock.calls[0][0] as Conversation;
    expect(conv.speaker).toBe("Keeper's Cottage");
    expect(conv.pages).toEqual([
      'You bank the hearth, and the night keeps its side of the bargain. The party is whole; the embers are banked.',
    ]);
  });

  // Wave 4 Task 7 — the hearth-rest patch goes level-keyed: a higher-level save heals/
  // refills to ITS OWN ceiling (maxHpForLevel/emberMaxForLevel), not the flat L1 default.
  it('never-rested at a higher level: the rest patch heals/refills to that level\'s own ceiling', async () => {
    const { saveMock } = installSave({ lastHearthAt: undefined, hp: 3, embers: 0, level: 5, xp: 2500 });
    const dialogueRun = vi.fn(async (_conv: Conversation): Promise<string | undefined> => undefined);
    const scene = makeScene(dialogueRun);

    await (scene as unknown as SceneTestView).doCottage();

    const patch = saveMock.mock.calls[0][0] as Partial<SaveData>;
    expect(patch.hp).toBe(maxHpForLevel(5)); // 24, not the flat L1 16
    expect(patch.embers).toBe(emberMaxForLevel(5)); // 4, not the flat L1 2
  });

  it('already rested today: no rest patch, only the checkpoint write; already-rested line appended', async () => {
    const lastHearthAt = new Date().toISOString(); // "now" — same local calendar day as the call below
    const { saveMock } = installSave({ lastHearthAt, hp: 9, embers: 1 });
    const dialogueRun = vi.fn(async (_conv: Conversation): Promise<string | undefined> => undefined);
    const scene = makeScene(dialogueRun);

    await (scene as unknown as SceneTestView).doCottage();

    expect(saveMock).toHaveBeenCalledTimes(1);
    const patch = saveMock.mock.calls[0][0] as Partial<SaveData>;
    expect(patch).not.toHaveProperty('hp');
    expect(patch).not.toHaveProperty('embers');
    expect(patch).not.toHaveProperty('lastHearthAt');
    expect(patch.scene).toBe('hamlet');
    expect(patch.pos).toEqual({ x: 120, y: 340 });

    expect(dialogueRun).toHaveBeenCalledTimes(1);
    const conv = dialogueRun.mock.calls[0][0] as Conversation;
    expect(conv.speaker).toBe("Keeper's Cottage");
    expect(conv.pages[conv.pages.length - 1]).toBe(
      "The hearth still glows from tonight's banking. Rest again come tomorrow's dark.",
    );
    expect(conv.pages.length).toBe(3); // 2 existing checkpoint pages + the appended line
  });
});
