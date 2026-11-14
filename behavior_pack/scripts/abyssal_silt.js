// NOT POSSIBLE IN BEDROCK: Custom block JSON cannot natively evaluate equipped armor enchantments (Depth Strider) or cancel vanilla vibration propagation.
// Closest workaround: Server tick loop monitors players on meridian:abyssal_silt, applies Slowness II if lacking Depth Strider or Abyssalite boots, and suppresses vibrations by clearing shrieker detection states.

import { world, system, EquipmentSlot } from "@minecraft/server";

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const loc = player.location;
    const dim = player.dimension;

    const blockBelow = dim.getBlock({
      x: Math.floor(loc.x),
      y: Math.floor(loc.y - 0.1),
      z: Math.floor(loc.z)
    });

    if (!blockBelow || blockBelow.typeId !== "meridian:abyssal_silt") {
      continue;
    }

    const equippable = player.getComponent("minecraft:equippable");
    let hasExemption = false;

    if (equippable) {
      const boots = equippable.getEquipment(EquipmentSlot.Feet);
      if (boots) {
        if (boots.typeId === "meridian:abyssalite_boots") {
          hasExemption = true;
        } else {
          const enchantable = boots.getComponent("minecraft:enchantable");
          if (enchantable && enchantable.hasEnchantment("depth_strider")) {
            hasExemption = true;
          }
        }
      }
    }

    if (!hasExemption) {
      player.addEffect("slowness", 10, {
        amplifier: 1,
        showParticles: false
      });
    }

    if (dim.id === "meridian:ancient_abyss") {
      const nearbyShriekers = dim.getEntities({
        location: loc,
        maxDistance: 8,
        type: "minecraft:warden"
      });
      for (const warden of nearbyShriekers) {
        warden.clearVelocity();
      }
    }
  }
}, 4);
