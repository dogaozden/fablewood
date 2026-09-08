import { test, expect, type Page } from '@playwright/test';
import {
  waitReady,
  tapKey,
  waitHamletPlayer,
  waitProvincesLoaded,
  warpHamletTo,
  readState,
} from '../e2e/helpers';

/**
 * "The Ledger Amended" — the supersession re-teach event, end to end
 * (docs/design/supersession-reteach.md §9).
 *
 * Runs against the FIXTURE pack (e2e/fixtures/packs/amended-almanac) on its own dev server,
 * own STATE_DIR and the stub judge — see playwright.amendments.config.ts. The fixture
 * declares FOUR superseded pairs, which is what makes the batch cap observable (a visit
 * presents 3, the fourth waits).
 */

const EV = 'screenshots';

/** The four amendments the fixture declares, old → new. */
const OLD_IDS = ['aa-toll-old', 'aa-frost-old', 'aa-market-old', 'aa-bell-old'];
const NEW_IDS = ['aa-toll-new', 'aa-frost-new', 'aa-market-new', 'aa-bell-new'];
const OLD_STATEMENTS = [
  'The bridge toll is three copper.',
  'Whispermoss is cut on the first frost.',
  'Market day is held on the seventh of the month.',
  'The curfew bell rings twice.',
];

type Srs = { facts?: Record<string, unknown> };
type Amendments = Record<string, string>;

/** Live read of the hamlet's pending-amendment set + the Records Office dressing. */
async function records(page: Page): Promise<{ pending: number; label: string; pulsing: boolean }> {
  return page.evaluate(() => {
    const g = window.__FABLEWOOD_GAME as { scene?: { getScene?(k: string): unknown } } | undefined;
    const h = g?.scene?.getScene?.('hamlet') as
      | {
          amendedPending?: unknown[];
          labels?: Map<string, { text?: string }>;
          recordsPulse?: { visible?: boolean };
        }
      | undefined;
    return {
      pending: h?.amendedPending?.length ?? -1,
      label: h?.labels?.get('records')?.text ?? '',
      pulsing: !!h?.recordsPulse?.visible,
    };
  });
}

/** Wipe the scratch ledger so a test starts from "four amendments pending". */
async function resetLedger(page: Page, witnessed: Amendments = {}): Promise<void> {
  for (const [name, body] of [
    ['amendments.json', witnessed],
    ['srs.json', { version: 1, facts: {} }],
    ['save.json', { scene: 'hamlet', hp: 16, streak: 0, lastPlayed: '' }],
  ] as const) {
    const res = await page.request.put(`/api/state/${name}`, { data: body });
    expect(res.ok(), `seeded state/${name}`).toBe(true);
  }
}

/** Boot into the hamlet with packs loaded. */
async function enterHamlet(page: Page): Promise<void> {
  await page.goto('/?renderer=classic&seed=7');
  await waitReady(page, 'boot');
  await page.keyboard.press('Enter');
  await waitReady(page, 'hamlet');
  await waitHamletPlayer(page);
  await waitProvincesLoaded(page);
  await expect.poll(async () => (await records(page)).pending, {
    message: 'the hamlet bootstrap resolved its pending amendments',
  }).toBeGreaterThanOrEqual(0);
}

/** Knock on the Records Office door (dev warp + a real keypress). */
async function knockAtRecords(page: Page): Promise<void> {
  expect(await warpHamletTo(page, 'records'), 'warped to the Records Office').toBe(true);
  await tapKey(page, 'e');
}

/** The amendment card currently on screen, as plain text. */
function card(page: Page) {
  return page.locator('.fw-overlay');
}

/** The struck (old) truth currently on screen, or '' when no card is up. */
async function struckLine(page: Page): Promise<string> {
  const struck = page.locator('.fw-amend-old');
  return (await struck.count()) ? (await struck.first().innerText()).trim() : '';
}

/**
 * Confirm the card on screen and wait for it to LEAVE. The next card of the batch renders
 * the same classes, so "gone" is "the struck line is no longer this one" — not merely
 * "there is no .fw-amend-old". Clicks are retried inside the poll because overlay.ts arms
 * its controls a paint + 400ms after mount (a click before that is deliberately inert).
 */
