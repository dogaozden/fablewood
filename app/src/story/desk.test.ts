import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const UI = readFileSync(join(__dirname, 'ui.ts'), 'utf8');
const REGISTER = readFileSync(join(__dirname, 'register.ts'), 'utf8');

describe('the reading desk chrome (CARRY items 3 and 4)', () => {
  it('renders a close-hint element, the way the story card renders .fw-story-hint', () => {
    expect(UI, 'a .fw-desk-hint style rule exists').toContain('.fw-desk-hint');
    expect(UI, "the hint element is built and says how to close").toContain("'fw-desk-hint', 'Esc · close'");
  });

  it('gives .fw-desk-body a fade mask so an overflowing canto reads as scrollable', () => {
    expect(UI).toContain('mask-image');
  });

  it('openDeskUi accepts opts and auto-closes on the same 600ms beat as showBeatCard', () => {
    expect(UI).toContain('export function openDeskUi(model: DeskModel, opts?: { auto?: boolean })');
    expect(UI, 'the auto-close timer mirrors showBeatCard (ui.ts:105)').toContain(
      "if (opts?.auto) setTimeout(done, 600);",
    );
  });

  it('services.story.openDesk actually threads opts through — the interface stops lying', () => {
    expect(REGISTER).toContain('openDesk: async (opts?: { auto?: boolean }): Promise<void>');
    expect(REGISTER).toContain('}, opts);');
  });
});

describe('the engine-destination id is pinned by construction (Task 4 review R1)', () => {
  it('register.ts holds no fresh literal of the road spec id — it imports beats.ts\'s ROAD_SPEC', () => {
    // Before this fix, ENGINE_DESTINATIONS spelled the id itself ({ id: 'arc01-road', ... }),
    // a fourth, test-unpinned copy whose drift would silently degrade the gate's "Road South"
    // choice to the dev fixture (review-task4-verdict.md §1). beats.test.ts already pins
    // beats.ts's ROAD_SPEC against engineSpecs.ts's ROAD_SPEC_ID behaviourally; importing the
    // SAME constant here — rather than retyping it — makes drift structurally impossible
    // instead of merely untested.
    expect(REGISTER, 'no re-typed literal of the id').not.toMatch(/id:\s*'arc01-road'/);
    expect(REGISTER, "imports ROAD_SPEC from beats.ts").toMatch(/import\s*\{[^}]*\bROAD_SPEC\b[^}]*\}\s*from\s*'\.\/beats'/);
    expect(REGISTER, 'uses the imported constant as the destination id').toMatch(/id:\s*ROAD_SPEC\b/);
  });
});
