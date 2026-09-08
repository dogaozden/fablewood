import { chromium, expect } from '@playwright/test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { screenshot } from './screenshot.mjs';
const authoredRecallAnswers = JSON.parse(await readFile(new URL('../../packs/vc-law/acceptance-answers.json', import.meta.url), 'utf8'));

const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1672, height: 941 } });
const errors = [], steps = [];
page.on('pageerror', error => errors.push(error.message));
const state = () => page.evaluate(() => window.__FW3D.state);
const checkpoint = async name => {
  const current = await state();
  steps.push({ name, state: current });
  console.log(JSON.stringify({ step: name, position: current.position, chapter: current.chapter, hp: current.hp, renewed: current.renewed }));
};

async function capture(path) {
  try { await screenshot(page, path); }
  catch(error) { steps.push({screenshot:path,failure:String(error)}); }
}

// Observe real requests/results without replacing the encounter, draw, judge, or SRS.
async function observeEncounters() {
  await page.evaluate(async () => {
    const { services } = await import('/src/game/contracts.ts');
    const original = services.runEncounter;
    window.__encounterRequests = [];
    services.runEncounter = async request => {
      window.__encounterRequests.push(structuredClone(request));
      return original(request);
    };
  });
}

async function travel(label, point) {
  await page.getByRole('button', { name: /Wayfinder.*Places & paths/ }).click();
  await page.locator('.map-locations button').filter({ hasText: label }).click();
  await page.waitForFunction(p => Math.hypot(window.__FW3D.state.position.x - p.x, window.__FW3D.state.position.z - p.z) <= 2.5, point, { timeout: 25000 });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: label, exact: true }).press('Enter');
}

async function answer(correct = true) {
  await expect(page.locator('.fw-overlay')).toBeVisible();
  const encounter = await page.evaluate(async () => {
    const request = window.__encounterRequests.at(-1);
    const response = await fetch('/api/packs').then(r => r.json());
    const { FIXTURE_PACK } = await import('/src/game/encounters/fixtures.ts');
    const packs = response.packs.length ? response.packs.map(entry => entry.pack) : [FIXTURE_PACK];
    const source = packs.find(pack => pack.meta.id === request.packId);
    const enc = source.encounters.find(candidate => candidate.id === request.encounterId);
    const { reskin } = await import('/src/game/encounters/engine.ts');
    return reskin(enc, request.seed);
  });
  await page.waitForTimeout(500);
  if (encounter.kind === 'mcq') {
    const option = encounter.options.find(value => (String(value) === String(encounter.answer)) === correct);
    await page.locator('.fw-opt').filter({ has: page.locator('.fw-optlabel', { hasText: String(option) }) }).first().click();
  } else if (encounter.kind === 'free_recall') {
    const response = correct ? authoredRecallAnswers[encounter.id] : 'Zigzag pebbles hum quietly.';
    if (!response) throw new Error(`No reviewed recall answer for ${encounter.id}.`);
    await page.locator('.fw-textarea').fill(response);
    await page.getByRole('button', { name: 'Cast', exact: true }).click();
  } else if (encounter.kind === 'scenario_branch') {
    const branch = encounter.branches.find(branch => branch.correct === correct);
    await page.locator('.fw-opt').filter({ hasText: branch.label }).click();
  } else if (encounter.kind === 'match') {
    const pairs = encounter.answer;
    for (let i = 0; i < pairs.length; i++) {
      await page.getByRole('button', { name: pairs[i][0], exact: true }).click();
      await page.getByRole('button', { name: pairs[correct ? i : (i + 1) % pairs.length][1], exact: true }).click();
    }
    await page.getByRole('button', { name: 'Seal the Weave' }).click();
  } else if (encounter.kind === 'order') {
    const target = correct ? encounter.answer : [...encounter.answer.slice(1), encounter.answer[0]];
    for (let i = 0; i < target.length; i++) {
      for (let guard = 0; guard < target.length; guard++) {
        const labels = (await page.locator('.fw-steplabel').allInnerTexts()).map(text => text.trim());
        const index = labels.indexOf(String(target[i]));
        if (index <= i) break;
        await page.locator('.fw-step').nth(index).locator('.fw-move button').first().click();
      }
    }
    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
  }
  await expect(page.locator(correct ? '.fw-verdict.pass' : '.fw-verdict.fail')).toBeVisible({ timeout: 15000 });
  if (encounter.kind !== 'mcq' || !correct) await page.getByRole('button', { name: 'Onward ▸' }).click();
  await expect(page.locator('.fw-overlay')).toHaveCount(0, { timeout: 10000 });
  await expect(page.locator('.realm-busy')).toHaveCount(0);
  steps.push({ encounter: encounter.id, kind: encounter.kind, correct });
}