async function witnessCard(page: Page): Promise<string> {
  const before = await struckLine(page);
  expect(before, 'a card is on screen to witness').not.toBe('');
  await expect
    .poll(
      async () => {
        // Short click timeout on purpose: an un-settled (still animating) button would
        // otherwise let ONE click call sit in Playwright's actionability wait for the whole
        // poll window. Click ONLY — a keyboard fallback here races the NEXT card of the
        // batch, confirming it the instant it arms and skipping it in the tally.
        await page
          .getByRole('button', { name: 'Read and witnessed ▸' })
          .first()
          .click({ timeout: 700 })
          .catch(() => {});
        return struckLine(page);
      },
      { message: 'the card accepted the witness (past the overlay arm guard)', timeout: 15_000 },
    )
    .not.toBe(before);
  return before;
}

/**
 * The next card of the batch, or '' once the batch is done. Polls past the ~170ms overlay
 * exit animation, during which NO card is mounted — reading the DOM in that window would
 * otherwise end a 3-card batch after two.
 */
/** Wait for the next drill encounter to mount past the previous overlay's exit animation. */
async function settleOverlay(page: Page, timeout = 3000): Promise<boolean> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await page.locator('.fw-opt').count()) return true;
    await page.waitForTimeout(80);
  }
  return false;
}

async function settleNextCard(page: Page, timeout = 4000): Promise<string> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const line = await struckLine(page);
    if (line !== '') return line;
    await page.waitForTimeout(80);
  }
  return '';
}

