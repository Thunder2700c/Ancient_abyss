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
