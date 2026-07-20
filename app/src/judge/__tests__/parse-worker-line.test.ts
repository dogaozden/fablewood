import { describe, it, expect } from 'vitest';
import { parseWorkerLine } from '../parse-worker-line';

// Fixture shapes captured 2026-07-20 from a real
// `claude -p --input-format stream-json --output-format stream-json --verbose`
// run (see the worktree report) — trimmed to the fields parseWorkerLine reads.
const systemEvent = '{"type":"system","subtype":"init","session_id":"abc"}';
const assistantThinkingEvent =
  '{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"deliberating..."}]}}';
const assistantTextEvent =
  '{"type":"assistant","message":{"content":[{"type":"text","text":"{\\"verdict\\":\\"pass\\"}"}]}}';
const rateLimitEvent = '{"type":"rate_limit_event","status":"allowed"}';
const resultSuccess =
  '{"type":"result","subtype":"success","is_error":false,"result":"{\\"verdict\\":\\"pass\\",\\"line\\":\\"The ink holds.\\"}"}';
const resultError = '{"type":"result","subtype":"error_max_turns","is_error":true,"result":null}';

describe('parseWorkerLine — stream-json NDJSON event classification', () => {
  it('treats blank/whitespace lines as pending (buffering not yet complete)', () => {
    expect(parseWorkerLine('')).toEqual({ kind: 'pending' });
    expect(parseWorkerLine('   \n')).toEqual({ kind: 'pending' });
  });

  it('treats malformed/partial JSON as pending, not an error', () => {
    expect(parseWorkerLine('{"type":"result", "resu')).toEqual({ kind: 'pending' });
  });

  it('treats every non-result event type as pending', () => {
    expect(parseWorkerLine(systemEvent)).toEqual({ kind: 'pending' });
    expect(parseWorkerLine(assistantThinkingEvent)).toEqual({ kind: 'pending' });
    expect(parseWorkerLine(assistantTextEvent)).toEqual({ kind: 'pending' });
    expect(parseWorkerLine(rateLimitEvent)).toEqual({ kind: 'pending' });
  });

  it('extracts the raw text from a successful result event', () => {
    const r = parseWorkerLine(resultSuccess);
    expect(r.kind).toBe('success');
    expect(r).toMatchObject({ kind: 'success', text: expect.stringContaining('"verdict":"pass"') });
  });

  it('reports is_error:true result events as an error', () => {
    const r = parseWorkerLine(resultError);
    expect(r.kind).toBe('error');
  });

  it('reports a result event with a non-string result as an error, not a crash', () => {
    const r = parseWorkerLine('{"type":"result","subtype":"success","is_error":false,"result":null}');
    expect(r.kind).toBe('error');
  });
});
