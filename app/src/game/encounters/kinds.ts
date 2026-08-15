/**
 * The five encounter renderers. Each fills the overlay body/footer, wires keyboard-first
 * interaction, teaches on a miss (correct answer + fact statement shown in place), and calls
 * resolve() with an EncounterResult. Correctness is by value (mcq/match/order vs the answer)
 * or by branch flag (scenario); scoring for match/order lives in engine.ts (pure, unit-tested).
 */
import type { EncounterResult, FactLite, Quality } from '../contracts';
import type { Encounter } from '../../packs/types';
import type { Overlay, EncounterCtx } from './overlay';
import { el, ACTIONS, sealGlyph } from './dom';
import { scoreMatch, scoreOrder } from './engine';
import { reclaimBell, reclaimChip } from './redemption';

type Resolve = (r: EncounterResult) => void;
export type KindRenderer = (
  o: Overlay,
  enc: Encounter,
  facts: FactLite[],
  ctx: EncounterCtx,
  resolve: Resolve,
) => void;

// --- shared bits -------------------------------------------------------------

function verdictBanner(tone: 'pass' | 'partial' | 'fail', line: string): HTMLElement {
  return el('div', { class: `fw-verdict ${tone}` }, [
    el('span', { class: 'fw-seal', 'aria-hidden': 'true', text: sealGlyph(tone) }),
    el('span', { text: line }),
  ]);
}

/** The on-miss teach: the correct answer, plus the first fact's statement/detail if we have it. */
function teachBlock(head: string, answer: string, fact?: FactLite): HTMLElement {
  const line: Array<Node | string> = ['The answer is ', el('b', { text: answer }), '.'];
  if (fact) line.push(` ${fact.statement}${fact.detail ? ` ${fact.detail}` : ''}`);
  return el('div', { class: 'fw-teach' }, [
    el('span', { class: 'fw-teachhead', text: head }),
    el('span', {}, line),
  ]);
}

/** The book's own words — verbatim excerpt + citation, shown win or lose (the source is the reward).
 *  Exported so the amendment card (overlay.ts) gives the new truth's source the SAME treatment
 *  free_recall's earned page does (supersession-reteach.md §3) rather than cloning it a third time. */
export function excerptBlock(fact: FactLite): HTMLElement | null {
  const src = fact.source_ref;
  if (!src?.quote) return null;
  const loc = src.loc ? ` › ${src.loc}` : '';
  return el('blockquote', { class: 'fw-excerpt' }, [
    el('span', { class: 'fw-openquote', 'aria-hidden': 'true', text: '“' }),
    src.quote,
    el('div', { class: 'fw-cite' }, [
      el('span', { class: 'fw-citemark', 'aria-hidden': 'true', text: '❦' }),
      el('span', { text: `${src.file}${loc}` }),
    ]),
  ]);
}

function continueButton(resolve: Resolve, result: EncounterResult): HTMLButtonElement {
  return el('button', {
    class: 'fw-btn fw-btn-primary',
    type: 'button',
    text: 'Onward ▸',
    'data-commit': 'true',
    onclick: () => resolve(result),
  });
}

/**
 * Keep feedback reveals still: native focus must not choose the panel's scroll position.
 * If a player had already scrolled unusually long content, reveal the verdict deliberately.
 */
