import { registerScene } from '../SceneRegistry';
import { BootScene } from './BootScene';
import { HamletScene } from './hamlet/HamletScene';
import { DungeonScene } from './dungeon/DungeonScene';
import { CombatScene } from '../combat/CombatScene';
// Provider registrations (side-effect installs into services — see contracts.ts):
import '../encounters/register';
import '../../srs/register';
import '../../inventory/register';

// Side-effect import: registering here means new scenes become reachable via
// ?scene=<key> just by adding one line — the whole test/screenshot harness rides on this.
// ORCHESTRATOR-OWNED FILE: wave-2 agents replace their own scene/provider files, never this one.
registerScene('boot', BootScene);
registerScene('hamlet', HamletScene);
registerScene('vaults', DungeonScene);
registerScene('combat', CombatScene);
