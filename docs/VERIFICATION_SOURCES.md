# The Ancient Abyss — Verification Sources & Rules

Persistent project source register. Update it whenever a phase relies on new APIs, schemas, or modder patterns.

## Runtime target and experiments
- Target the regular retail Minecraft Bedrock release chosen by the project owner. Do not require Minecraft Preview/Beta as the game client.
- The literal manifest dependency version "beta" for @minecraft/server means the Beta Script API track. It does not mean the Minecraft Preview game build.
- Enable the Beta APIs experiment in the retail world's Game Settings > Experiments when beta-track Script API features are used.
- Keep stable module dependencies stable where possible. Check peer dependencies and the target retail game's supported API versions before changing them.
- Minecraft product versions and Script API module versions are separate version tracks.

## Primary official sources
1. Microsoft Learn — Script Module Versioning
   https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/versioning?view=minecraft-bedrock-stable
2. Microsoft Learn — Experimental Features Toggle
   https://learn.microsoft.com/en-us/minecraft/creator/documents/experimentalfeaturestoggle?view=minecraft-bedrock-stable
3. Microsoft Learn — Script API reference
   https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/minecraft-server?view=minecraft-bedrock-stable
4. Microsoft Learn — ActionFormData
   https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/actionformdata?view=minecraft-bedrock-stable
5. Microsoft Learn — Working With Events
   https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/events?view=minecraft-bedrock-stable
6. Mojang — Bedrock Schemas
   https://github.com/Mojang/bedrock-schemas
7. Mojang — Bedrock Samples
   https://github.com/Mojang/bedrock-samples

## Established community/modder sources
1. Bedrock-OSS Bedrock Wiki — Scripting introduction and API versioning
   https://wiki.bedrock.dev/scripting/scripting-intro
   Cross-check API calls against Microsoft Learn.
2. Bedrock-OSS Bedrock Wiki — Trading behavior
   https://wiki.bedrock.dev/loot/trading-behavior
3. Rob-Keys — MC_Enchant_Mod
   https://github.com/Rob-Keys/MC_Enchant_Mod
   Demonstrates a scripted custom-enchantment framework; it is not a native engine enchantment registration API.
4. Justash01 — Item Editor
   https://github.com/Justash01/item-editor
   Demonstrates script-driven item abilities; use as a pattern only.
5. NetEase Chinese Edition references
   https://mc.163.com/dev/
   NetEase-only formats/APIs must not be copied into global Bedrock unless Mojang also supports the exact feature.

## Verification procedure for every phase
1. Read the exact PRD requirement and inspect all related repository files before editing.
2. Verify JSON against Mojang schemas and vanilla samples.
3. Verify API names, event payloads, method signatures, version tracks and execution restrictions against Microsoft Learn and target type definitions.
4. Compare patterns with established add-ons or open-source modder projects. Third-party code is supporting evidence, not an API contract.
5. Label claims as Officially verified, Modder reference, Inference, or Runtime untested.
6. Fetch every changed file after commit and validate the committed content.
7. Never claim in-game testing unless it was actually performed.
8. Preserve original BP/RP UUIDs, existing commands and unrelated phase behavior.
9. Never invent APIs, components, enchantment identifiers or JSON fields. If Bedrock lacks a native capability, use a clearly labelled script-based equivalent only when it has a real testable effect; otherwise document the limitation.

## Phase 23 source checks
- Action forms: Microsoft ActionFormData reference.
- Pylon interaction: Microsoft PlayerInteractWithBlockBeforeEvent reference.
- Inventory and equipment: Microsoft Container, EntityEquippableComponent, EquipmentSlot and ItemStack references.
- Custom item/block definitions: Mojang Bedrock Schemas and vanilla samples.
- Scripted enchantment pattern: Rob-Keys MC_Enchant_Mod and Justash01 Item Editor. These support script-driven effects, not native custom enchantment registration.

## Phase 21 — custom-dimension world generation references

### Official Microsoft / Mojang references
1. Microsoft Learn — Dimension components
   https://learn.microsoft.com/en-us/minecraft/creator/reference/content/dimensionreference/examples/dimensioncomponents/components?view=minecraft-bedrock-stable
   Confirms custom dimensions currently allow only the `void` generator and configure one `minecraft:default_biome` for the dimension.
2. Microsoft Learn — Dimension API
   https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/dimension?view=minecraft-bedrock-stable
   Reference for `Dimension.getBlock` and `Dimension.fillBlocks`, including unloaded-chunk/error behavior.
3. Microsoft Learn — World API
   https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/world?view=minecraft-bedrock-stable
   Confirms `World.seed` is a read-only string and exposes `tickingAreaManager`.
4. Microsoft Learn — TickingAreaManager API
   https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/tickingareamanager?view=minecraft-bedrock-stable
   Reference for temporary ticking areas, capacity checks, and cleanup.
5. Microsoft Learn — Game loops and timed callbacks
   https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/system-run-guide
   Explains `system.runJob` and generator-based time slicing for long-running tasks.
6. Microsoft Learn — Scripting performance
   https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/script-performance?view=minecraft-bedrock-stable
   Recommends granular work units and device-specific performance testing.
7. Microsoft Learn — Vanilla block listings
   https://learn.microsoft.com/en-us/minecraft/creator/reference/content/vanillalistingsreference/blocks?view=minecraft-bedrock-stable
   Confirms the vanilla `minecraft:barrier` block identifier used as a hidden completion marker.

### Community references (algorithmic guidance only)
1. Bedrock-OSS Bedrock Wiki — Dimensions
   https://wiki.bedrock.dev/world-generation/dimensions.html
   Cross-check for void-only custom dimensions and the role of the default biome.
2. Bedrock-OSS — World Generation Engine
   https://github.com/theaddonn/WGE
   Example of 16×16 chunk heightmaps, layered noise maps, biome selection, staged generation, and time-sliced jobs. This is an experimental community project; its README still lists biome implementation and performance work as TODO. It is not treated as a production-ready drop-in.
3. FonnyFofo — Minecraft Bedrock Custom Dimensions
   https://github.com/FonnyFofo/MinecraftBECustomDimensions
   Community example of scripted, deterministic terrain inside custom dimensions; use as design reference only and cross-check every API against Microsoft Learn.

### Phase 21 implementation rule
- The Ancient Abyss custom dimension remains a void-generator dimension with one default biome.
- Hadal Trenches, Hydrothermal Fissures, and Inverted Necropolis are scripted vertical strata, not three native engine biome IDs.
- Generate deterministically from the world seed, in small chunk-sized jobs, and keep a persistent completion marker that is written only after generation succeeds.
- Do not overwrite legacy generated chunks automatically; existing builds must be preserved. Evaluate the improved generator in a fresh test world.
- Static code/JSON verification is not a substitute for in-game testing on the supported retail Bedrock client with Beta APIs enabled.