function focusContinue(o: Overlay, verdict: HTMLElement, button: HTMLButtonElement): void {
  button.focus({ preventScroll: true });
  const panelRect = o.panel.getBoundingClientRect();
  const verdictRect = verdict.getBoundingClientRect();
  if (verdictRect.top < panelRect.top || verdictRect.bottom > panelRect.bottom) {
    verdict.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

/**
 * "Reclaimed from the Fade" (§3.1): if this q1 answer redeems a once-missed fact, drop the
 * bell just under the verdict (or at the top of the body when the pass verdict lives in the
 * footer — mcq's clean strike). Self-gates on quality (reclaimBell returns null unless it is a
 * full pass reclaiming an uncleared miss), and reads PRIOR history — so every renderer calls it
 * unconditionally right after its verdict lands, before resolve() lets combat record the answer.
 * Returns whether the bell rang (mcq lengthens its auto-advance so the beat is legible).
 */
function reclaimBeat(
  o: Overlay,
  factIds: string[],
  quality: Quality,
  afterVerdict: HTMLElement | null,
): boolean {
  const bell = reclaimBell(factIds, quality);
  if (!bell) return false;
  const chip = reclaimChip(bell.line);
  if (afterVerdict && afterVerdict.parentNode === o.body) afterVerdict.after(chip);
  else o.body.insertBefore(chip, o.body.firstChild);
  return true;
}

// --- mcq · Smite -------------------------------------------------------------

const renderMcq: KindRenderer = (o, enc, facts, ctx, resolve) => {
  const options = (enc.options ?? []).map(String);
  const answer = String(enc.answer ?? '');
  const cards: HTMLButtonElement[] = [];
  let answered = false;

  // Ch. VII Mira's Stall — Scrivener's Hint (T3): deterministic, first wrong option in
  // presentation order (no rng anywhere near answers). -1 (no match) is a safe no-op below —
  // no real index ever equals it, so nothing renders struck.
  const struckIndex = ctx.strikeOneFalse ? options.findIndex((opt) => opt !== answer) : -1;

  const choose = (idx: number) => {
    if (answered || !o.isArmed() || idx === struckIndex) return;
    answered = true;
    const correct = options[idx] === answer;
    cards.forEach((c, i) => {
      c.disabled = true;
      if (options[i] === answer) c.classList.add('is-correct');
      else if (i === idx) c.classList.add('is-wrong');
      else c.classList.add('is-dimmed');
    });
    const result: EncounterResult = {
      encounterId: enc.id,
      kind: 'mcq',
      factIds: enc.fact_ids,
      quality: correct ? 1 : 0,
      detail: correct ? undefined : enc.trap_notes || `The answer is “${answer}.”`,
    };
    if (correct) {
      o.footer.replaceChildren(verdictBanner('pass', 'A clean strike.'));
      // clean pass auto-advances; a redemption bell lengthens the beat so it can be read.
      const rang = reclaimBeat(o, enc.fact_ids, result.quality, null);
      setTimeout(() => resolve(result), rang ? 1500 : 720);
    } else {
      // The verdict is the reveal's visual anchor. Keep it above the retained answer cards so
      // it is visible immediately without relying on a focus-triggered jump to the footer.
      const verdict = verdictBanner('fail', enc.trap_notes || 'Not quite — mark it, and move on.');
      o.body.insertBefore(verdict, list);
      o.body.append(teachBlock('The Ledger records', answer, facts[0]));
      const cont = continueButton(resolve, result);
      o.footer.replaceChildren(el('span', { class: 'fw-spacer' }), cont);
      focusContinue(o, verdict, cont);
    }
  };

  const list = el('div', { class: 'fw-opts' });
  options.forEach((label, i) => {
    // Struck option gets its own build (not the shared commit-button path) — it must stay
    // inert: disabled, no onclick, and NO data-commit. W6's lantern-raise disarm listener
    // (overlay.ts) only fires on [data-commit] buttons, so withholding the attribute here is
    // what keeps a struck line from counting as a commit as well as from being clickable.
    const card = i === struckIndex
      ? el('button', { class: 'fw-opt fw-struck', type: 'button', disabled: true }, [
          el('span', { class: 'fw-key', 'aria-hidden': 'true', text: String(i + 1) }),
          el('span', { class: 'fw-optlabel', text: label }),
          el('span', { class: 'fw-struck-sub', text: "— struck by the scrivener's hand" }),
        ])
      : el('button', { class: 'fw-opt', type: 'button', 'data-commit': 'true', onclick: () => choose(i) }, [
          el('span', { class: 'fw-key', 'aria-hidden': 'true', text: String(i + 1) }),
          el('span', { class: 'fw-optlabel', text: label }),
        ]);
    cards.push(card);
    list.append(card);
  });
  o.body.append(list);
  o.footer.replaceChildren(el('span', { class: 'fw-hint', text: ACTIONS.mcq.hint }));
  o.onKey((e) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) {
      e.preventDefault();
      choose(n - 1);
    }
  });
  // Ch. VII final review — focus the first ENABLED card, not blindly cards[0]. struckIndex is
  // 0 whenever the first option isn't the answer (roughly three hinted casts in four), and a
  // disabled button's .focus() is a no-op, which cost the options list its focus ring and its
  // Tab entry point. Number keys were never affected (overlay.ts binds the bus to root).
  requestAnimationFrame(() => cards.find((c) => !c.disabled)?.focus());
};

