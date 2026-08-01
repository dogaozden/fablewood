import { useEffect, useState } from 'react';
import { getPacks, getState } from '../bridge/client';
import { services } from '../game/contracts';
import type { SrsState } from '../srs/leitner';
import {
  BOX_LABELS,
  boxDistribution,
  boxLabel,
  currentStreak,
  dueForecast,
  flattenHistory,
  passRate,
  weakestBindings,
  type BoxCounts,
  type DueForecast,
} from './metrics';
import './shell.css';

/**
 * The Dashboard pane — the hamlet is the dashboard (spec §7). Reads the live
 * Ledger (SRS + save) over the service contract and shows it as warm panels over
 * the hamlet vignette: mastery by province, the due forecast, streak + history,
 * and the weakest bindings worth a Wellspring visit.
 */

interface Props {
  /** switch the shell to the Game tab */
  onSetOut: () => void;
}

/** Over how many of the most recent answers the pass rate is computed. */
const PASS_RATE_WINDOW = 20;
/** How many weakest-binding facts to show. */
const WEAKEST_LIMIT = 5;

interface DomainMastery {
  packId: string;
  title: string;
  totalFacts: number;
  boxCounts: BoxCounts;
  welded: number; // facts with box > 0
}

interface WeakItem {
  id: string;
  statement: string;
  box: number;
}

interface Metrics {
  hasPack: boolean;
  domains: DomainMastery[];
  hasHistory: boolean;
  forecast: DueForecast;
  hearthStreak: number; // existing milestone counter (services.save.streak) — unrelated to answerStreak
  answerStreak: number; // consecutive full-credit answers, from SRS history
  totalCasts: number;
  passRate: { rate: number; sample: number };
  lastPlayed: string;
  weakest: WeakItem[];
}

interface RawFact {
  id: string;
  statement: string;
  /** supersession-reteach.md §6 — present ⇒ the Realm has moved past this fact */
  superseded_by?: string;
}
interface RawPack {
  meta?: { title?: string };
  facts?: RawFact[];
}

const EMPTY_METRICS: Metrics = {
  hasPack: false,
  domains: [],
  hasHistory: false,
  forecast: { today: 0, tomorrow: 0, week: 0 },
  hearthStreak: 0,
  answerStreak: 0,
  totalCasts: 0,
  passRate: { rate: 0, sample: 0 },
  lastPlayed: '',
  weakest: [],
};

