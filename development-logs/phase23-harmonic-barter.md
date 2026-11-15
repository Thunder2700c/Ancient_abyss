# Phase 23 — Harmonic Barter

## Rework status

**Source-verified implementation of the custom barter menu. Runtime testing remains required.**
This phase is not marked fully complete because two design effects in the PRD are not available through the documented add-on interfaces, and two trust-source integrations depend on other phases or an unimplemented structure.

## Implemented in this rework

- behavior_pack/scripts/trade_handler.js uses the documented ActionFormData API from @minecraft/server-ui.
- The menu presents all three Phase 23 exchanges:
  - 4 Amethyst Shards + 2 wool of any vanilla colour -> named leather boots, explicitly marked as a prototype.
  - 1 Calibrated Sculk Sensor + 4 Echo Shards -> meridian:abyssal_anchor.
  - 1 meridian:resonant_core + 16 Crying Obsidian -> meridian:abyss_upgrade_smithing_template.
- All three reward identifiers were checked against the current behavior pack item definitions.
- Material counts are checked across the player's inventory. Wool is matched by the actual vanilla item ID suffix _wool rather than an invented item identifier.
- Costs are checked again when the player selects a trade.
- The transaction snapshots the inventory, removes exact ingredient counts, and restores the original slot contents if the reward cannot be inserted.
- Creative-mode players receive the reward without ingredient consumption.
- The handler is registered through the Phase 22 Echo Dweller interaction hook already imported by startup.js.
- Arbitrary trust thresholds have been removed. The PRD defines trust gain but does not specify numerical barter-tier unlock thresholds; the UI displays trust without inventing those rules.

## Explicit limitations — not falsely marked complete

1. **Padded Treads acoustic enchantment: NOT IMPLEMENTED.** The documented ItemEnchantableComponent lets scripts add/remove recognised enchantments, but the public API does not expose a registration method for a new custom enchantment type. Nor is there a documented cancellable event for suppressing vanilla player-footstep sounds or their sculk vibrations. Tier I therefore awards clearly labelled prototype leather boots with lore explaining the missing effect; it does not claim to provide acoustic silence.
2. **Village pylon donations: NOT IMPLEMENTED.** The current pack tree has no village-pylon block definition or structure interaction. Phase 22 currently grants donation trust through Echo Dweller interaction; this is not represented as a completed pylon.
3. **Resonant Warden healing trust: DEFERRED TO PHASE 24.** The Resonant Warden is not yet implemented. Phase 22 already exports addTrust(player, amount); Phase 24 can call that function after a verified successful heal.
4. **Trust thresholds: UNSPECIFIED.** No 10/25 or other thresholds are imposed by this phase, because the specification does not state them.

## API/source verification

### Microsoft / Mojang official sources

- @minecraft/server-ui.ActionFormData: constructor, title, body, button, and show(player); the response exposes canceled and selection.
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/actionformdata?view=minecraft-bedrock-stable
- Player.getGameMode() returns a GameMode; inventory is accessed through EntityComponentTypes.Inventory.
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/player?view=minecraft-bedrock-stable
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/entityinventorycomponent?view=minecraft-bedrock-stable
- Container.size, getItem, setItem, and addItem are documented; ItemStack.clone(), amount, nameTag, and setLore() are documented.
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/container?view=minecraft-bedrock-experimental
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemstack?view=minecraft-bedrock-stable
- ItemEnchantableComponent supports applying and reading enchantment types, but the published interface has no custom-enchantment registration operation.
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server/itemenchantablecomponent?view=minecraft-bedrock-stable
- The current manifest still requests @minecraft/server on the Beta channel and @minecraft/server-ui 2.0.0. Microsoft lists server-ui 2.0.0 as an available module version and documents its server 2.0.0 peer dependency. The user's actual 1.26.52.3 runtime must still load-test this exact dependency pair.
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/minecraft-server-ui?view=minecraft-bedrock-stable
  - https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-ui/changelog?view=minecraft-bedrock-stable

### Modder and add-on reference cross-check

- Bedrock-OSS Bedrock Wiki documents the native Bedrock entity-trading pattern: minecraft:behavior.trade_with_player plus minecraft:trade_table / minecraft:economy_trade_table, attached through a component group and referencing a trade-table JSON.
  - https://wiki.bedrock.dev/loot/trading-behavior
- Mojang's own Bedrock Samples contains live vanilla trade-table JSON in behavior_pack/trading/economy_trades/butcher_trades.json. This confirms the real trade-table data format and the native alternative; Phase 23 retains a scripted ActionFormData menu because the phase explicitly asks for a custom menu.
  - https://github.com/Mojang/bedrock-samples/blob/main/behavior_pack/trading/economy_trades/butcher_trades.json
- These sources validate actual Bedrock systems and schemas. No proprietary pack code or assets were copied.

## Validation performed

- [ ] In-game test on Bedrock 1.26.52.3 with Experiments enabled
- [ ] Multiplayer / simultaneous trade attempts
- [ ] Full-inventory rollback
- [ ] Each cost/reward in Survival and Creative
- [ ] Confirm form availability when another UI is open
- [ ] Confirm the selected wool variants are accepted

Source inspection and static checks are not substitutes for those runtime tests.

## Files changed by this rework

- behavior_pack/scripts/trade_handler.js
- development-logs/phase23-harmonic-barter.md

The behavior-pack UUIDs, existing commands, and other phase files were not changed.