// --- free_recall · Cast From Memory -----------------------------------------

const renderFreeRecall: KindRenderer = (o, enc, facts, ctx, resolve) => {
  const ta = el('textarea', {
    class: 'fw-textarea',
    'aria-label': 'Your answer',
    placeholder: 'Cast the answer from memory…',
  });
  o.body.append(ta);
  const cast = el('button', { class: 'fw-btn fw-btn-primary', type: 'button', text: 'Cast', 'data-commit': 'true' });
  o.footer.replaceChildren(
    el('span', { class: 'fw-hint', text: ACTIONS.free_recall.hint }),
    el('span', { class: 'fw-spacer' }),
    cast,
  );

  let submitting = false;
  const submit = async () => {
    if (submitting || !o.isArmed()) return;
    const answer = ta.value.trim();
    if (!answer) {
      ta.focus();
      return;
    }
    submitting = true;
    ta.disabled = true;
    cast.disabled = true;
    o.footer.replaceChildren(
      el('div', { class: 'fw-deliberate' }, [
        el('span', { class: 'fw-nib', 'aria-hidden': 'true', text: '✒' }),
        el('span', { text: 'the Clerk deliberates' }),
        el('span', { class: 'fw-dots' }, [
          el('span', { text: '.' }),
          el('span', { text: '.' }),
          el('span', { text: '.' }),
        ]),
      ]),
    );

    const rubric = typeof enc.rubric === 'string' ? enc.rubric : JSON.stringify(enc.rubric ?? '');
    const verdict = await ctx.judge({ prompt: enc.prompt, answer, rubric });
    const quality: Quality = verdict.verdict === 'pass' ? 1 : verdict.verdict === 'partial' ? 0.5 : 0;

    const parts: HTMLElement[] = [
      verdictBanner(verdict.verdict, verdict.line),
      el('div', { class: 'fw-teach' }, [
        el('span', { class: 'fw-teachhead', text: 'You cast' }),
        el('span', { text: answer }),
      ]),
    ];
    // The answer to the QUESTION ASKED, which only the rubric holds. facts[0].statement below
    // is the concept the encounter was built from — for a definitional prompt that happens to
    // be the answer, but for an applied one ("$5M pref, 20%, $100M exit — what do you take
    // home?") it is a definition and the number never appears. A player who missed then had
    // no way to learn what they should have said.
    if (quality < 1 && rubric) {
      parts.push(
        el('div', { class: 'fw-teach fw-teach-answer' }, [
          el('span', { class: 'fw-teachhead', text: 'The answer' }),
          el('span', { text: rubric }),
        ]),
      );
    }
    if (quality < 1 && facts[0]) {
      parts.push(
        el('div', { class: 'fw-teach' }, [
          el('span', { class: 'fw-teachhead', text: 'The Ledger records' }),
          el('span', { text: `${facts[0].statement}${facts[0].detail ? ` ${facts[0].detail}` : ''}` }),
        ]),
      );
    }
    // the source's verbatim words appear win or lose — a good cast EARNS the page
    const excerpt = facts[0] ? excerptBlock(facts[0]) : null;
    if (excerpt) parts.push(excerpt);
    o.body.replaceChildren(...parts);
    reclaimBeat(o, enc.fact_ids, quality, parts[0]);

    const cont = continueButton(resolve, {
      encounterId: enc.id,
      kind: 'free_recall',
      factIds: enc.fact_ids,
      quality,
      detail: verdict.line,
    });
    o.footer.replaceChildren(el('span', { class: 'fw-spacer' }), cont);
    focusContinue(o, parts[0], cont);
  };

  cast.addEventListener('click', () => void submit());
  o.onKey((e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  });
  requestAnimationFrame(() => ta.focus());
};

// --- scenario_branch · Parley ------------------------------------------------

