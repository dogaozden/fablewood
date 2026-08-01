/**
 * Encounter overlay styles, injected once. Cozy-whimsical register per docs/style-contract.md:
 * a warm parchment panel — lantern-lit from the top-left — floating over a cool dusk-dimmed
 * canvas. All base colors are the palette hexes from docs/art/palette.json (kept here as CSS
 * tokens rather than imported, so this slice builds with no dependency on the art agent's
 * app/src/art/palette.ts; swap to that import once it lands).
 */
let injected = false;

export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'fw-enc-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.fw-overlay {
  --parchment:#EBD9B2; --parchment-hi:#FFF1C6; --parchment-lo:#C6A476;
  --ink:#241A14; --ink-2:#2A1D13; --ink-soft:#684628; --ink-deep:#452F1C;
  --gold:#F7CE6B; --amber:#EEA23F; --ember:#D2792C; --ember-deep:#A65420;
  --moss:#7C9C46; --green:#588234; --green-deep:#37602A;
  --berry:#C4443E; --orchid:#9A6EC8;
  --dusk:#34265A; --plum:#1B1526; --void:#100B0A;

  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center; padding: 24px;
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  background:
    radial-gradient(ellipse at 50% 36%, rgba(52,38,90,.28), rgba(27,21,38,.80) 58%, rgba(16,11,10,.90));
  -webkit-backdrop-filter: blur(3px) saturate(.9);
  backdrop-filter: blur(3px) saturate(.9);
  animation: fw-fade .22s ease both;
}
.fw-overlay.is-closing { animation: fw-fade .18s ease reverse both; }

.fw-panel {
  position: relative;
  width: min(92vw, 660px); max-height: 88vh; overflow: auto;
  padding: 26px 30px 22px;
  color: var(--ink);
  border: 1.5px solid var(--ink-soft);
  border-radius: 20px;
  background:
    linear-gradient(158deg, rgba(255,241,198,.6), rgba(237,222,186,1) 26%,
                    rgba(235,217,178,1) 70%, rgba(214,184,140,.6));
  box-shadow:
    0 0 0 3px rgba(70,47,26,.30),
    0 0 64px rgba(247,206,107,.20),
    0 26px 64px -14px rgba(16,11,10,.78),
    inset 0 1px 0 rgba(255,241,198,.75),
    inset 0 0 0 1px rgba(247,206,107,.22);
  animation: fw-rise .26s cubic-bezier(.2,.9,.3,1) both;
  scrollbar-width: thin; scrollbar-color: rgba(104,70,40,.5) transparent;
}
.fw-panel:focus { outline: none; } /* programmatic keyboard host — inner controls carry the visible ring */
.fw-panel::-webkit-scrollbar { width: 10px; }
.fw-panel::-webkit-scrollbar-thumb { background: rgba(104,70,40,.45); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }

.fw-eyebrow {
  display: flex; align-items: center; gap: .5em;
  font-size: .72rem; letter-spacing: .22em; text-transform: uppercase; font-weight: 700;
  color: var(--ember-deep);
}
.fw-eyebrow .fw-glyph { font-size: 1.15rem; color: var(--gold); text-shadow: 0 0 10px rgba(247,206,107,.6); letter-spacing: 0; }
.fw-eyebrow .fw-kindname { color: var(--ink-soft); font-weight: 600; letter-spacing: .12em; }
.fw-prompt { margin: .45em 0 0; font-size: 1.5rem; line-height: 1.32; color: var(--ink-2); text-wrap: balance; }
.fw-rule { height: 2px; margin: 16px 0 18px; border: 0;
  background: linear-gradient(90deg, transparent, rgba(247,206,107,.9), rgba(166,84,32,.45), transparent); }

.fw-body { display: block; }
.fw-footer { display: flex; align-items: center; gap: 12px; margin-top: 20px; }
.fw-hint { font-size: .82rem; color: var(--ink-soft); font-style: italic; }
.fw-spacer { flex: 1 1 auto; }

/* buttons */
.fw-btn { font: inherit; font-weight: 600; cursor: pointer; border-radius: 10px;
  padding: .55em 1.15em; transition: transform .12s, box-shadow .12s, filter .12s, background .12s; }
