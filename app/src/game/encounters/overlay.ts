/**
 * The encounter overlay — a DOM panel over the dimmed Phaser canvas (DOM beats canvas text
 * entry for free_recall; slice-blueprint §1). buildOverlay() owns the parchment scaffolding,
 * focus, and the keyboard bus; the per-kind renderers (kinds.ts) fill the body and resolve.
 *
 * ESC policy (task teeth): in a Wellspring 'drill' you may flee (quality 0); in combat / boss /
 * parley ESC does nothing — you answer or you don't.
 */
import type {
  Amendment,
  EncounterRequest,
  EncounterResult,
  Judge,
  FactLite,
  NightLedgerData,
} from '../contracts';
import type { Encounter, EncounterDifficulty } from '../../packs/types';
import { itemById } from '../../inventory/catalog';
import { ensureStyles } from './styles';
import { el, ACTIONS } from './dom';
import { RENDERERS, excerptBlock } from './kinds';
import { DIFFICULTY_DEFS, difficultyOf } from './engine';
import { createLanternGate, isCommitKey, isCommitTarget, redrawSentinel } from './lantern-ui';
import { LEVEL_UP_TITLE, LEVEL_UP_SIGNOFF } from '../progression/ceremony';

export interface EncounterCtx {
  context: EncounterRequest['context'];
  judge: Judge;
  /** §12.4 — T2/T3 spell casts pass their label through here for the eyebrow's action slot
   *  ("✦ Cinder-Rebuke · Multiple Choice"); T1 casts pass nothing (shipped eyebrows unchanged). */
  flair?: string;
  /** Ch. IV — caller holds a lit Lantern-light: show the overlay's re-draw affordance.
   *  Absent/false = no affordance (gates, boss phases, trim, teaching never pass it). */
  lanternLight?: boolean;
  /** One italic line under the eyebrow (e.g. lantern.ts FATE_HOLDS_LINE on a re-present).
   *  Absent = none. */
  notice?: string;
  /** Ch. VII Mira's Stall — Scrivener's Hint fired: renderMcq strikes one wrong option.
   *  Absent/false = no strike. Threaded straight from EncounterRequest (register.ts). */
  strikeOneFalse?: boolean;
}

export interface Overlay {
  root: HTMLDivElement;
  panel: HTMLDivElement;
  body: HTMLDivElement;
  footer: HTMLDivElement;
  /** Answer controls stay inert until the mounted overlay has been painted and settled. */
  isArmed(): boolean;
  /** eyebrow (action name + glyph) + prompt + rule; omit prompt for teaching. `flair` (§12.4)
   *  replaces the default action-kind name in the eyebrow ("Cinder-Rebuke" instead of "Smite"). */
  setHeader(kindKey: string, prompt?: string, flair?: string, difficulty?: EncounterDifficulty): void;
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

const ENCOUNTER_ARM_MS = 400;

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
  let armed = false;

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

