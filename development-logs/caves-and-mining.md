# Caves and Mining

- Added two deterministic winding underground cave passages to each newly generated chunk.
- Added biome-hosted ore seams: Abyssal Iron Ore (raw iron), Abyssal Gold Ore (raw gold), and biome-specific Abyssalite Ore (Raw Abyssal Silt).
- The ore pool intentionally excludes diamond, emerald, coal, lapis, redstone, and all other vanilla ores.
- Added four original 16×16 pixel-art Abyssalite ore textures, each palette-matched to its biome: teal/cyan Garden, slate-blue Shelf, ember Caldera, and violet Necropolis. Iron and gold retain familiar vanilla ore textures.
- BP/RP version: 1.0.4.

## Terrain persistence
The existing V2 and legacy chunk-completion markers remain unchanged. Chunks already generated/discovered by this pack are skipped, so this update does not carve caves into, replace, or re-ore existing terrain. New caves and ore veins appear only in chunks first generated after the update.

## Validation
Static source and JSON review only. Bedrock retail runtime, mining drops, cave appearance, and texture rendering still need in-game testing.
