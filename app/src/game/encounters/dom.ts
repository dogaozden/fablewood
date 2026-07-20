/** Tiny DOM helpers + the encounter-kind vocabulary, shared by overlay.ts and kinds.ts. */

/** createElement with attrs (on* → listeners, known props set directly, else setAttribute) + children. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, unknown> = {},
  children: Array<Node | string> = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null) continue;
    if (k.startsWith('on') && typeof v === 'function') {
      node.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === 'class') node.className = String(v);
    else if (k === 'text') node.textContent = String(v);
    else if (k in node) (node as unknown as Record<string, unknown>)[k] = v;
    else node.setAttribute(k, String(v));
  }
  for (const c of children) node.append(c);
  return node;
}

export interface ActionMeta {
  glyph: string;
  action: string;
  kind: string;
  hint: string;
}

/**
 * Each encounter kind is dressed as its combat move (slice-blueprint §3), so the overlay
 * speaks the same language as the battle: mcq = Smite, match = Binding Weave, etc.
 * (Strike is free and overlay-less since the friction redesign — mcq now gates Smite.)
 * Glyphs are monochrome typographic ornaments (they inherit text color → stay on-palette).
 */
export const ACTIONS: Record<string, ActionMeta> = {
  mcq: { glyph: '✦', action: 'Smite', kind: 'Multiple Choice', hint: 'Press 1–4, or click, to smite.' },
  free_recall: { glyph: '✧', action: 'Cast From Memory', kind: 'Free Recall', hint: 'Write it from memory, then Cast (Enter).' },
  scenario_branch: { glyph: '❧', action: 'Parley', kind: 'Scenario', hint: 'Press a number, or click a reply.' },
  match: { glyph: '❈', action: 'Binding Weave', kind: 'Match', hint: 'Pick one from each side to bind them.' },
  order: { glyph: '❖', action: 'Ritual Sequence', kind: 'Order', hint: 'Reorder with ↑ ↓ (or drag), then seal.' },
  teaching: { glyph: '❦', action: 'Discovered Document', kind: 'The Ledger Remembers', hint: 'Space or → to read on.' },
};

/** Seal glyph for a verdict tone. */
export function sealGlyph(tone: 'pass' | 'partial' | 'fail'): string {
  return tone === 'pass' ? '✦' : tone === 'partial' ? '❖' : '✕';
}
