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
 */
export function openPane(onClose: () => void): PaneHandle {
  ensureStyles();
  const panel = el('div', { class: 'inv-panel', tabIndex: -1, role: 'dialog', 'aria-modal': 'true' });
  const root = el('div', { class: 'inv-overlay' }, [panel]);

  let closed = false;
  const teardown = (): void => {
    document.removeEventListener('keydown', onKey);
    openPanes.delete(abort);
    root.remove();
  };
  const close = (): void => {
    if (closed) return;
    closed = true;
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

  return { panel, close };
}