const renderScenario: KindRenderer = (o, enc, _facts, _ctx, resolve) => {
  const branches = enc.branches ?? [];
  const cards: HTMLButtonElement[] = [];
  let answered = false;

  const choose = (idx: number) => {
    if (answered || !o.isArmed()) return;
    answered = true;
    const b = branches[idx];
    const tag = b.correct === true ? 'good' : b.correct === false ? 'bad' : 'neutral';
    const tone = tag === 'good' ? 'pass' : tag === 'bad' ? 'fail' : 'partial';
    const quality: Quality = tag === 'good' ? 1 : tag === 'bad' ? 0 : 0.5;
    cards.forEach((c, i) => {
      c.disabled = true;
      if (i === idx) {
        const cls = tag === 'good' ? 'is-correct' : tag === 'bad' ? 'is-wrong' : '';
        if (cls) c.classList.add(cls);
      } else c.classList.add('is-dimmed');
    });
    const outcome = b.outcome || (tag === 'good' ? 'A sound choice.' : 'The moment passes.');
    const verdict = verdictBanner(tone, outcome);
    o.body.append(verdict);
    reclaimBeat(o, enc.fact_ids, quality, verdict);
    const cont = continueButton(resolve, {
      encounterId: enc.id,
      kind: 'scenario_branch',
      factIds: enc.fact_ids,
      quality,
      detail: outcome,
      branchTag: tag,
    });
    o.footer.replaceChildren(el('span', { class: 'fw-spacer' }), cont);
    focusContinue(o, verdict, cont);
  };

  const list = el('div', { class: 'fw-opts' });
  branches.forEach((b, i) => {
    const card = el('button', { class: 'fw-opt', type: 'button', 'data-commit': 'true', onclick: () => choose(i) }, [
      el('span', { class: 'fw-key', 'aria-hidden': 'true', text: String(i + 1) }),
      el('span', { class: 'fw-optlabel', text: b.label }),
    ]);
    cards.push(card);
    list.append(card);
  });
  o.body.append(list);
  o.footer.replaceChildren(el('span', { class: 'fw-hint', text: ACTIONS.scenario_branch.hint }));
  o.onKey((e) => {
    const n = Number(e.key);
    if (Number.isInteger(n) && n >= 1 && n <= branches.length) {
      e.preventDefault();
      choose(n - 1);
    }
  });
  requestAnimationFrame(() => cards[0]?.focus());
};

// --- match · Binding Weave ---------------------------------------------------

const SVG_NS = 'http://www.w3.org/2000/svg';

