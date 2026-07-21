/**
 * The in-battle Satchel list (inventory-handoff §10): a combat-scoped reduction of the
 * Satchel showing only the items CombatScene has already decided are usable-in-combat
 * (combat/satchel.ts's usableSatchelItems) — same DOM/parchment scaffold as
 * inventoryPane.ts/shopPane.ts (openPane, §7), same mandatory caller-side keyboard-quiet
 * wrap (./dom.ts). Kept presentation-only (no services.inventory / combat/** imports): the
 * scene owns the mutation, because it must sync the LIVE in-battle HP pool into
 * services.save before calling services.inventory.useItem (see combat/satchel.ts).
 */
import type { ItemDef } from '../catalog';
import { RARITY_META } from '../catalog';
import { iconUrl } from '../icons';
import { el, openPane } from './dom';
import { effectLabel } from './shopPane';

export interface CombatSatchelEntry {
  item: ItemDef;
  qty: number;
}

/** Opens the in-battle Satchel list; resolves with the chosen item id, or null (cancelled/empty/closed). */
export function openCombatSatchelPane(usable: CombatSatchelEntry[], gold: number): Promise<string | null> {
  return new Promise((resolve) => {
    let picked: string | null = null;
    const { panel, close } = openPane(() => resolve(picked), 'combatSatchel');

    const goldEl = el('span', { class: 'inv-gold', text: `⟡ ${gold}` });
    const body = el('div', { class: 'inv-body' });
    panel.append(
      el('div', { class: 'inv-header' }, [el('h2', { class: 'inv-title', text: 'Satchel' }), goldEl]),
      el('hr', { class: 'inv-rule' }),
      body,
      el('button', { class: 'inv-close', type: 'button', text: 'Never Mind', onClick: close }),
    );

    if (!usable.length) {
      body.replaceChildren(
        el('p', { class: 'inv-empty', text: "The Clerk's register shows nothing fit to use in this trial." }),
      );
      return;
    }

    body.replaceChildren(
      ...usable.map(({ item, qty }) => {
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
          el('span', { class: 'inv-qty', text: `×${qty}` }),
          el('button', {
            class: 'inv-btn',
            type: 'button',
            text: 'Use',
            onClick: () => {
              picked = item.id;
              close();
            },
          }),
        ]);
      }),
    );
  });
}
