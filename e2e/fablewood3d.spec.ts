import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { freshJourney, type Journey } from '../app/src/game3d/model';

// Subject-specific answers remain content, alongside the installed fixture pack.
const authoredRecallAnswers: Record<string, string> = JSON.parse(readFileSync(
  new URL('../packs/vc-law/acceptance-answers.json', import.meta.url), 'utf8',
));

test.use({ channel: 'chromium' });
test.setTimeout(60000);
const file = 'journey-3d-v1.json';
const snapshot = async (page: Page) => page.evaluate(() => (window as unknown as { __FW3D: { state: Journey } }).__FW3D.state);
type ObservedEncounter = {
  packId: string;
  encounterId: string;
  factIds: string[];
  seed: number;
  kind: string;
  correct: boolean;
};

async function openWood(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Fablewood 3D' })).toBeVisible();
  await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
  const welcome = page.getByRole('button', { name: 'Step into the wood' });
  if (await welcome.isVisible()) await welcome.click();
}

async function observeEncounterRequests(page: Page) {
  await page.evaluate(async () => {
    const { services } = await import('/src/game/contracts.ts');
    const original = services.runEncounter;
    const host = window as unknown as { __encounterRequests: unknown[] };
    host.__encounterRequests = [];
    services.runEncounter = async request => {
      host.__encounterRequests.push(structuredClone(request));
      return original(request);
    };
  });
}

async function travelTo(page: Page, label: string, point: { x: number; z: number }) {
  await page.getByRole('button', { name: /Wayfinder.*Places & paths/ }).click();
  await page.locator('.map-locations button').filter({ hasText: label }).click();
  await page.waitForFunction(
    target => Math.hypot(
      (window as unknown as { __FW3D: { state: Journey } }).__FW3D.state.position.x - target.x,
      (window as unknown as { __FW3D: { state: Journey } }).__FW3D.state.position.z - target.z,
    ) <= 2.5,
    point,
    { timeout: 25_000 },
  );
  await page.getByRole('button', { name: label, exact: true }).press('Enter');
}

async function answerAuthoredEncounter(
  page: Page,
  correct: boolean,
  observed: ObservedEncounter[],
) {
  await expect(page.locator('.fw-overlay')).toBeVisible();
  // Encounters intentionally ignore commits until a painted frame plus a short
  // reading guard has elapsed; there is no public DOM state for that arm gate.
  await page.evaluate(() => new Promise<void>(resolve => {
    requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 500)));
  }));
  const resolved = await page.evaluate(async () => {
    const host = window as unknown as { __encounterRequests: Array<{
      packId: string;
      encounterId: string;
      factIds: string[];
      seed: number;
    }> };
    const request = host.__encounterRequests.at(-1);
    if (!request) throw new Error('No real encounter request was observed.');
    const response = await fetch('/api/packs').then(result => result.json()) as {
      packs: Array<{ pack: { meta: { id: string }; encounters: Array<{ id: string }> } }>;
    };
    const source = response.packs.map(entry => entry.pack).find(pack => pack.meta.id === request.packId);
    if (!source) throw new Error(`Encounter pack ${request.packId} was not installed.`);
    const encounter = source.encounters.find(candidate => candidate.id === request.encounterId);
    if (!encounter) throw new Error(`Authored encounter ${request.encounterId} was not found.`);
    const { reskin } = await import('/src/game/encounters/engine.ts');
    return { request, encounter: reskin(encounter as never, request.seed) };
  });
  const encounter = resolved.encounter as unknown as {
    id: string;
    kind: string;
    options: unknown[];
    answer: unknown;
    branches: Array<{ label: string; correct: boolean }>;
  };
  observed.push({ ...resolved.request, kind: encounter.kind, correct });

  if (encounter.kind === 'mcq') {
    const option = encounter.options.find(value => (String(value) === String(encounter.answer)) === correct);
    if (option === undefined) throw new Error(`No ${correct ? 'correct' : 'incorrect'} option for ${encounter.id}.`);
    await page.locator('.fw-opt').filter({
      has: page.locator('.fw-optlabel', { hasText: String(option) }),
    }).first().click();
  } else if (encounter.kind === 'free_recall') {
    // Submit reviewed player answers, never the grading instructions and traps.
    const answer = correct
      ? authoredRecallAnswers[encounter.id]
      : 'Zigzag pebbles hum quietly.';
    if (!answer) throw new Error(`No reviewed recall answer for ${encounter.id}.`);
    await page.locator('.fw-textarea').fill(answer);
    await page.getByRole('button', { name: 'Cast', exact: true }).click();
  } else if (encounter.kind === 'scenario_branch') {
    const branch = encounter.branches.find(candidate => candidate.correct === correct);
    if (!branch) throw new Error(`No ${correct ? 'correct' : 'incorrect'} branch for ${encounter.id}.`);
    await page.locator('.fw-opt').filter({ hasText: branch.label }).click();
  } else if (encounter.kind === 'match') {
    const pairs = encounter.answer as Array<[string, string]>;
    for (let index = 0; index < pairs.length; index += 1) {
      await page.getByRole('button', { name: pairs[index][0], exact: true }).click();
      await page.getByRole('button', {
        name: pairs[correct ? index : (index + 1) % pairs.length][1],
        exact: true,
      }).click();
    }
    await page.getByRole('button', { name: 'Seal the Weave' }).click();
  } else if (encounter.kind === 'order') {
    const answer = encounter.answer as string[];
    const target = correct ? answer : [...answer.slice(1), answer[0]];
    for (let expected = 0; expected < target.length; expected += 1) {
      for (let guard = 0; guard < target.length; guard += 1) {
        const labels = (await page.locator('.fw-steplabel').allInnerTexts()).map(text => text.trim());
        const current = labels.indexOf(String(target[expected]));
        if (current <= expected) break;
        await page.locator('.fw-step').nth(current).locator('.fw-move button').first().click();
      }
    }
    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
  } else {
    throw new Error(`Unsupported authored encounter kind ${encounter.kind}.`);
  }

  await expect(page.locator(correct ? '.fw-verdict.pass' : '.fw-verdict.fail')).toBeVisible({ timeout: 15_000 });
  if (encounter.kind !== 'mcq' || !correct) {
    await page.getByRole('button', { name: 'Onward ▸' }).click();
  }
  await expect(page.locator('.fw-overlay')).toHaveCount(0, { timeout: 10_000 });
  await expect(page.locator('.realm-busy')).toHaveCount(0);
}