.fw-btn:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.fw-btn-primary { color: var(--ink-2); border: 1px solid var(--ember-deep);
  background: linear-gradient(var(--gold), var(--amber));
  box-shadow: inset 0 1px 0 rgba(255,241,198,.8), 0 3px 10px -3px rgba(16,11,10,.5); }
.fw-btn-primary:hover { filter: brightness(1.06); box-shadow: inset 0 1px 0 rgba(255,241,198,.9), 0 6px 18px -4px rgba(16,11,10,.55), 0 0 22px rgba(247,206,107,.4); transform: translateY(-1px); }
.fw-btn-primary:disabled { filter: saturate(.4) brightness(.95); cursor: default; transform: none; box-shadow: none; }
.fw-btn-ghost { color: var(--ink-soft); background: transparent; border: 1px solid rgba(104,70,40,.5); }
.fw-btn-ghost:hover { color: var(--ink-2); border-color: var(--ember-deep); background: rgba(255,241,198,.35); }

/* mcq / scenario option cards */
.fw-opts { display: flex; flex-direction: column; gap: 10px; }
.fw-opt { display: flex; align-items: center; gap: .85em; width: 100%; text-align: left;
  font: inherit; color: var(--ink); cursor: pointer;
  background: rgba(255,241,198,.42); border: 1.5px solid rgba(104,70,40,.45); border-radius: 12px;
  padding: .7em .9em; transition: transform .12s, box-shadow .12s, border-color .12s, background .12s, opacity .2s; }
.fw-opt:hover:not(:disabled) { transform: translateY(-2px); border-color: var(--ember-deep);
  background: rgba(255,241,198,.7);
  box-shadow: 0 8px 20px -10px rgba(16,11,10,.55), 0 0 0 1px rgba(247,206,107,.5), inset 0 0 22px rgba(247,206,107,.12); }
.fw-opt:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.fw-opt .fw-optlabel { flex: 1 1 auto; line-height: 1.35; }
.fw-key { flex: none; width: 1.75em; height: 1.75em; display: grid; place-items: center;
  border-radius: 8px; font-weight: 700; font-size: .95em; color: var(--ink-2);
  background: linear-gradient(var(--gold), var(--amber));
  box-shadow: inset 0 1px 0 rgba(255,241,198,.85), 0 1px 2px rgba(16,11,10,.4); }
.fw-opt.is-correct { border-color: var(--green); background: rgba(124,156,70,.28);
  box-shadow: 0 0 0 1px var(--moss), 0 0 24px rgba(124,156,70,.35); }
