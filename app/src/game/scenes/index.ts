import { registerScene } from '../SceneRegistry';
import { BootScene } from './BootScene';

// Side-effect import: registering here means new scenes become reachable via
// ?scene=<key> just by adding one line — the whole test/screenshot harness rides on this.
registerScene('boot', BootScene);
