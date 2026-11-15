# The Ancient Abyss — Phases 4–12 Audit

Branch: `main`
Audit scope: Phases 4 through 12, including previously identified defects and cross-phase dependencies.

## Status

| Phase | Result | Work completed | Remaining limitation |
|---|---|---|---|
| 4 — Transit + safe landing | Implemented; static checks passed | Y=32 landing platform; 16:1 entry coordinate mapping; portal polling; particle trigger; safe Overworld Y=-50 return search near saved X/Z; exact saved-entry fallback if no safe pocket exists; destination chunk is loaded during search/teleport. | Portal contact is polling, not a native touch event. A nearby Ancient City is not positively located; the saved portal X/Z is used as the reference. |
| 5 — Void Tether + Anti-Elytra | Implemented; static checks passed | Per-player dynamic-property cooldown, 20-block rescue, 10-second Slow Falling, Elytra durability drain, item-use firework cancellation, spawned-rocket cleanup. Corrected Bedrock's distinct firework item/entity identifiers. | No native Elytra-disable switch; durability and rocket cleanup are workarounds. |
| 6 — Portal blocks | Implemented; static checks passed | Unbreakable Sculk Altar; no-collision light-level-4 portal; resource-pack particle definition; portal contact particle spawn throttled per player. | Contact/particle trigger is polling-based. |
| 7 — Null Core | Implemented; static checks passed | Startup injection scans nearby Bedrock frame blocks, verifies the displayed item is an Elytra through BlockItemFrameComponent, inserts four Null Cores into the adjacent chest, and retries missing Shulker guardians independently. Removed the incomplete End City loot-table override to preserve vanilla loot. | Scanning is limited to a 12-block horizontal / 6-block vertical radius around End players, so the ship is processed when a player approaches it. |
| 8 — Ritual ignition | Implemented; static checks passed | Four slotted Null Cores and Dragon Egg validation; exact 30×30 frame; all four frame edges now checked; beam sequence, 5-second Darkness, portal fill; Dragon Egg lock/restore. | Reverse Warden roar is approximated with a low-pitch vanilla roar; it is not actual reversed audio. |
| 9 — Echo Shard fallback | Implemented; static checks passed | Requires the clicked Reinforced Deepslate block to belong to a complete 30×30 frame; 1.5-second charge; item cost is consumed only after transit succeeds and is tied to the original inventory slot. | Transit itself still depends on the Phase 4 teleport implementation and the player's destination being safely available. |
| 10 — Abyssal Silt | Best supported approximation implemented | Slowness III is refreshed while standing on silt; Depth Strider and Abyssalite boots exempt the player; Blast Furnace recipe and slag item are present. Removed the ineffective Warden velocity-clearing workaround. | NOT POSSIBLE IN BEDROCK: Script API cannot cancel vanilla vibration propagation from a custom block. Slowness III is approximately 45%, not exactly 40%. |
| 11 — Slate set | Implemented; JSON statically validated | Fractured/Polished Slate blocks, slabs, and stairs; top/bottom slab placement; cardinal stair orientation; multi-box stair collision; stair support shape; aligned stair mesh; crafting and stonecutter recipes; added the missing Fractured Slate base recipe. | In-game collision, stair orientation, and placement must still be tested on the target retail client. |
| 12 — Bricks + Gloomstone | Implemented with documented light approximation | Chiseled Abyssal Bricks use 4-second mining time and explosion resistance 9; recipe present. Added Gloomstone recipe; Darkness is applied within a 3-block spherical radius; block light dampening remains at 15. | NOT POSSIBLE IN BEDROCK: a custom block cannot subtract exactly two levels from the neighboring block-light field. Darkness is a player-vision approximation, not actual local light absorption. |

## Static verification

- All changed block/recipe/particle JSON files parsed successfully after the latest edits.
- Stair block files contain placement traits under the block description, cardinal/vertical-half permutations, multi-box collision definitions, and stair support shape.
- Transit checks confirm safe Y=-50 search, complete-frame validation, post-success Echo Shard consumption, and portal particle throttling.
- Void Tether checks confirm separate firework item and entity IDs.
- Ritual checks confirm 30×30 dimensions and four-edge validation.
- End Ship script checks confirm per-frame idempotence, first-empty-slot insertion, and retryable guardian spawning.
- The deleted `behavior_pack/loot_tables/chests/end_city_treasure.json` is absent from the branch.

## Verification boundary

These are repository/static checks only. No Bedrock client was launched, no world was loaded, and no in-game behavior was observed in this audit. Treat Phases 4–12 as code-complete to the documented API limits, but not runtime-certified until tested in a disposable world on the target Bedrock version with Beta APIs enabled.
