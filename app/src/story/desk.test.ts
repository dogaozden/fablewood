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
