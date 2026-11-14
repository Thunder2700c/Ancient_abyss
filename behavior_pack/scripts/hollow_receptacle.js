// NOT POSSIBLE IN BEDROCK: Native Trial Vault components cannot be configured via custom block JSON to filter arbitrary custom key items or trigger scripted multi-entity dimensional ejections.
// Closest workaround: Server script intercepts item interaction on meridian:hollow_receptacle with meridian:heart_of_herobrine, initiates reality-tearing lightning, resurrects Herobrine, triggers the Survivor's amnesiac loop, and ejects all players back to their spawn point.

import { world, system, EquipmentSlot } from "@minecraft/server";

world.beforeEvents.itemUseOn.subscribe((event) => {
  const { block, player, itemStack } = event;

  if (block.typeId !== "meridian:hollow_receptacle") return;

  event.cancel = true;

  if (!itemStack || itemStack.typeId !== "meridian:heart_of_herobrine") {
    system.run(() => {
      player.sendMessage("§5[The Hollow Receptacle]§r §7The receptacle remains sealed. It demands the Heart of Herobrine.");
      player.playSound("respawn_anchor.deplete", { volume: 0.8, pitch: 0.5 });
    });
    return;
  }

  system.run(() => {
    const dim = player.dimension;
    const center = {
      x: block.location.x + 0.5,
      y: block.location.y + 0.5,
      z: block.location.z + 0.5
    };

    // Consume the Heart of Herobrine
    const equippable = player.getComponent("minecraft:equippable");
    if (equippable && player.getGameMode() !== "creative") {
      equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    }

    // Audio-visual reality tear
    dim.spawnParticle("meridian:hollow_receptacle_tear", center);
    dim.playSound("ambient.cave", center, { volume: 2.0, pitch: 0.1 });
    dim.playSound("warden.sonic_boom", center, { volume: 2.0, pitch: 0.4 });

    try {
      dim.spawnEntity("minecraft:lightning_bolt", center);
    } catch (e) {
      // Lightning spawn protection
    }

    world.sendMessage("§4§l[REALITY TEAR]§r §cThe Heart snaps shut inside the receptacle. The eternal loop resets!");

    // Resurrect Herobrine
    world.setDynamicProperty("herobrine_alive", true);
    world.setDynamicProperty("herobrine_in_combat", false);

    try {
      dim.spawnEntity("meridian:herobrine", {
        x: center.x,
        y: center.y + 1.0,
        z: center.z
      });
    } catch (e) {
      // Entity spawn safety fallback
    }

    // Reset Survivor Amnesiac Loop
    world.setDynamicProperty("survivor_defeated", false);
    world.setDynamicProperty("survivor_yielded", false);

    // Eject all players in the Ancient Abyss back to their spawn point after 30 ticks
    system.runTimeout(() => {
      const abyssPlayers = dim.getPlayers();
      for (const p of abyssPlayers) {
        p.addEffect("blindness", 60, { amplifier: 0, showParticles: false });
        p.addEffect("darkness", 100, { amplifier: 0, showParticles: false });
        p.playSound("respawn_anchor.deplete", { volume: 2.0, pitch: 0.6 });

        const spawn = p.getSpawnPoint();
        if (spawn) {
          p.teleport(
            { x: spawn.x, y: spawn.y, z: spawn.z },
            { dimension: spawn.dimension, checkForBlocks: false }
          );
        } else {
          const overworld = world.getDimension("minecraft:overworld");
          if (overworld) {
            p.teleport(
              { x: 0, y: 72, z: 0 },
              { dimension: overworld, checkForBlocks: false }
            );
          }
        }
        p.sendMessage("§4[Temporal Ejection]§r §7Reality violently snaps shut, casting you out of the abyss!");
      }
    }, 30);
  });
});
