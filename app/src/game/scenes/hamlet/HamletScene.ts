/**
 * STUB — owned by the hamlet agent; replace wholesale (slice-blueprint §5).
 * Keep: scene key 'hamlet', markReady at end of create().
 */
import Phaser from 'phaser';
import { markReady } from '../../ready';

export class HamletScene extends Phaser.Scene {
  constructor() {
    super('hamlet');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#233524');
    this.add.text(20, 20, 'HAMLET (stub)', { color: '#F4E6C8', fontSize: '24px' });
    markReady({ scene: 'hamlet', title: 'FABLEWOOD', seed: 0 });
  }
}
