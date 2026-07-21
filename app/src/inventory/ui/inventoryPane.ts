/**
 * The Satchel (inventory-handoff §7): every owned item, with "Use" wired to
 * services.inventory.useItem for field-usable consumables. A DOM overlay over the
 * Phaser canvas — see ./dom.ts's openPane doc for the mandatory caller-side
 * keyboard-quiet wrap.
 */
import { services, type InventorySnapshot } from '../../game/contracts';
import { CATALOG, RARITY_META, type ItemDef } from '../catalog';
import { iconUrl } from '../icons';
import { el, openPane } from './dom';

/** Opens the Satchel; resolves when the pane closes (click-outside, Escape, or the Close button). */
export function openInventoryPane(): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = openPane(resolve, 'inventory');

    const goldEl = el('span', { class: 'inv-gold' });
    const banner = el('div', {});
    const body = el('div', { class: 'inv-body' });
    panel.append(
      el('div', { class: 'inv-header' }, [el('h2', { class: 'inv-title', text: 'Satchel' }), goldEl]),
      el('hr', { class: 'inv-rule' }),
      banner,
      body,
      el('button', { class: 'inv-close', type: 'button', text: 'Close ✕', onClick: close }),
    );

    const showBanner = (ok: boolean, message: string): void => {
      banner.replaceChildren(el('div', { class: `inv-banner ${ok ? 'ok' : 'fail'}`, text: message }));
    };

    const useCell = (item: ItemDef): Array<Node | string> => {
      if (item.use === 'field') {
        return [
          el('button', {
            class: 'inv-btn',
            type: 'button',
            text: 'Use',
            onClick: async () => {
              const res = await services.inventory.useItem(item.id);
              showBanner(res.ok, res.message);
              render();
            },
          }),
        ];
      }
      if (item.use === 'trial') {
        return [el('span', { class: 'inv-btn is-muted', title: 'Used in trials', text: 'Trial-bound' })];
      }
      if (item.use === 'combat') {
        // V1-22: Glow items are 'combat'-only by construction (catalog.ts's item() factory) and
        // used to fall through to an empty cell here, indistinguishable from a fully-inert
        // trinket. Mirrors the 'trial' muted-pill treatment above so the player learns where
        // it DOES work, instead of reading as dead weight.
        return [el('span', { class: 'inv-btn is-muted', title: 'Used in battle', text: 'Combat-only' })];
      }
      return [];
    };

    const row = (item: ItemDef, snap: InventorySnapshot): HTMLDivElement => {
      const meta = RARITY_META[item.rarity];
      const qty = snap.stacks[item.id] ?? 0;
      return el('div', { class: 'inv-row' }, [
        el('img', { class: 'inv-icon', src: iconUrl(item.id), alt: item.name }),
        el('div', { class: 'inv-main' }, [
          el('div', { class: 'inv-name-row' }, [
            el('span', { class: 'inv-name', style: `color:${meta.name}`, text: item.name }),
            el('span', {
              class: 'inv-chip',
              style: `background:${meta.chip};color:${meta.chipInk}`,
              text: meta.label,
            }),
          ]),
          el('span', { class: 'inv-flavor', text: item.flavor }),
        ]),
        el('span', { class: 'inv-qty', text: `×${qty}` }),
        ...useCell(item),
      ]);
    };

    const render = (): void => {
      const snap = services.inventory.snapshot();
      goldEl.textContent = `⟡ ${snap.gold}`;
      const owned = CATALOG.filter((i) => (snap.stacks[i.id] ?? 0) > 0);
      if (!owned.length) {
        body.replaceChildren(
          el('p', { class: 'inv-empty', text: 'Your satchel is empty. Clear the Vaults to earn coin and loot.' }),
        );
        return;
      }
      body.replaceChildren(...owned.map((item) => row(item, snap)));
    };

    render();
  });
}
