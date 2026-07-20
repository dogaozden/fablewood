import { afterEach, describe, expect, it, vi } from 'vitest';
import { getLastGrade, judge, noteLastGrade } from './client';

describe('noteLastGrade / getLastGrade', () => {
  it('records a verdict and returns it unchanged (passthrough)', () => {
    const v = { verdict: 'pass' as const, line: 'The Ledger is satisfied.' };
    const returned = noteLastGrade(v, 42, 'client-stub');
    expect(returned).toBe(v);
    const last = getLastGrade();
    expect(last?.verdict).toBe('pass');
    expect(last?.line).toBe('The Ledger is satisfied.');
    expect(last?.latencyMs).toBe(42);
    expect(last?.tier).toBe('client-stub');
    expect(typeof last?.ts).toBe('number');
  });

  it('prefers the verdict\'s own latency/tier over the fallback when both are present', () => {
    const v = { verdict: 'fail' as const, line: 'Unwritten.', latencyMs: 50, tier: 'warm' };
    noteLastGrade(v, 999, 'client-stub');
    const last = getLastGrade();
    expect(last?.latencyMs).toBe(50);
    expect(last?.tier).toBe('warm');
  });

  it('falls back to the supplied latency/tier when the verdict carries neither', () => {
    const v = { verdict: 'partial' as const, line: 'Nearly.' };
    noteLastGrade(v, 17, 'native');
    const last = getLastGrade();
    expect(last?.latencyMs).toBe(17);
    expect(last?.tier).toBe('native');
  });

  it('getLastGrade reflects the most recent call, overwriting the previous one', () => {
    noteLastGrade({ verdict: 'pass', line: 'a' }, 1, 'http');
    noteLastGrade({ verdict: 'fail', line: 'b' }, 2, 'http');
    expect(getLastGrade()?.line).toBe('b');
  });
});

// Register-audit "Non-voice correctness catch": the web/HTTP fallback used to assign
// the stub's own flavor line on failure instead of AWAY_LINE (native.ts's fallback
// already did), so a browser player could get a normal-looking verdict when the judge
// was actually unreachable. isTauri() reads `window`, which is undefined under
// vitest's node test environment, so judge() always takes the fetch/HTTP path here —
// exactly the path under test — never the native branch.
const AWAY_LINE = 'The Clerk is momentarily away from his desk.';

describe('judge — web/HTTP fallback honesty (mirrors native.ts AWAY_LINE)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('assigns AWAY_LINE when the bridge fetch rejects (network error)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const v = await judge({ prompt: 'p', answer: 'a', rubric: 'r' });
    expect(v.line).toBe(AWAY_LINE);
  });

  it('assigns AWAY_LINE when the bridge responds non-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) })),
    );
    const v = await judge({ prompt: 'p', answer: 'a', rubric: 'r' });
    expect(v.line).toBe(AWAY_LINE);
  });

  it('assigns AWAY_LINE when the bridge returns a malformed verdict', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ nonsense: true }) })),
    );
    const v = await judge({ prompt: 'p', answer: 'a', rubric: 'r' });
    expect(v.line).toBe(AWAY_LINE);
  });

  it('keeps the real verdict line on a healthy bridge response (no false AWAY_LINE)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ verdict: 'pass', line: 'The Ledger is satisfied.' }),
      })),
    );
    const v = await judge({ prompt: 'p', answer: 'a', rubric: 'r' });
    expect(v.line).toBe('The Ledger is satisfied.');
    expect(v.verdict).toBe('pass');
  });
});
