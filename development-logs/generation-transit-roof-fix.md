# Generation, Transit, and Low-Ceiling Fix

## Changes
- Removed the blocking 5x5 terrain-generation wait from Abyss entry. The safe arrival platform is prepared first, then the player is teleported and nearby terrain generation is queued in the background.
- Reduced the transit ticking-area bounds from 33x33 to 17x17 blocks; the arrival platform fits within this area.
- Reduced the Overworld Y=-50 safe-return search radius from 8 blocks to 2 blocks to avoid a long scan before returning.
- Increased the terrain proximity scan from every 100 ticks to every 10 ticks.
- Added two concurrent terrain-generation workers, nearest-chunk queue prioritization, and velocity-based forward prefetch (16–32 blocks).
- Lowered the irregular ceiling underside to Y=128–140 and its continuous roof cap to Y=144.
- Moved the air-only sky-seal layer to Y=144 and changed its dynamic-property registry key so cells sealed at the former Y=319 are not incorrectly treated as already sealed.
- The seal uses meridian:fractured_slate and only fills air, preserving existing structures and player-placed non-air blocks in previously generated chunks.
- Adjusted sanctuary placement for the lower ceiling.
- Extended all regional air fog ranges to start at 80 and end at 220, with weather fog from 70 to 190, so the low ceiling can be seen at typical render distances.
- Bumped BP/RP versions to 1.0.2.

## Day/night limitation
The Bedrock World Clock API is world-scoped, not dimension-scoped. Pausing the built-in daylight clock would also stop the Overworld day/night cycle. This fix does not alter global time; the opaque Y=144 ceiling hides the changing sky from players inside the Abyss.

## Validation
- All changed fog and dimension JSON files parsed successfully.
- Static source checks confirmed the lower roof constants, new sky-seal registry, accelerated scan interval, two-worker queue, movement prefetch, and non-blocking entry path.
- Source checks are not a substitute for testing on the target retail Bedrock client. Verify first-entry travel, return travel, ceiling visibility, daylight leakage, falling at chunk borders, and mobile frame-time impact in-game.
