/**
 * Satchel / Mira's-shop overlay styles (inventory-handoff §7), injected once.
 * Mirrors the encounters overlay's parchment-panel look (game/encounters/styles.ts)
 * under an independent `.inv-*` namespace + `--inv-*` custom properties — that
 * module's internals aren't exported and encounters/** is off-limits here, so the
 * look is replicated rather than shared.
 */
let injected = false;

export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const style = document.createElement('style');
  style.id = 'inv-styles';
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.inv-overlay {
  --inv-ink:#241A14; --inv-ink-2:#2A1D13; --inv-ink-soft:#684628;
  --inv-gold:#F7CE6B; --inv-amber:#EEA23F; --inv-ember-deep:#A65420;
  --inv-green:#588234; --inv-berry:#C4443E; --inv-forest:#37602A;

  position: fixed; inset: 0; z-index: 9999;
  display: grid; place-items: center; padding: 24px;
  font-family: Georgia, 'Iowan Old Style', 'Times New Roman', serif;
  background:
    radial-gradient(ellipse at 50% 36%, rgba(52,38,90,.28), rgba(27,21,38,.80) 58%, rgba(16,11,10,.90));
  -webkit-backdrop-filter: blur(3px) saturate(.9);
  backdrop-filter: blur(3px) saturate(.9);
}

.inv-panel {
  position: relative;
  width: min(92vw, 620px); max-height: 86vh; overflow-y: auto;
  padding: 24px 26px 20px;
  color: var(--inv-ink);
  border: 1.5px solid rgba(70,47,26,.5);
  border-radius: 20px;
  background:
    linear-gradient(158deg, rgba(255,241,198,.6), rgba(237,222,186,1) 26%,
                    rgba(235,217,178,1) 70%, rgba(214,184,140,.6));
  box-shadow:
    0 0 0 3px rgba(70,47,26,.30),
    0 26px 64px -14px rgba(16,11,10,.78),
    inset 0 1px 0 rgba(255,241,198,.75),
    inset 0 0 0 1px rgba(247,206,107,.22);
  scrollbar-width: thin; scrollbar-color: rgba(104,70,40,.5) transparent;
}
.inv-panel:focus { outline: none; }
.inv-panel::-webkit-scrollbar { width: 10px; }
.inv-panel::-webkit-scrollbar-thumb { background: rgba(104,70,40,.45); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }

.inv-header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
.inv-title { font-size: 1.4rem; font-weight: 700; color: var(--inv-ink-2); margin: 0; }
.inv-gold { font-size: 1.05rem; font-weight: 700; color: var(--inv-ember-deep); white-space: nowrap; }
.inv-rule { height: 2px; margin: 12px 0 12px; border: 0;
  background: linear-gradient(90deg, transparent, rgba(247,206,107,.9), rgba(166,84,32,.45), transparent); }

.inv-body { display: flex; flex-direction: column; gap: 8px; }
.inv-empty { padding: 1.1em .2em; color: var(--inv-ink-soft); font-style: italic; }

.inv-section-title { font-size: .72rem; letter-spacing: .16em; text-transform: uppercase; font-weight: 700;
  color: var(--inv-ember-deep); margin: 12px 0 2px; }
.inv-section-title:first-child { margin-top: 0; }

.inv-row { display: flex; align-items: center; gap: .7em; padding: .5em .65em; border-radius: 12px;
  background: rgba(255,241,198,.4); border: 1px solid rgba(104,70,40,.35); }
.inv-icon { width: 32px; height: 32px; image-rendering: pixelated; flex: none; }
.inv-main { flex: 1 1 auto; min-width: 0; }
.inv-name-row { display: flex; align-items: center; gap: .5em; flex-wrap: wrap; }
.inv-name { font-weight: 700; }
.inv-flavor { display: block; font-size: .8rem; font-style: italic; color: var(--inv-ink-soft); margin-top: .15em; }
.inv-effect { display: block; font-size: .78rem; font-weight: 600; color: var(--inv-forest); margin-top: .15em; }
.inv-qty { flex: none; font-size: .85rem; color: var(--inv-ink-soft); min-width: 2.4em; text-align: center; }
.inv-price { flex: none; font-size: .88rem; color: var(--inv-ember-deep); font-weight: 700; min-width: 3.6em; text-align: right; }

/* rarity chip: mirrors the .box0..box5 pill (shell.css) — same shape, per-rarity color inline */
.inv-chip { flex: none; min-width: 2.9rem; text-align: center; font-size: .68rem; letter-spacing: .03em;
  padding: .15rem .5rem; border-radius: 999px; border: 1px solid rgba(0,0,0,.35); font-weight: 700; }

.inv-btn { flex: none; font: inherit; font-weight: 600; cursor: pointer; border-radius: 10px;
  padding: .45em 1em; border: 1px solid var(--inv-ember-deep);
  background: linear-gradient(var(--inv-gold), var(--inv-amber)); color: var(--inv-ink-2);
  box-shadow: inset 0 1px 0 rgba(255,241,198,.8); transition: filter .12s, transform .12s; }
.inv-btn:hover:not(:disabled) { filter: brightness(1.06); transform: translateY(-1px); }
.inv-btn:disabled { filter: saturate(.35) brightness(.92); cursor: default; transform: none; opacity: .7; }
.inv-btn.is-muted { color: var(--inv-ink-soft); font-size: .74rem; font-style: italic; font-weight: 400;
  background: none; border: none; box-shadow: none; cursor: default; padding: .45em .1em; }

.inv-close { font: inherit; font-size: .78rem; cursor: pointer; color: var(--inv-ink-soft); margin-top: 14px;
  background: transparent; border: 1px solid rgba(104,70,40,.45); border-radius: 8px; padding: .4em .9em; }
.inv-close:hover { color: var(--inv-ink-2); border-color: var(--inv-ember-deep); background: rgba(255,241,198,.35); }

.inv-banner { display: flex; align-items: center; gap: .6em; padding: .6em .9em; border-radius: 12px;
  margin: 2px 0 10px; font-style: italic; font-size: .9rem; color: var(--inv-ink-2); }
.inv-banner.ok { background: rgba(124,156,70,.22); border-left: 4px solid var(--inv-green); }
.inv-banner.fail { background: rgba(196,68,62,.18); border-left: 4px solid var(--inv-berry); }
`;
