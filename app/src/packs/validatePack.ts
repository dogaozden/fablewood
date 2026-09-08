import Ajv from 'ajv';
import type { ErrorObject } from 'ajv';
import schema from './pack.schema.json';
import type { Pack } from './types';

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

// strict: false — draft-07 if/then plus permissive type-arrays; we want validation,
// not schema-authoring pedantry.
const ajv = new Ajv({ allErrors: true, strict: false });
const validateFn = ajv.compile(schema);

function formatError(err: ErrorObject): string {
  const where = err.instancePath || '(root)';
  const extra =
    err.keyword === 'enum' && Array.isArray(err.params?.allowedValues)
      ? ` (allowed: ${(err.params.allowedValues as unknown[]).join(', ')})`
      : '';
  return `${where} ${err.message ?? 'is invalid'}${extra}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Validate the cross-field rules for the durable duplicate relationship.
 *
 * JSON Schema checks the field's type; these checks establish its graph and
 * pack-local invariants. Keeping this helper pure lets the runtime validator
 * and focused tests exercise the same contract without loading a pack from
 * disk. The runtime index has a matching tolerant policy and simply ignores
 * declarations that fail these checks.
 */
export function checkDuplicateAliases(data: unknown): string[] {
  if (!isRecord(data) || !Array.isArray(data.facts)) return [];

  const facts = data.facts.filter(isRecord);
  const factsById = new Map<string, Record<string, unknown>>();
  for (const fact of facts) {
    if (typeof fact.id !== 'string' || fact.id.length === 0 || factsById.has(fact.id)) continue;
    factsById.set(fact.id, fact);
  }

  const errors: string[] = [];
  for (const fact of facts) {
    const aliasTarget = fact.duplicate_of;
    if (aliasTarget === undefined) continue;

    const id = typeof fact.id === 'string' ? fact.id : '(unknown)';
    if (typeof aliasTarget !== 'string' || aliasTarget.length === 0) {
      errors.push(`[${id}] duplicate_of must be a non-empty string`);
      continue;
    }
    if (aliasTarget === fact.id) {
      errors.push(`[${id}] duplicate_of itself (self-reference)`);
    }
    if (fact.supersedes !== undefined || fact.superseded_by !== undefined) {
      errors.push(`[${id}] duplicate_of cannot be combined with supersedes or superseded_by`);
    }

    const target = factsById.get(aliasTarget);
    if (!target) {
      errors.push(`[${id}] duplicate_of unknown fact id: ${aliasTarget}`);
    } else if (target.duplicate_of !== undefined) {
      errors.push(`[${id}] duplicate_of target ${aliasTarget} is itself an alias; duplicate chains/cycles are not allowed`);
    } else if (target.supersedes !== undefined || target.superseded_by !== undefined) {
      errors.push(`[${id}] duplicate_of target ${aliasTarget} cannot carry supersedes or superseded_by metadata`);
    }
  }

  // Report an explicit cycle once, even though each edge in the cycle also
  // violates the direct-canonical rule above.
  const reportedCycles = new Set<string>();
  for (const start of facts) {
    if (typeof start.id !== 'string' || typeof start.duplicate_of !== 'string') continue;
    const path: string[] = [];
    const position = new Map<string, number>();
    let current: string | undefined = start.id;
    while (current !== undefined) {
      if (position.has(current)) {
        const cycle = path.slice(position.get(current)!).concat(current);
        const key = cycle.slice(0, -1).slice().sort().join('\u0000');
        if (!reportedCycles.has(key)) {
          reportedCycles.add(key);
          errors.push(`duplicate_of cycle detected: ${cycle.join(' -> ')}`);
        }
        break;
      }
      position.set(current, path.length);
      path.push(current);
      const fact = factsById.get(current);
      const next = fact?.duplicate_of;
      if (typeof next !== 'string' || !factsById.has(next)) break;
      current = next;
    }
  }

  return errors;
}

/** Validate an unknown value against the pack contract. */
export function validatePack(data: unknown): ValidationResult {
  const ok = validateFn(data);
  const schemaErrors = ok ? [] : (validateFn.errors ?? []).map(formatError);
  const aliasErrors = checkDuplicateAliases(data);
  return {
    valid: ok && aliasErrors.length === 0,
    errors: [...schemaErrors, ...aliasErrors],
  };
}

/** Validate and narrow to Pack, throwing a readable error on failure. */
export function assertPack(data: unknown): Pack {
  const result = validatePack(data);
  if (!result.valid) {
    throw new Error(`Invalid pack:\n  ${result.errors.join('\n  ')}`);
  }
  return data as Pack;
}
