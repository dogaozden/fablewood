/**
 * The encounter overlay — a DOM panel over the dimmed Phaser canvas (DOM beats canvas text
 * entry for free_recall; slice-blueprint §1). buildOverlay() owns the parchment scaffolding,
 * focus, and the keyboard bus; the per-kind renderers (kinds.ts) fill the body and resolve.
 *
 * ESC policy (task teeth): in a Wellspring 'drill' you may flee (quality 0); in combat / boss /
 * parley ESC does nothing — you answer or you don't.
 */
import type { EncounterRequest, EncounterResult, Judge, FactLite } from '../contracts';
import type { Encounter } from '../../packs/types';
import { ensureStyles } from './styles';
import { el, ACTIONS } from './dom';
import { RENDERERS } from './kinds';

export interface EncounterCtx {
  context: EncounterRequest['context'];
  judge: Judge;
  /** §12.4 — T2/T3 spell casts pass their label through here for the eyebrow's action slot
   *  ("✦ Cinder-Rebuke · Multiple Choice"); T1 casts pass nothing (shipped eyebrows unchanged). */
  flair?: string;
}

export interface Overlay {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  /** eyebrow (action name + glyph) + prompt + rule; omit prompt for teaching. `flair` (§12.4)
   *  replaces the default action-kind name in the eyebrow ("Cinder-Rebuke" instead of "Smite"). */
  setHeader(kindKey: string, prompt?: string, flair?: string): void;
  /** register a keydown handler (several may coexist; all fire). */
  onKey(fn: (e: KeyboardEvent) => void): void;
  /** animate out, remove, restore prior focus. */
  close(): Promise<void>;
}

/**
 * While any overlay is open the game keyboard goes quiet: Phaser holds global key
 * captures (the hamlet's WASD/E/Space/cursors) that preventDefault at the window
 * level, which silently eats those characters out of a focused text input —
 * "economics and control" once arrived as "conomicncontrol". Depth-counted for
 * stacked overlays; key state resets on both edges so no held key keeps the
 * Keeper walking under (or after) the card.
 */
let overlayDepth = 0;
function quietGameKeyboard(quiet: boolean): void {
  const game = window.__FABLEWOOD_GAME;
  const kb = game?.input.keyboard;
  if (!game || !kb) return;
  kb.enabled = !quiet;
  for (const s of game.scene.getScenes(true)) s.input?.keyboard?.resetKeys();
}

/**
 * Overlays are document.body children, so they outlive the canvas: switching
 * shell tabs unmounts PhaserGame and the orphaned card kept floating over the
 * Dashboard while its drill loop ran on against the dead scene. PhaserGame
 * announces teardown via GAME_TEARDOWN_EVENT and every open overlay is dropped
 * (no exit animation, latch stepped down). The abandoned promises are
 * deliberately left unresolved: an encounter nobody answered must never be
 * graded, and rejecting would crash the dead scene's continuations — the parked
 * chains are garbage once the destroyed game releases them.
 */
const openOverlays = new Set<() => void>();
export const GAME_TEARDOWN_EVENT = 'fablewood:game-teardown';

export function abortOpenOverlays(): void {
  for (const abort of [...openOverlays]) abort();
}

if (typeof window !== 'undefined') {
  window.addEventListener(GAME_TEARDOWN_EVENT, abortOpenOverlays);
}

function buildOverlay(): Overlay {
  ensureStyles();
  const prevFocus = document.activeElement as HTMLElement | null;
  let closed = false;

  const header = el('div', { class: 'fw-header' });
  const body = el('div', { class: 'fw-body' });
  const footer = el('div', { class: 'fw-footer' });
  const panel = el(
    'div',
    { class: 'fw-panel', tabIndex: -1, role: 'dialog', 'aria-modal': 'true' },
    [header, body, footer],
  );
  const root = el('div', { class: 'fw-overlay' }, [panel]);

  const handlers: Array<(e: KeyboardEvent) => void> = [];
  root.addEventListener('keydown', (e) => {
    for (const h of handlers) h(e);
  });

  /**
   * BUG #12 (crucible sev2): the panel is a programmatic keyboard host (tabIndex=-1,
   * above) so something inside the overlay always holds focus for the keydown bus above
   * to receive events. But a stray click on inert content (e.g. kinds.ts's teachBlock)
   * has no focusable target of its own, so the browser's default click-to-focus
   * delegates to the nearest focusable ancestor — the panel — stealing focus off
   * whatever control (typically the Onward/Continue button) held it. Once focus is on
   * the bare panel, Enter/Space have nothing to activate (a mouse click on the control
   * itself still works, since that doesn't depend on focus). Suppressing the
   * mousedown's default for any non-control target keeps focus put, without touching
   * the click-through behaviour those controls (and drag-to-reorder) still need.
   */
  root.addEventListener('mousedown', (e) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest('button, input, textarea, select, a[href], [draggable="true"]')) {
      e.preventDefault();
    }
  });

  document.body.appendChild(root);
  if (++overlayDepth === 1) quietGameKeyboard(true);
  requestAnimationFrame(() => panel.focus());

  // Shared by close() (after its exit animation) and abort (immediately): remove
  // the DOM and step the keyboard latch down exactly once per overlay.
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  const finishClose = (): void => {
    if (closeTimer !== null) clearTimeout(closeTimer);
    closeTimer = null;
    openOverlays.delete(abort);
    root.remove();
    if (--overlayDepth === 0) quietGameKeyboard(false);
  };
  const abort = (): void => {
    if (closed) {
      // mid-exit-animation: settle the bookkeeping now (its close() promise,
      // like an aborted overlay's encounter promise, is left unresolved)
      if (closeTimer !== null) finishClose();
      return;
    }
    closed = true;
    finishClose();
  };
  openOverlays.add(abort);

  return {
    root,
    panel,
    body,
    footer,
    setHeader(kindKey, prompt, flair) {
      const a = ACTIONS[kindKey] ?? ACTIONS.mcq;
      const parts: Array<Node | string> = [
        el('div', { class: 'fw-eyebrow' }, [
          el('span', { class: 'fw-glyph', 'aria-hidden': 'true', text: a.glyph }),
          el('span', { text: flair ?? a.action }),
          el('span', { class: 'fw-kindname', text: `· ${a.kind}` }),
        ]),
      ];
      if (prompt) parts.push(el('h2', { class: 'fw-prompt', text: prompt }));
      parts.push(el('hr', { class: 'fw-rule' }));
      header.replaceChildren(...parts);
    },
    onKey(fn) {
      handlers.push(fn);
    },
    close() {
      // idempotent: a drill-flee racing a pending judge may finish twice, and the
      // keyboard latch must only step once per overlay.
      if (closed) return Promise.resolve();
      closed = true;
      root.classList.add('is-closing');
      return new Promise<void>((resolve) => {
        closeTimer = setTimeout(() => {
          finishClose();
          prevFocus?.focus?.();
          resolve();
        }, 170);
      });
    },
  };
}

