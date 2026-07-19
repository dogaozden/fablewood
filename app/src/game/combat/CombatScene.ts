/**
 * STUB — owned by the combat agent; replace wholesale (slice-blueprint §3).
 * Keep: scene key 'combat', markReady at end of create().
 * Launch contract: scene.start('combat', CombatLaunch); resolve via game.events 'combat:resolved'
 * with CombatOutcome, then start(returnScene).
 */
import Phaser from 'phaser';
import { markReady } from '../ready';

export class CombatScene extends Phaser.Scene {
  constructor() {
    super('combat');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#241A2E');
    this.add.text(20, 20, 'COMBAT (stub)', { color: '#F4E6C8', fontSize: '24px' });
    markReady({ scene: 'combat', title: 'FABLEWOOD', seed: 0 });
  }
}
