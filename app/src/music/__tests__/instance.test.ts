import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for crucible finding #8: resumeMusicOnce's old one-shot `resumed`
 * flag flipped true forever after the first successful resume, so a SECOND AudioContext
 * suspension (e.g. the tab is backgrounded twice) never recovered — no later gesture
 * could ever call music.resume() again. The fix re-checks Tone.getContext().state on
 * every call instead of caching a boolean.
 *
 * Under vitest's node test environment there's no real Web Audio API, so Tone.js falls
 * back to a dummy context whose `.state` isn't a meaningful, controllable string — real
 * suspend/resume transitions can't be simulated against it. `tone` is fully mocked here
 * instead (a headless AudioContext-state simulation): just enough surface for
 * MusicPlayer's constructor (Gain/Reverb) plus the two calls resumeMusicOnce itself
 * makes (getContext/start), with a test-controlled `contextState` standing in for the
 * real AudioContext's state. music.play() is never called in these tests, so
 * music.current() stays null and the "restart the current motif" branch (unchanged by
 * this fix, and already explained by its own source comment) is never exercised.
 */
let contextState: 'suspended' | 'running' = 'suspended';
let startBehavior: 'resolve' | 'reject' = 'resolve';
const start = vi.fn(async () => {
  if (startBehavior === 'reject') throw new Error('still locked — no gesture reached it');
  contextState = 'running';
});

vi.mock('tone', () => ({
  getContext: () => ({ state: contextState }),
  start,
  Gain: class {
    connect() {
      /* no-op */
    }
  },
  Reverb: class {
    toDestination() {
      /* no-op */
    }
  },
}));

beforeEach(() => {
  vi.resetModules(); // fresh `music` singleton + closure state per test
  contextState = 'suspended';
  startBehavior = 'resolve';
  start.mockClear();
});

describe('resumeMusicOnce — AudioContext suspend/resume guard', () => {
  it('resumes on the first gesture', async () => {
    const { resumeMusicOnce } = await import('../instance');
    await resumeMusicOnce();
    expect(start).toHaveBeenCalledTimes(1);
    expect(contextState).toBe('running');
  });

  it('no-ops on further gestures while the context is already running', async () => {
    const { resumeMusicOnce } = await import('../instance');
    await resumeMusicOnce();
    await resumeMusicOnce();
    await resumeMusicOnce();
    expect(start).toHaveBeenCalledTimes(1); // only the first call actually resumed
  });

  it('recovers from a SECOND suspension — the bug this fix closes', async () => {
    const { resumeMusicOnce } = await import('../instance');
    await resumeMusicOnce(); // 1st gesture, 1st suspension
    expect(start).toHaveBeenCalledTimes(1);

    contextState = 'suspended'; // tab backgrounded a 2nd time (or an OS route change)
    await resumeMusicOnce(); // next gesture after the 2nd suspension
    // Under the old one-shot `resumed` flag this 2nd resume would NEVER fire — the
    // flag was already permanently true, so the guard's `if (resumed) return;` short-
    // circuited every later gesture regardless of the real context state.
    expect(start).toHaveBeenCalledTimes(2);
    expect(contextState).toBe('running');
  });

  it('recovers again from a THIRD suspension (not just a one-time extra retry)', async () => {
    const { resumeMusicOnce } = await import('../instance');
    await resumeMusicOnce();
    contextState = 'suspended';
    await resumeMusicOnce();
    contextState = 'suspended';
    await resumeMusicOnce();
    expect(start).toHaveBeenCalledTimes(3);
    expect(contextState).toBe('running');
  });

  it('a failed resume leaves the guard open for the very next gesture to retry', async () => {
    const { resumeMusicOnce } = await import('../instance');
    startBehavior = 'reject';
    await resumeMusicOnce();
    expect(contextState).toBe('suspended'); // still locked, exactly as before the call

    startBehavior = 'resolve';
    await resumeMusicOnce(); // next gesture retries — was never permanently blocked
    expect(start).toHaveBeenCalledTimes(2);
    expect(contextState).toBe('running');
  });
});
