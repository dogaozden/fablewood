# Fablewood 3D — The Lantern Wood

User authorization: September 7, 2026, Goal 1. Ground-up rethink; rotatable elevated party-RPG camera. This reopens the former Phaser/pixel-art implementation constraint and the pixel-specific dimensions in the style contract. Warmth, craft, source truth, stable pack IDs, and live-state protections remain binding. SPEC.md stays untouched.

## Playable promise
A hand-crafted forest hamlet and its lost road, visible in the same traversable 3D world. Read a source at a waystone, recall it to renew the path, take a companion into tactical encounters, return the light to the village. Learning opens spaces and changes tactical power. Basic movement/attacks remain available without a question on every click. A save-anywhere journey and repeatable patrol support short visits and a complete chapter.

## Delivery requirements
- Three distinct generated direction previews; select and record one.
- Actual modeled 3D world, elevated orbit/zoom camera, click-to-walk and keyboard movement, collision/navigation.
- Warm detailed hamlet, creek/bridge, woodland waystones, ruined gate and guardian arena.
- Companion recruitment, source discovery, recall that alters the world, turn-based movement/range/guard/attack/knowledge abilities, retreat and recovery, rewards, return and repeatable expedition.
- Pack-neutral engine; real installed packs selected through existing services with due/fresh/revisit ordering, amendment suspension, source evidence, and SRS recording. Explicitly labeled neutral practice when no packs are installed.
- Versioned new journey save alongside, never overwriting legacy save/story data. All implementation/QA uses isolated STATE_DIR. Real user state and originals are never touched.
- Running screenshots and independent visual critique against the chosen concept; at least two actual revisions, target score 8 and acceptable measured browser performance.
- Unit tests, build, zero-packs, required main browser suite and focused 3D acceptance, honest shader/render/native limitations.

## Ownership
Goal 1: app/src/game3d, game entry integration, dependencies, 3D art, new gameplay tests. Goals 2/3 own secreg experience and publication. Keep Pack contract compatible. Main 5175 test port is shared; schedule before running. Scratch 5411.

## First implementation
Separate geometry/material generation, renderer/input lifecycle, pure journey/tactical reducer, React HUD, and service adapter. New default entry is 3D; explicit legacy scene/developer routes retain the 2D regression harness. The old engine is retained as compatibility access while the new experience becomes the primary game.
