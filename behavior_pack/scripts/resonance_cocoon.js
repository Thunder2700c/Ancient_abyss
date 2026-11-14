// NOT POSSIBLE IN BEDROCK: Block JSON cannot natively alter bed explosion physics across custom dimensions or decrement custom respawn point charges.
// Closest workaround: Server script intercepts bed/anchor usage in Ancient Abyss to execute explosions, handles Cocoon charging with Echo Shards, executes inward sonic implosions outside the Abyss, and cleanses players setting spawn.

import { world, system, EquipmentSlot } from "@minecraft/server";

function getCocoonKey(block) {
  return `cocoon_charges_${block.location.x}_${block.location.y}_${block.location.z}`;
}

world.beforeEvents.itemUseOn.subscribe((event) => {
  const { block, player, itemStack } = event;
  const dim = player.dimension;

  // Cross-Dimensional Rejection: Beds in Ancient Abyss
  if (dim.id === "meridian:ancient_abyss" && block.typeId.includes("bed")) {
    event.cancel = true;
    system.run(() => {
      block.setType("minecraft:air");
      dim.createExplosion(block.location, 5, { causesFire: false, breaksBlocks: true });
      player.sendMessage("§1[Dimensional Rejection]§r §7The crushing silence shatters the wood.");
    });
    return;
  }

  // Cross-Dimensional Rejection: Nether Respawn Anchor in Ancient Abyss
  if (dim.id === "meridian:ancient_abyss" && block.typeId === "minecraft:respawn_anchor") {
    event.cancel = true;
    system.run(() => {
      block.setType("minecraft:air");
      dim.createExplosion(block.location, 6, { causesFire: true, breaksBlocks: true });
      player.sendMessage("§1[Dimensional Rejection]§r §7The cryogenic chill violently rejects the Nether's core.");
    });
    return;
  }

  // Resonance Cocoon Activation Logic
  if (block.typeId === "meridian:resonance_cocoon") {
    event.cancel = true;

    // Cross-Dimensional Explosion Matrix: Implosion outside Abyss
    if (dim.id !== "meridian:ancient_abyss") {
      system.run(() => {
        const center = {
          x: block.location.x + 0.5,
          y: block.location.y + 0.5,
          z: block.location.z + 0.5
        };

        dim.spawnParticle("meridian:cocoon_implosion", center);
        dim.playSound("warden.sonic_boom", center, { volume: 2.0, pitch: 0.3 });
        dim.playSound("respawn_anchor.deplete", center, { volume: 2.0, pitch: 0.5 });

        const nearbyEntities = dim.getEntities({
          location: center,
          maxDistance: 12
        });

        for (const entity of nearbyEntities) {
          const loc = entity.location;
          const diffX = center.x - loc.x;
          const diffZ = center.z - loc.z;
          const dist = Math.hypot(diffX, diffZ) || 1;

          entity.applyKnockback({
            x: (diffX / dist) * 1.8,
            z: (diffZ / dist) * 1.8
          }, -0.5);

          if (entity.typeId === "minecraft:player") {
            entity.addEffect("darkness", 300, { amplifier: 0, showParticles: false });
            entity.addEffect("nausea", 300, { amplifier: 0, showParticles: false });
            entity.sendMessage("§5[Implosion]§r §7Atmospheric decompression triggers a devastating vacuum rupture!");
          }
        }

        system.runTimeout(() => {
          block.setType("minecraft:air");
          dim.createExplosion(center, 4, { causesFire: false, breaksBlocks: true });
        }, 20);
      });
      return;
    }

    // Inside Ancient Abyss: Fuel or Spawn Set
    system.run(() => {
      const chargeKey = getCocoonKey(block);
      let charges = world.getDynamicProperty(chargeKey) ?? 0;

      // Charge with Echo Shard
      if (itemStack && itemStack.typeId === "minecraft:echo_shard") {
        if (charges < 4) {
          charges += 1;
          world.setDynamicProperty(chargeKey, charges);

          const equippable = player.getComponent("minecraft:equippable");
          if (equippable && player.getGameMode() !== "creative") {
            if (itemStack.amount > 1) {
              itemStack.amount -= 1;
              equippable.setEquipment(EquipmentSlot.Mainhand, itemStack);
            } else {
              equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
            }
          }

          dim.playSound("respawn_anchor.charge", block.location, { volume: 1.0, pitch: 1.2 });
          player.sendMessage(`§b[Resonance Cocoon]§r §7Charged: §e${charges}/4§7 Echo Shards.`);
          return;
        } else {
          player.sendMessage("§b[Resonance Cocoon]§r §7The Cocoon is fully pressurized (4/4).");
          return;
        }
      }

      // Interaction to set spawn and cleanse
      if (charges > 0) {
        player.setSpawnPoint({
          dimension: dim,
          x: block.location.x,
          y: block.location.y + 1,
          z: block.location.z
        });

        player.removeEffect("darkness");
        player.removeEffect("blindness");
        player.removeEffect("slowness");

        player.addEffect("regeneration", 600, { amplifier: 1, showParticles: true });
        player.addEffect("absorption", 600, { amplifier: 0, showParticles: true });

        player.playSound("beacon.activate", block.location, { volume: 1.0, pitch: 0.8 });
        player.sendMessage("§b[Bio-Sanctuary]§r §7Pressurized resonance cleanses your afflictions and anchors your soul.");

        player.setDynamicProperty("active_cocoon_key", chargeKey);
      } else {
        player.sendMessage("§c[Resonance Cocoon]§r §7The Cocoon is depleted. Insert Echo Shards to establish a spawn anchor.");
      }
    });
  }
});

world.afterEvents.playerSpawn.subscribe((event) => {
  const { player, initialSpawn } = event;
  if (initialSpawn) return;

  const activeKey = player.getDynamicProperty("active_cocoon_key");
  if (!activeKey) return;

  let charges = world.getDynamicProperty(activeKey) ?? 0;
  if (charges > 0) {
    charges -= 1;
    world.setDynamicProperty(activeKey, charges);
    player.sendMessage(`§b[Resonance Cocoon]§r §7Spawn anchor consumed. Remaining charges: §e${charges}/4§7.`);
    if (charges === 0) {
      player.setDynamicProperty("active_cocoon_key", undefined);
      player.sendMessage("§c[Resonance Cocoon]§r §7Your anchor has exhausted all charges. Next death will revert to the surface.");
    }
  }
});
