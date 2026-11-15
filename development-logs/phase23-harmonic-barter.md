# Phase 23 — Harmonic Barter

## Status
**Partial implementation committed; in-game validation still required.**

## Implemented
- Added `behavior_pack/scripts/trade_handler.js`.
- Added an `@minecraft/server-ui` dependency at version `2.0.0`.
- Loaded the trade handler from `behavior_pack/scripts/startup.js`.
- Added a three-option `ActionFormData` menu:
  - Tier I: 4 Amethyst Shards + 2 of any wool → named leather boots ("Padded Treads").
  - Tier II: 1 Calibrated Sculk Sensor + 4 Echo Shards → `meridian:abyssal_anchor`.
  - Tier III: 1 `meridian:resonant_core` + 16 Crying Obsidian → `meridian:abyss_upgrade_smithing_template`.
- Tier II requires 10 trust; Tier III requires 25 trust. These thresholds were engineering choices because the PRD does not specify them.
- Material counts are checked before consumption. The script requires a free inventory slot, refunds consumed materials if reward insertion fails, and does not consume ingredients in Creative.
- Existing Phase 22 trust logic remains responsible for sneaking sculk-clearing trust and direct Dweller donations. Normal interaction with a donation item still donates; sneak-interaction opens the trade UI.

## Explicit limitations / unfinished requirements
- **Padded Treads is not the requested custom enchantment.** Bedrock's supported Script API does not expose a general custom-enchantment registration interface for this behavior. The current Tier I reward is a named vanilla leather-boots placeholder. It does not mute footsteps or suppress sculk vibrations. A proper soundproofing mechanic needs a different supported workaround or a native game feature.
- The PRD names a village pylon, but the current Phase 22 implementation awards donation trust by interacting with the Dweller because no pylon block/structure interaction exists yet.
- Resonant Warden healing cannot contribute trust until Phase 24 exists; Phase 24 should call the exported `addTrust(player, amount)` function when a valid heal succeeds.
- No in-game UI, inventory transaction, or multiplayer test has been performed in this commit.

## API verification
- **Verified against Microsoft Learn:** `ActionFormData` supports `title`, `body`, `button`, and `show(player)`; its response exposes `canceled` and `selection`.
- **Verified against Microsoft Learn:** `@minecraft/server-ui` version `2.0.0` is a published module version and declares a peer dependency on `@minecraft/server@2.0.0`. The behavior pack continues to request the server beta track, so the actual game build must still be checked in-world.
- **Verified against Microsoft Learn:** `PlayerInteractWithEntityBeforeEvent` exposes `cancel`, `itemStack`, `player`, and `target`, matching the Phase 22 interaction event fields used by the trade hook.
- **Not verified in-game:** module resolution on the user's exact Minecraft build, form visibility, item insertion/refund edge cases, and all tier trades.

## External pack/source comparison
- No Actions & Stuff source code or assets were copied. Its published FAQ describes it as a global resource pack that does not modify behavior or mechanics, so it is not a source reference for a scripted trade UI.
- No Chinese Edition / NetEase-only APIs were used. NetEase-specific addon formats must not be assumed compatible with the international Bedrock runtime.

## Files changed
- `behavior_pack/manifest.json`
- `behavior_pack/scripts/startup.js`
- `behavior_pack/scripts/trade_handler.js`
