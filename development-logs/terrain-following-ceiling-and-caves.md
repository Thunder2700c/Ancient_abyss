# Terrain-following ceiling and cave systems

- Replaced the fixed Y=128–140 visible ceiling underside with a deterministic terrain-following underside.
- The visible roof maintains a 40–60 block vertical clearance above the local top surface in all four scripted biomes; the opaque roof mass still joins the Y=144 sky-seal cap.
- Rebased hydrothermal fissure walls and sulfuric black smokers on local terrain height and capped them below the local roof.
- Expanded the former two short cave passages into a multi-level system with broad rounded caverns, winding main passages, thinner noodle-style branches, occasional lower chambers, and vertical connectors.
- Added deterministic cave portals that align across neighbouring chunk borders. Edge carving remains clipped to the chunk currently being generated.
- Cave passages reach the upper underground band near the surface as well as deeper strata, while preserving a 5-block stone buffer under the surface.
- Existing V1/V2 completion markers are unchanged. Previously generated chunks are skipped, so the new roof and caves apply to newly generated chunks only.
- Removed the old sanctuary placement cutoff tied to the previous high ceiling; sanctuaries now follow the terrain-relative roof.
- Pack versions remain 1.0.4.

## Validation
Static source and repository review only. Bedrock retail runtime, cave appearance/connectivity, chunk seam quality, and mobile generation performance still require in-game testing.
