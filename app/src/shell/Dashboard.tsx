import { useEffect, useState } from 'react';
import { getPacks, getState } from '../bridge/client';
import { services } from '../game/contracts';
import './shell.css';

/**
 * The Dashboard pane — the hamlet is the dashboard (spec §7). Reads the live
 * Ledger (SRS + save) over the service contract and shows it as warm panels over
 * the hamlet vignette: what's due, the streak, province mastery, last entry.
 */

interface Props {
  /** switch the shell to the Game tab */
  onSetOut: () => void;
}

interface Metrics {
  hasPack: boolean;
  provinceTitle: string;
  dueNow: number;
  totalFacts: number;
  welded: number; // facts with box > 0
  mastery: number; // avg box, 0-5
  streak: number;
  lastPlayed: string;
  nextDueMs?: number; // soonest upcoming review among welded facts
}

interface RawPack {
  meta?: { title?: string };
  facts?: { id: string }[];
}

const safe = <T,>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

/** Soonest upcoming review time across the pack's facts (from the persisted Ledger). */
async function soonestNextDue(factIds: string[]): Promise<number | undefined> {
  const raw = await getState<{ facts?: Record<string, { next_due?: number }> }>('srs.json');
  const facts = raw?.facts;
  if (!facts) return undefined;
  const now = Date.now();
  let soonest = Infinity;
  for (const id of factIds) {
    const nd = facts[id]?.next_due;
    if (typeof nd === 'number' && nd > now && nd < soonest) soonest = nd;
  }
  return soonest === Infinity ? undefined : soonest;
}

async function computeMetrics(): Promise<Metrics> {
  await Promise.all([services.srs.ready(), services.save.ready()]).catch(() => {});
  let streak = 0;
  let lastPlayed = '';
  try {
    const s = services.save.get();
    streak = s.streak;
    lastPlayed = s.lastPlayed;
  } catch {
    /* no save yet */
  }
  const { packs } = await getPacks();
  const first = packs[0];
  if (!first) {
    return { hasPack: false, provinceTitle: '', dueNow: 0, totalFacts: 0, welded: 0, mastery: 0, streak, lastPlayed };
  }
  const pack = first.pack as RawPack;
  const factIds = (pack.facts ?? []).map((f) => f.id);
  const dueNow = safe(() => services.srs.dueQueue(first.id, factIds).length, factIds.length);
  const welded = factIds.filter((id) => safe(() => services.srs.boxOf(id), 0) > 0).length;
  const mastery = safe(() => services.srs.masteryAvg(factIds), 0);
  const nextDueMs = await soonestNextDue(factIds).catch(() => undefined);
  return {
    hasPack: true,
    provinceTitle: pack.meta?.title ?? first.id,
    dueNow,
    totalFacts: factIds.length,
    welded,
    mastery,
    streak,
    lastPlayed,
    nextDueMs,
  };
}

function ago(iso: string): string {
  if (!iso) return 'no entry yet';
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const s = (Date.now() - t) / 1000;
  if (s < 90) return 'moments ago';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} days ago`;
}

function until(ms: number): string {
  const s = (ms - Date.now()) / 1000;
  if (s <= 0) return 'now';
  if (s < 3600) return `in ${Math.max(1, Math.floor(s / 60))} min`;
  if (s < 86400) return `in ${Math.floor(s / 3600)} h`;
  return `in ${Math.floor(s / 86400)} days`;
}

export function Dashboard({ onSetOut }: Props) {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    computeMetrics()
      .then((metrics) => alive && setM(metrics))
      .catch(() => alive && setM({ hasPack: false, provinceTitle: '', dueNow: 0, totalFacts: 0, welded: 0, mastery: 0, streak: 0, lastPlayed: '' }));
    return () => {
      alive = false;
    };
  }, []);

  if (!m) {
    return (
      <div className="dash">
        <div className="dash-inner">
          <p className="dash-loading">Consulting the Ledger…</p>
        </div>
      </div>
    );
  }

  const flames = Math.min(m.streak, 5);
  const dueNote =
    m.dueNow > 0
      ? 'the Fade gnaws — renew them'
      : m.nextDueMs
        ? `the next fable stirs ${until(m.nextDueMs)}`
        : 'the Ledger rests easy';

  return (
    <div className="dash">
      <div className="dash-inner">
        <header className="dash-head">
          <div>
            <h1 className="dash-title">The Hamlet</h1>
            <p className="dash-sub">
              {m.hasPack ? `${m.provinceTitle} · your home in the Ledger Realms` : 'your home in the Ledger Realms'}
            </p>
          </div>
          <button className="dash-setout" onClick={onSetOut}>
            Set out ▸
          </button>
        </header>

        {!m.hasPack ? (
          <div className="dash-empty">
            <h2>The roads are quiet, Keeper.</h2>
            <p>No province has been settled yet. Compile a knowledge pack into <code>packs/</code>, and the Ledger will begin to fill.</p>
            <p>Your hearth still burns {m.streak > 0 ? `${m.streak} nights tall` : 'unkindled'}.</p>
          </div>
        ) : (
          <div className="dash-grid">
            <div className="dash-card">
              <p className="dash-eyebrow">Due today</p>
              <div className="dash-stat">
                {m.dueNow}
                <span className="unit">{m.dueNow === 1 ? 'fable' : 'fables'}</span>
              </div>
              <p className="dash-note">{dueNote}</p>
            </div>

            <div className="dash-card">
              <p className="dash-eyebrow">Hearth streak</p>
              <div className="dash-stat">
                {m.streak}
                <span className="unit">{m.streak === 1 ? 'night' : 'nights'}</span>
              </div>
              <p className="dash-flames" aria-hidden="true">
                {flames > 0 ? '🔥'.repeat(flames) : <span className="dim">🕯️</span>}
              </p>
            </div>

            <div className="dash-card span2">
              <p className="dash-eyebrow">🛡 Province mastery</p>
              <div className="dash-bar">
                <span style={{ width: `${(m.mastery / 5) * 100}%` }} />
              </div>
              <div className="dash-stat" style={{ fontSize: '1.5rem' }}>
                {m.mastery.toFixed(1)}
                <span className="unit">/ 5</span>
              </div>
              <p className="dash-note">
                the Fablewood remembers <strong>{m.welded}</strong> of <strong>{m.totalFacts}</strong> fables
              </p>
            </div>

            <div className="dash-card">
              <p className="dash-eyebrow">Last Ledger entry</p>
              <div className="dash-stat" style={{ fontSize: '1.5rem' }}>
                {ago(m.lastPlayed)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
