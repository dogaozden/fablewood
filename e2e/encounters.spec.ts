import { test, expect, type Page } from '@playwright/test';
import { openOverlay } from './helpers';

// Drives the encounter overlay + Laconic Clerk judge (JUDGE_MODE=stub) through the ?overlay=
// dev harness — all five kinds + teaching, correct and wrong answers, asserting the quality→
// verdict mapping the combat layer relies on. Deterministic (fixture data + seed 7 + stub judge).

interface VerdictRevealProbe {
  beforeScrollTop: number;
  revealScrollTop: number;
  panelScrollHeight: number;
  panelClientHeight: number;
  verdictTop: number;
  verdictBottom: number;
  viewportHeight: number;
}

/**
 * Observe the reveal mutation itself. An end-state-only visibility check missed the original
 * regression because native button focus had already snapped the panel to its final position.
 */
async function armVerdictRevealProbe(page: Page, verdictSelector: string): Promise<void> {
  await page.evaluate((selector) => {
    const panel = document.querySelector<HTMLElement>('.fw-panel');
    if (!panel) throw new Error('encounter panel missing');
    delete panel.dataset.verdictRevealProbe;

    let beforeScrollTop = panel.scrollTop;
    panel.addEventListener('click', () => { beforeScrollTop = panel.scrollTop; }, {
      capture: true,
      once: true,
    });

    const observer = new MutationObserver(() => {
      const verdict = panel.querySelector<HTMLElement>(selector);
      if (!verdict) return;
      const rect = verdict.getBoundingClientRect();
      const result: VerdictRevealProbe = {
        beforeScrollTop,
        revealScrollTop: panel.scrollTop,
        panelScrollHeight: panel.scrollHeight,
        panelClientHeight: panel.clientHeight,
        verdictTop: rect.top,
        verdictBottom: rect.bottom,
        viewportHeight: window.innerHeight,
      };
      observer.disconnect();
      panel.dataset.verdictRevealProbe = JSON.stringify(result);
    });
    observer.observe(panel, { childList: true, subtree: true });
  }, verdictSelector);
}

async function expectStableVerdictReveal(page: Page): Promise<void> {
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('.fw-panel')?.dataset.verdictRevealProbe,
  );
  const reveal = await page.locator('.fw-panel').evaluate((panel) => (
    JSON.parse((panel as HTMLElement).dataset.verdictRevealProbe ?? '') as VerdictRevealProbe
  ));

  expect(
    reveal.panelScrollHeight,
    'the fixture must overflow so this exercises the focus-scroll regression',
  ).toBeGreaterThan(reveal.panelClientHeight);
  expect(
    Math.abs(reveal.revealScrollTop - reveal.beforeScrollTop),
    'the panel must not snap when the verdict first appears',
  ).toBeLessThanOrEqual(3);
  expect(reveal.verdictTop, 'the verdict top is inside the viewport at reveal').toBeGreaterThanOrEqual(0);
  expect(reveal.verdictBottom, 'the full verdict is inside the viewport at reveal').toBeLessThanOrEqual(
    reveal.viewportHeight,
  );
}

