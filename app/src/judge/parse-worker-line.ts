/**
 * Pure parser for one line of the `claude -p --output-format stream-json`
 * NDJSON protocol (used by ../../judge-worker.ts's warm pool). We only care
 * about the terminal `result` event — its `result` field carries the exact
 * same raw text today's plain `claude -p` capture would have produced, so
 * the existing parseVerdict/firstJsonObject in vite-judge-plugin.ts can
 * parse it unchanged. Every other event type (`system` boot events,
 * `assistant` content/thinking blocks, `rate_limit_event`, …) is "pending" —
 * keep reading.
 */
export type WorkerLineResult =
  | { kind: 'pending' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; message: string };

export function parseWorkerLine(line: string): WorkerLineResult {
  const trimmed = line.trim();
  if (!trimmed) return { kind: 'pending' };
  let evt: unknown;
  try {
    evt = JSON.parse(trimmed);
  } catch {
    return { kind: 'pending' }; // a split/partial line — the caller re-buffers it
  }
  if (typeof evt !== 'object' || evt === null) return { kind: 'pending' };
  const o = evt as Record<string, unknown>;
  if (o.type !== 'result') return { kind: 'pending' };
  if (!o.is_error && typeof o.result === 'string') {
    return { kind: 'success', text: o.result };
  }
  return { kind: 'error', message: `warm worker result subtype=${String(o.subtype ?? 'unknown')}` };
}
