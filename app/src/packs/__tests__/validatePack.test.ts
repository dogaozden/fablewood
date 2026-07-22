import { describe, it, expect } from 'vitest';
import { validatePack } from '../validatePack';
import validPack from './fixtures/valid-mosslore.json';

// structuredClone (Node 18+) so each mutation starts from a pristine valid pack.
function clone(): any {
  return structuredClone(validPack);
}

describe('validatePack', () => {
  it('accepts the toy moss-lore pack', () => {
    const result = validatePack(validPack);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a bad fact type (enum)', () => {
    const pack = clone();
    pack.facts[0].type = 'legendary';
    const result = validatePack(pack);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('/facts/0/type');
    expect(result.errors.join('\n').toLowerCase()).toContain('allowed');
  });

  it('rejects a fact missing source_ref', () => {
    const pack = clone();
    delete pack.facts[0].source_ref;
    const result = validatePack(pack);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('source_ref');
  });

  it('rejects out-of-range difficulty', () => {
    const high = clone();
    high.facts[0].difficulty = 7;
    expect(validatePack(high).valid).toBe(false);
    expect(validatePack(high).errors.join('\n')).toContain('difficulty');

    const zero = clone();
    zero.facts[0].difficulty = 0;
    expect(validatePack(zero).valid).toBe(false);

    const nonInt = clone();
    nonInt.facts[0].difficulty = 'hard';
    expect(validatePack(nonInt).valid).toBe(false);
  });

  it('accepts a fact carrying supersedes/superseded_by (additive, optional — vision §3b/§9.3)', () => {
    const pack = clone();
    pack.facts[0].superseded_by = 'mf-002';
    pack.facts[1].supersedes = 'mf-001';
    const result = validatePack(pack);
    expect(result.errors).toEqual([]);
    expect(result.valid).toBe(true);
  });

  it('rejects a non-string supersedes value', () => {
    const pack = clone();
    pack.facts[0].supersedes = 42;
    const result = validatePack(pack);
    expect(result.valid).toBe(false);
  });

  it('enforces encounter kind requirements (mcq needs an answer)', () => {
    const pack = clone();
    delete pack.encounters[0].answer; // me-001 is mcq
    const result = validatePack(pack);
    expect(result.valid).toBe(false);
    expect(result.errors.join('\n')).toContain('answer');
  });

  it('enforces free_recall needs a rubric', () => {
    const pack = clone();
    delete pack.encounters[1].rubric; // me-002 is free_recall
    expect(validatePack(pack).valid).toBe(false);
  });

  it('rejects non-objects and empties', () => {
    expect(validatePack(null).valid).toBe(false);
    expect(validatePack({}).valid).toBe(false);
    expect(validatePack({ meta: { id: 'x' } }).valid).toBe(false);
  });
});
