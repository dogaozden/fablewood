import { registerScene } from '../SceneRegistry';
import { BootScene } from './BootScene';
import { HamletScene } from './hamlet/HamletScene';
import { DungeonScene } from './dungeon/DungeonScene';
import { CombatScene } from '../combat/CombatScene';
// Provider registrations (settings/save/srs/inventory/encounters/judge) moved to
// ../providers.ts (bundle diet: they're Phaser/Tone-free and the shell needs them
// eagerly, independent of this Phaser-heavy module — see that file's header).

// Side-effect import: registering here means new scenes become reachable via
// ?scene=<key> just by adding one line — the whole test/screenshot harness rides on this.
// ORCHESTRATOR-OWNED FILE: wave-2 agents replace their own scene/provider files, never this one.
registerScene('boot', BootScene);
registerScene('hamlet', HamletScene);
registerScene('vaults', DungeonScene);
registerScene('combat', CombatScene);