const renderMatch: KindRenderer = (o, enc, _facts, _ctx, resolve) => {
  const cols = (enc.options ?? []) as unknown[];
  const left = ((cols[0] as unknown[]) ?? []).map(String);
  const right = ((cols[1] as unknown[]) ?? []).map(String);
  const answerPairs = ((enc.answer as unknown[]) ?? []).map(
    (p) => [String((p as unknown[])[0]), String((p as unknown[])[1])] as [string, string],
  );

  const leftBtns: HTMLButtonElement[] = [];
  const rightBtns: HTMLButtonElement[] = [];
  const pairOf = new Map<number, number>(); // leftIdx -> rightIdx
  let activeLeft: number | null = null;
  let done = false;

  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('class', 'fw-match-svg');
  const container = el('div', { class: 'fw-match' });

  const seal = el('button', {
    class: 'fw-btn fw-btn-primary',
    type: 'button',
    text: 'Seal the Weave',
    'data-commit': 'true',
    disabled: true,
  });

  const drawLine = (li: number, ri: number, color: string) => {
    const cRect = container.getBoundingClientRect();
    const a = leftBtns[li].getBoundingClientRect();
    const b = rightBtns[ri].getBoundingClientRect();
    const x1 = a.right - cRect.left;
    const y1 = a.top - cRect.top + a.height / 2;
    const x2 = b.left - cRect.left;
    const y2 = b.top - cRect.top + b.height / 2;
    const mx = (x1 + x2) / 2;
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', '2.5');
    path.setAttribute('fill', 'none');
    path.setAttribute('stroke-linecap', 'round');
    svg.append(path);
  };

  const redraw = (colorFor?: (li: number, ri: number) => string) => {
    svg.replaceChildren();
    for (const [li, ri] of pairOf) drawLine(li, ri, colorFor ? colorFor(li, ri) : 'rgba(166,84,32,.75)');
  };

  const refresh = () => {
    leftBtns.forEach((b, i) => {
      b.classList.toggle('is-active', activeLeft === i);
      b.classList.toggle('is-paired', pairOf.has(i));
    });
    const used = new Set(pairOf.values());
    rightBtns.forEach((b, i) => b.classList.toggle('is-paired', used.has(i)));
    seal.disabled = pairOf.size !== left.length;
    redraw();
  };

  const clickLeft = (li: number) => {
    if (done || !o.isArmed()) return;
    if (pairOf.has(li)) pairOf.delete(li); // re-pick
    activeLeft = li;
    refresh();
  };
  const clickRight = (ri: number) => {
    if (done || !o.isArmed() || activeLeft === null) return;
    for (const [l, r] of pairOf) if (r === ri) pairOf.delete(l); // right can only serve one left
    pairOf.set(activeLeft, ri);
    activeLeft = null;
    refresh();
  };

  const submit = () => {
    if (done || !o.isArmed() || pairOf.size !== left.length) return;
    done = true;
    const userPairs = [...pairOf].map(([li, ri]) => [left[li], right[ri]] as [string, string]);
    const quality = scoreMatch(userPairs, answerPairs);
    const answerSet = new Set(answerPairs.map((p) => `${p[0]} ${p[1]}`));
    const isRight = (li: number, ri: number) => answerSet.has(`${left[li]} ${right[ri]}`);

    for (const [li, ri] of pairOf) {
      const ok = isRight(li, ri);
      leftBtns[li].classList.add(ok ? 'is-correct' : 'is-wrong');
      rightBtns[ri].classList.add(ok ? 'is-correct' : 'is-wrong');
    }
    [...leftBtns, ...rightBtns].forEach((b) => (b.disabled = true));
    redraw((li, ri) => (isRight(li, ri) ? '#588234' : '#C4443E'));

    const tone = quality === 1 ? 'pass' : quality === 0.5 ? 'partial' : 'fail';
    const line = quality === 1 ? 'The weave holds.' : quality === 0.5 ? 'Half the threads catch.' : 'The weave unravels.';
    const verdict = verdictBanner(tone, line);
    o.body.insertBefore(verdict, container);
    reclaimBeat(o, enc.fact_ids, quality, verdict);
    if (quality < 1) {
      o.body.append(
        el('div', { class: 'fw-teach' }, [
          el('span', { class: 'fw-teachhead', text: 'The true binding' }),
          el('span', { text: answerPairs.map((p) => `${p[0]} → ${p[1]}`).join('   ·   ') }),
        ]),
      );
    }
    const cont = continueButton(resolve, {
      encounterId: enc.id,
      kind: 'match',
      factIds: enc.fact_ids,
      quality,
      detail: answerPairs.map((p) => `${p[0]} → ${p[1]}`).join(', '),
    });
    o.footer.replaceChildren(el('span', { class: 'fw-spacer' }), cont);
    focusContinue(o, verdict, cont);
  };

  const leftCol = el('div', { class: 'fw-col' }, [el('div', { class: 'fw-colhead', text: 'Claim' })]);
  const rightCol = el('div', { class: 'fw-col' }, [el('div', { class: 'fw-colhead', text: 'True Name' })]);
  left.forEach((label, i) => {
    const b = el('button', { class: 'fw-chip', type: 'button', onclick: () => clickLeft(i) }, [label]);
    leftBtns.push(b);
    leftCol.append(b);
  });
  right.forEach((label, i) => {
    const b = el('button', { class: 'fw-chip', type: 'button', onclick: () => clickRight(i) }, [label]);
    rightBtns.push(b);
    rightCol.append(b);
  });
  container.append(svg, leftCol, rightCol);
  o.body.append(container);
  seal.addEventListener('click', submit);
  o.footer.replaceChildren(
    el('span', { class: 'fw-hint', text: ACTIONS.match.hint }),
    el('span', { class: 'fw-spacer' }),
    seal,
  );
  requestAnimationFrame(() => leftBtns[0]?.focus());
};

// --- order · Ritual Sequence -------------------------------------------------

/** Below this many px of vertical movement, a press-and-release still counts as a plain
 *  click (setActive), not a drag — keeps a quick tap from being swallowed as a zero-move drag. */
const ORDER_DRAG_THRESHOLD_PX = 4;

/** The drop-indicator sits a few px taller than the row itself, so its dashed edge stays a
 *  visible "landing zone" halo even when the floating row's pointer-tracked position happens
 *  to land exactly on top of it (rather than being fully eclipsed). */
