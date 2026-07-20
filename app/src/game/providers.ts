/**
 * Eager service-provider registrations (side-effect installs into `services` —
 * contracts.ts): settings, save, srs, inventory, encounters + judge.
 *
 * Split out of scenes/index.ts (bundle diet) so the shell (App/Dashboard/Library)
 * can use `services.*` — the mute toggle needs settings on mount; Dashboard/Library
 * read save/srs/inventory directly — without pulling in Phaser or Tone, which only
 * the scene classes need. None of the three modules below import Phaser or Tone
 * (verified: only scene/combat/dialogue/music modules do). Import this eagerly
 * (e.g. from App.tsx); scenes/index.ts keeps the scene-class registrations, which
 * PhaserGame lazy-loads.
 */
import './encounters/register';
import '../srs/register';
import '../inventory/register';
