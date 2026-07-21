import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Regression tests for crucible v1 finding V1-4: rapid input (e.g. a mashed key/pointer
 * burst while the AudioContext is mid-resume from a real re-suspension) could race
 * resumeMusicOnce() into a genuinely uncaught Tone.js throw. The old guard only checked
 * `Tone.getContext().state === 'running'` — synchronous, but running BEFORE the
 * function's own `await` — so two overlapping (unawaited) calls both passed it while
 * the context was still mid-resume, and both went on to run a full stop()+play() motif
 * rebuild. Two Transport restarts landing at the same clock instant trip Tone's own
 * ordering assertion ("Start time must be strictly greater than previous start time").
 *
 * The fix (instance.ts) memoizes the in-flight resume as a single promise
 * (`inFlightResume`, set synchronously before the first await) so every overlapping
 * caller joins the SAME resume+rebuild instead of starting a second one — without
 * reintroducing the one-shot `resumed` flag bug already fixed for crucible #8 (see
 * instance.test.ts): once the in-flight resume settles, the guard clears, so a LATER,
 * non-overlapping call (e.g. after a genuinely new suspension) still resumes again.
 *
 * `music` is mocked wholesale here (via `../index`'s createPlayer) rather than
 * exercising the real MusicPlayer/Tone.Transport, so resume/stop/play/current can be
 * asserted on directly and the race can be reproduced deterministically without
 * depending on Tone's real scheduling internals or timing. `resume()` is deliberately a
 * manually-resolved deferred promise (not a plain `async () => {}`) — that's what holds
 * the context in 'suspended' for the ENTIRE synchronous burst of overlapping calls
 * below, exactly like a real (slow, browser-level) AudioContext.resume() would during a
 * genuine mash. Every pending resume is queued (not just the latest) so that even the
 * PRE-FIX code — which starts a second, independent resume() call per overlapping
 * caller — settles cleanly instead of hanging: that turns the regression into a fast,
 * legible assertion failure ("resume called 2 times, expected 1") rather than a test
 * timeout.
 */
let contextState: 'suspended' | 'running' = 'suspended';

vi.mock('tone', () => ({
  getContext: () => ({ state: contextState }),
}));

let pendingResumes: Array<{ resolve: () => void; reject: (err: Error) => void }> = [];
function resolveAllResumes(): void {
  const batch = pendingResumes;
  pendingResumes = [];
  contextState = 'running';
  for (const p of batch) p.resolve();
}
function rejectAllResumes(err: Error): void {
  const batch = pendingResumes;
  pendingResumes = [];
  for (const p of batch) p.reject(err);
}

const fakeMusic = {
  resume: vi.fn(
    () =>
      new Promise<void>((resolve, reject) => {
        pendingResumes.push({ resolve, reject });
      }),
  ),
  current: vi.fn((): string | null => 'battle'),
  stop: vi.fn(),
  play: vi.fn(),
};

vi.mock('../index', () => ({ createPlayer: () => fakeMusic }));

beforeEach(() => {
  vi.resetModules(); // fresh module-level `inFlightResume` per test
  contextState = 'suspended';
  pendingResumes = [];
  fakeMusic.resume.mockClear();
  fakeMusic.current.mockClear();
  fakeMusic.stop.mockClear();
  fakeMusic.play.mockClear();
});

describe('resumeMusicOnce — concurrent-call race (crucible v1 V1-4)', () => {
  it('two overlapping unawaited calls perform only ONE stop+play rebuild', async () => {
    const { resumeMusicOnce } = await import('../instance');

    const p1 = resumeMusicOnce();
    const p2 = resumeMusicOnce(); // fired before p1's resume settles — the old race window
    resolveAllResumes();
    await Promise.all([p1, p2]);

    expect(fakeMusic.resume).toHaveBeenCalledTimes(1); // only ONE resume was ever started
    expect(fakeMusic.stop).toHaveBeenCalledTimes(1);
    expect(fakeMusic.play).toHaveBeenCalledTimes(1);
    expect(contextState).toBe('running');
  });

  it('a mash of 30 overlapping calls still only rebuilds once', async () => {
    const { resumeMusicOnce } = await import('../instance');

    const calls = Array.from({ length: 30 }, () => resumeMusicOnce());
    resolveAllResumes();
    await Promise.all(calls);

    expect(fakeMusic.resume).toHaveBeenCalledTimes(1);
    expect(fakeMusic.stop).toHaveBeenCalledTimes(1);
    expect(fakeMusic.play).toHaveBeenCalledTimes(1);
  });

  it('no unhandled rejection when the resume itself fails under concurrent calls', async () => {
    const { resumeMusicOnce } = await import('../instance');

    const p1 = resumeMusicOnce();
    const p2 = resumeMusicOnce();
    rejectAllResumes(new Error('still locked — no gesture reached it'));

    await expect(Promise.all([p1, p2])).resolves.toEqual([undefined, undefined]);
    expect(fakeMusic.stop).not.toHaveBeenCalled();
    expect(contextState).toBe('suspended'); // still locked, exactly as before the calls
  });

  it('still recovers on a LATER, non-overlapping call after a fresh suspension (not a regression to the crucible #8 one-shot)', async () => {
    const { resumeMusicOnce } = await import('../instance');

    const p1 = resumeMusicOnce();
    const p2 = resumeMusicOnce();
    resolveAllResumes();
    await Promise.all([p1, p2]);
    expect(fakeMusic.resume).toHaveBeenCalledTimes(1);
    expect(fakeMusic.stop).toHaveBeenCalledTimes(1);

    contextState = 'suspended'; // a later, real re-suspension (e.g. backgrounded again)
    const p3 = resumeMusicOnce();
    resolveAllResumes();
    await p3;

    expect(fakeMusic.resume).toHaveBeenCalledTimes(2); // guard reset, not permanently one-shot
    expect(fakeMusic.stop).toHaveBeenCalledTimes(2);
  });

  it('a single call still no-ops once already running (unchanged base case)', async () => {
    const { resumeMusicOnce } = await import('../instance');
    contextState = 'running';

    await resumeMusicOnce();

    expect(fakeMusic.resume).not.toHaveBeenCalled();
    expect(fakeMusic.stop).not.toHaveBeenCalled();
  });
});
