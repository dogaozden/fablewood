/**
 * Tiny DOM helpers for the inventory/shop panes (inventory-handoff §7). encounters/dom.ts's
 * el() shape is copied here rather than imported — that module's internals aren't
 * exported and encounters/** is off-limits from this slice.
 */
import { ensureStyles } from './styles';
import { GAME_TEARDOWN_EVENT } from '../../game/encounters/overlay';

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

export interface PaneHandle {
  panel: HTMLDivElement;
  close(): void;
}

/**
 * The Satchel/shop panes (inventoryPane.ts, shopPane.ts, combatSatchelPane.ts) are
 * document.body children, so — same bug as the encounter overlay (encounters/overlay.ts,
 * GAME_TEARDOWN_EVENT is that module's own exported constant, not an internal) — they
 * outlive the Phaser canvas: unmounting PhaserGame left an orphaned pane floating over
 * whatever mounted next while its `await` kept a dead scene's continuation (re-enabling
 * this.input.keyboard, clearing a busy flag) queued. Every open pane is dropped on
 * teardown (DOM removed, no exit animation). The pane's own Promise is deliberately left
 * unresolved, exactly like an abandoned encounter: that continuation would run against a
 * torn-down scene.
 */
const openPanes = new Set<() => void>();

if (typeof window !== 'undefined') {
  window.addEventListener(GAME_TEARDOWN_EVENT, () => {
    for (const abort of [...openPanes]) abort();
  });
}

/**
 * Open a parchment overlay panel (Satchel / Mira's shop share this scaffold):
 * appended to document.body, closes on click-outside OR Escape (browsing here is
 * non-punitive, unlike the encounters overlay, which deliberately omits both —
 * inventory-handoff §7). `onClose` fires exactly once, however the pane closes (never on
 * a forced GAME_TEARDOWN_EVENT abort — see the module comment above).
 *
 * CRITICAL (Phaser bleed, §7): a DOM overlay over the canvas lets WASD/E leak into
 * the game underneath. This module has no access to encounters' depth-counted
 * quietGameKeyboard (unexported, and encounters/** is forbidden here) — so every
 * CALLER must wrap the open:
 *   this.input.keyboard!.enabled = false;
 *   await openInventoryPane();   // or openShopPane()
 *   this.input.keyboard!.enabled = true;
 *   this.input.keyboard!.resetKeys();
 *
 * GHOST-REOPEN GUARD (bugfix-wave #2, crucible finding "rapid q→Escape leaves Escape dead"):
 * root-caused via an instrumented repro against real CombatScene — dom.ts's own add/remove
 * of its keydown listener is airtight (every Escape press closes whatever pane is currently
 * open, every time). The bug is upstream: Phaser's KeyboardPlugin queues every native
 * keydown/keyup it sees (KeyboardManager#queue) and never clears that queue itself; its
 * de-dup only remembers the ONE most-recently-processed entry, so while a caller's keyboard
 * is disabled for a pane's lifetime (per the wrap above) the queue keeps growing untouched,
 * and once more than one stale event has piled up, an OLD keydown — e.g. the very 'q' that
 * opened the pane Escape just closed — can replay and silently reopen it the instant the
 * caller re-enables its keyboard. Confirmed empirically: a ghost 'q' lands ~1-10ms after this
 * module's own close() runs, far faster than any human can perceive the pane closing, decide
 * to reopen it, and press a key. This module can't patch Phaser or CombatScene (out of
 * bounds here), but it CAN refuse to let a reopen that fast masquerade as a fresh one: a new
 * openPane() within REOPEN_SETTLE_MS of the last close is swallowed (opened and immediately
 * self-closed, before the browser ever paints it) rather than flashed back open — from the
 * player's side, Escape closed the pane and it stayed closed.
 *
 * PER-PANE SCOPING (crucible V1-15): the guard above must be scoped per PANE-TYPE, not
 * global — Satchel/Shop/combat-Satchel are separate flows a player can legitimately
 * alternate between (e.g. close Shop, immediately press 'I' for the Satchel), and a single
 * shared timestamp treated that legitimate cross-pane open as a ghost reopen of the pane
 * that just closed, silently swallowing it too. `closedAt` below is keyed by `paneId` so
 * closing one pane never taints another pane's guard.
 */
export const REOPEN_SETTLE_MS = 150;
const closedAt = new Map<string, number>();

/** Every distinct pane flow sharing this scaffold — see PER-PANE SCOPING above. */
export type PaneId = 'inventory' | 'shop' | 'combatSatchel';

/**
 * Pure ghost-reopen decision (no DOM), factored out of openPane() so the per-pane scoping
 * fix is unit-testable: this project's vitest runs under `environment: 'node'`
 * (vite.config.ts), not jsdom, so openPane() itself — which touches document/window
 * throughout — isn't directly unit-testable here, but this slice of its logic is.
 */
export function isGhostReopen(paneId: string, now: number, closedAt: ReadonlyMap<string, number>): boolean {
  const last = closedAt.get(paneId);
  return last !== undefined && now - last < REOPEN_SETTLE_MS;
}

/**
 * V1-18: the overlay must not cover the shell's nav bar (`.tabbar`, App.tsx/App.css) — a
 * full-viewport overlay made the tab bar's real click target the overlay instead of the
 * button underneath it, so a click there ran click-outside-to-close instead of navigating.
 * The overlay still has to fully cover the game canvas below the nav bar — that's the whole
 * point of the Phaser-bleed suppression documented above — so this only shrinks the
 * overlay's TOP inset to clear the nav bar's own rendered height; everything else about the
 * overlay (backdrop, click-outside-close, keyboard capture) is unchanged. Measured at open
 * time rather than hardcoded: App.tsx/App.css own the nav bar's actual size (out of bounds
 * for this module to edit), and the shell may not even be mounted around this pane in every
 * test/host context — 0 when `.tabbar` is absent preserves the old full-viewport behavior.
 */
function navBarHeight(): number {
  return document.querySelector('.tabbar')?.getBoundingClientRect().height ?? 0;
}

export function openPane(onClose: () => void, paneId: PaneId): PaneHandle {
  ensureStyles();
  const ghostReopen = isGhostReopen(paneId, Date.now(), closedAt);
  const panel = el('div', { class: 'inv-panel', tabIndex: -1, role: 'dialog', 'aria-modal': 'true' });
  const root = el('div', { class: 'inv-overlay', style: `top:${navBarHeight()}px` }, [panel]);

  let closed = false;
  const teardown = (): void => {
    document.removeEventListener('keydown', onKey);
    openPanes.delete(abort);
    root.remove();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
    closedAt.set(paneId, Date.now());
    teardown();
    onClose();
  };
  const abort = (): void => {
    if (closed) return;
    closed = true;
    teardown();
    // deliberately NOT calling onClose() — see the module comment above.
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  document.addEventListener('keydown', onKey);
  openPanes.add(abort);

  document.body.appendChild(root);
  requestAnimationFrame(() => panel.focus());

  if (ghostReopen) close(); // swallowed before the browser ever paints the reopen

  return { panel, close };
}
