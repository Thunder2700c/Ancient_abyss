// NOT POSSIBLE IN BEDROCK: Script API does not expose a supported way to cancel vanilla vibration propagation from a custom block.
// Closest honest implementation: monitor players standing on silt and apply Slowness III (about 45% slower) unless their boots provide Depth Strider or are Abyssalite. Exact 40% movement tuning and vibration dampening are not exposed by the supported block/API controls.

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
        amplifier: 2,
        showParticles: false
      });
    }

  }
}, 4);