test.describe.serial('The Ledger Amended', () => {
  test('§2 the Records Office pulses and offers the Clerk hover line', async ({ page }) => {
    await page.goto('/?renderer=classic&seed=7');
    await waitReady(page, 'boot');
    await resetLedger(page);
    await enterHamlet(page);

    await expect
      .poll(async () => (await records(page)).pending, { message: 'four amendments pend' })
      .toBe(4);

    const state = await records(page);
    expect(state.pulsing, 'the Records Office glow is lit').toBe(true);
    // §2's hover line, verbatim
    expect(state.label).toContain('The Clerk has amendments.');

    // frame the evidence on the office itself — the pulse lives there, not at the spawn
    expect(await warpHamletTo(page, 'records')).toBe(true);
    await expect.poll(async () => (await records(page)).pulsing).toBe(true); // settled
    await page.screenshot({ path: `${EV}/e2e-amended-pulse.png` });
  });

  test('§3 the card registers both truths, the quote and the Clerk lines verbatim', async ({ page }) => {
    await page.goto('/?renderer=classic&seed=7');
    await waitReady(page, 'boot');
    await resetLedger(page);
    await enterHamlet(page);
    await knockAtRecords(page);

    await expect(card(page), 'the amendment card opened before the conversation').toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator('.fw-ledger-title')).toHaveText('The Ledger Amended');

    // every player-facing string, verbatim (doc §3)
    const text = await card(page).innerText();
    expect(text).toContain('The Realm moved. The Ledger moves with it.');
    expect(text).toContain('What was true is not unwritten. It is amended. Both lines stay.');
    expect(text).toContain('Read and witnessed ▸');

    // the old truth is struck through, and it is genuinely a strike (not just a class)
    const struck = page.locator('.fw-amend-old');
    await expect(struck).toBeVisible();
    const oldText = (await struck.innerText()).trim();
    expect(OLD_STATEMENTS, 'the struck line is one of the fixture old truths').toContain(oldText);
    const decoration = await struck.evaluate((el) => getComputedStyle(el).textDecorationLine);
    expect(decoration).toContain('line-through');

    // the new truth sits beneath it, with its verbatim source quote + citation
    await expect(page.locator('.fw-amend-new')).toBeVisible();
    const newText = (await page.locator('.fw-amend-new').innerText()).trim();
    expect(newText).not.toBe(oldText);
    await expect(page.locator('.fw-excerpt')).toBeVisible();
    await expect(page.locator('.fw-cite')).toContainText('raw/almanac/almanac.md');

    // teach-only: no answer controls anywhere on the card
    await expect(page.locator('.fw-opt')).toHaveCount(0);
    await expect(page.locator('.fw-textarea')).toHaveCount(0);

    await expect.poll(async () => card(page).count()).toBe(1); // settled
    await page.screenshot({ path: `${EV}/e2e-amended-card.png` });
  });

  test('§9 witnessing writes state, and a mid-batch reload keeps the rest pending', async ({ page }) => {
    await page.goto('/?renderer=classic&seed=7');
    await waitReady(page, 'boot');
    await resetLedger(page);
    await enterHamlet(page);
    await knockAtRecords(page);

    // card 1 of a 3-card batch
    await expect(card(page)).toBeVisible({ timeout: 10_000 });
    await witnessCard(page);

    // the witness landed in its OWN state file — srs.json is untouched by the ceremony
    const witnessed = await expect
      .poll(async () => Object.keys((await readState<Amendments>(page, 'amendments.json')) ?? {}).length, {
        message: 'the witness beat persisted',
      })
      .toBe(1)
      .then(() => readState<Amendments>(page, 'amendments.json'));
    const witnessedId = Object.keys(witnessed ?? {})[0];
    expect(OLD_IDS, 'the witness is keyed by the superseded fact').toContain(witnessedId);
    const srs = await readState<Srs>(page, 'srs.json');
    expect(Object.keys(srs?.facts ?? {}), 'teach-only: no SRS record from the card').toEqual([]);

    // the next card of the batch is up — reload RIGHT HERE
    await expect(card(page), 'the batch continued to the next amendment').toBeVisible();
    await enterHamlet(page);

    await expect
      .poll(async () => (await records(page)).pending, {
        message: 'the three unwitnessed amendments are still pending after the reload',
      })
      .toBe(3);
    expect((await records(page)).pulsing, 'the office still pulses').toBe(true);
  });

  test('§2 batch cap: a visit presents at most three cards, the overflow waits', async ({ page }) => {
    await page.goto('/?renderer=classic&seed=7');
    await waitReady(page, 'boot');
    await resetLedger(page);
    await enterHamlet(page);
    await expect.poll(async () => (await records(page)).pending).toBe(4);

    await knockAtRecords(page);
    await expect(card(page)).toBeVisible({ timeout: 10_000 });

    const shownStatements: string[] = [];
    const signoffs: boolean[] = [];
    let current = await settleNextCard(page);
    while (current !== '') {
      expect(shownStatements.length, 'the batch never exceeds the cap').toBeLessThan(3);
      // §3's sign-off belongs to the LAST card of the batch, and only it
      signoffs.push(
        (await card(page).innerText()).includes('So amended. What the Ledger keeps, it keeps honestly.'),
      );
      shownStatements.push(await witnessCard(page));
      current = await settleNextCard(page);
    }
    expect(signoffs, 'the sign-off closes the batch, and appears nowhere before it').toEqual([
      false,
      false,
      true,
    ]);
    expect(shownStatements, 'exactly three distinct cards this visit').toHaveLength(3);
    expect(new Set(shownStatements).size, 'no card repeated').toBe(3);
    for (const s of shownStatements) expect(OLD_STATEMENTS).toContain(s);

    await expect
      .poll(async () => Object.keys((await readState<Amendments>(page, 'amendments.json')) ?? {}).length)
      .toBe(3);
    await expect
      .poll(async () => (await records(page)).pending, { message: 'the fourth amendment still waits' })
      .toBe(1);
  });

  test('§4 after witnessing, the new truth drills and the old one is never drawn', async ({ page }) => {
    // all four witnessed: every new truth is in play, every old truth retired
    const now = new Date().toISOString();
    await page.goto('/?renderer=classic&seed=7');
    await waitReady(page, 'boot');
    await resetLedger(page, Object.fromEntries(OLD_IDS.map((id) => [id, now])));
    await enterHamlet(page);

    await expect
      .poll(async () => (await records(page)).pending, { message: 'nothing left to amend' })
      .toBe(0);
    expect((await records(page)).pulsing, 'the pulse is out').toBe(false);
    expect((await records(page)).label).not.toContain('The Clerk has amendments.');

    // three Wellspring drills — N passes over the due queue
    for (let run = 0; run < 3; run++) {
      expect(await warpHamletTo(page, 'wellspring')).toBe(true);
      // advance the intro dialogue (real keypresses) until the first encounter opens
      await expect
        .poll(
          async () => {
            if (!(await page.locator('.fw-overlay').count())) await tapKey(page, 'e');
            return page.locator('.fw-overlay').count();
          },
          { message: `the Wellspring drill opened (run ${run + 1})`, timeout: 25_000 },
        )
        .toBeGreaterThan(0);
      if (run === 0) await page.screenshot({ path: `${EV}/e2e-amended-drill.png` });

      for (let n = 0; n < 3; n++) {
        if (!(await page.locator('.fw-overlay').count())) break;
        await answerAnyOverlay(page);
        await settleOverlay(page);
      }
      // close the outro so the next run starts clean
      for (let k = 0; k < 8; k++) await tapKey(page, 'e');
    }

    const srs = await expect
      .poll(async () => Object.keys((await readState<Srs>(page, 'srs.json'))?.facts ?? {}).length, {
        message: 'the drills recorded facts',
      })
      .toBeGreaterThan(0)
      .then(() => readState<Srs>(page, 'srs.json'));
    const recorded = Object.keys(srs?.facts ?? {});

    // the new truth entered play as a normal new fact…
    expect(
      recorded.some((id) => NEW_IDS.includes(id)),
      `a superseding fact was drilled (recorded: ${recorded.join(', ')})`,
    ).toBe(true);
    // …and no retired truth was ever drawn, across every drill
    for (const old of OLD_IDS) {
      expect(recorded, `${old} is retired and must never be drilled`).not.toContain(old);
    }
  });

  test('§6 the Library keeps both lines (⟳ marker); the Dashboard drops the old ones', async ({ page }) => {
    await page.goto('/?renderer=classic&seed=7');
    await waitReady(page, 'boot');
    await resetLedger(page);

    // The Library: an amended fable keeps its row, marked, and stops reporting a review time.
    await page.getByRole('button', { name: 'Library' }).click();
    await expect(page.locator('.lib-fact').first()).toBeVisible({ timeout: 15_000 });
    await expect
      .poll(async () => page.locator('.lib-fact').count(), { message: 'every fixture fable is shelved' })
      .toBe(10);
    await expect(page.locator('.lib-fact.is-amended')).toHaveCount(4);
    await expect(page.locator('.lib-amended')).toHaveCount(4);
    for (const statement of OLD_STATEMENTS) {
      const row = page.locator('.lib-fact', { hasText: statement });
      await expect(row).toHaveClass(/is-amended/);
      await expect(row.locator('.lib-due')).toHaveText('amended');
    }
    // the new truths are ordinary rows — unmarked, still scheduled
    const newRow = page.locator('.lib-fact', { hasText: 'The bridge toll is five copper.' });
    await expect(newRow).not.toHaveClass(/is-amended/);
    await page.screenshot({ path: `${EV}/e2e-amended-library.png` });

    // The Dashboard: 10 fixture facts, 4 superseded → the mastery aggregate counts 6.
    await page.getByRole('button', { name: 'The Ledger' }).click();
    await expect(page.locator('.dash-domain-count')).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('.dash-domain-count')).toHaveText(/\/ 6 welded/);
    await page.screenshot({ path: `${EV}/e2e-amended-dashboard.png` });
  });
});