async function waitForJourneySave(page: Page) {
  await expect(page.locator('.realm-footer')).toContainText('Journey saved');
}

let before: unknown;
test.beforeEach(async ({ page }) => {
  const response = await page.request.get(`/api/state/${file}`);
  before = response.ok() ? await response.json() : null;
  await page.request.put(`/api/state/${file}`, { data: freshJourney() });
});
test.afterEach(async ({ page }) => {
  // All writes use the configured isolated e2e state. Never mutate the user's state.
  await page.goto('about:blank');
  await page.request.put(`/api/state/${file}`, { data: before ?? freshJourney() });
});

test('the default entry is a real 3D world with keyboard movement and a modal journal', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await openWood(page);
  await expect(page.locator('.realm-canvas canvas')).toHaveCount(1);
  const initial = await snapshot(page);
  await page.keyboard.press('j');
  await expect(page.getByRole('dialog')).toContainText('What we carry.');
  await page.keyboard.press('w');
  expect((await snapshot(page)).position).toEqual(initial.position);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.keyboard.press('d');
  await expect.poll(async () => JSON.stringify((await snapshot(page)).position)).not.toBe(JSON.stringify(initial.position));
  expect(errors).toEqual([]);
});

test('world remounts preserve the journey and release the old canvas and overlays', async ({ page }) => {
  await openWood(page);
  for (let i = 0; i < 3; i++) {
    await page.getByRole('button', { name: 'The Ledger', exact: true }).click();
    await expect(page.locator('.realm-canvas canvas')).toHaveCount(0);
    await expect(page.locator('.fw-overlay')).toHaveCount(0);
    await page.getByRole('button', { name: 'Realms', exact: true }).click();
    await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
    const welcome = page.getByRole('button', { name: 'Step into the wood' });
    if (await welcome.isVisible()) await welcome.click();
    await expect(page.locator('.realm-canvas canvas')).toHaveCount(1);
  }
  expect((await snapshot(page)).position).toEqual(freshJourney().position);
});

