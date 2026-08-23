/**
 * «Onward» card + desk DOM (design §5). Same DOM-over-canvas parchment language as
 * the encounter overlay family, but self-contained: story owns its UI, encounters
 * owns its own — providers never import each other's internals (contracts.ts header).
 * Classes are prefixed fw-story-* / fw-desk-* so e2e can target them unambiguously.
 */
import type { StoryBeat } from '../game/contracts';

let stylesDone = false;
function ensureStyles(): void {
  if (stylesDone) return;
  stylesDone = true;
  const css = `
  .fw-story-veil { position:fixed; inset:0; z-index:60; display:flex; align-items:center;
    justify-content:center; background:rgba(20,14,26,.62); }
  .fw-story-card { width:min(560px, 92vw); max-height:82vh; overflow-y:auto;
    background:#EBD9B2; color:#2a1d13; border:2px solid #8a6b3f; border-radius:10px;
    padding:22px 26px 16px; font-family:Georgia, 'Times New Roman', serif;
    box-shadow:0 12px 40px rgba(0,0,0,.5); }
  .fw-story-eyebrow { font-size:.72rem; letter-spacing:.14em; text-transform:uppercase;
    color:#7a5610; margin-bottom:6px; }
  .fw-story-title { font-size:1.25rem; font-weight:700; margin-bottom:12px; }
  .fw-story-page { line-height:1.55; margin-bottom:12px; white-space:pre-wrap; }
  .fw-story-page i { color:#4a3a24; }
  .fw-story-margin { font-size:.85rem; font-style:italic; color:#6b5638;
    border-top:1px solid rgba(138,107,63,.4); padding-top:8px; margin-top:4px; }
  .fw-story-hint { font-size:.72rem; color:#6b5638; text-align:right; margin-top:10px; }
  .fw-desk { position:fixed; inset:0; z-index:60; display:flex; align-items:center;
    justify-content:center; background:rgba(20,14,26,.62); }
  .fw-desk-panel { width:min(760px, 94vw); height:min(560px, 86vh); display:flex;
    background:#EBD9B2; color:#2a1d13; border:2px solid #8a6b3f; border-radius:10px;
    font-family:Georgia, 'Times New Roman', serif; overflow:hidden;
    box-shadow:0 12px 40px rgba(0,0,0,.5); }
  .fw-desk-nav { width:220px; border-right:1px solid rgba(138,107,63,.4); padding:16px 0;
    overflow-y:auto; }
  .fw-desk-bookhead { font-size:.72rem; letter-spacing:.12em; text-transform:uppercase;
    color:#7a5610; padding:8px 16px 4px; }
  .fw-desk-item { display:block; width:100%; text-align:left; padding:7px 16px; border:0;
    background:none; color:#2a1d13; font:inherit; cursor:pointer; }
  .fw-desk-item:hover { background:rgba(138,107,63,.15); }
  .fw-desk-item.fw-desk-locked { color:#6b5638; cursor:default; font-style:italic; }
  .fw-desk-body { flex:1; padding:20px 26px; overflow-y:auto; line-height:1.55;
    white-space:pre-wrap; }
  .fw-desk-close { position:absolute; margin:10px; }
  `;
  const tag = document.createElement('style');
  tag.textContent = css;
  document.head.appendChild(tag);
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

/** Render `*italic*` markers in curated prose as <i> — the only markup cards carry. */
function renderProse(target: HTMLElement, text: string): void {
  const parts = text.split('*');
  parts.forEach((part, i) => {
    if (i % 2 === 1) {
      const it = document.createElement('i');
      it.textContent = part;
      target.appendChild(it);
    } else {
      target.appendChild(document.createTextNode(part));
    }
  });
}

/** Parchment story card: all pages shown, dismiss on Enter/Space/click. Resolves on dismiss. */
export function showBeatCard(beat: StoryBeat, opts?: { auto?: boolean }): Promise<void> {
  ensureStyles();
  return new Promise((resolve) => {
    const veil = el('div', 'fw-story-veil');
    const card = el('div', 'fw-story-card');
    card.setAttribute('data-beat', beat.id);
    card.appendChild(el('div', 'fw-story-eyebrow', '«Onward» · the Second Telling'));
    card.appendChild(el('div', 'fw-story-title', beat.title));
    for (const page of beat.pages) {
      const p = el('div', 'fw-story-page');
      renderProse(p, page);
      card.appendChild(p);
    }
    if (beat.margin) card.appendChild(el('div', 'fw-story-margin', beat.margin));
    card.appendChild(el('div', 'fw-story-hint', 'Enter · continue'));
    veil.appendChild(card);
    document.body.appendChild(veil);

    const done = (): void => {
      window.removeEventListener('keydown', onKey, true);
      veil.remove();
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Enter' || ev.key === ' ' || ev.key === 'e' || ev.key === 'Escape') {
        ev.preventDefault();
        ev.stopPropagation();
        done();
      }
    };
    window.addEventListener('keydown', onKey, true);
    veil.addEventListener('click', done);
    if (opts?.auto) setTimeout(done, 600);
  });
}

export interface DeskModel {
  cantos: { roman: string; title: string; body: string; unlocked: boolean }[];
  onward: { heading: string; entries: string[]; clerkLine: string };
}

/** The Records Office reading desk: nav (two books) + reader pane. Esc/E closes. */
export function openDeskUi(model: DeskModel): Promise<void> {
  ensureStyles();
  return new Promise((resolve) => {
    const veil = el('div', 'fw-desk');
    const panel = el('div', 'fw-desk-panel');
    const nav = el('div', 'fw-desk-nav');
    const body = el('div', 'fw-desk-body');

    nav.appendChild(el('div', 'fw-desk-bookhead', '«The First Lantern»'));
    model.cantos.forEach((c) => {
      const label = c.unlocked ? `Canto ${c.roman} — ${c.title}` : `Canto ${c.roman} — …`;
      const item = el('button', `fw-desk-item${c.unlocked ? '' : ' fw-desk-locked'}`, label);
      if (c.unlocked) {
        item.addEventListener('click', () => {
          body.textContent = `Canto ${c.roman} — ${c.title}\n\n${c.body}`;
          body.scrollTop = 0;
        });
      } else {
        item.addEventListener('click', () => {
          body.textContent = 'This canto waits. Tend more of your ledger — the desk will know.';
        });
      }
      nav.appendChild(item);
    });

    nav.appendChild(el('div', 'fw-desk-bookhead', '«Onward»'));
    const onwardItem = el('button', 'fw-desk-item', model.onward.heading);
    onwardItem.addEventListener('click', () => {
      const lines = [
        model.onward.heading,
        '',
        ...(model.onward.entries.length ? model.onward.entries.map((t) => `· ${t}`) : []),
        '',
        model.onward.clerkLine,
      ];
      body.textContent = lines.join('\n');
      body.scrollTop = 0;
    });
    nav.appendChild(onwardItem);

    // opening view: the first unlocked canto
    const first = model.cantos.find((c) => c.unlocked);
    if (first) body.textContent = `Canto ${first.roman} — ${first.title}\n\n${first.body}`;

    panel.appendChild(nav);
    panel.appendChild(body);
    veil.appendChild(panel);
    document.body.appendChild(veil);

    const done = (): void => {
      window.removeEventListener('keydown', onKey, true);
      veil.remove();
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape' || ev.key === 'e') {
        ev.preventDefault();
        ev.stopPropagation();
        done();
      }
    };
    window.addEventListener('keydown', onKey, true);
    veil.addEventListener('click', (ev) => {
      if (ev.target === veil) done();
    });
  });
}
