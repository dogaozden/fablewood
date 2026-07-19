/**
 * Pure text layout for the dialogue box — no Phaser, so it unit-tests in the node
 * vitest env. Word-wraps to a column budget and groups the wrapped lines into
 * fixed-height pages.
 */

/** Greedy word-wrap to at most `maxCols` characters per line; hard-breaks overlong words. */
export function wrapWords(text: string, maxCols: number): string[] {
  const lines: string[] = [];
  let cur = '';
  const flush = () => {
    if (cur.length) lines.push(cur);
    cur = '';
  };
  for (const raw of text.split(/\s+/).filter(Boolean)) {
    let w = raw;
    while (w.length > maxCols) {
      flush();
      lines.push(w.slice(0, maxCols));
      w = w.slice(maxCols);
    }
    if (cur === '') cur = w;
    else if (cur.length + 1 + w.length <= maxCols) cur += ' ' + w;
    else {
      flush();
      cur = w;
    }
  }
  flush();
  return lines;
}

/**
 * Wrap `text` to `maxCols` and pack lines into pages of at most `maxRows` lines.
 * Explicit '\n' in the input forces a line break (blank lines preserved). Always
 * returns at least one (possibly empty) page.
 */
export function paginate(text: string, maxCols: number, maxRows: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    const wrapped = wrapWords(para, maxCols);
    if (wrapped.length === 0) lines.push('');
    else lines.push(...wrapped);
  }
  const pages: string[] = [];
  for (let i = 0; i < lines.length; i += maxRows) {
    pages.push(lines.slice(i, i + maxRows).join('\n'));
  }
  return pages.length ? pages : [''];
}
