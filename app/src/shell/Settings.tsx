import { useEffect, useRef, useState } from 'react';
import { services } from '../game/contracts';
import { getLastGrade, type LastGrade } from '../judge/client';
import './shell.css';

/**
 * The Settings pane — music volume + mute, and a peek at the Laconic Clerk's most
 * recent grading latency/tier. Mute is lifted to App.tsx (the tab-bar button and
 * this pane's toggle share the exact same state, so they can never drift). Volume
 * writes to state/settings.json debounced, so dragging the slider doesn't spam the
 * bridge with a write per pixel.
 */

interface Props {
  muted: boolean;
  onToggleMute: () => void;
}

const SAVE_DEBOUNCE_MS = 300;

// Tone stays behind the game/App.tsx lazy boundary — same cached dynamic-import
// pattern as App.tsx's loadMusic, so this pane never drags the engine chunk into
// the shell bundle. import() of the same specifier resolves to the same module.
let musicModule: Promise<typeof import('../music/instance')> | undefined;
function loadMusic() {
  musicModule ??= import('../music/instance');
  return musicModule;
}
/** How often to poll for a fresh judge grade while this pane is open. */
const POLL_MS = 1000;

export function Settings({ muted, onToggleMute }: Props) {
  const [volume, setVolume] = useState(100);
  const [ready, setReady] = useState(false);
  const [lastGrade, setLastGradeState] = useState<LastGrade | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    services.settings
      .ready()
      .then(() => {
        if (!alive) return;
        const v = services.settings.get().volume;
        const initial = typeof v === 'number' && Number.isFinite(v) ? v : 100;
        setVolume(initial);
        void loadMusic().then(({ music }) => music.setVolume(initial));
        setReady(true);
      })
      .catch(() => alive && setReady(true));
    return () => {
      alive = false;
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  useEffect(() => {
    setLastGradeState(getLastGrade());
    const id = setInterval(() => setLastGradeState(getLastGrade()), POLL_MS);
    return () => clearInterval(id);
  }, []);

  const onVolumeChange = (next: number) => {
    setVolume(next);
    void loadMusic().then(({ music }) => music.setVolume(next));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void services.settings.set({ volume: next });
    }, SAVE_DEBOUNCE_MS);
  };

  return (
    <div className="settings">
      <div className="settings-inner">
        <h2 className="lib-title">Settings</h2>
        <p className="lib-sub">Tune the hearth.</p>

        <div className="dash-card settings-music">
          <p className="dash-eyebrow">Music</p>
          <label className="settings-row">
            <span className="settings-label">Volume</span>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volume}
              disabled={!ready}
              onChange={(e) => onVolumeChange(Number(e.target.value))}
              aria-label="Music volume"
            />
            <span className="settings-value">{volume}</span>
          </label>
          <label className="settings-row">
            <span className="settings-label">{muted ? 'Muted' : 'Sound on'}</span>
            <button className="dash-setout settings-mute-btn" onClick={onToggleMute}>
              {muted ? 'Unmute' : 'Mute'}
            </button>
          </label>
        </div>

        <div className="dash-card settings-judge">
          <p className="dash-eyebrow">The Clerk&rsquo;s ledger</p>
          {lastGrade ? (
            <>
              <div className="dash-stat" style={{ fontSize: '1.6rem' }}>
                {lastGrade.latencyMs ?? '—'}
                <span className="unit">ms</span>
              </div>
              <p className="dash-note">{lastGrade.line}</p>
            </>
          ) : (
            <p className="dash-note">
              No verdict yet — answer a cast-from-memory question, and the Clerk&rsquo;s swiftness will appear
              here.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
