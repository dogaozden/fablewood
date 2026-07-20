import { describe, expect, it } from 'vitest';
import { getLastGrade, noteLastGrade } from './client';

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
