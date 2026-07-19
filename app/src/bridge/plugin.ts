import type { Plugin, ViteDevServer } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { PackEntry } from './types';

// --- Directory resolution (env overrides, cwd-relative defaults) -------------

export function packsDir(): string {
  return process.env.PACKS_DIR
    ? path.resolve(process.env.PACKS_DIR)
    : path.resolve(process.cwd(), 'packs');
}

export function stateDir(): string {
  return process.env.STATE_DIR
    ? path.resolve(process.env.STATE_DIR)
    : path.resolve(process.cwd(), 'state');
}

// --- Packs (read-only, from disk at request time) ----------------------------

/** List packs found at <dir>/<name>/pack.json. Missing dir → []. Bad JSON is skipped. */
export function listPacks(dir: string): PackEntry[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return []; // missing dir = no packs installed
  }
  const packs: PackEntry[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const file = path.join(dir, entry.name, 'pack.json');
    try {
      const pack = JSON.parse(fs.readFileSync(file, 'utf8'));
      const id =
        typeof pack?.meta?.id === 'string' ? (pack.meta.id as string) : entry.name;
      packs.push({ id, dir: entry.name, pack });
    } catch {
      // no pack.json, or unreadable/invalid — skip silently
    }
  }
  return packs;
}

// --- State (read/write JSON files; atomic writes, never deletes siblings) -----

const NAME_RE = /^[A-Za-z0-9._-]+$/;

/** Guards against path traversal and stray separators. */
export function isValidStateName(name: string): boolean {
  return NAME_RE.test(name) && !name.includes('..');
}

export async function readState(dir: string, name: string): Promise<unknown | null> {
  if (!isValidStateName(name)) throw new Error(`invalid state name: ${name}`);
  let raw: string;
  try {
    raw = await fsp.readFile(path.join(dir, name), 'utf8');
  } catch {
    return null; // missing file
  }
  try {
    return JSON.parse(raw);
  } catch {
    // Unparseable bytes (truncated write, hand edit): NOT the same as missing.
    // state/ is precious — preserve the bytes before any caller, seeing null,
    // starts fresh and overwrites the only copy. Content-hashed name + wx keep
    // repeated reads of the same corrupt file from multiplying backups.
    let h = 5381;
    for (let i = 0; i < raw.length; i++) h = ((h * 33) ^ raw.charCodeAt(i)) >>> 0;
    const backup = `${name.replace(/\.json$/, '')}.corrupt-${h.toString(16)}.json`;
    try {
      await fsp.writeFile(path.join(dir, backup), raw, { flag: 'wx' });
      console.warn(`[bridge] state/${name} is not valid JSON; bytes preserved at state/${backup}`);
    } catch {
      /* backup already exists (same bytes) or is unwritable — still degrade */
    }
    return null;
  }
}

/** Atomic write: tmp file + rename, mkdir -p. Touches only the target file. */
export async function writeState(dir: string, name: string, data: unknown): Promise<void> {
  if (!isValidStateName(name)) throw new Error(`invalid state name: ${name}`);
  await fsp.mkdir(dir, { recursive: true });
  const tmp = path.join(
    dir,
    `.tmp-${name}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  );
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tmp, path.join(dir, name));
}

// --- Pack assets (read-only files under packs/<dir>/assets/) ------------------

/**
 * Resolve a request-supplied relative path against a pack's assets dir, returning
 * the absolute path only if it stays strictly inside that dir. Rejects `..`
 * traversal, absolute paths, and anything that escapes the assets root. Returns
 * null (→ caller sends 400) for anything unsafe.
 */
export function safePackAssetPath(assetsRoot: string, relPath: string): string | null {
  if (!relPath || relPath.includes('\0')) return null;
  const root = path.resolve(assetsRoot);
  const full = path.resolve(root, relPath);
  // must be a file *inside* the assets dir, not the dir itself or a sibling
  if (full === root) return null;
  if (!full.startsWith(root + path.sep)) return null;
  return full;
}

/** Content-type by extension for served assets (JSON specs, sprite images, …). */
export function assetContentType(filePath: string): string {
  switch (path.extname(filePath).toLowerCase()) {
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

// --- Vite dev-server plugin --------------------------------------------------

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.end(json);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Dev-only bridge. These APIs exist under `vite`/`vite dev` only; a static build
 * has no server, so the client falls back to empty state gracefully.
 */
export function fablewoodBridge(): Plugin {
  return {
    name: 'fablewood-bridge',
    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url ?? '';
        try {
          // Pack assets (read-only): GET /api/packs/<id>/assets/<relpath>
          const assetMatch = url.match(/^\/api\/packs\/([^/?]+)\/assets\/([^?]*)/);
          if (assetMatch) {
            if (req.method !== 'GET') {
              send(res, 405, { error: 'method not allowed' });
              return;
            }
            const packId = decodeURIComponent(assetMatch[1]);
            const rel = decodeURIComponent(assetMatch[2]);
            const pack = listPacks(packsDir()).find((p) => p.id === packId);
            if (!pack) {
              send(res, 404, { error: 'pack not found' });
              return;
            }
            const assetsRoot = path.join(packsDir(), pack.dir, 'assets');
            const full = safePackAssetPath(assetsRoot, rel);
            if (!full) {
              send(res, 400, { error: 'invalid asset path' });
              return;
            }
            try {
              const buf = await fsp.readFile(full);
              res.statusCode = 200;
              res.setHeader('content-type', assetContentType(full));
              res.end(buf);
            } catch {
              send(res, 404, { error: 'asset not found' });
            }
            return;
          }

          if (url === '/api/packs' || url.startsWith('/api/packs?')) {
            send(res, 200, { packs: listPacks(packsDir()) });
            return;
          }

          const match = url.match(/^\/api\/state\/([^/?]+)/);
          if (match) {
            const name = decodeURIComponent(match[1]);
            if (!isValidStateName(name)) {
              send(res, 400, { error: 'invalid state name' });
              return;
            }
            if (req.method === 'GET') {
              const data = await readState(stateDir(), name);
              if (data === null) {
                send(res, 404, { error: 'not found' });
                return;
              }
              send(res, 200, data);
              return;
            }
            if (req.method === 'PUT') {
              const raw = await readBody(req);
              let parsed: unknown;
              try {
                parsed = raw ? JSON.parse(raw) : null;
              } catch {
                send(res, 400, { error: 'invalid JSON body' });
                return;
              }
              await writeState(stateDir(), name, parsed);
              send(res, 200, { ok: true });
              return;
            }
            send(res, 405, { error: 'method not allowed' });
            return;
          }

          next();
        } catch (err) {
          send(res, 500, { error: String((err as Error)?.message ?? err) });
        }
      });
    },
  };
}
