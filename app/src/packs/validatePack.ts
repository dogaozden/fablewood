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

/** Validate an unknown value against the pack contract. */
export function validatePack(data: unknown): ValidationResult {
  const ok = validateFn(data);
  if (ok) return { valid: true, errors: [] };
  return {
    valid: false,
    errors: (validateFn.errors ?? []).map(formatError),
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
