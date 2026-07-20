/**
 * Tiny DOM helpers for the inventory/shop panes (inventory-handoff §7). encounters/dom.ts's
 * el() shape is copied here rather than imported — that module's internals aren't
 * exported and encounters/** is off-limits from this slice.
 */
import { ensureStyles } from './styles';

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
 * Open a parchment overlay panel (Satchel / Mira's shop share this scaffold):
 * appended to document.body, closes on click-outside OR Escape (browsing here is
 * non-punitive, unlike the encounters overlay, which deliberately omits both —
 * inventory-handoff §7). `onClose` fires exactly once, however the pane closes.
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
  const close = () => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    root.remove();
    onClose();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };
  root.addEventListener('click', (e) => {
    if (e.target === root) close();
  });
  document.addEventListener('keydown', onKey);

  document.body.appendChild(root);
  requestAnimationFrame(() => panel.focus());

  return { panel, close };
}