test('leaving the wood waits for the most recent movement save', async ({ page }) => {
  await openWood(page);
  let release!: () => void;
  const pendingWrite = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/state/${file}`, async route => {
    if (route.request().method() === 'PUT') await pendingWrite;
    await route.continue();
  });
  const initial = await snapshot(page);
  await page.keyboard.press('d');
  await expect.poll(async () => (await snapshot(page)).position.x).not.toBe(initial.position.x);
  const moved = (await snapshot(page)).position;
  await page.getByRole('button', { name: 'The Ledger', exact: true }).click();
  await expect(page.locator('.realm-canvas canvas')).toHaveCount(1);
  await expect(page.locator('.realm-footer')).toContainText('Saving');
  release();
  await expect(page.locator('.realm-canvas canvas')).toHaveCount(0);
  await page.getByRole('button', { name: 'Realms', exact: true }).click();
  await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
  expect((await snapshot(page)).position).toEqual(moved);
  expect((await (await page.request.get(`/api/state/${file}`)).json()).position).toEqual(moved);
});

for (const failure of [
  { name: 'server failure', status: 503, body: '{"error":"temporarily unavailable"}' },
  { name: 'malformed JSON', status: 200, body: '{broken' },
  { name: 'JSON null', status: 200, body: 'null' },
]) {
  test(`a ${failure.name} reading a journey never starts a writable replacement`, async ({ page }) => {
    const writes: string[] = [];
    await page.route(`**/api/state/${file}`, async route => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ status: failure.status, contentType: 'application/json', body: failure.body });
      } else {
        writes.push(route.request().postData() ?? '');
        await route.continue();
      }
    });
    await page.goto('/');
    await expect(page.getByRole('alert')).toContainText('Your saved journey has not been replaced');
    await expect(page.locator('.realm-canvas canvas')).toHaveCount(0);
    await page.getByRole('button', { name: /Interact.*The Hearth/ }).click();
    await page.keyboard.press('d');
    expect(writes).toEqual([]);
    expect(await (await page.request.get(`/api/state/${file}`)).json()).toEqual(freshJourney());
  });
}

test('corrupt or future journey versions are reported without overwriting them', async ({ page }) => {
  const future = { ...freshJourney(), version: 999, note: 'preserve this exact isolated fixture' };
  await page.request.put(`/api/state/${file}`, { data: future });
  await page.goto('/');
  await expect(page.getByRole('alert')).toContainText('Your saved journey has not been replaced');
  const response = await page.request.get(`/api/state/${file}`);
  expect(await response.json()).toEqual(future);
  await expect(page.locator('.realm-canvas canvas')).toHaveCount(0);
});

test('a hearth cloak upgrade spends earned gold and survives reload', async ({ page }) => {
  await page.request.put(`/api/state/${file}`, { data: {
    ...freshJourney(), companion: true, chapter: 'complete', gold: 20, completedRuns: 1,
    learned: ['neutral-source'], renewed: ['stone-1', 'stone-2', 'stone-3'],
    collected: ['skirmish-victory', 'guardian-victory'],
  } });
  await openWood(page);
  await page.getByRole('button', { name: 'The Hearth', exact: true }).click();
  await page.getByRole('button', { name: /Reinforce your cloak/ }).click();
  expect((await snapshot(page)).maxHp).toBe(14);
  expect((await snapshot(page)).gold).toBe(8);
  await expect.poll(async () => (await (await page.request.get(`/api/state/${file}`)).json()).maxHp).toBe(14);
  await page.reload();
  await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
  expect((await snapshot(page)).maxHp).toBe(14);
  expect((await snapshot(page)).gold).toBe(8);
});

test('a world without installed packs explicitly labels its invented practice material', async ({ page }) => {
  await page.route('**/api/packs', route => route.fulfill({ json: { packs: [] } }));
  await openWood(page);
  await expect(page.locator('.realm-footer')).toContainText('Practice woodland · no knowledge packs installed');
  await expect(page.locator('.realm-canvas canvas')).toBeVisible();
});

test('a full authored chapter persists its journey and spaced-repetition history', async ({ page }) => {
  test.setTimeout(360_000);
  await page.setViewportSize({ width: 1672, height: 941 });
  const errors: string[] = [];
  const observed: ObservedEncounter[] = [];
  page.on('pageerror', error => errors.push(error.message));

  const priorSrsResponse = await page.request.get('/api/state/srs.json');
  const priorSrs = priorSrsResponse.ok() ? await priorSrsResponse.json() : null;
  await page.request.put('/api/state/srs.json', { data: { version: 1, facts: {} } });

  try {
    const packsResponse = await page.request.get('/api/packs');
    expect(packsResponse.ok()).toBe(true);
    const packs = await packsResponse.json() as {
      packs: Array<{ pack: {
        meta: { id: string };
        facts: Array<{ id: string; source_ref: { quote: string } }>;
      } }>;
    };
    const authoredPack = packs.packs.find(entry => entry.pack.meta.id === 'vc-law')?.pack;
    expect(authoredPack, 'the configured authored fixture pack should be installed').toBeTruthy();
    const authoredFactIds = new Set(authoredPack!.facts.map(fact => fact.id));

    await openWood(page);
    await observeEncounterRequests(page);
    expect((await snapshot(page)).companion).toBe(false);

    await travelTo(page, 'Mira', { x: 3, z: 6 });
    await page.getByRole('button', { name: 'Ask Mira to join you' }).click();
    expect((await snapshot(page)).companion).toBe(true);

    await travelTo(page, 'First Waystone', { x: 6, z: 4 });
    const evidence = await page.locator('.source-evidence blockquote').first().innerText();
    expect(evidence.trim()).not.toBe('');
    expect(authoredPack!.facts.some(fact => evidence.includes(fact.source_ref.quote))).toBe(true);
    await page.getByRole('button', { name: 'Speak to the waystone' }).click();
    await answerAuthoredEncounter(page, false, observed);
    const failedRecall = await snapshot(page);
    expect(failedRecall.hp).toBe(10);
    expect(failedRecall.renewed).toEqual([]);
    expect(failedRecall.chapter).toBe('road');

    await page.getByRole('button', { name: 'First Waystone', exact: true }).click();
    await page.getByRole('button', { name: 'Speak to the waystone' }).click();
    await answerAuthoredEncounter(page, true, observed);
    expect((await snapshot(page)).renewed).toEqual(['stone-1']);
    await waitForJourneySave(page);
    await page.reload();
    await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
    await observeEncounterRequests(page);
    expect((await snapshot(page)).companion).toBe(true);
    expect((await snapshot(page)).renewed).toEqual(['stone-1']);
    expect((await snapshot(page)).hp).toBe(10);

    await travelTo(page, 'Second Waystone', { x: 17, z: 3 });
    await page.getByRole('button', { name: 'Speak to the waystone' }).click();
    await answerAuthoredEncounter(page, true, observed);
    await expect.poll(async () => (await snapshot(page)).combat?.kind).toBe('skirmish');
    const beforeGuard = await snapshot(page);
    await page.getByRole('button', { name: /Guard.*Brace & wait/ }).click();
    const afterGuard = await snapshot(page);
    expect(afterGuard.combat?.turn).toBe((beforeGuard.combat?.turn ?? 0) + 1);
    expect(afterGuard.hp).toBeLessThanOrEqual(beforeGuard.hp);

    await waitForJourneySave(page);
    const beforeCombatReload = await snapshot(page);
    await page.reload();
    await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
    await observeEncounterRequests(page);
    expect((await snapshot(page)).combat).toEqual(beforeCombatReload.combat);
    expect((await snapshot(page)).hp).toBe(beforeCombatReload.hp);

    await page.getByRole('button', { name: /Retreat.*Return safely/ }).click();
    const retreated = await snapshot(page);
    expect(retreated.combat).toBeNull();
    expect(retreated.hp).toBe(beforeCombatReload.hp);
    await page.getByRole('button', { name: 'Second Waystone', exact: true }).press('Enter');
    await expect.poll(async () => (await snapshot(page)).combat?.kind).toBe('skirmish');
    const beforeHeal = await snapshot(page);
    await page.getByRole('button', { name: /Mira’s ember.*Heal/ }).click();
    const healed = await snapshot(page);
    expect(healed.embers).toBe(beforeHeal.embers - 1);
    expect(healed.hp).toBeGreaterThan(beforeHeal.hp);
    expect(healed.hp).toBeLessThanOrEqual(Math.min(beforeHeal.maxHp, beforeHeal.hp + 4));
    expect(healed.log.at(-1)).toMatch(/Mira restores|Enemies deal/);

    for (let attack = 0; attack < 2; attack += 1) {
      await page.getByRole('button', { name: /Recall.*Cast from memory/ }).click();
      await answerAuthoredEncounter(page, true, observed);
    }
    const skirmishWon = await snapshot(page);
    expect(skirmishWon.combat).toBeNull();
    expect(skirmishWon.collected).toContain('skirmish-victory');

    await travelTo(page, 'Third Waystone', { x: 24, z: -6 });
    await page.getByRole('button', { name: 'Speak to the waystone' }).click();
    await answerAuthoredEncounter(page, true, observed);
    expect((await snapshot(page)).renewed).toEqual(['stone-1', 'stone-2', 'stone-3']);

    await travelTo(page, 'Ruined Gate', { x: 27, z: -12 });
    await page.getByRole('button', { name: 'Approach the Toll-Warden' }).click();
    await expect.poll(async () => (await snapshot(page)).combat?.kind).toBe('guardian');
    for (let cast = 0; cast < 3; cast += 1) {
      const turnStart = await snapshot(page);
      const telegraph = turnStart.combat?.telegraph;
      expect(telegraph).not.toBeNull();
      for (let step = 0; step < 3; step += 1) {
        const beforeStep = (await snapshot(page)).position;
        await page.keyboard.press('w');
        await page.waitForFunction(
          before => Math.hypot(
            (window as unknown as { __FW3D: { state: Journey } }).__FW3D.state.position.x - before.x,
            (window as unknown as { __FW3D: { state: Journey } }).__FW3D.state.position.z - before.z,
          ) > 0.5,
          beforeStep,
        );
        const moved = await snapshot(page);
        if (Math.hypot(moved.position.x - telegraph!.x, moved.position.z - telegraph!.z) > 1.6) break;
      }
      const clearPosition = (await snapshot(page)).position;
      expect(Math.hypot(clearPosition.x - telegraph!.x, clearPosition.z - telegraph!.z)).toBeGreaterThan(1.6);
      const hpBeforeCast = (await snapshot(page)).hp;
      await page.getByRole('button', { name: /Recall.*Cast from memory/ }).click();
      await answerAuthoredEncounter(page, true, observed);
      const afterCast = await snapshot(page);
      expect(afterCast.hp).toBe(hpBeforeCast);
      if (cast < 2) {
        expect(afterCast.combat?.telegraph).toEqual(afterCast.position);
      }
    }
    expect((await snapshot(page)).chapter).toBe('return');
    expect((await snapshot(page)).collected).toContain('guardian-victory');
    await page.getByRole('button', { name: 'Homeward' }).click();

    await travelTo(page, 'The Hearth', { x: -10, z: 1 });
    await page.getByRole('button', { name: 'Tell the story of the road' }).click();
    const completed = await snapshot(page);
    expect(completed.chapter).toBe('complete');
    expect(completed.completedRuns).toBe(1);
    expect(completed.gold).toBeGreaterThanOrEqual(12);

    await page.getByRole('button', { name: 'The Hearth', exact: true }).press('Enter');
    await page.getByRole('button', { name: /Reinforce your cloak/ }).click();
    expect((await snapshot(page)).maxHp).toBe(14);
    expect((await snapshot(page)).gold).toBe(completed.gold - 12);
    await page.getByRole('button', { name: 'Rest at the hearth' }).click();
    expect((await snapshot(page)).hp).toBe(14);
    expect((await snapshot(page)).embers).toBe(2);

    await waitForJourneySave(page);
    await page.reload();
    await page.waitForFunction(() => (window as unknown as { __FW3D?: { ready: boolean } }).__FW3D?.ready);
    await observeEncounterRequests(page);
    expect((await snapshot(page)).maxHp).toBe(14);
    expect((await snapshot(page)).completedRuns).toBe(1);
    expect((await snapshot(page)).chapter).toBe('complete');

    await page.getByRole('button', { name: 'The Hearth', exact: true }).press('Enter');
    await page.getByRole('button', { name: 'Begin another patrol' }).click();
    const repeat = await snapshot(page);
    expect(repeat.chapter).toBe('road');
    expect(repeat.renewed).toEqual([]);
    expect(repeat.completedRuns).toBe(1);
    expect(repeat.maxHp).toBe(14);
    expect(repeat.learned.length).toBeGreaterThan(0);
    await travelTo(page, 'First Waystone', { x: 6, z: 4 });
    await page.getByRole('button', { name: 'Speak to the waystone' }).click();
    await answerAuthoredEncounter(page, true, observed);
    expect((await snapshot(page)).renewed).toEqual(['stone-1']);
    await waitForJourneySave(page);

    expect(observed).toHaveLength(10);
    expect(observed.every(request => request.packId === 'vc-law')).toBe(true);
    const srsResponse = await page.request.get('/api/state/srs.json');
    expect(srsResponse.status()).toBe(200);
    const persisted = await srsResponse.json() as {
      version: number;
      facts: Record<string, { history: Array<{ quality: number; encounter_id: string }> }>;
    };
    expect(persisted.version).toBe(1);
    expect(Object.keys(persisted.facts).length).toBeGreaterThan(0);
    expect(Object.keys(persisted.facts).every(factId => authoredFactIds.has(factId))).toBe(true);
    const histories = Object.values(persisted.facts).flatMap(entry => entry.history);
    expect(histories.map(entry => entry.quality)).toContain(0);
    expect(histories.map(entry => entry.quality)).toContain(1);
    for (const request of observed) {
      expect(request.factIds.every(factId => persisted.facts[factId]?.history.some(
        item => item.encounter_id === request.encounterId,
      ))).toBe(true);
    }
    expect(errors).toEqual([]);
  } finally {
    await page.request.put('/api/state/srs.json', {
      data: priorSrs ?? { version: 1, facts: {} },
    });
  }
});
