/**
 * Mira's Ledger (inventory-handoff §7): buy the 6 consumable/tool items, sell
 * owned trinkets. Same DOM-overlay contract as inventoryPane.ts — see ./dom.ts's
 * openPane doc for the mandatory caller-side keyboard-quiet wrap.
 */
import { services } from '../../game/contracts';
import { CATALOG, RARITY_META, shopStock, type ItemDef } from '../catalog';
import { sellPrice } from '../economy';
import { iconUrl } from '../icons';
import { el, openPane } from './dom';

/** Short buyer-facing description of what an item does (shop-only presentation, not catalog data). */
function effectLabel(item: ItemDef): string {
  const e = item.effect;
  switch (e.kind) {
    case 'heal':
      return e.amount >= 999 ? 'Restores to full vigor' : `Restores ${e.amount} vigor`;
    case 'glow':
      return `Grants ${e.amount} glow in battle`;
    case 'reveal_option':
      return 'Strikes one wrong answer in a trial';
    case 'retry_cast':
      return 'Retry a failed cast in a trial';
    case 'streak_shield':
      return 'Holds your hearth streak through a stumble in a trial';
    case 'none':
      return '';
  }
}

/** Opens Mira's shop; resolves when the pane closes (click-outside, Escape, or the Close button). */
export function openShopPane(): Promise<void> {
  return new Promise((resolve) => {
    const { panel, close } = openPane(resolve);

    const goldEl = el('span', { class: 'inv-gold' });
    const banner = el('div', {});
    const body = el('div', { class: 'inv-body' });
    panel.append(
      el('div', { class: 'inv-header' }, [
        el('h2', { class: 'inv-title', text: "Mira's Ledger — Wares & Trade" }),
        goldEl,
      ]),
      el('hr', { class: 'inv-rule' }),
      banner,
      body,
      el('button', { class: 'inv-close', type: 'button', text: 'Close ✕', onClick: close }),
    );

    const showBanner = (ok: boolean, message: string): void => {
      banner.replaceChildren(el('div', { class: `inv-banner ${ok ? 'ok' : 'fail'}`, text: message }));
    };

    const buyRow = (item: ItemDef, gold: number): HTMLDivElement => {
      const meta = RARITY_META[item.rarity];
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
          el('span', { class: 'inv-flavor', text: effectLabel(item) }),
        ]),
        el('span', { class: 'inv-price', text: `⟡ ${item.value}` }),
        el('button', {
          class: 'inv-btn',
          type: 'button',
          text: 'Buy',
          disabled: gold < item.value,
          onClick: async () => {
            // Atomic (crucible #6): one store.mutate() write does gold AND the item
            // together, so a reload can never land between "gold spent" and "item granted".
            const ok = await services.inventory.buy(item.id, item.value);
            if (!ok) {
              showBanner(false, "You can't afford that yet.");
              return;
            }
            showBanner(true, `Bought ${item.name}.`);
            render();
          },
        }),
      ]);
    };

    const sellRow = (item: ItemDef, qty: number): HTMLDivElement => {
      const meta = RARITY_META[item.rarity];
      const price = sellPrice(item);
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
        ]),
        el('span', { class: 'inv-qty', text: `×${qty}` }),
        el('button', {
          class: 'inv-btn',
          type: 'button',
          text: `Sell ⟡${price}`,
          onClick: async () => {
            // Atomic (crucible #6): one store.mutate() write removes the item AND credits
            // gold together — the sell-side mirror of buy() above.
            const sold = await services.inventory.sell(item.id, price);
            if (!sold) {
              showBanner(false, "You don't have one of those.");
              return;
            }
            showBanner(true, `Sold ${item.name} for ⟡${price}.`);
            render();
          },
        }),
      ]);
    };

    const render = (): void => {
      const snap = services.inventory.snapshot();
      goldEl.textContent = `⟡ ${snap.gold}`;

      const rows: Array<Node | string> = [el('div', { class: 'inv-section-title', text: 'Buy' })];
      rows.push(...shopStock().map((item) => buyRow(item, snap.gold)));

      rows.push(el('div', { class: 'inv-section-title', text: 'Sell' }));
      const owned = CATALOG.filter((i) => i.type === 'trinket' && (snap.stacks[i.id] ?? 0) > 0);
      if (owned.length) {
        rows.push(...owned.map((item) => sellRow(item, snap.stacks[item.id] ?? 0)));
      } else {
        rows.push(el('p', { class: 'inv-empty', text: 'Nothing to sell — trinkets turn up in the Vaults.' }));
      }
      body.replaceChildren(...rows);
    };

    render();
  });
}
