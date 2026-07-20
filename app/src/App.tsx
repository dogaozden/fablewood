import { lazy, Suspense, useEffect, useState } from 'react';
import { Dashboard } from './shell/Dashboard';
import { Library } from './shell/Library';
import { Settings } from './shell/Settings';
import { services } from './game/contracts';
// Eager, Phaser/Tone-free service registrations (settings/save/srs/inventory/
// encounters/judge) — the mute toggle below and Dashboard/Library need `services.*`
// on mount, independent of whether the Game tab (and its heavy engine chunk) has
// ever loaded. See providers.ts's header for why this split is safe.
import './game/providers';

// Bundle diet: Phaser + all scene/combat code (and, transitively, Tone via the
// scenes' own music.play() calls) only load once the Game tab actually renders,
// instead of weighing down the Dashboard/Library-only path.
const PhaserGame = lazy(() =>
  import('./game/PhaserGame').then((m) => ({ default: m.PhaserGame })),
);

// Tone.js lives behind the same lazy boundary — imported dynamically here too (not
// at module top level) so the shell chunk never carries it. Cached after the first
// call; every caller below awaits the same resolved module.
let musicModule: Promise<typeof import('./music/instance')> | undefined;
function loadMusic() {
  musicModule ??= import('./music/instance');
  return musicModule;
}

type Tab = 'dashboard' | 'game' | 'library' | 'settings';
const TABS: Tab[] = ['dashboard', 'game', 'library', 'settings'];
// Voice audit T3: displayed tab labels, distinct from the internal Tab ids above
// (which stay 'dashboard'/'game'/'library'/'settings' — save/e2e/etc. never see these).
const TAB_LABELS: Record<Tab, string> = {
  dashboard: 'The Ledger',
  game: 'Realms',
  library: 'Library',
  settings: '⚙ The Study',
};

export function App() {
  const [tab, setTab] = useState<Tab>('game');
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    services.settings
      .ready()
      .then(() => {
        const s = services.settings.get();
        setMuted(s.muted);
        void loadMusic().then(({ music }) => {
          music.setMuted(s.muted);
          music.setVolume(s.volume);
        });
      })
      .catch(() => {});
    const wake = () => void loadMusic().then(({ resumeMusicOnce }) => resumeMusicOnce());
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
    void loadMusic().then(({ music }) => music.setMuted(next));
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
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>
        <button
          className="tab mute"
          aria-label={muted ? 'Unmute music' : 'Mute music'}
          title={muted ? 'Unmute music' : 'Mute music'}
          onClick={toggleMute}
        >
          {muted ? '♪̸ hushed' : '♪ singing'}
        </button>
      </nav>
      <main className="pane">
        {tab === 'game' && (
          <Suspense fallback={<div className="phaser-root" />}>
            <PhaserGame />
          </Suspense>
        )}
        {tab === 'dashboard' && <Dashboard onSetOut={() => setTab('game')} />}
        {tab === 'library' && <Library />}
        {tab === 'settings' && <Settings muted={muted} onToggleMute={toggleMute} />}
      </main>
    </div>
  );
}