/** Answer whichever kind the overlay shows (fixture drills are mcq; kept general).
 *  Same short-click + keyboard discipline as witnessCard: never let one actionability
 *  wait consume the whole poll window. */
async function answerAnyOverlay(page: Page): Promise<void> {
  await expect(page.locator('.fw-overlay')).toBeVisible({ timeout: 10_000 });
  await expect
    .poll(
      async () => {
        if (await page.locator('.fw-textarea').count()) {
          await page.locator('.fw-textarea').fill('the amended almanac says so').catch(() => {});
          await page.getByRole('button', { name: 'Cast' }).click({ timeout: 700 }).catch(() => {});
        } else {
          await page.locator('.fw-opt').first().click({ timeout: 700 }).catch(() => {});
        }
        return page.locator('.fw-verdict').count();
      },
      { message: 'the encounter accepted an answer (past the arm guard)', timeout: 20_000 },
    )
    .toBeGreaterThan(0);

  await expect
    .poll(
      async () => {
        // click only, same reason as witnessCard: a stray Space races the next encounter
        await page.getByRole('button', { name: 'Onward ▸' }).first().click({ timeout: 700 }).catch(() => {});
        return page.locator('.fw-verdict').count();
      },
      { message: 'the verdict was dismissed', timeout: 20_000 },
    )
    .toBe(0);
}
