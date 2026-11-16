# Phase 25 — Tri-Citadel: Earth Duo

## Implemented

### Tectonic Weft Mage
- Added `meridian:tectonic_weft_mage` behavior entity, client entity, custom geometry, animations, render controller, and creative spawn egg.
- The mage searches for nearby players and alternates two scripted attacks:
  - Raises a 5-wide, 3-block-high temporary bedrock wall between itself and its target.
  - Calls down three temporary hanging pointed-dripstone stalactites above/around the target. A delayed impact deals 6 damage only when the player remains in the strike area.
- Attack blocks are placed only into air and self-clear after their short lifetime, avoiding permanent replacement of terrain and player structures.

### Tectonic Colossus Warden
- Added `meridian:tectonic_colossus_warden` behavior entity, custom geometry, client entity and spawn egg.
- Uses a larger Warden-derived visual and a 1.5 visual scale.
- Periodically launches itself toward the nearest player with `Entity.applyImpulse`, then deals impact damage, knockback, and brief Slowness when its charge intersects the target.
- Ram collision checks the swept path between script updates to reduce tunnelling through a player at high speed.

### Obsidian chain tether
- Added the custom, non-colliding `meridian:obsidian_chain` block with X/Y/Z axis states and a two-link geometry.
- The chain uses the existing Gloomstone texture as its dark obsidian-like finish; no new binary texture asset was required.
- When a Mage and Colossus are summoned within 32 blocks in the same dimension, the controller pairs them and draws an oriented chain between them.
- Chain cleanup is dimension-aware and removes only chain blocks still present at the positions owned by the tether.

## Integration
- Added `behavior_pack/scripts/tectonic_duo.js`.
- Wired `initTectonicDuo()` into `behavior_pack/scripts/startup.js`.
- BP and RP versions are both `1.0.3`; the BP dependency references RP `1.0.3`.
- The Tectonic entity localization keys were already present in `resource_pack/texts/en_US.lang`.

## Validation
- All new or changed JSON files parsed successfully.
- Client entity geometry, animation and render-controller references were checked.
- Mage animation bone names were checked against the Mage model; Colossus shares the existing Resonant Warden animation and render controller with matching bone names.
- Static checks confirmed startup wiring, entity spawn flags, three chain axes, non-collision, temporary attack-block cleanup, Mage attacks, and Colossus ram logic.
- The Earth-duo JavaScript passed a syntax compilation check.

## Not yet verified in retail Bedrock
- Visual quality of the two new models and the reused vanilla Evoker/Warden textures.
- Whether the custom chain geometry looks correct at all three axis orientations.
- Bedrock runtime acceptance of the custom pointed-dripstone permutation on the target client.
- Actual combat timing, pathing and impact behavior in multiplayer.
- The pair is linked automatically when both entities are loaded in the same dimension and within 32 blocks; they are not yet naturally generated as a pre-placed boss encounter.
- This phase adds an encounter controller and summonable entities, not a Citadel structure or boss arena.

A successful JSON/source check is not a substitute for testing the encounter in the target retail Bedrock client.
