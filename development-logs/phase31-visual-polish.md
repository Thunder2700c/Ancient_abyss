# Phase 31 — Visual Polish & Asset Repair

## Scope
- Replace the 20 custom inventory icons with a coherent Minecraft-inspired pixel-art set.
- Rebuild the Echo Dweller's 64×64 texture atlas to match the geometry UV layout.
- Correct the Echo Dweller silhouette with a broader torso, thicker legs, defined feet, and a less extreme walk cycle.
- Correct the render-controller aliases to use the documented Geometry, Material, and Texture names.

## Changes
- Replaced all 20 custom item icons under resource_pack/textures/items/.
- Replaced resource_pack/textures/entity/echo_dweller/echo_dweller.png.
- Updated resource_pack/models/entity/echo_dweller.geo.json.
- Updated resource_pack/animations/echo_dweller.animation.json.
- Updated resource_pack/render_controllers/echo_dweller.render_controller.json.

## Verification
- Item icons are 32×32 RGBA PNGs; Echo Dweller atlas is 64×64 RGBA.
- Geometry, animation, and render-controller JSON parse successfully.
- UV rectangles fit inside the 64×64 atlas.
- Bone names in the walk animation match the geometry.
- Render-controller aliases match the documented client-entity keys.
- Source-level checks only. In-game rendering, held-item appearance, and animation still require Minecraft runtime testing.
