/**
 * Native (Tauri) transport routing — proves the bridge/judge clients route to Rust
 * commands when `window.__TAURI_INTERNALS__` exists, with graceful degradation on
 * command failure, and stay on the HTTP path when it doesn't. Runs in the node test
 * environment by faking the Tauri internals on a synthetic `window`.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { isTauri } from '../native';
import { getPacks, getPackAsset, getState, getStateStrict, putState } from '../client';
import { judge } from '../../judge/client';
import { AWAY_LINE } from '../../judge/stub';

type Invoke = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function installTauri(invoke: Invoke): void {
  (globalThis as Record<string, unknown>).window = {
    __TAURI_INTERNALS__: { invoke },
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).window;
});

describe('isTauri detection', () => {
  it('is false in node (no window at all)', () => {
    expect(isTauri()).toBe(false);
  });

  it('is false with a window but no internals', () => {
    (globalThis as Record<string, unknown>).window = {};
    expect(isTauri()).toBe(false);
  });

  it('is true once __TAURI_INTERNALS__ exists', () => {
    installTauri(async () => null);
    expect(isTauri()).toBe(true);
  });
});

describe('bridge client routing under Tauri', () => {
  let calls: Array<{ cmd: string; args?: Record<string, unknown> }>;
  let respond: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

  beforeEach(() => {
    calls = [];
    respond = async () => null;
    installTauri((cmd, args) => {
      calls.push({ cmd, args });
      return respond(cmd, args);
    });
  });

  it('getPacks invokes packs_list and wraps the array', async () => {
    respond = async () => [{ id: 'vc-law', dir: 'vc-law', pack: { meta: { id: 'vc-law' } } }];
    const res = await getPacks();
    expect(calls).toEqual([{ cmd: 'packs_list', args: undefined }]);
    expect(res.packs).toHaveLength(1);
    expect(res.packs[0].id).toBe('vc-law');
  });

  it('getPacks degrades to empty on command failure', async () => {
    respond = async () => {
      throw new Error('boom');
    };
    expect(await getPacks()).toEqual({ packs: [] });
  });

  it('getState/putState round-trip through state_read/state_write', async () => {
    respond = async (cmd) => (cmd === 'state_read' ? { hp: 16 } : null);
    expect(await getState('save.json')).toEqual({ hp: 16 });
    expect(await putState('save.json', { hp: 12 })).toBe(true);
    expect(calls).toEqual([
      { cmd: 'state_read', args: { name: 'save.json' } },
      { cmd: 'state_write', args: { name: 'save.json', data: { hp: 12 } } },
    ]);
  });

  it('getStateStrict distinguishes found, null, and absent native responses', async () => {
    respond = async () => ({ found: true, data: { hp: 16 } });
    expect(await getStateStrict('save.json')).toEqual({ status: 'found', value: { hp: 16 } });

    respond = async () => ({ found: true, data: null });
    expect(await getStateStrict('save.json')).toEqual({ status: 'found', value: null });

    respond = async () => ({ found: false });
    expect(await getStateStrict('save.json')).toEqual({ status: 'absent' });

    expect(calls).toEqual([
      { cmd: 'state_read_strict', args: { name: 'save.json' } },
      { cmd: 'state_read_strict', args: { name: 'save.json' } },
      { cmd: 'state_read_strict', args: { name: 'save.json' } },
    ]);
  });

  it('getStateStrict reports malformed native responses and command failures', async () => {
    respond = async () => ({ found: true });
    expect(await getStateStrict('save.json')).toEqual({
      status: 'error',
      kind: 'native',
      message: 'Native state read omitted found data.',
    });

    respond = async () => {
      throw new Error('permission denied');
    };
    expect(await getStateStrict('save.json')).toEqual({
      status: 'error',
      kind: 'native',
      message: 'permission denied',
    });
  });

  it('putState reports false when the command rejects', async () => {
    respond = async () => {
      throw new Error('invalid state name');
    };
    expect(await putState('../evil', {})).toBe(false);
  });

  it('getPackAsset wraps bytes in a Response with the extension mime', async () => {
    respond = async () => new TextEncoder().encode('{"rooms":[]}').buffer;
    const res = await getPackAsset('vc-law', 'vc-law.dungeon.json');
    expect(calls[0]).toEqual({
      cmd: 'pack_asset',
      args: { packId: 'vc-law', relPath: 'vc-law.dungeon.json' },
    });
    expect(res).not.toBeNull();
    expect(res!.headers.get('content-type')).toBe('application/json');
    expect(await res!.json()).toEqual({ rooms: [] });
  });

  it('getPackAsset returns null when the command rejects', async () => {
    respond = async () => {
      throw new Error('asset not found');
    };
    expect(await getPackAsset('vc-law', 'missing.png')).toBeNull();
  });
});

describe('judge routing under Tauri', () => {
  it('returns the Rust verdict when judge_grade succeeds', async () => {
    installTauri(async (cmd) => {
      expect(cmd).toBe('judge_grade');
      return { verdict: 'pass', line: 'The ink holds. Well cast.' };
    });
    const v = await judge({ prompt: 'q', answer: 'a', rubric: 'r' });
    expect(v).toEqual({ verdict: 'pass', line: 'The ink holds. Well cast.' });
  });

  it('falls back to stub verdict + away line when the command rejects', async () => {
    installTauri(async () => {
      throw new Error('judge timeout');
    });
    const v = await judge({
      prompt: 'q',
      answer: 'liquidation preference returns capital first',
      rubric: 'mentions liquidation preference and capital returned first',
    });
    expect(['pass', 'partial', 'fail']).toContain(v.verdict);
    expect(v.line).toBe(AWAY_LINE);
  });

  it('falls back when the command returns a malformed verdict', async () => {
    installTauri(async () => ({ verdict: 'meh', line: 42 }));
    const v = await judge({ prompt: 'q', answer: '', rubric: 'r' });
    expect(v.line).toBe(AWAY_LINE);
  });
});

describe('without Tauri, clients stay on the HTTP path', () => {
  it('getPacks hits fetch (stubbed) rather than invoke', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ packs: [] }), { status: 200 }));
    try {
      const res = await getPacks();
      expect(fetchSpy).toHaveBeenCalledWith('/api/packs');
      expect(res).toEqual({ packs: [] });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('getStateStrict distinguishes JSON, null, absence, HTTP failure, malformed data, and transport failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      fetchSpy.mockResolvedValueOnce(new Response(JSON.stringify({ hp: 16 }), { status: 200 }));
      expect(await getStateStrict('save.json')).toEqual({ status: 'found', value: { hp: 16 } });

      fetchSpy.mockResolvedValueOnce(new Response('null', { status: 200 }));
      expect(await getStateStrict('save.json')).toEqual({ status: 'found', value: null });

      fetchSpy.mockResolvedValueOnce(new Response(null, { status: 404 }));
      expect(await getStateStrict('save.json')).toEqual({ status: 'absent' });

      fetchSpy.mockResolvedValueOnce(new Response('unavailable', { status: 503 }));
      expect(await getStateStrict('save.json')).toEqual({
        status: 'error',
        kind: 'http',
        message: 'State read failed with HTTP 503.',
        httpStatus: 503,
      });

      fetchSpy.mockResolvedValueOnce(new Response('<!doctype html>', { status: 200 }));
      const malformed = await getStateStrict('save.json');
      expect(malformed).toMatchObject({ status: 'error', kind: 'invalid-json' });

      fetchSpy.mockRejectedValueOnce(new TypeError('network unavailable'));
      expect(await getStateStrict('save.json')).toEqual({
        status: 'error',
        kind: 'transport',
        message: 'network unavailable',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('putState adds keepalive only when explicitly requested', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(null, { status: 204 }));
    try {
      expect(await putState('journey.json', { gold: 4 }, { keepalive: true })).toBe(true);
      expect(await putState('legacy.json', { gold: 1 })).toBe(true);

      expect(fetchSpy).toHaveBeenNthCalledWith(1, '/api/state/journey.json', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gold: 4 }),
        keepalive: true,
      });
      expect(fetchSpy).toHaveBeenNthCalledWith(2, '/api/state/legacy.json', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gold: 1 }),
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