/** Open an encounter overlay; resolves with the graded result when the player is done. */
export function presentEncounter(
  encounter: Encounter,
  facts: FactLite[],
  ctx: EncounterCtx,
): Promise<EncounterResult> {
  return new Promise((resolve) => {
    const o = buildOverlay();
    o.setHeader(encounter.kind, encounter.prompt, ctx.flair);

    const finish = async (result: EncounterResult) => {
      await o.close();
      resolve(result);
    };

    // ESC policy first, then the kind's own keys.
    o.onKey((e) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      if (ctx.context === 'drill') {
        void finish({
          encounterId: encounter.id,
          kind: encounter.kind,
          factIds: encounter.fact_ids,
          quality: 0,
          detail: 'You slip back from the drill, the fact left unwelded.',
        });
      }
      // combat / boss / parley: no escape.
    });

    RENDERERS[encounter.kind](o, encounter, facts, ctx, (r) => void finish(r));
  });
}

/** "Discovered documents" — a parchment card per fact (teach-and-test). Resolves when dismissed. */
export function presentTeaching(facts: FactLite[]): Promise<void> {
  return new Promise((resolve) => {
    const o = buildOverlay();
    o.setHeader('teaching');
    const cards = facts.length ? facts : [{ id: 'x', type: 'note', statement: 'The archive is quiet.' }];

    let index = 0;
    const dots = el('div', { class: 'fw-dots-progress' });
    const nextBtn = el('button', { class: 'fw-btn fw-btn-primary', type: 'button' });

    const renderDots = () => {
      dots.replaceChildren(
        ...cards.map((_, i) => el('span', { class: i === index ? 'fw-dot is-on' : 'fw-dot' })),
      );
    };

    const renderCard = () => {
      const f = cards[index];
      const doc: Array<Node | string> = [
        el('span', { class: 'fw-doctype', text: f.type }),
        el('h2', { class: 'fw-docstate', text: f.statement }),
      ];
      if (f.detail) doc.push(el('p', { class: 'fw-docdetail', text: f.detail }));
      if (f.source_ref?.quote) {
        const loc = f.source_ref.loc ? ` › ${f.source_ref.loc}` : '';
        doc.push(
          el('blockquote', { class: 'fw-excerpt' }, [
            el('span', { class: 'fw-openquote', 'aria-hidden': 'true', text: '“' }),
            f.source_ref.quote,
            el('div', { class: 'fw-cite' }, [
              el('span', { class: 'fw-citemark', 'aria-hidden': 'true', text: '❦' }),
              el('span', { text: `${f.source_ref.file}${loc}` }),
            ]),
          ]),
        );
      }
      o.body.replaceChildren(el('div', { class: 'fw-doc' }, doc));
      nextBtn.textContent = index >= cards.length - 1 ? 'Close the archive' : 'Next page ▸';
      renderDots();
    };

    const advance = () => {
      if (index >= cards.length - 1) {
        void o.close().then(resolve);
      } else {
        index += 1;
        renderCard();
      }
    };

    nextBtn.addEventListener('click', advance);
    o.footer.replaceChildren(
      dots,
      el('span', { class: 'fw-spacer' }),
      el('span', { class: 'fw-hint', text: ACTIONS.teaching.hint }),
      nextBtn,
    );
    o.onKey((e) => {
      if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowRight') {
        e.preventDefault();
        advance();
      }
    });
    renderCard();
    requestAnimationFrame(() => nextBtn.focus());
  });
}
