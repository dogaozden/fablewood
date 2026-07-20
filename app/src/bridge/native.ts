/**
 * Tauri-native transport — the desktop twin of the dev-server bridge.
 *
 * When the app runs inside the Tauri webview, `window.__TAURI_INTERNALS__.invoke`
 * exists and every bridge call routes to a Rust command (src-tauri/src/bridge.rs)
 * instead of the vite middleware. In the browser (dev server or static build) the
 * detection returns false and the HTTP paths behave exactly as before — this module
 * deliberately has no dependency on @tauri-apps/api so the web bundle and the node
 * test environment never pay for or trip over Tauri code.
 *
 * Contract parity: each native impl mirrors its HTTP twin's graceful degradation —
 * errors surface as empty/absent data, never as thrown exceptions.
 */
import type { PackEntry, PacksResponse } from './types';

interface TauriInternals {
  invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T>;
}

function internals(): TauriInternals | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as { __TAURI_INTERNALS__?: TauriInternals };
  return w.__TAURI_INTERNALS__ ?? null;
}

/** True when running inside the Tauri desktop shell. */
export function isTauri(): boolean {
  return internals() !== null;
}

/** Invoke a Rust command. Throws when not under Tauri or when the command rejects. */
export async function invokeNative<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  const t = internals();
  if (!t) throw new Error('not running under tauri');
  return t.invoke<T>(cmd, args);
}

export async function nativeGetPacks(): Promise<PacksResponse> {
  try {
    const packs = await invokeNative<PackEntry[]>('packs_list');
    return { packs: Array.isArray(packs) ? packs : [] };
  } catch {
    return { packs: [] };
  }
}

/** Mirror of the bridge plugin's content-type-by-extension for served assets. */
function assetMime(relPath: string): string {
  const ext = relPath.slice(relPath.lastIndexOf('.')).toLowerCase();
  switch (ext) {
    case '.json':
      return 'application/json';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Read a pack asset via Rust (raw bytes over the IPC) and wrap it in a Response so
 * callers keep picking `.json()` / `.blob()` exactly as with the HTTP bridge.
 */
export async function nativeGetPackAsset(
  packId: string,
  relPath: string,
): Promise<Response | null> {
  try {
    const buf = await invokeNative<ArrayBuffer>('pack_asset', { packId, relPath });
    return new Response(buf, {
      status: 200,
      headers: { 'content-type': assetMime(relPath) },
    });
  } catch {
    return null;
  }
}

export async function nativeGetState<T = unknown>(name: string): Promise<T | null> {
  try {
    return await invokeNative<T | null>('state_read', { name });
  } catch {
    return null;
  }
}

export async function nativePutState(name: string, data: unknown): Promise<boolean> {
  try {
    await invokeNative<void>('state_write', { name, data });
    return true;
  } catch {
    return false;
  }
}
