import { deriveMastery } from './mastery.mjs';
import { loadPacks } from './packs.mjs';
import { matchesQuery } from './query.mjs';
import { loadSrs } from './srs.mjs';

const DAY_MS = 86_400_000;

export class UnknownPackError extends Error {
  constructor(pack, availablePacks) {
    super(`unknown pack: ${pack}. Available packs: ${availablePacks.join(', ')}`);
    this.name = 'UnknownPackError';
  }
}

function packsInScope(packs, packId) {
  if (packId === undefined) return packs;
  return packs.filter((pack) => pack.meta.id === packId);
}

function unknownPackWarning(packId) {
  return `unknown pack: ${packId}`;
}

function factWithMastery(pack, fact, state, now) {
  return {
    id: fact.id,
    pack: pack.meta.id,
    type: fact.type,
    statement: fact.statement,
    detail: fact.detail ?? null,
    tags: fact.tags ?? [],
    as_of: fact.as_of,
    source: {
      title: fact.source_version,
      loc: fact.source_ref.loc,
    },
    mastery: deriveMastery(state.facts[fact.id], now),
  };
}

async function loadToolData(ctx, packId) {
  const packResult = await loadPacks(ctx.packsDir);
  const scopedPacks = packsInScope(packResult.packs, packId);
  if (packId !== undefined && scopedPacks.length === 0) {
    return {
      packs: [],
      state: { version: 1, facts: {} },
      warnings: [...packResult.warnings, unknownPackWarning(packId)],
      unknownPack: true,
    };
  }

  const srsResult = await loadSrs(ctx.stateDir);
  return {
    packs: scopedPacks,
    state: srsResult.state,
    warnings: [...packResult.warnings, ...srsResult.warnings],
    unknownPack: false,
  };
}

export async function ledgerLookup(ctx, args) {
  const data = await loadToolData(ctx, args.pack);
  if (data.unknownPack) return { facts: [], warnings: data.warnings };

  const facts = data.packs.flatMap((pack) =>
    pack.facts
      .filter((fact) => matchesQuery(fact, args.query))
      .map((fact) => factWithMastery(pack, fact, data.state, ctx.now)),
  );

  return { facts, warnings: data.warnings };
}

function topicMatches(fact, topic) {
  const q = topic.trim().toLowerCase();
  if (!q) return false;
  return (fact.tags ?? []).some((tag) => tag.toLowerCase().includes(q));
}

export async function ledgerMastery(ctx, args) {
  const data = await loadToolData(ctx, args.pack);
  const scope = { pack: args.pack ?? null, topic: args.topic ?? null };
  const byBox = { '1': 0, '2': 0, '3': 0, '4': 0, '5': 0 };

  if (data.unknownPack) {
    return {
      scope,
      totalFacts: 0,
      byBox,
      unseen: 0,
      coveragePct: 0,
      weakest: [],
      warnings: data.warnings,
    };
  }

  const facts = data.packs.flatMap((pack) =>
    pack.facts
      .filter((fact) => args.topic === undefined || topicMatches(fact, args.topic))
      .map((fact) => ({ pack, fact })),
  );

  let unseen = 0;
  let known = 0;
  const seen = [];

  for (const { pack, fact } of facts) {
    const mastery = deriveMastery(data.state.facts[fact.id], ctx.now);
    if (mastery.box === 0) {
      unseen += 1;
      continue;
    }
    byBox[String(mastery.box)] += 1;
    if (mastery.box >= 3) known += 1;
    seen.push({
      id: fact.id,
      pack: pack.meta.id,
      statement: fact.statement,
      box: mastery.box,
      last_event: mastery.last_event,
      status: mastery.status,
    });
  }

  seen.sort((a, b) => {
    if (a.box !== b.box) return a.box - b.box;
    return (a.last_event ?? '').localeCompare(b.last_event ?? '');
  });

  const coveragePct = facts.length === 0
    ? 0
    : Math.round((known / facts.length) * 1_000) / 10;

  return {
    scope,
    totalFacts: facts.length,
    byBox,
    unseen,
    coveragePct,
    weakest: seen.slice(0, 5),
    warnings: data.warnings,
  };
}

export async function ledgerDue(ctx, args) {
  const data = await loadToolData(ctx, args.pack);
  if (data.unknownPack) return { facts: [], warnings: data.warnings };

  const dueFacts = [];
  for (const pack of data.packs) {
    for (const fact of pack.facts) {
      const entry = data.state.facts[fact.id];
      if (!entry) continue;
      const nextDueRaw = Number.isFinite(entry.next_due) ? entry.next_due : -Infinity;
      if (nextDueRaw > ctx.now) continue;
      dueFacts.push({
        ...factWithMastery(pack, fact, data.state, ctx.now),
        daysOverdue: Math.max(0, Math.floor((ctx.now - nextDueRaw) / DAY_MS)),
        next_due_raw: nextDueRaw,
      });
    }
  }

  dueFacts.sort(
    (a, b) => a.next_due_raw - b.next_due_raw || a.mastery.box - b.mastery.box,
  );

  return {
    facts: dueFacts.map(({ next_due_raw: _nextDueRaw, ...fact }) => fact),
    warnings: data.warnings,
  };
}

function renderFact(fact) {
  const detail = fact.detail ? ` — ${fact.detail}` : '';
  return `- **${fact.statement}**${detail}`;
}

export async function ledgerExport(ctx, args) {
  const packResult = await loadPacks(ctx.packsDir);
  const pack = packResult.packs.find((candidate) => candidate.meta.id === args.pack);
  if (!pack) {
    const availablePacks = packResult.packs.map((candidate) => candidate.meta.id);
    throw new UnknownPackError(args.pack, availablePacks);
  }

  const srsResult = await loadSrs(ctx.stateDir);
  const warnings = [...packResult.warnings, ...srsResult.warnings];
  const minBox = args.minBox ?? 3;
  const selected = pack.facts.filter(
    (fact) => deriveMastery(srsResult.state.facts[fact.id], ctx.now).box >= minBox,
  );

  const lines = [
    `# ${pack.meta.title} — box >= ${minBox} (exported ${new Date(ctx.now).toISOString()})`,
    `_Source: ${pack.meta.sources.map((source) => source.title).join('; ')}_`,
  ];

  if (selected.length === 0) {
    lines.push('', `_No facts yet at box >= ${minBox}._`);
  } else {
    const sections = new Map();
    for (const fact of selected) {
      const tags = fact.tags?.length ? [...new Set(fact.tags)] : ['Untagged'];
      for (const tag of tags) {
        const section = sections.get(tag) ?? [];
        section.push(fact);
        sections.set(tag, section);
      }
    }

    for (const [tag, facts] of sections) {
      lines.push('', `## ${tag}`);
      facts
        .sort((a, b) => a.id.localeCompare(b.id))
        .forEach((fact) => lines.push(renderFact(fact)));
    }
  }

  for (const warning of warnings) {
    lines.push('', `> Note: ${warning}`);
  }

  return { markdown: lines.join('\n'), factCount: selected.length, warnings };
}
