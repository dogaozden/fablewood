/**
 * Encounter + judge provider registration. OWNED BY THE ENCOUNTERS AGENT — this stub
 * implementation is replaced wholesale; keep the side-effect-install shape.
 */
import { services, type EncounterResult, type EncounterRequest } from '../contracts';

const KINDS = ['mcq', 'free_recall', 'scenario_branch', 'match', 'order'] as const;

services.runEncounter = async (req: EncounterRequest): Promise<EncounterResult> => {
  // STUB: auto-resolves full quality after a beat so combat/dungeon can develop against it.
  await new Promise((r) => setTimeout(r, 250));
  const kind = req.kinds?.[0] ?? KINDS[req.seed % KINDS.length];
  return {
    encounterId: req.encounterId ?? `stub-${kind}`,
    kind,
    factIds: req.factIds?.slice(0, 1) ?? [],
    quality: 1,
    detail: '[stub encounter — real overlay pending]',
  };
};

services.judge = async ({ answer }) => {
  await new Promise((r) => setTimeout(r, 150));
  return {
    verdict: answer.trim().length > 20 ? 'pass' : 'partial',
    line: '[stub] The Clerk nods once.',
  };
};

services.showTeaching = async () => {
  // STUB: real "discovered documents" modal pending.
};
