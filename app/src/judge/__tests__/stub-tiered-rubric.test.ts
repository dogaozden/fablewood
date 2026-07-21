import { describe, it, expect } from 'vitest';
import { stubJudge } from '../stub';

/**
 * Pins the tiered-rubric-grading mechanism stub.ts added on top of the plain keyword-overlap
 * heuristic (stub.test.ts covers that base heuristic). Fixtures here are invented and
 * domain-free (a fantasy "loom and kiln" beat, nothing lifted from any real pack) — the
 * engine/content split forbids domain knowledge in app/, so these must never borrow real
 * pack rubric text, even for a test.
 */

// A rubric in the house tiered style: "Full credit… Partial credit… No credit… (the classic
// trap)." The trap sentence names a plausible-looking wrong answer (41) that must NOT become
// a scoring key — only Full/Partial credit sentences describe what a good answer contains.
const RUBRIC_TIERED =
  'Full credit if the answer names the loom and the kiln as the two things that matter. ' +
  'Partial credit for naming only one of them. ' +
  'No credit for 41 (the classic trap).';
const PROMPT_TIERED = 'Name the two things that matter to a moss-warden.';

describe('stubJudge — tiered rubric grading', () => {
  it('strips "No credit" sentences: trap words never become keys', () => {
    // "41" and "classic trap" appear ONLY inside the stripped No-credit sentence — an answer
    // consisting of nothing else must fail, proving those words never entered the key set.
    expect(stubJudge({ prompt: PROMPT_TIERED, rubric: RUBRIC_TIERED, answer: '41' }).verdict).toBe('fail');
    expect(stubJudge({ prompt: PROMPT_TIERED, rubric: RUBRIC_TIERED, answer: 'classic trap' }).verdict).toBe('fail');
  });

  it('a terse-but-correct answer against a tiered rubric passes', () => {
    // Naming both required terms, even with none of the rubric's surrounding prose, satisfies
    // the Full-credit tier as authored — the denominator's min(keys, answerWords) side lets a
    // short answer reach full overlap on its own word count rather than the rubric's whole key set.
    expect(stubJudge({ prompt: PROMPT_TIERED, rubric: RUBRIC_TIERED, answer: 'Loom and kiln.' }).verdict).toBe('pass');
  });

  it('a single fished keyword is capped at partial, never pass', () => {
    // Naming only one of the two required terms is explicitly the rubric's Partial-credit
    // tier — the denominator's floor of 2 caps a lone keyword hit at 0.5 (partial), so
    // fishing a single plausible word out of a multi-concept rubric can never bluff a pass.
    expect(stubJudge({ prompt: PROMPT_TIERED, rubric: RUBRIC_TIERED, answer: 'loom' }).verdict).toBe('partial');
  });

  it('a numeric terse answer scores against a rubric whose full-credit sentence contains it', () => {
    const rubric = 'Full credit if the correct measure is 25 grains per vial. Partial credit if the unit is missing.';
    const prompt = 'How many grains of moss-dust per vial?';
    // "25" is 2 characters — the numeric-token exception (length ≥2 for digit-bearing tokens)
    // is what keeps it from being filtered out entirely like a pure-alpha 2-letter token would be.
    const verdict = stubJudge({ prompt, rubric, answer: '25' }).verdict;
    expect(['partial', 'pass']).toContain(verdict);
  });

  it('a plain, untiered rubric (no "Full credit" prose) behaves as it did before', () => {
    const rubric = 'Credit if the answer explains that the kiln must cool for a full day before the glaze is checked.';
    const prompt = 'Recite the kiln-glaze rule.';
    // Nothing to strip (no "No credit" sentence) — a verbose, near-complete answer still
    // passes, and an unrelated one still fails, exactly like the pre-tiering heuristic.
    expect(
      stubJudge({ prompt, rubric, answer: 'the kiln must cool for a full day before the glaze is checked' }).verdict,
    ).toBe('pass');
    expect(stubJudge({ prompt, rubric, answer: 'goblins dance under moonlight' }).verdict).toBe('fail');
  });

  it('an empty rubric keeps the presence-heuristic fallback unchanged', () => {
    // keys.size === 0 (no gradable content, before OR after the tiering strip) still leans
    // on "did the player write anything at all" rather than tiered scoring.
    expect(stubJudge({ prompt: 'anything', rubric: '', answer: 'some answer text' }).verdict).toBe('partial');
    expect(stubJudge({ prompt: 'anything', rubric: '', answer: '' }).verdict).toBe('fail');
  });
});
