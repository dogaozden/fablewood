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
  try {
    return JSON.parse(await fsp.readFile(path.join(dir, name), 'utf8'));
  } catch {
    return null; // missing file
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