.fw-opt.is-correct .fw-key { background: linear-gradient(var(--moss), var(--green)); color: #F3E7C8; }
.fw-opt.is-wrong { border-color: var(--berry); background: rgba(196,68,62,.20); animation: fw-shake .4s; }
.fw-opt.is-wrong .fw-key { background: linear-gradient(#D98A85, var(--berry)); color: #F3E7C8; }
.fw-opt.is-dimmed { opacity: .45; }
.fw-opt:disabled { cursor: default; }

/* verdict banner + on-miss teach */
.fw-verdict { display: flex; align-items: flex-start; gap: .7em; padding: .75em 1em; border-radius: 12px;
  margin: 2px 0 16px; font-style: italic; line-height: 1.4; animation: fw-rise .24s ease both; }
.fw-verdict .fw-seal { font-style: normal; font-size: 1.2rem; line-height: 1.2; }
.fw-verdict.pass { background: rgba(124,156,70,.22); border-left: 4px solid var(--green); color: var(--ink-2); }
.fw-verdict.pass .fw-seal { color: var(--green); }
.fw-verdict.partial { background: rgba(238,162,63,.20); border-left: 4px solid var(--amber); color: var(--ink-2); }
.fw-verdict.partial .fw-seal { color: var(--ember); }
.fw-verdict.fail { background: rgba(196,68,62,.18); border-left: 4px solid var(--berry); color: var(--ink-2); }
.fw-verdict.fail .fw-seal { color: var(--berry); }
.fw-teach { margin: 0 0 14px; padding: .7em 1em; border-radius: 10px; background: rgba(198,164,118,.26);
  border-left: 3px solid var(--ember-deep); color: var(--ink-deep); font-size: .96rem; line-height: 1.45; animation: fw-rise .24s ease both; }
.fw-teach .fw-teachhead { font-size: .7rem; letter-spacing: .16em; text-transform: uppercase; color: var(--ember-deep); font-weight: 700; display: block; margin-bottom: .25em; }
.fw-teach b { color: var(--ink-2); }

/* reclaimed-from-the-fade — the redemption bell (§3.1). A warm lantern-flare, not confetti. */
.fw-reclaim { display: flex; align-items: center; gap: .8em; margin: 2px 0 16px; padding: .72em 1.05em;
  border-radius: 12px; border: 1px solid var(--amber);
  background: linear-gradient(100deg, rgba(247,206,107,.24), rgba(238,162,63,.12) 68%, rgba(247,206,107,.06));
  box-shadow: 0 0 0 1px rgba(247,206,107,.32), 0 0 28px rgba(247,206,107,.26), inset 0 1px 0 rgba(255,241,198,.6);
  animation: fw-reclaim-bloom .72s ease both; }
.fw-reclaim .fw-reclaim-flare { flex: none; font-size: 1.5rem; line-height: 1; color: var(--gold);
  text-shadow: 0 0 8px rgba(247,206,107,.85), 0 0 18px rgba(238,162,63,.5); animation: fw-reclaim-flicker 2.6s ease-in-out infinite; }
.fw-reclaim .fw-reclaim-text { display: flex; flex-direction: column; gap: .12em; }
.fw-reclaim .fw-reclaim-label { font-size: .7rem; letter-spacing: .18em; text-transform: uppercase; font-weight: 700; color: var(--ember-deep); }
.fw-reclaim .fw-reclaim-line { font-style: italic; line-height: 1.4; color: var(--ink-2); }

/* the night's ledger — the run-harvest screen (§3.2). */
.fw-ledger-head { text-align: center; }
.fw-ledger-title { margin: 0; font-size: 1.7rem; line-height: 1.2; color: var(--ink-2); }
.fw-ledger-sub { display: block; margin-top: .3em; font-style: italic; color: var(--ember-deep); font-size: 1rem; }
.fw-ledger-rows { display: flex; flex-direction: column; gap: 1px; margin: 2px 0 18px; }
.fw-ledger-row { display: flex; align-items: baseline; gap: .5em; padding: .5em .2em; }
.fw-ledger-label { color: var(--ink-deep); font-size: 1.05rem; }
.fw-ledger-lead { flex: 1 1 auto; align-self: center; height: 0; border-bottom: 1.5px dotted rgba(104,70,40,.4); margin: 0 .15em; }
.fw-ledger-val { color: var(--ink-2); font-weight: 700; font-variant-numeric: tabular-nums; font-size: 1.1rem; }
.fw-ledger-row.is-reclaim .fw-ledger-label { color: var(--ember-deep); font-weight: 600; }
.fw-ledger-row.is-reclaim .fw-ledger-val { color: var(--amber); text-shadow: 0 0 10px rgba(247,206,107,.45); }
.fw-ledger-signoff { margin: 0; text-align: center; font-style: italic; color: var(--ink-soft); line-height: 1.5; }

/* the ledger amended — the supersession re-teach card (supersession-reteach.md §3).
   Both lines stay: the old truth is struck, never removed, and keeps readable contrast. */
.fw-amend-old { margin: 20px 0 0; font-size: 1.16rem; line-height: 1.4; color: var(--ink-soft);
  text-decoration: line-through; text-decoration-color: rgba(166,84,32,.85); text-decoration-thickness: 2px; }
.fw-amend-caption { margin: .5em 0 0; font-size: .84rem; font-style: italic; line-height: 1.45; color: var(--ink-soft); }
.fw-amend-new { margin: 1.05em 0 0; font-size: 1.42rem; line-height: 1.3; color: var(--ink-2); text-wrap: balance; }
.fw-amend-new::before { content: '⟳'; margin-right: .4em; color: var(--ember-deep); font-size: .95em; }

/* free recall */
.fw-textarea { width: 100%; min-height: 122px; resize: vertical; font: inherit; font-size: 1.06rem;
  line-height: 1.5; color: var(--ink); padding: .8em .9em; border-radius: 12px;
  background: linear-gradient(rgba(255,241,198,.35), rgba(235,217,178,.15));
  border: 1.5px solid rgba(104,70,40,.5); box-shadow: inset 0 2px 6px rgba(16,11,10,.14); outline: none; }
.fw-textarea::placeholder { color: rgba(104,70,40,.6); font-style: italic; }
.fw-textarea:focus { border-color: var(--ember-deep); box-shadow: inset 0 2px 6px rgba(16,11,10,.14), 0 0 0 3px rgba(247,206,107,.35); }
.fw-deliberate { display: flex; align-items: center; gap: .55em; color: var(--ink-soft); font-style: italic; }
.fw-deliberate .fw-nib { font-style: normal; font-size: 1.15rem; animation: fw-bob 1.1s ease-in-out infinite; }
.fw-dots span { animation: fw-dots 1.2s infinite; }
.fw-dots span:nth-child(2) { animation-delay: .2s; } .fw-dots span:nth-child(3) { animation-delay: .4s; }

/* match */
.fw-match { position: relative; display: grid; grid-template-columns: 1fr 1fr; column-gap: 96px; row-gap: 10px; margin-top: 4px; }
.fw-match-svg { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
.fw-col { display: flex; flex-direction: column; gap: 10px; }
.fw-colhead { font-size: .68rem; letter-spacing: .18em; text-transform: uppercase; color: var(--ink-soft); font-weight: 700; margin-bottom: 2px; }
.fw-chip { position: relative; font: inherit; cursor: pointer; text-align: center; color: var(--ink);
  background: rgba(255,241,198,.5); border: 1.5px solid rgba(104,70,40,.5); border-radius: 999px; padding: .5em 1em;
  transition: transform .12s, box-shadow .12s, border-color .12s, background .12s; }
.fw-chip:hover:not(:disabled) { border-color: var(--ember-deep); transform: translateY(-1px); }
.fw-chip:focus-visible { outline: 2px solid var(--gold); outline-offset: 2px; }
.fw-chip.is-active { border-color: var(--ember-deep); box-shadow: 0 0 0 3px rgba(247,206,107,.45); background: rgba(247,206,107,.22); }
.fw-chip.is-paired { border-color: var(--ember-deep); background: rgba(247,206,107,.2); }
.fw-chip.is-correct { border-color: var(--green); background: rgba(124,156,70,.26); box-shadow: 0 0 0 1px var(--moss); }
.fw-chip.is-wrong { border-color: var(--berry); background: rgba(196,68,62,.2); animation: fw-shake .4s; }
.fw-chip:disabled { cursor: default; }

/* order */
.fw-order { display: flex; flex-direction: column; gap: 8px; margin-top: 4px; }
.fw-step { display: flex; align-items: center; gap: .7em; padding: .5em .6em; border-radius: 12px;
  background: rgba(255,241,198,.5); border: 1.5px solid rgba(104,70,40,.42);
  transition: transform .16s, box-shadow .16s, border-color .16s, background .16s; }
.fw-step.is-active { border-color: var(--ember-deep); box-shadow: 0 0 0 3px rgba(247,206,107,.4); background: rgba(255,241,198,.72); }
.fw-step.is-correct { border-color: var(--green); background: rgba(124,156,70,.24); }
.fw-step.is-wrong { border-color: var(--berry); background: rgba(196,68,62,.16); }
.fw-idx { flex: none; width: 1.7em; height: 1.7em; display: grid; place-items: center; border-radius: 8px;
  font-weight: 700; color: var(--ink-2); background: linear-gradient(var(--gold), var(--amber));
  box-shadow: inset 0 1px 0 rgba(255,241,198,.85); }
.fw-step.is-correct .fw-idx { background: linear-gradient(var(--moss), var(--green)); color: #F3E7C8; }
.fw-steplabel { flex: 1 1 auto; line-height: 1.3; }
.fw-grip { flex: none; color: var(--ink-soft); cursor: grab; font-size: 1.1rem; user-select: none; padding: 0 .1em; }
.fw-move { display: flex; flex-direction: column; gap: 2px; }
.fw-move button { font: inherit; line-height: 1; cursor: pointer; color: var(--ink-soft); background: transparent;
  border: 1px solid rgba(104,70,40,.4); border-radius: 6px; width: 1.6em; height: 1.15em; display: grid; place-items: center; padding: 0; }
.fw-move button:hover { color: var(--ink-2); border-color: var(--ember-deep); background: rgba(255,241,198,.5); }
.fw-step[draggable="true"] { cursor: grab; }
.fw-step.is-dragging { opacity: .5; }

/* teaching — discovered documents */
.fw-doctype { display: inline-block; font-size: .68rem; letter-spacing: .18em; text-transform: uppercase; font-weight: 700;
  color: var(--ember-deep); border: 1px solid rgba(166,84,32,.4); border-radius: 999px; padding: .15em .7em; margin-bottom: .2em; }
.fw-docstate { margin: .45em 0 .4em; font-size: 1.42rem; line-height: 1.3; color: var(--ink-2); text-wrap: balance; }
.fw-docdetail { margin: 0; color: var(--ink-deep); font-size: 1.02rem; line-height: 1.5; }
.fw-excerpt { position: relative; margin: 18px 0 0; padding: .85em 1.1em .85em 1.5em; font-style: italic; color: var(--ink-2);
  background: rgba(198,164,118,.26); border-left: 3px solid var(--ember-deep); border-radius: 0 10px 10px 0; line-height: 1.5; }
.fw-excerpt .fw-openquote { position: absolute; left: .18em; top: -.12em; font-size: 3rem; line-height: 1; color: rgba(166,84,32,.35); }
.fw-cite { display: flex; align-items: center; gap: .45em; margin-top: .7em; font-size: .78rem; letter-spacing: .04em;
  font-style: normal; color: var(--ink-soft); }
.fw-cite .fw-citemark { color: var(--ember-deep); }
.fw-dots-progress { display: flex; gap: .45em; align-items: center; }
.fw-dot { width: 8px; height: 8px; border-radius: 999px; background: rgba(104,70,40,.32); transition: background .2s, transform .2s; }
.fw-dot.is-on { background: var(--ember-deep); transform: scale(1.25); }

@keyframes fw-fade { from { opacity: 0; } to { opacity: 1; } }
@keyframes fw-rise { from { opacity: 0; transform: translateY(10px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes fw-shake { 10%,90%{transform:translateX(-1px)} 20%,80%{transform:translateX(2px)} 30%,50%,70%{transform:translateX(-4px)} 40%,60%{transform:translateX(4px)} }
@keyframes fw-bob { 0%,100%{transform:translateY(0) rotate(0)} 50%{transform:translateY(-3px) rotate(-8deg)} }
@keyframes fw-dots { 0%,100%{opacity:.25} 50%{opacity:1} }
@keyframes fw-reclaim-bloom {
  0% { opacity: 0; transform: translateY(6px); box-shadow: 0 0 0 1px rgba(247,206,107,0), 0 0 0 rgba(247,206,107,0); }
  55% { box-shadow: 0 0 0 1px rgba(247,206,107,.5), 0 0 40px rgba(247,206,107,.42), inset 0 1px 0 rgba(255,241,198,.6); }
  100% { opacity: 1; transform: none; }
}
@keyframes fw-reclaim-flicker {
  0%,100% { text-shadow: 0 0 8px rgba(247,206,107,.85), 0 0 18px rgba(238,162,63,.5); }
  50% { text-shadow: 0 0 11px rgba(247,206,107,1), 0 0 24px rgba(238,162,63,.7); }
}

@media (prefers-reduced-motion: reduce) {
  .fw-overlay, .fw-panel, .fw-verdict, .fw-teach, .fw-reclaim { animation: none !important; }
  .fw-opt, .fw-chip, .fw-step, .fw-btn { transition: none !important; }
  .fw-deliberate .fw-nib, .fw-dots span, .fw-reclaim .fw-reclaim-flare { animation: none !important; }
}
`;
