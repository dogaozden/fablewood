import { useEffect, useState } from 'react';
import { getPacks, getState } from '../bridge/client';
import { services } from '../game/contracts';
import { boxLabel } from './metrics';
import './shell.css';

/**
 * The Library pane — a read-only pack/fact browser. Per installed pack: title,
 * fact + encounter counts, and an expandable fact list where each fact carries its
 * Leitner box badge (weld strength) and next-review timing from the Ledger.
 */

interface Fact {
  id: string;
  statement: string;
}
interface RawPack {
  meta?: { title?: string };
  facts?: Fact[];
  encounters?: unknown[];
}
interface PackView {
  id: string;
  title: string;
  facts: Fact[];
  encounterCount: number;
}

type SrsState = { facts?: Record<string, { box?: number; next_due?: number }> };

function until(ms: number): string {
  const s = (ms - Date.now()) / 1000;
  if (s <= 0) return 'ready to cast';
  if (s < 86400) {
    const hours = Math.max(1, Math.floor(s / 3600));
    return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  }
  const days = Math.floor(s / 86400);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

function BoxBadge({ box }: { box: number }) {
  return <span className={`lib-badge box${box}`}>{boxLabel(box)}</span>;
}

function FactRow({ fact, srs }: { fact: Fact; srs: SrsState }) {
  const entry = srs.facts?.[fact.id];
  const box = entry?.box ?? Math.max(0, services.srs.boxOf(fact.id));
  const due =
    box === 0
      ? 'uncast'
      : typeof entry?.next_due === 'number'
        ? until(entry.next_due)
        : 'cast';
  const dueNow = due === 'ready to cast';
  return (
    <div className="lib-fact">
      <BoxBadge box={box} />
      <span className="lib-statement">{fact.statement}</span>
      <span className={dueNow ? 'lib-due now' : 'lib-due'}>{due}</span>
    </div>
  );
}

export function Library() {
  const [packs, setPacks] = useState<PackView[] | null>(null);
  const [srs, setSrs] = useState<SrsState>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let alive = true;
    (async () => {
      await services.srs.ready().catch(() => {});
      const [res, srsState] = await Promise.all([
        getPacks(),
        getState<SrsState>('srs.json').catch(() => null),
      ]);
      if (!alive) return;
      const views: PackView[] = res.packs.map((p) => {
        const rp = p.pack as RawPack;
        return {
          id: p.id,
          title: rp.meta?.title ?? p.id,
          facts: rp.facts ?? [],
          encounterCount: rp.encounters?.length ?? 0,
        };
      });
      setPacks(views);
      setSrs(srsState ?? {});
      // expand the first pack by default so the shelf isn't empty
      if (views[0]) setOpen({ [views[0].id]: true });
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (packs === null) {
    return (
      <div className="lib">
        <div className="lib-inner">
          <p className="dash-loading">Reading the shelves…</p>
        </div>
      </div>
    );
  }

  if (packs.length === 0) {
    return (
      <div className="lib">
        <div className="lib-inner">
          <h2 className="lib-title">The Library</h2>
          <p className="lib-sub">The shelves stand empty.</p>
          <p style={{ color: 'var(--parchment)', opacity: 0.85 }}>
            No province has been settled yet. Compile a knowledge pack into <code>packs/</code> and it will
            appear here as a province of the Ledger.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="lib">
      <div className="lib-inner">
        <h2 className="lib-title">The Library</h2>
        <p className="lib-sub">Every province of the Ledger, and how well each fable is welded.</p>
        {packs.map((pack) => {
          const isOpen = !!open[pack.id];
          return (
            <div className="lib-pack" key={pack.id}>
              <button
                className="lib-packhead"
                aria-expanded={isOpen}
                onClick={() => setOpen((o) => ({ ...o, [pack.id]: !o[pack.id] }))}
              >
                <span className={isOpen ? 'lib-caret open' : 'lib-caret'}>▸</span>
                <span className="lib-packtitle">{pack.title}</span>
                <span className="lib-counts">
                  {pack.facts.length} fables · {pack.encounterCount} encounters
                </span>
              </button>
              {isOpen && (
                <div className="lib-facts">
                  {pack.facts.map((f) => (
                    <FactRow key={f.id} fact={f} srs={srs} />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
