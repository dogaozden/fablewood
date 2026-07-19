/**
 * Dev fixture — a self-contained, domain-free "moss lore" pack: one encounter of each of the
 * five kinds, plus the facts they teach. Used two ways:
 *   1. register.ts falls back to it when zero packs are installed (engine stays playable packless);
 *   2. the ?overlay=<kind> dev harness opens one kind straight from here for screenshots/e2e.
 * Deliberately fantasy, not VC law: it must carry NO domain knowledge (engine/content split).
 */
import type { Fact, Pack } from '../../packs/types';
import type { FactLite } from '../contracts';

export const FIXTURE_FACTS: Fact[] = [
  {
    id: 'mf-glow',
    type: 'concept',
    statement: 'Lantern-moss glows brightest in the third week after rain.',
    detail: 'The glow fades early if the hollow dries before the third week is out.',
    source_ref: {
      file: 'raw/mosslore/compendium.md',
      loc: 'p.12',
      quote: 'Lantern-moss glows brightest in the third week after the rains, and dimmer ever after.',
    },
    as_of: '2026-07-19',
    source_version: '1.0',
    tags: ['lantern-moss', 'glow'],
    difficulty: 2,
  },
  {
    id: 'mf-frost',
    type: 'rule',
    statement: 'Never harvest whispermoss before the frost-bell rings.',
    detail: 'Cut too early, the moss forgets its song and will not sing again.',
    source_ref: {
      file: 'raw/mosslore/compendium.md',
      loc: 'p.31',
      quote: 'Never lay blade to whispermoss before the frost-bell rings, lest its song be lost.',
    },
    as_of: '2026-07-19',
    source_version: '1.0',
    tags: ['whispermoss', 'harvest'],
    difficulty: 3,
  },
  {
    id: 'mf-stones',
    type: 'number',
    statement: 'A healthy moss-hollow holds seven singing stones.',
    detail: 'Fewer than seven and the hollow has begun to fade.',
    source_ref: {
      file: 'raw/mosslore/compendium.md',
      loc: 'p.44',
      quote: 'Count the singing stones: seven to a healthy hollow, no fewer.',
    },
    as_of: '2026-07-19',
    source_version: '1.0',
    tags: ['moss-hollow'],
    difficulty: 1,
  },
  {
    id: 'mf-ember',
    type: 'dont',
    statement: "Don't let emberfoxes near the dampmoss beds.",
    detail: 'Their warmth withers dampmoss by morning.',
    source_ref: {
      file: 'raw/mosslore/compendium.md',
      loc: 'p.58',
      quote: 'Keep the emberfox from the dampmoss beds, for its warmth is their ruin.',
    },
    as_of: '2026-07-19',
    source_version: '1.0',
    tags: ['dampmoss', 'emberfox'],
    difficulty: 2,
  },
];

export const FIXTURE_PACK: Pack = {
  meta: {
    id: '__fixture__',
    title: 'Moss Lore of the Fablewood (dev fixture)',
    version: '0.1.0',
    sources: [{ id: 'green-compendium', title: 'The Green Compendium', author: 'The Old Mosswright' }],
  },
  facts: FIXTURE_FACTS,
  encounters: [
    {
      id: 'fx-mcq',
      fact_ids: ['mf-glow'],
      kind: 'mcq',
      template_vars: { moss: ['lantern-moss', 'glimmer-moss', 'the hollow-moss'] },
      prompt: 'When does {{moss}} glow brightest after the rains?',
      options: ['The first week', 'The second week', 'The third week', 'It never glows'],
      answer: 'The third week',
      trap_notes: 'The distractors are the neighbouring weeks — this tests precise recall, not a vibe.',
    },
    {
      id: 'fx-free-recall',
      fact_ids: ['mf-frost'],
      kind: 'free_recall',
      prompt: 'Cast the whispermoss harvest rule from memory.',
      rubric:
        'Credit if the answer says to wait for the frost-bell to ring before harvesting whispermoss.',
    },
    {
      id: 'fx-scenario',
      fact_ids: ['mf-ember'],
      kind: 'scenario_branch',
      prompt: 'An emberfox pads toward the dampmoss beds at dusk. What do you do?',
      branches: [
        { label: 'Shoo it gently back toward the warm stones', outcome: 'The dampmoss beds are spared. Good keeping.', correct: true },
        { label: 'Let it curl up among the dampmoss to warm itself', outcome: 'By morning the dampmoss has withered. The Fade creeps in.', correct: false },
        { label: 'Do nothing and watch a while', outcome: 'You learn little, and risk more. The beds are uneasy.', correct: false },
      ],
    },
    {
      id: 'fx-match',
      fact_ids: ['mf-glow', 'mf-frost', 'mf-ember'],
      kind: 'match',
      prompt: 'Match each moss to its gift.',
      options: [
        ['Lantern-moss', 'Whispermoss', 'Dampmoss'],
        ['glow', 'song', 'balm'],
      ],
      answer: [
        ['Lantern-moss', 'glow'],
        ['Whispermoss', 'song'],
        ['Dampmoss', 'balm'],
      ],
    },
    {
      id: 'fx-order',
      fact_ids: ['mf-frost'],
      kind: 'order',
      prompt: 'Put the whispermoss harvest in its proper order.',
      options: ['Wait for the frost-bell', 'Gather at first light', 'Dry in lantern-glow', 'Bind with reed'],
      answer: ['Wait for the frost-bell', 'Gather at first light', 'Dry in lantern-glow', 'Bind with reed'],
    },
  ],
  quests: [],
  metaphor_map: {
    'the Fade': 'forgetting a fact',
    ghost: 'a fact overdue for review',
    'weld strength': "a fact's Leitner box",
  },
};

/** The facts a teaching moment reveals (also the ?overlay=teaching harness payload). */
export const FIXTURE_TEACHING: FactLite[] = FIXTURE_FACTS.slice(0, 3).map((f) => ({
  id: f.id,
  type: f.type,
  statement: f.statement,
  detail: f.detail,
  source_ref: f.source_ref,
}));
