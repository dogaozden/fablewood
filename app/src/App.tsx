import { useEffect, useState } from 'react';
import { PhaserGame } from './game/PhaserGame';
import { getPacks, type PackEntry } from './bridge/client';
import { music, resumeMusicOnce } from './music/instance';
import { services } from './game/contracts';

type Tab = 'dashboard' | 'game' | 'library';
const TABS: Tab[] = ['dashboard', 'game', 'library'];

export function App() {
  const [tab, setTab] = useState<Tab>('game');
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    services.settings
      .ready()
      .then(() => {
        const m = services.settings.get().muted;
        setMuted(m);
        music.setMuted(m);
      })
      .catch(() => {});
    const wake = () => void resumeMusicOnce();
    window.addEventListener('pointerdown', wake);
    window.addEventListener('keydown', wake);
    return () => {
      window.removeEventListener('pointerdown', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    music.setMuted(next);
    void services.settings.set({ muted: next });
  };

  return (
    <div className="app">
      <nav className="tabbar">
        <span className="brand">Fablewood</span>
        <div className="tabs">
          {TABS.map((t) => (
            <button
              key={t}
              className={t === tab ? 'tab active' : 'tab'}
              onClick={() => setTab(t)}
            >
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>
        <button
          className="tab mute"
          aria-label={muted ? 'Unmute music' : 'Mute music'}
          title={muted ? 'Unmute music' : 'Mute music'}
          onClick={toggleMute}
        >
          {muted ? '♪̸ off' : '♪ on'}
        </button>
      </nav>
      <main className="pane">
        {tab === 'game' && <PhaserGame />}
        {tab === 'dashboard' && <Dashboard />}
        {tab === 'library' && <Library />}
      </main>
    </div>
  );
}

function Dashboard() {
  return (
    <div className="placeholder">
      <h2>The Hamlet</h2>
      <p>Your dashboard — due queue, streaks, province mastery, retinue — will grow here.</p>
    </div>
  );
}

function Library() {
  const [packs, setPacks] = useState<PackEntry[] | null>(null);
  useEffect(() => {
    getPacks().then((r) => setPacks(r.packs));
  }, []);

  if (packs === null) {
    return (
      <div className="placeholder">
        <p>Reading the shelves…</p>
      </div>
    );
  }
  if (packs.length === 0) {
    return (
      <div className="placeholder">
        <h2>Library</h2>
        <p>
          No packs installed yet. Drop a knowledge pack into <code>packs/</code> and it
          will appear here.
        </p>
      </div>
    );
  }
  return (
    <div className="placeholder">
      <h2>Library</h2>
      <ul>
        {packs.map((p) => (
          <li key={p.id}>{p.id}</li>
        ))}
      </ul>
    </div>
  );
}