async function computeMetrics(): Promise<Metrics> {
  await Promise.all([services.srs.ready(), services.save.ready()]).catch(() => {});
  let hearthStreak = 0;
  let lastPlayed = '';
  try {
    const s = services.save.get();
    hearthStreak = s.streak;
    lastPlayed = s.lastPlayed;
  } catch {
    /* no save yet */
  }

  const [{ packs }, raw] = await Promise.all([
    getPacks(),
    getState<SrsState>('srs.json').catch(() => null),
  ]);
  if (packs.length === 0) {
    return { ...EMPTY_METRICS, hearthStreak, lastPlayed };
  }

  const srsFacts = raw?.facts ?? {};
  const domains: DomainMastery[] = [];
  const allFactIds: string[] = [];
  const statementsById = new Map<string, string>();
  /** supersession-reteach.md §6 — superseded facts drop out of the forecast, the weakest
   *  bindings and the mastery aggregates FROM PACK LOAD (their SRS rows are preserved
   *  forever; the Library still shows them, marked). */
  const superseded = new Set<string>();

  for (const p of packs) {
    const pack = p.pack as RawPack;
    const factIds = (pack.facts ?? []).filter((f) => !f.superseded_by).map((f) => f.id);
    for (const f of pack.facts ?? []) {
      statementsById.set(f.id, f.statement);
      if (f.superseded_by) superseded.add(f.id);
    }
    allFactIds.push(...factIds);
    const boxCounts = boxDistribution(factIds, srsFacts);
    domains.push({
      packId: p.id,
      title: pack.meta?.title ?? p.id,
      totalFacts: factIds.length,
      boxCounts,
      welded: factIds.length - boxCounts[0],
    });
  }

  const forecast = dueForecast(allFactIds, srsFacts, Date.now());
  const history = flattenHistory(srsFacts);
  const weak = weakestBindings(srsFacts, WEAKEST_LIMIT, superseded).map((w) => ({
    id: w.id,
    box: w.box,
    statement: statementsById.get(w.id) ?? w.id,
  }));

  return {
    hasPack: true,
    domains,
    hasHistory: history.length > 0,
    forecast,
    hearthStreak,
    answerStreak: currentStreak(history),
    totalCasts: history.length,
    passRate: passRate(history, PASS_RATE_WINDOW),
    lastPlayed,
    weakest: weak,
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

function BoxStackBar({ counts }: { counts: BoxCounts }) {
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const label = counts.map((c, i) => `${c} ${BOX_LABELS[i]}`).join(', ');
  return (
    <div className="dash-stackbar" role="img" aria-label={label}>
      {counts.map((c, i) =>
        c > 0 ? (
          <span key={i} className={`box${i}`} style={{ width: `${(c / total) * 100}%` }} title={`${BOX_LABELS[i]}: ${c}`} />
        ) : null,
      )}
    </div>
  );
}

export function Dashboard({ onSetOut }: Props) {
  const [m, setM] = useState<Metrics | null>(null);

  useEffect(() => {
    let alive = true;
    computeMetrics()
      .then((metrics) => alive && setM(metrics))
      .catch(() => alive && setM(EMPTY_METRICS));
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

  const forecastNote =
    m.forecast.today > 0
      ? `the Ledger stirs — ${m.forecast.today} ${m.forecast.today === 1 ? 'fable calls' : 'fables call'} for renewal today`
      : m.forecast.tomorrow > 0 || m.forecast.week > 0
        ? 'the Ledger rests easy today — more waits ahead this week'
        : 'the Ledger rests easy';

  const flames = Math.min(m.hearthStreak, 5);

  return (
    <div className="dash">
      <div className="dash-inner">
        <header className="dash-head">
          <div>
            <h1 className="dash-title">The Hamlet</h1>
            <p className="dash-sub">
              {m.hasPack ? `${m.domains.map((d) => d.title).join(' · ')} · your home in the Ledger Realms` : 'your home in the Ledger Realms'}
            </p>
          </div>
          <button className="dash-setout" onClick={onSetOut}>
            Set out ▸
          </button>
        </header>

        {!m.hasPack ? (
          <div className="dash-empty">
            <h2>The roads are quiet, Keeper.</h2>
            <p>
              No province has been settled yet. Compile a knowledge pack into <code>packs/</code>, and the Ledger will
              begin to fill.
            </p>
            <p>Your hearth still burns {m.hearthStreak > 0 ? `${m.hearthStreak} nights tall` : 'unkindled'}.</p>
          </div>
        ) : (
          <div className="dash-grid">
            <div className="dash-card span2">
              <p className="dash-eyebrow">🛡 Mastery by province</p>
              {m.domains.map((d) => (
                <div className="dash-domain" key={d.packId}>
                  <div className="dash-domain-head">
                    <span className="dash-domain-title">{d.title}</span>
                    <span className="dash-domain-count">
                      {d.welded} / {d.totalFacts} welded
                    </span>
                  </div>
                  <BoxStackBar counts={d.boxCounts} />
                </div>
              ))}
            </div>

            {!m.hasHistory ? (
              <div className="dash-card span2 dash-invite">
                <h2>The Ledger is freshly bound, Keeper.</h2>
                <p>Not a single fable has been cast yet. Seek the Wellspring, and the record will begin.</p>
              </div>
            ) : (
              <>
                <div className="dash-card">
                  <p className="dash-eyebrow">Due forecast</p>
                  <div className="dash-forecast">
                    <div>
                      <strong>{m.forecast.today}</strong>
                      <span>today</span>
                    </div>
                    <div>
                      <strong>{m.forecast.tomorrow}</strong>
                      <span>tomorrow</span>
                    </div>
                    <div>
                      <strong>{m.forecast.week}</strong>
                      <span>this week</span>
                    </div>
                  </div>
                  <p className="dash-note">{forecastNote}</p>
                </div>

                <div className="dash-card">
                  <p className="dash-eyebrow">📜 Casting streak</p>
                  <div className="dash-stat">
                    {m.answerStreak}
                    <span className="unit">in a row</span>
                  </div>
                  <p className="dash-note">
                    {m.totalCasts} cast{m.totalCasts === 1 ? '' : 's'} graded · {m.passRate.rate.toFixed(0)}% pass rate
                    (last {m.passRate.sample})
                  </p>
                </div>

                <div className="dash-card">
                  <p className="dash-eyebrow">Hearth streak</p>
                  <div className="dash-stat">
                    {m.hearthStreak}
                    <span className="unit">{m.hearthStreak === 1 ? 'night' : 'nights'}</span>
                  </div>
                  <p className="dash-flames" aria-hidden="true">
                    {flames > 0 ? '🔥'.repeat(flames) : <span className="dim">🕯️</span>}
                  </p>
                </div>

                <div className="dash-card">
                  <p className="dash-eyebrow">Last Ledger entry</p>
                  <div className="dash-stat" style={{ fontSize: '1.5rem' }}>
                    {ago(m.lastPlayed)}
                  </div>
                </div>

                <div className="dash-card span2 dash-weakest">
                  <p className="dash-eyebrow">⚠ Weakest bindings</p>
                  {m.weakest.length === 0 ? (
                    <p className="dash-note">Nothing frays right now — the Ledger holds steady.</p>
                  ) : (
                    <>
                      <ul className="dash-weak-list">
                        {m.weakest.map((w) => (
                          <li key={w.id}>
                            <span className={`lib-badge box${w.box}`}>{boxLabel(w.box)}</span>
                            <span className="dash-weak-statement">{w.statement}</span>
                          </li>
                        ))}
                      </ul>
                      <p className="dash-note">Return to the Wellspring to mend these.</p>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