const ORDER_DROP_HALO_PX = 6;

/** The floating row hovers this many px "above the table" relative to its raw pointer-tracked
 *  position — a literal lift, not just the shadow/scale — so it never fully eclipses the
 *  drop-indicator slot beneath it, whatever the exact pointer position. Purely visual: the
 *  hover-slot math below still tracks the true (un-offset) pointer delta. */
const ORDER_LIFT_OFFSET_PX = 10;

const renderOrder: KindRenderer = (o, enc, _facts, _ctx, resolve) => {
  const answer = ((enc.answer as unknown[]) ?? []).map(String);
  const items = ((enc.options as unknown[]) ?? []).map(String);
  let active = 0;
  let done = false;

  const list = el('div', { class: 'fw-order' });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (done || j < 0 || j >= items.length) return;
    [items[i], items[j]] = [items[j], items[i]];
    active = j;
    render();
  };

  const setActive = (i: number) => {
    if (done) return;
    active = i;
    render();
  };

  /** Splice item `from` to sit at `to` — the drag-drop commit path (move() above, used by
   *  the arrow buttons, stays untouched: it only ever swaps adjacent slots). */
  const reorder = (from: number, to: number) => {
    if (done || from === to) return;
    const [moved] = items.splice(from, 1);
    items.splice(to, 0, moved);
    active = to;
    render();
  };

  /**
   * Pointer-based drag-to-reorder. Replaces the old HTML5 draggable API (dragstart/dragover/
   * drop were wired but effectively inert in the Tauri/WKWebView shell this game actually ships
   * in — generic-element HTML5 DnD is unreliable there, matching the live-playtest report that
   * the handles show but dragging itself doesn't work). Pure pointer events + setPointerCapture,
   * transform-only so nothing reflows mid-drag: the pressed row floats with the pointer
   * (translateY, lifted shadow) while every row between its origin and the live target slot
   * shifts by one row-step to open the gap, and a dashed placeholder marks exactly where it
   * will land. Release commits via reorder(); a tap that never crosses the threshold falls
   * through to the row's own onclick (setActive), unchanged.
   */
  let dropIndicator: HTMLElement | null = null;

  const attachDrag = (row: HTMLElement, i: number): void => {
    let dragging = false;
    let pointerId = -1;
    let startY = 0;
    let step = 0;
    let minDelta = 0;
    let maxDelta = 0;
    let hoverIndex = i;
    let originTop = 0;

    const slotTop = (target: number): number => originTop + (target - i) * step - ORDER_DROP_HALO_PX;

    const applyShift = (target: number): void => {
      const rows = [...list.children] as HTMLElement[];
      rows.forEach((r, ri) => {
        if (ri === i) return;
        const shift = target >= i ? (ri > i && ri <= target ? -1 : 0) : ri >= target && ri < i ? 1 : 0;
        r.style.transform = shift ? `translateY(${shift * step}px)` : '';
      });
      if (dropIndicator) dropIndicator.style.top = `${slotTop(target)}px`;
    };

    const end = (commit: boolean): void => {
      if (row.hasPointerCapture(pointerId)) row.releasePointerCapture(pointerId);
      if (!dragging) return;
      dragging = false;
      row.classList.remove('is-lifted');
      row.style.transform = '';
      dropIndicator?.remove();
      dropIndicator = null;
      if (commit && hoverIndex !== i) reorder(i, hoverIndex);
      else render(); // clear the siblings' shift transforms
    };

    row.addEventListener('pointerdown', (e: PointerEvent) => {
      if (done || e.button !== 0 || items.length < 2) return;
      if ((e.target as HTMLElement).closest('button')) return; // the ▲▼ buttons keep their own click
      pointerId = e.pointerId;
      startY = e.clientY;
      const rows = [...list.children] as HTMLElement[];
      step = rows.length > 1 ? rows[1].offsetTop - rows[0].offsetTop : row.offsetHeight;
      originTop = row.offsetTop;
      minDelta = -i * step;
      maxDelta = (items.length - 1 - i) * step;
      hoverIndex = i;
      row.setPointerCapture(pointerId);
    });

    row.addEventListener('pointermove', (e: PointerEvent) => {
      if (e.pointerId !== pointerId || done) return;
      const rawDelta = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(rawDelta) < ORDER_DRAG_THRESHOLD_PX) return;
        dragging = true;
        active = i; // dragging a row also makes it the keyboard-active one (no re-render mid-drag)
        row.classList.add('is-lifted');
        dropIndicator = el('div', { class: 'fw-order-drop' });
        dropIndicator.style.height = `${row.offsetHeight + ORDER_DROP_HALO_PX * 2}px`;
        dropIndicator.style.top = `${slotTop(hoverIndex)}px`;
        list.appendChild(dropIndicator);
      }
      e.preventDefault();
      const delta = Math.max(minDelta, Math.min(maxDelta, rawDelta));
      row.style.transform = `translateY(${delta - ORDER_LIFT_OFFSET_PX}px) scale(1.03)`;
      const next = Math.max(0, Math.min(items.length - 1, i + Math.round(delta / step)));
      if (next !== hoverIndex) {
        hoverIndex = next;
        applyShift(hoverIndex);
      }
    });

    row.addEventListener('pointerup', (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      end(true);
    });
    row.addEventListener('pointercancel', (e: PointerEvent) => {
      if (e.pointerId !== pointerId) return;
      end(false);
    });
  };

  const stepRow = (label: string, i: number) => {
    const row = el(
      'div',
      { class: `fw-step${i === active ? ' is-active' : ''}`, onclick: () => setActive(i) },
      [
        el('span', { class: 'fw-idx', 'aria-hidden': 'true', text: String(i + 1) }),
        el('span', { class: 'fw-steplabel', text: label }),
        el('span', { class: 'fw-grip', 'aria-hidden': 'true', text: '⠿' }),
        el('div', { class: 'fw-move' }, [
          el('button', { type: 'button', 'aria-label': 'move up', text: '▲', onclick: (e: Event) => { e.stopPropagation(); move(i, -1); } }),
          el('button', { type: 'button', 'aria-label': 'move down', text: '▼', onclick: (e: Event) => { e.stopPropagation(); move(i, 1); } }),
        ]),
      ],
    );
    if (!done) attachDrag(row, i);
    return row;
  };

  function render() {
    list.replaceChildren(...items.map((label, i) => stepRow(label, i)));
  }

  const submit = () => {
    if (done || !o.isArmed()) return;
    done = true;
    const quality = scoreOrder(items, answer);
    const rows = [...list.children] as HTMLElement[];
    rows.forEach((row, i) => {
      row.classList.remove('is-active');
      row.classList.add(items[i] === answer[i] ? 'is-correct' : 'is-wrong');
      row.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = true));
    });
    const tone = quality === 1 ? 'pass' : quality === 0.5 ? 'partial' : 'fail';
    const line = quality === 1 ? 'The ritual holds.' : quality === 0.5 ? 'The chain falters partway.' : 'The sequence breaks.';
    const verdict = verdictBanner(tone, line);
    o.body.insertBefore(verdict, list);
    reclaimBeat(o, enc.fact_ids, quality, verdict);
    if (quality < 1) {
      o.body.append(
        el('div', { class: 'fw-teach' }, [
          el('span', { class: 'fw-teachhead', text: 'The proper order' }),
          el('span', { text: answer.join('   →   ') }),
        ]),
      );
    }
    const cont = continueButton(resolve, {
      encounterId: enc.id,
      kind: 'order',
      factIds: enc.fact_ids,
      quality,
      detail: answer.join(' → '),
    });
    o.footer.replaceChildren(el('span', { class: 'fw-spacer' }), cont);
    focusContinue(o, verdict, cont);
  };

  render();
  o.body.append(list);
  const seal = el('button', { class: 'fw-btn fw-btn-primary', type: 'button', text: 'Seal the Sequence', 'data-commit': 'true', onclick: submit });
  o.footer.replaceChildren(
    el('span', { class: 'fw-hint', text: ACTIONS.order.hint }),
    el('span', { class: 'fw-spacer' }),
    seal,
  );
  o.onKey((e) => {
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      move(active, -1);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      move(active, 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      submit();
    }
  });
};

export const RENDERERS: Record<Encounter['kind'], KindRenderer> = {
  mcq: renderMcq,
  free_recall: renderFreeRecall,
  scenario_branch: renderScenario,
  match: renderMatch,
  order: renderOrder,
};
