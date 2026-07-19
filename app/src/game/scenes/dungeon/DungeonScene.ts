/**
 * STUB — owned by the dungeon agent; replace wholesale (slice-blueprint §4).
 * Keep: scene key 'vaults', markReady at end of create().
 */
import Phaser from 'phaser';
import { markReady } from '../../ready';

export class DungeonScene extends Phaser.Scene {
  constructor() {
    super('vaults');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1E2233');
    this.add.text(20, 20, 'THE PREFERENCE VAULTS (stub)', { color: '#F4E6C8', fontSize: '24px' });
    markReady({ scene: 'vaults', title: 'FABLEWOOD', seed: 0 });
  }
}