try {
  await page.goto(`${process.env.FABLEWOOD_PREVIEW_URL ?? 'http://127.0.0.1:5411'}/`);
  await page.waitForFunction(() => window.__FW3D?.ready);
  await observeEncounters();
  const initial = await state();
  assert.equal(initial.companion, false, 'Use a fresh isolated STATE_DIR for this journey.');
  await page.getByRole('button', { name: 'Step into the wood' }).click();
  await capture('.dream-loop/playthrough-start.png');
  await travel('Mira', { x: 3, z: 6 });
  await page.getByRole('button', { name: 'Ask Mira to join you' }).click();
  await checkpoint('companion recruited');
  await travel('First Waystone', { x: 6, z: 4 });
  await expect(page.locator('.source-evidence blockquote').first()).not.toBeEmpty();
  await page.getByRole('button', { name: 'Speak to the waystone' }).click();
  await answer(false);
  assert.equal((await state()).hp, 10);
  assert.deepEqual((await state()).renewed, []);
  await checkpoint('failed recall preserves the locked bridge');
  await page.getByRole('button', { name: 'First Waystone', exact: true }).click();
  await page.getByRole('button', { name: 'Speak to the waystone' }).click();
  await answer();
  await checkpoint('first waystone renewed');
  await page.waitForFunction(() => document.querySelector('.realm-footer')?.textContent.includes('Journey saved'));
  await page.reload();
  await page.waitForFunction(() => window.__FW3D?.ready);
  await observeEncounters();
  assert.equal((await state()).companion, true);
  assert.deepEqual((await state()).renewed, ['stone-1']);
  await checkpoint('reload preserved the party and renewed world');
  await travel('Second Waystone', { x: 17, z: 3 });
  await page.getByRole('button', { name: 'Speak to the waystone' }).click();
  await answer();
  await page.waitForFunction(() => window.__FW3D.state.combat?.kind === 'skirmish');
  await capture('.dream-loop/playthrough-battle.png');
  await page.getByRole('button', { name: /Guard.*Brace & wait/ }).click();
  const beforeCombatReload = await state();
  await page.waitForFunction(() => document.querySelector('.realm-footer')?.textContent.includes('Journey saved'));
  await page.reload();
  await page.waitForFunction(() => window.__FW3D?.ready);
  await observeEncounters();
  assert.deepEqual((await state()).combat, beforeCombatReload.combat);
  assert.equal((await state()).hp, beforeCombatReload.hp);
  await checkpoint('combat turn, health and enemies survived reload');
  await page.getByRole('button', { name: /Retreat.*Return safely/ }).click();
  assert.equal((await state()).combat, null);
  assert.equal((await state()).hp, beforeCombatReload.hp);
  await checkpoint('retreat preserves wounds and learned road');
  await page.getByRole('button', { name: 'Second Waystone', exact: true }).press('Enter');
  await page.waitForFunction(() => window.__FW3D.state.combat?.kind === 'skirmish');
  await page.getByRole('button', { name: /Mira’s ember.*Heal/ }).click();
  assert.equal((await state()).embers, 1);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: /Recall.*Cast from memory/ }).click();
    await answer();
  }
  assert.equal((await state()).combat, null);
  assert.ok((await state()).collected.includes('skirmish-victory'));
  await checkpoint('road skirmish won');
  await travel('Third Waystone', { x: 24, z: -6 });
  await page.getByRole('button', { name: 'Speak to the waystone' }).click();
  await answer();
  await travel('Ruined Gate', { x: 27, z: -12 });
  await page.getByRole('button', { name: 'Approach the Toll-Warden' }).click();
  await page.waitForFunction(() => window.__FW3D.state.combat?.kind === 'guardian');
  // Walk out of the telegraphed area using real keyboard movement before casting.
  for (let i = 0; i < 3; i++) {
    for(let step = 0; step < 2; step++) {
      const before = (await state()).position;
      await page.keyboard.press('w');
      await page.waitForFunction(p => Math.hypot(window.__FW3D.state.position.x-p.x,window.__FW3D.state.position.z-p.z)>.5, before);
      await page.waitForTimeout(100);
    }
    await page.getByRole('button', { name: /Recall.*Cast from memory/ }).click();
    await answer();
  }
  assert.equal((await state()).chapter, 'return');
  await page.getByRole('button', { name: 'Homeward' }).click();
  await checkpoint('guardian released');
  await travel('The Hearth', { x: -10, z: 1 });
  await page.getByRole('button', { name: 'Tell the story of the road' }).click();
  const completed = await state();
  assert.equal(completed.chapter, 'complete');
  assert.equal(completed.completedRuns, 1);
  await checkpoint('chapter completed at the hearth');
  await capture('.dream-loop/playthrough-complete.png');
  await page.getByRole('button', { name: 'The Hearth', exact: true }).press('Enter');
  await page.getByRole('button', { name: /Reinforce your cloak/ }).click();
  assert.equal((await state()).maxHp, 14);
  assert.equal((await state()).gold, completed.gold - 12);
  await page.getByRole('button', { name: 'Rest at the hearth' }).click();
  assert.equal((await state()).hp, 14);
  assert.equal((await state()).embers, 2);
  await page.waitForFunction(() => document.querySelector('.realm-footer')?.textContent.includes('Journey saved'));
  await page.reload();
  await page.waitForFunction(() => window.__FW3D?.ready);
  await observeEncounters();
  assert.equal((await state()).maxHp, 14);
  assert.equal((await state()).completedRuns, 1);
  await checkpoint('earned cloak upgrade and completed chapter survived reload');
  await page.getByRole('button', { name: 'The Hearth', exact: true }).press('Enter');
  await page.getByRole('button', { name: 'Begin another patrol' }).click();
  assert.equal((await state()).chapter, 'road');
  assert.deepEqual((await state()).renewed, []);
  assert.equal((await state()).completedRuns, 1);
  assert.equal((await state()).maxHp, 14);
  await travel('First Waystone', { x: 6, z: 4 });
  await page.getByRole('button', { name: 'Speak to the waystone' }).click();
  await answer();
  assert.deepEqual((await state()).renewed, ['stone-1']);
  await checkpoint('repeat patrol renewed the road with persistent learning and equipment');
  const srsResponse = await page.request.get(new URL('/api/state/srs.json', page.url()).href);
  assert.equal(srsResponse.status(), 200);
  const srs = await srsResponse.json();
  assert.deepEqual(errors, []);
  await writeFile('.dream-loop/playthrough.json', JSON.stringify({ passed: true, judgeMode: 'stub', errors, steps, persistedSrs: srs }, null, 2));
} catch (error) {
  await page.screenshot({ path: '.dream-loop/playthrough-failure.png' }).catch(() => {});
  await writeFile('.dream-loop/playthrough.json', JSON.stringify({ passed: false, failure: String(error), errors, steps, state: await state().catch(() => null), body: await page.locator('body').innerText().catch(() => '') }, null, 2));
  throw error;
} finally {
  await browser.close();
}
