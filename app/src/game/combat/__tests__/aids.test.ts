import { describe, expect, it } from 'vitest';
import { aidFires, armAid, type ArmedAid } from '../aids';

describe('aids (Ch. VII pure arm-state slice)', () => {
  describe('armAid', () => {
    it('arms from empty (null current)', () => {
      expect(armAid(null, 'scriveners-hint', 'reveal_option')).toEqual({
        itemId: 'scriveners-hint',
        kind: 'reveal_option',
      });
    });

    it('arm-over-arm replaces: returns the NEW aid, the old one simply gone (one live arm at a time)', () => {
      const first = armAid(null, 'scriveners-hint', 'reveal_option');
      const second = armAid(first, 'second-wind-seal', 'retry_cast');
      expect(second).toEqual({ itemId: 'second-wind-seal', kind: 'retry_cast' });
    });

    it('replacing leaves no side effects on the old arm — item retention is automatic since nothing was deducted', () => {
      const first = armAid(null, 'scriveners-hint', 'reveal_option');
      const second = armAid(first, 'scriveners-hint', 'reveal_option');
      expect(second).toEqual({ itemId: 'scriveners-hint', kind: 'reveal_option' });
      expect(first).toEqual({ itemId: 'scriveners-hint', kind: 'reveal_option' }); // untouched by the replace
    });
  });

  describe('aidFires', () => {
    it('nothing armed: never fires', () => {
      expect(aidFires(null, 'reveal_option')).toBeNull();
      expect(aidFires(null, 'retry_cast')).toBeNull();
    });

    it('kind match: fires — returns the armed aid so the caller can deduct the item and clear the arm', () => {
      const armed: ArmedAid = { itemId: 'scriveners-hint', kind: 'reveal_option' };
      expect(aidFires(armed, 'reveal_option')).toEqual(armed);
    });

    it('kind mismatch: does not fire (null) — caller contract is nothing deducts, and a differently-kinded standing arm stays armed for its own trigger', () => {
      const armed: ArmedAid = { itemId: 'second-wind-seal', kind: 'retry_cast' };
      expect(aidFires(armed, 'reveal_option')).toBeNull();
    });
  });
});