test.describe('encounter overlay — all kinds', () => {
  test('mcq (Smite): correct answer → pass verdict', async ({ page }) => {
    await openOverlay(page, 'mcq');
    await expect(page.locator('.fw-eyebrow')).toContainText('Smite');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await page.locator('.fw-opt', { hasText: 'The third week' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('mcq (Smite): wrong answer → fail verdict + teach-on-miss reveals the answer', async ({ page }) => {
    await openOverlay(page, 'mcq');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await armVerdictRevealProbe(page, '.fw-verdict.fail');
    await page.locator('.fw-opt', { hasText: 'It never glows' }).click();
    await expect(page.locator('.fw-verdict.fail')).toBeVisible();
    // teach-on-miss shows the correct answer + the fact statement
    await expect(page.locator('.fw-teach')).toContainText('The third week');
    await expectStableVerdictReveal(page);
  });

  test('free_recall (Cast From Memory): good answer → stub judge pass', async ({ page }) => {
    await openOverlay(page, 'free_recall');
    await expect(page.locator('.fw-eyebrow')).toContainText('Cast From Memory');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await page.locator('.fw-textarea').fill('wait for the frost-bell before harvesting whispermoss');
    await page.getByRole('button', { name: 'Cast' }).click();
    // stub judge is deterministic + instant; a verdict banner + Clerk line renders
    await expect(page.locator('.fw-verdict.pass')).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('.fw-verdict.pass')).not.toBeEmpty();
    // the book's verbatim words show even on a correct cast (the author's live request)
    await expect(page.locator('.fw-excerpt')).toBeVisible();
    await expect(page.locator('.fw-cite')).toContainText('compendium');
  });

  test('free_recall: real typing survives the game key captures (WASD/E/Space)', async ({ page }) => {
    // Regression: hamlet's Phaser key captures preventDefault'ed W/A/S/D/E/Space at the
    // window level even while the recall textarea was focused — "economics and control"
    // arrived as "conomicncontrol". Real key events (not fill), over the hamlet scene so
    // the captures are actually registered.
    await openOverlay(page, 'free_recall', 7, 'hamlet');
    const ta = page.locator('.fw-textarea');
    await ta.click();
    await page.keyboard.type('we saved economics and control', { delay: 20 });
    await expect(ta).toHaveValue('we saved economics and control');
    await page.screenshot({ path: 'screenshots/e2e-freerecall-typing.png' });
  });

  test('scenario_branch (Parley): correct branch → pass verdict + consequence', async ({ page }) => {
    await openOverlay(page, 'scenario_branch');
    await expect(page.locator('.fw-eyebrow')).toContainText('Parley');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await page.locator('.fw-opt', { hasText: 'Shoo it gently' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
    await expect(page.locator('.fw-verdict.pass')).toContainText('spared');
  });

  test('match (Binding Weave): all pairs correct → pass verdict', async ({ page }) => {
    await openOverlay(page, 'match');
    // register-audit CRITICAL: the column headers are engine chrome, not dev-fixture content —
    // every real pack's Binding Weave encounter renders under these same two labels, so they
    // must be domain-neutral, never this fixture's own 'Moss'/'Gift' vocabulary.
    await expect(page.locator('.fw-colhead').nth(0)).toHaveText('Claim');
    await expect(page.locator('.fw-colhead').nth(1)).toHaveText('True Name');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    const pair = async (left: string, right: string) => {
      await page.locator('.fw-chip', { hasText: left }).click();
      await page.locator('.fw-chip', { hasText: right }).click();
    };
    await pair('Lantern-moss', 'glow');
    await pair('Whispermoss', 'song');
    await pair('Dampmoss', 'balm');
    await page.getByRole('button', { name: 'Seal the Weave' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('match (Binding Weave): miss reveals a stable verdict card', async ({ page }) => {
    // At this height, the pre-answer weave fits but its verdict + teach reveal overflows.
    await page.setViewportSize({ width: 1280, height: 520 });
    await openOverlay(page, 'match');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    const pair = async (left: string, right: string) => {
      await page.locator('.fw-chip', { hasText: left }).click();
      await page.locator('.fw-chip', { hasText: right }).click();
    };
    await pair('Lantern-moss', 'song');
    await pair('Whispermoss', 'balm');
    await pair('Dampmoss', 'glow');

    await armVerdictRevealProbe(page, '.fw-verdict.fail');
    await page.getByRole('button', { name: 'Seal the Weave' }).click();
    await expect(page.locator('.fw-verdict.fail')).toBeVisible();
    await expect(page.locator('.fw-teach')).toContainText('The true binding');
    await expectStableVerdictReveal(page);
  });

  test('order (Ritual Sequence): sorted correctly → pass verdict', async ({ page }) => {
    await openOverlay(page, 'order');
    const target = ['Wait for the frost-bell', 'Gather at first light', 'Dry in lantern-glow', 'Bind with reed'];
    // selection sort by clicking each item's "up" button until it reaches its slot
    for (let i = 0; i < target.length; i++) {
      for (let guard = 0; guard < 12; guard++) {
        const labels = (await page.locator('.fw-steplabel').allInnerTexts()).map((t) => t.trim());
        const j = labels.findIndex((l) => l === target[i]);
        if (j <= i) break;
        await page.locator('.fw-step').nth(j).locator('.fw-move button').first().click();
        await page.waitForTimeout(60);
      }
    }
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
    await expect(page.locator('.fw-verdict.pass')).toBeVisible();
  });

  test('order (Ritual Sequence): miss reveals a stable verdict card', async ({ page }) => {
    // At this height, the pre-answer sequence fits but its verdict + teach reveal overflows.
    await page.setViewportSize({ width: 1280, height: 520 });
    await openOverlay(page, 'order');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    // reskin() guarantees the initial sequence is not already solved.
    await armVerdictRevealProbe(page, '.fw-verdict:not(.pass)');
    await page.getByRole('button', { name: 'Seal the Sequence' }).click();
    await expect(page.locator('.fw-verdict:not(.pass)')).toBeVisible();
    await expect(page.locator('.fw-teach')).toContainText('The proper order');
    await expectStableVerdictReveal(page);
  });

  // Crucible finding #12 (sev2, input-mangler): the panel is a tabIndex=-1 "programmatic
  // keyboard host" (styles.ts) — the browser's default click-to-focus delegates a stray click
  // on any INERT content (no focusable target of its own, e.g. the teach block below) to that
  // panel, stealing focus off whatever control held it. The shared Continue/Onward button relies
  // entirely on being the focused element for Enter/Space to activate it (kinds.ts's
  // continueButton has no key handler of its own) — so that stray click silently killed
  // keyboard dismissal (a mouse click on the button itself still worked).
  test('overlay: a stray click on inert content must not defocus Onward (Enter still advances)', async ({ page }) => {
    await openOverlay(page, 'mcq');
    await page.waitForTimeout(450); // past overlay.ts's paint-anchored 400ms answer guard
    await page.locator('.fw-opt', { hasText: 'It never glows' }).click(); // miss on purpose
    await expect(page.locator('.fw-verdict.fail')).toBeVisible();

    // T2 consistency rename: every sibling button uses a directional verb + ▸.
    const cont = page.getByRole('button', { name: 'Onward ▸' });
    await expect(cont, 'the shared Continue/Onward button auto-focuses on a miss').toBeFocused();

    await page.locator('.fw-teach').click(); // the stray click — inert, non-interactive content

    await page.keyboard.press('Enter');
    await expect(
      page.locator('.fw-overlay'),
      'Enter still dismisses the overlay after the stray click',
    ).toHaveCount(0, { timeout: 5_000 });
  });

  test('teaching (discovered documents): pages through and closes', async ({ page }) => {
    await openOverlay(page, 'teaching');
    await expect(page.locator('.fw-doc')).toBeVisible();
    await expect(page.locator('.fw-eyebrow')).toContainText('Discovered Document');
    const btn = page.locator('.fw-footer .fw-btn-primary');
    for (let i = 0; i < 8; i++) {
      const txt = await btn.innerText();
      await btn.click();
      if (txt.includes('Close')) break;
      await page.waitForTimeout(80);
    }
    await expect(page.locator('.fw-overlay')).toHaveCount(0);
  });
});
