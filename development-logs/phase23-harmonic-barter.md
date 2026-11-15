# Phase 23 — Harmonic Barter

## Status
Feature implementation expanded and source-checked. In-game testing on the target retail Bedrock client is still pending.

## Implemented
- Custom ActionFormData trade menu with all three PRD barter tiers.
- Inventory costs are counted across slots and rechecked on selection.
- Inventory snapshots are restored if reward insertion fails.
- Creative mode does not consume ingredients.
- Tier II and III rewards use existing custom item identifiers.

## Padded Treads
- New custom wearable: meridian:padded_treads.
- Tier I returns this custom item rather than renamed vanilla leather boots.
- The item has feet-slot wearable, durability, enchantability and glint components.
- Script checks the Feet equipment slot every 10 ticks.
- While worn, the player receives the meridian:padded_treads tag.
- While worn and sneaking, the player receives refreshed Speed I with hidden particles.
- This is a scripted passive/custom-enchantment-like ability, not a native engine enchantment registration.
- The tag is exported through isPaddedTreadsActive() for later Ancient Abyss entity AI.

## Resonant Village Pylon
- New custom block: meridian:harmonic_pylon.
- Interaction accepts one Amethyst Shard (+1 trust), Echo Shard (+2 trust), or any vanilla Wool (+0.5 trust).
- Item type and selected inventory slot are rechecked before consumption.
- The before-interaction event is cancelled and held-button repeats are ignored.
- The block reuses Resonance Ward textures until dedicated pylon art is supplied.
- This is a donation station, not a generated village structure; a survival crafting recipe remains unspecified.

## Limitations
1. Vanilla sculk vibration suppression is not implemented. The verified public API surface does not expose a cancellable event for vanilla footstep vibration emission. Padded Treads currently grants a scripted sneaking-speed passive and tag; do not claim vanilla sculk sensors are bypassed.
2. Native custom enchantment registration is not implemented. ItemEnchantableComponent adds/removes recognized enchantment types; it does not register new enchantment IDs. The scripted effect follows a documented community pattern for custom abilities.
3. Warden-healing trust is deferred to Phase 24. addTrust(player, amount) is the integration point.
4. The PRD does not define barter unlock thresholds; none are added to the barter menu.
5. The pylon has no survival recipe or generated village placement yet.

## API/source verification
- Microsoft Script Module Versioning explains the stable and Beta Script API tracks and the Beta APIs world experiment.
- Microsoft ActionFormData documentation supports the custom trade UI and response handling.
- Microsoft PlayerInteractWithBlockBeforeEvent documents block, player, itemStack, cancel and isFirstEvent.
- Microsoft EntityEquippableComponent documentation demonstrates EntityComponentTypes.Equippable, EquipmentSlot.Feet and getEquipment.
- Microsoft ItemEnchantableComponent documents methods for recognized enchantments but no custom enchantment registration method.
- Mojang Bedrock Schemas and Bedrock Samples are the reference for custom item/block JSON.
- Bedrock-OSS trading behavior documents native trade-table patterns.
- Rob-Keys MC_Enchant_Mod and Justash01 Item Editor are community examples of script-driven custom item abilities; they are not native enchantment registration APIs.

## Source URLs
- https://learn.microsoft.com/en-us/minecraft/creator/documents/scripting/versioning?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/documents/experimentalfeaturestoggle?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/actionformdata?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/playerinteractwithblockbeforeevent?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityequippablecomponent?view=minecraft-bedrock-stable
- https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemenchantablecomponent?view=minecraft-bedrock-stable
- https://github.com/Mojang/bedrock-schemas
- https://github.com/Mojang/bedrock-samples
- https://wiki.bedrock.dev/loot/trading-behavior
- https://github.com/Rob-Keys/MC_Enchant_Mod
- https://github.com/Justash01/item-editor

## Validation checklist
- [ ] Retail Bedrock client loads the pack.
- [ ] Beta APIs experiment is enabled in the retail world for the manifest's @minecraft/server beta dependency.
- [ ] Pylon appears in creative inventory and can be placed.
- [ ] Pylon accepts valid offerings and consumes exactly one item in Survival.
- [ ] Pylon donations do not consume items in Creative.
- [ ] Padded Treads can be equipped in Feet slot.
- [ ] Padded Treads grants Speed I only while sneaking and wearing the boots.
- [ ] Removing boots clears the tag on the next update.
- [ ] All three trades work with enough materials and fail safely with insufficient materials or full inventory.
- [ ] Multiplayer testing confirms inventory isolation.

Static source verification is not a substitute for in-game testing.
