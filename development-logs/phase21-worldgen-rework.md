# Phase 21 — Scripted Strata World-Generation Rework

**Status:** Source rewrite committed; in-game validation pending  
**Target:** Retail Minecraft Bedrock with the world's Beta APIs experiment enabled

## Why the previous generator was replaced

The previous `strata.js` sampled the floor in 4×4 block cells, producing obvious square terraces. Its noise used fixed seeds, so every world received the same layout. The fissure layer had only a few crude rectangular towers, and the ceiling was a largely uniform slab. Its bedrock completion marker was placed at the beginning of chunk generation, which meant an interrupted job could make an incomplete chunk look finished.

The separate `biome_strata.js` script was not imported by `startup.js`. It attempted a huge one-time volume fill, with millions of individual block operations, and did not generate three meaningful landscapes. It has been removed rather than left as misleading dead code.

## Replacement

`behavior_pack/scripts/strata.js` was rebuilt while preserving the public exports used by other modules:

- `registerProtectedCenter(x, z)`
- `ensureTerrainAround(dimension, x, z, radiusChunks)`
- `initStrata()`

### Hadal Trenches — Y -64 to 24
- World-seed-derived multi-scale noise produces rolling basins, trench cuts and shelves.
- Surface sampling uses 2×2 tiles instead of 4×4 blocks to reduce the visible grid-step effect.
- Abyssal Silt remains the dominant surface; Fractured Slate forms occasional shelves.
- Glow Polyps and Tendril Coral are distributed using deterministic ecology noise.

### Hydrothermal Fissures — Y 30 to 120
- Noise-selected basalt ridges create broken vertical fissure walls.
- Chunk-seeded black-smoker chimneys use stepped silhouettes, Sulfuric Basalt and Gloomstone.
- The vertical band is no longer an empty gap between the floor and ceiling.

### Inverted Necropolis — upper ceiling strata
- The underside is sampled independently to create an undulating ceiling.
- Petrified Gloom-Roots form the lower ceiling skin, with Fractured Slate above.
- Tapered hanging roots/stalactites and rare inverted brick cathedrals add landmarks.
- The Phase 22 Soundproof Sanctuary generation hook remains connected.

## Performance and safety changes

- Terrain is generated near players in 16×16 chunks, not as a multi-million-block region on first entry.
- The generator is deterministic per world seed and uses `system.runJob` with yields between small block-fill operations.
- Chunk queue size is bounded and duplicate requests are coalesced.
- Ticking-area capacity is checked before generation, and temporary areas are removed in `finally`.
- Failed chunks are not marked complete; retries use backoff.
- The V2 barrier completion marker is written only after terrain and structures finish.
- The V1 bedrock marker coordinate is deliberately left untouched until the V2 marker exists, so a failed V2 attempt is not mistaken for a legacy chunk.
- Existing V1-generated chunks are detected and preserved. They are not destructively regenerated because that could erase player builds.
- Spawn protection and the existing `ensureTerrainAround` / transit integration remain intact.

## Bedrock limitations

This is still a scripted approximation. The custom-dimension component documentation currently specifies the `void` generator and one `minecraft:default_biome` for the custom dimension. The three names in the design are therefore vertical scripted strata, not three native biome IDs with engine-driven noise generation.

The black-smoker forms are static terrain structures in this pass; continuous steam/particle ambience and native biome transitions are not claimed as implemented.

## Verification

- Local JavaScript syntax check: passed with Node.js 22.
- Committed `strata.js` fetched back from GitHub; its three expected exports and preserved imports were confirmed.
- `startup.js` still imports and calls `initStrata()`.
- `transit.js` still imports `ensureTerrainAround` and `registerProtectedCenter`.
- The original pack manifests, UUIDs, dimension ID and block IDs were not changed.
- Official API/source references added to `docs/VERIFICATION_SOURCES.md`.

**Not verified:** Minecraft runtime loading, mobile frame-time impact, block placement behavior in-game, actual landscape appearance, or old-world migration. A fresh test world is required to inspect the new terrain because old generated chunks are intentionally preserved.