  /**
   * BUG #4 (crucible sev3), generalized: answer controls receive native focus one frame
   * after mount, so a Space/Enter/number-key mash already in flight can otherwise commit
   * an unread encounter the instant its first control appears. The countdown must start
   * from a PRESENTED frame, not from render time: a bare setTimeout can elapse entirely
   * while a stalled device (throttling, GC, backgrounded tab) has painted nothing —
   * arming blind for the exact impatient-mash this guard exists to stop. Double-rAF
   * guarantees at least one real paint before the clock runs.
   */
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      setTimeout(() => { armed = true; }, ENCOUNTER_ARM_MS);
    });
  });

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
    isArmed() {
      return armed;
    },
    setHeader(kindKey, prompt, flair, difficulty) {
      const a = ACTIONS[kindKey] ?? ACTIONS.mcq;
      const difficultyMeta = difficulty === undefined ? null : DIFFICULTY_DEFS[difficulty];
      const difficultySpan = difficultyMeta
        ? el('span', { class: 'fw-difficulty', text: `· ${difficultyMeta.glyph} ${difficultyMeta.name}` })
        : null;
      if (difficultySpan && difficultyMeta) {
        // panelInk, not tint: this badge sits on parchment, where the canvas tints wash out.
        difficultySpan.style.color = difficultyMeta.panelInk;
      }
      const parts: Array<Node | string> = [
        el('div', { class: 'fw-eyebrow' }, [
          el('span', { class: 'fw-glyph', 'aria-hidden': 'true', text: a.glyph }),
          el('span', { text: flair ?? a.action }),
          el('span', { class: 'fw-kindname', text: `· ${a.kind}` }),
          ...(difficultySpan ? [difficultySpan] : []),
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
    o.setHeader(encounter.kind, encounter.prompt, ctx.flair, difficultyOf(encounter));

    // Ch. IV — one italic notice line under the eyebrow (fate-holds re-presents).
    if (ctx.notice) {
      o.panel.querySelector('.fw-header')!.appendChild(
        el('p', { class: 'fw-notice', text: ctx.notice }),
      );
    }

    // First resolution wins: the lantern strip and the kind's own done-callback race
    // (a slow judge round-trip vs a late lantern click) — never double-settle.
    const gate = createLanternGate();
    const finish = async (result: EncounterResult) => {
      if (!gate.settle()) return;
      await o.close();
      resolve(result);
    };

    // Ch. IV — "Raise the lantern": resolve a SENTINEL instead of answering. Chrome-level,
    // kind-agnostic. Disarmed the moment an answer gesture commits (any other button click,
    // Enter, or a digit key): "before answering any drill" means before COMMITTING an
    // answer — a submitted free-recall mid-judge must not be dodgeable.
    if (ctx.lanternLight) {
      const strip = el('div', { class: 'fw-lantern' });
      const btn = el('button', { class: 'fw-lantern-btn', text: 'Raise the lantern' }) as HTMLButtonElement;
      strip.appendChild(btn);
      strip.appendChild(el('span', { class: 'fw-lantern-hint', text: 'spend its light — a different memory surfaces' }));
      o.panel.querySelector('.fw-header')!.appendChild(strip);
      const disarm = (): void => {
        gate.disarm();
        strip.remove();
      };
      btn.addEventListener('click', () => {
        if (!o.isArmed() || !gate.mayRaise()) return;
        void finish(redrawSentinel(encounter));
      });
      o.root.addEventListener(
        'click',
        (e) => {
          const t = e.target as HTMLElement | null;
          if (t && isCommitTarget(t)) disarm();
        },
        { capture: true },
      );
      o.onKey((e) => {
        if (isCommitKey(e.key)) disarm();
      });
    }

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

const LEDGER_SUBTITLE: Record<NightLedgerData['outcome'], string> = {
  victory: '— the vault stands cleared',
  camp: '— rest, earned',
  retreat: '— a wise withdrawal',
  wipe: '— the Fade closes in', // Task 5/6 wires this
};

/**
 * "The Night's Ledger" (§3.2) — the run-harvest screen. A parchment overlay in the encounter
 * family (same buildOverlay scaffolding as presentTeaching: quiet keyboard, arm guard, teardown
 * safety). Rows are data-driven and zero-suppressed EXCEPT "Held against the Fade" (always
 * shown); the sign-off flips to its empty-harvest variant when nothing was gained. Dismiss on
 * Space / Enter / click — the continue idiom the encounter overlays use.
 */
export function presentNightLedger(data: NightLedgerData, opts: { auto?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    const o = buildOverlay();

    // rows — render only nonzero, EXCEPT "Held against the Fade" (always). Reclaimed carries a
    // gold accent, tying it back to the verdict-moment bell (§3.1).
    const rows: Array<{ label: string; value: string; accent?: boolean }> = [
      { label: 'Held against the Fade', value: String(data.held) },
    ];
    if (data.welds > 0) rows.push({ label: 'Newly welded', value: String(data.welds) });
    if (data.reclaimed > 0) rows.push({ label: 'Reclaimed from the Fade', value: String(data.reclaimed), accent: true });
    if (data.gold > 0) rows.push({ label: 'Gold', value: `+${data.gold}` });
    if (data.streak > 0) rows.push({ label: 'Vigil', value: data.streak === 1 ? '1 night' : `${data.streak} nights` });
    // Death's Door wipe (Task 6) — zero-suppressed like every row above: absent when nothing
    // was eligible to take (keepsakeId null is a real, reportable "nothing carried" outcome,
    // not "this wasn't a wipe" — see CombatScene's wipeAtDoor).
    if (data.keepsakeId) {
      rows.push({ label: 'Keepsake taken', value: itemById(data.keepsakeId)?.name ?? data.keepsakeId });
    }

    // empty harvest = nothing gained this run (streak is a standing counter, not a gain).
    const empty = data.held === 0 && data.welds === 0 && data.reclaimed === 0 && data.gold === 0;
    const signoff =
      data.outcome === 'wipe'
        ? 'The Fade took its due. The Ledger holds what matters.'
        : empty
          ? 'A thin page is still a page. The Ledger keeps it.'
          : 'So entered. What you keep, the Ledger keeps.';

    o.body.replaceChildren(
      el('div', { class: 'fw-ledger-head' }, [
        el('h2', { class: 'fw-ledger-title', text: "The Night's Ledger" }),
        el('span', { class: 'fw-ledger-sub', text: LEDGER_SUBTITLE[data.outcome] }),
      ]),
      el('hr', { class: 'fw-rule' }),
      el(
        'div',
        { class: 'fw-ledger-rows' },
        rows.map((r) =>
          el('div', { class: r.accent ? 'fw-ledger-row is-reclaim' : 'fw-ledger-row' }, [
            el('span', { class: 'fw-ledger-label', text: r.label }),
            el('span', { class: 'fw-ledger-lead', 'aria-hidden': 'true' }),
            el('span', { class: 'fw-ledger-val', text: r.value }),
          ]),
        ),
      ),
      el('p', { class: 'fw-ledger-signoff', text: signoff }),
    );

    let closed = false;
    const done = (): void => {
      if (closed) return;
      closed = true;
      void o.close().then(resolve);
    };
    const cont = el('button', {
      class: 'fw-btn fw-btn-primary',
      type: 'button',
      text: 'Onward ▸',
      onclick: () => {
        if (o.isArmed()) done();
      },
    });
    o.footer.replaceChildren(
      el('span', { class: 'fw-hint', text: 'Space, Enter, or click to close the ledger.' }),
      el('span', { class: 'fw-spacer' }),
      cont,
    );
    o.onKey((e) => {
      if ((e.key === ' ' || e.key === 'Enter') && o.isArmed()) {
        e.preventDefault();
        done();
      }
    });
    requestAnimationFrame(() => cont.focus());
    // auto-drive / dev flows must never hang on a click that won't come: auto-advance after a
    // readable beat (the dungeon cards' 'auto' CardMode idiom). Real play waits for input. The
    // window is generous so an e2e can capture the card even under fleet CPU load.
    if (opts.auto) setTimeout(done, 2000);
  });
}

/**
 * "The Lantern Burns Brighter" (Wave 4 Task 5) — the level-up ceremony card. Night-Ledger
 * family: same parchment scaffolding as presentNightLedger (quiet keyboard, arm guard, teardown
 * safety, Space/Enter/click "Onward ▸" to dismiss). Presentation-only — every row already
 * composed by progression/ceremony.ts's levelUpRows(); title/signoff are that same module's
 * FINAL copy, imported rather than re-authored here.
 * `opts.auto` mirrors presentNightLedger's own auto-drive escape hatch: DungeonScene's dev
 * harness (?auto=full/win) can cross a level threshold mid-run, and a card with no click
 * coming must never hang it.
 */
export function presentLevelUp(rows: string[], opts: { auto?: boolean } = {}): Promise<void> {
  return new Promise((resolve) => {
    const o = buildOverlay();

    o.body.replaceChildren(
      el('div', { class: 'fw-ledger-head' }, [el('h2', { class: 'fw-ledger-title', text: LEVEL_UP_TITLE })]),
      el('hr', { class: 'fw-rule' }),
      el(
        'div',
        { class: 'fw-ledger-rows' },
        rows.map((r) => el('div', { class: 'fw-ledger-row' }, [el('span', { class: 'fw-ledger-label', text: r })])),
      ),
      el('p', { class: 'fw-ledger-signoff', text: LEVEL_UP_SIGNOFF }),
    );

    let closed = false;
    const done = (): void => {
      if (closed) return;
      closed = true;
      void o.close().then(resolve);
    };
    const cont = el('button', {
      class: 'fw-btn fw-btn-primary',
      type: 'button',
      text: 'Onward ▸',
      onclick: () => {
        if (o.isArmed()) done();
      },
    });
    o.footer.replaceChildren(
      el('span', { class: 'fw-hint', text: 'Space, Enter, or click to close.' }),
      el('span', { class: 'fw-spacer' }),
      cont,
    );
    o.onKey((e) => {
      if ((e.key === ' ' || e.key === 'Enter') && o.isArmed()) {
        e.preventDefault();
        done();
      }
    });
    requestAnimationFrame(() => cont.focus());
    // dev/e2e auto-drive must never hang on a click that won't come (presentNightLedger's own
    // idiom, verbatim).
    if (opts.auto) setTimeout(done, 2000);
  });
}

/**
 * "The Ledger Amended" (supersession-reteach.md §3) — the supersession re-teach card, one
 * amendment per card. Same parchment scaffolding as presentNightLedger (quiet keyboard, arm
 * guard, teardown safety, Space/Enter/click to confirm).
 *
 * Teach-only: no question, no grade, no SRS record, no HP, no Glow — the ONLY outcome is the
 * caller's witness write when this resolves. Every player-facing string below is Fable-written
 * and FINAL (doc §3), transcribed verbatim.
 */
export const AMENDMENT_TITLE = 'The Ledger Amended';
export const AMENDMENT_OPENING = 'The Realm moved. The Ledger moves with it.';
export const AMENDMENT_CAPTION = 'What was true is not unwritten. It is amended. Both lines stay.';
export const AMENDMENT_CONFIRM = 'Read and witnessed ▸';
export const AMENDMENT_SIGNOFF = 'So amended. What the Ledger keeps, it keeps honestly.';

export function presentAmendment(
  card: Amendment,
  opts: { last?: boolean; auto?: boolean } = {},
): Promise<void> {
  return new Promise((resolve) => {
    const o = buildOverlay();

    const body: Array<Node | string> = [
      el('div', { class: 'fw-ledger-head' }, [
        el('h2', { class: 'fw-ledger-title', text: AMENDMENT_TITLE }),
        el('span', { class: 'fw-ledger-sub', text: AMENDMENT_OPENING }),
      ]),
      el('hr', { class: 'fw-rule' }),
      // the old truth, struck — then the caption that explains the strike, right under it
      el('p', { class: 'fw-amend-old', text: card.old.statement }),
      el('p', { class: 'fw-amend-caption', text: AMENDMENT_CAPTION }),
      // the new truth beneath it
      el('p', { class: 'fw-amend-new', text: card.next.statement }),
    ];
    if (card.next.detail) body.push(el('p', { class: 'fw-docdetail', text: card.next.detail }));
    // the new fact's source quote + citation — the same treatment free_recall's earned page gives it
    const excerpt = excerptBlock(card.next);
    if (excerpt) body.push(excerpt);
    if (opts.last) body.push(el('p', { class: 'fw-ledger-signoff', text: AMENDMENT_SIGNOFF }));

    o.body.replaceChildren(...body);

    let closed = false;
    const done = (): void => {
      if (closed) return;
      closed = true;
      void o.close().then(resolve);
    };
    const cont = el('button', {
      class: 'fw-btn fw-btn-primary',
      type: 'button',
      text: AMENDMENT_CONFIRM,
      onclick: () => {
        if (o.isArmed()) done();
      },
    });
    o.footer.replaceChildren(
      el('span', { class: 'fw-hint', text: 'Space, Enter, or click to witness the amendment.' }),
      el('span', { class: 'fw-spacer' }),
      cont,
    );
    o.onKey((e) => {
      if ((e.key === ' ' || e.key === 'Enter') && o.isArmed()) {
        e.preventDefault();
        done();
      }
      // no ESC: the Clerk's amendment is read and witnessed, not dismissed
    });
    requestAnimationFrame(() => cont.focus());
    if (opts.auto) setTimeout(done, 2000);
  });
}

export interface HoldTheLineHandle {
  /** Update the two 3-slot counters (successes → lantern-flames held, failures → fade-marks)
   *  and, on a round that produced reader-facing feedback, the beat line beneath them. `beat`
   *  is omitted for the revive round — it closes the frame into its own banner instead. */
  update(counts: { successes: number; failures: number }, beat?: { text: string; good: boolean }): void;
  /** Fade the card out and remove it. Idempotent — safe to call from more than one exit path. */
  close(): void;
}

const HOLD_SLOTS = 3;

/**
 * "The Ledger Holds Your Line" (Concordance Ch. I, Task 7) — Death's Door's persistent
 * hold-the-line status card. Deliberately NOT a .fw-overlay: that class is the full-screen
 * dimming/blurring modal every graded encounter uses (buildOverlay above), and the per-round
 * drill opens ON TOP of this card via the normal presentEncounter flow while the door is open —
 * two stacked .fw-overlay instances would double the blur and let the later one visually bury
 * this one under its own backdrop, and would risk two elements both matching the e2e suite's
 * single-element `.fw-overlay` + /Ledger Holds Your Line/ locator. Instead this is a small fixed
 * corner card (styles.ts), z-indexed ABOVE .fw-overlay so it stays legible while a drill is open,
 * with `pointer-events: none` and no keydown handler of its own — it never takes focus or a click
 * meant for the drill, so there is no focus/keyboard contention to resolve between the two.
 */
export function presentHoldTheLine(): HoldTheLineHandle {
  ensureStyles();

  const flameSlots = Array.from({ length: HOLD_SLOTS }, () => el('span', { class: 'fw-holdline-slot fw-flame' }));
  const markSlots = Array.from({ length: HOLD_SLOTS }, () => el('span', { class: 'fw-holdline-slot fw-mark' }));
  const beatEl = el('p', { class: 'fw-holdline-beat' });

  const root = el('div', { class: 'fw-holdline' }, [
    el('div', { class: 'fw-holdline-eyebrow' }, [
      el('span', { class: 'fw-glyph', 'aria-hidden': 'true', text: '✧' }),
      el('span', { text: "Death's Door" }),
    ]),
    el('h3', { class: 'fw-holdline-title', text: 'The Ledger Holds Your Line' }),
    el('p', { class: 'fw-holdline-entry', text: 'The Fade presses close. Hold the line with what you know.' }),
    el('div', { class: 'fw-holdline-tracks' }, [
      el('div', { class: 'fw-holdline-track' }, [
        el('span', { class: 'fw-holdline-tracklabel', text: 'Held' }),
        el('div', { class: 'fw-holdline-slots' }, flameSlots),
      ]),
      el('div', { class: 'fw-holdline-track' }, [
        el('span', { class: 'fw-holdline-tracklabel', text: 'Fade' }),
        el('div', { class: 'fw-holdline-slots' }, markSlots),
      ]),
    ]),
    beatEl,
  ]);
  document.body.appendChild(root);

  // Teardown safety (same idiom buildOverlay's openOverlays set uses): a shell tab-away mid-door
  // would otherwise leave this card floating over the torn-down canvas.
  let closed = false;
  const abort = (): void => {
    if (closed) return;
    closed = true;
    root.remove();
  };
  openOverlays.add(abort);

  return {
    update(counts, beat) {
      flameSlots.forEach((s, i) => s.classList.toggle('is-lit', i < counts.successes));
      markSlots.forEach((s, i) => s.classList.toggle('is-marked', i < counts.failures));
      if (beat) {
        beatEl.textContent = beat.text;
        beatEl.classList.toggle('is-good', beat.good);
        beatEl.classList.toggle('is-bad', !beat.good);
      }
    },
    close() {
      if (closed) return;
      closed = true;
      openOverlays.delete(abort);
      root.classList.add('is-closing');
      setTimeout(() => root.remove(), 180);
    },
  };
}
