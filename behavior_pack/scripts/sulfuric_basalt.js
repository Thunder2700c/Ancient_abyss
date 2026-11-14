// NOT POSSIBLE IN BEDROCK: Block JSON cannot detect when a player is actively mining without sneaking, nor can it deal armor-piercing damage directly.
// Closest workaround: Server script monitors players standing on or breaking sulfuric basalt without sneaking, applying 4 armor-piercing magic damage per second and spawning steam particles.

import { world, system } from "@minecraft/server";

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const loc = player.location;
    const dim = player.dimension;

    const blockBelow = dim.getBlock({
      x: Math.floor(loc.x),
      y: Math.floor(loc.y - 0.1),
      z: Math.floor(loc.z)
    });

    if (!blockBelow || blockBelow.typeId !== "meridian:sulfuric_basalt") {
      continue;
    }

    dim.spawnParticle("meridian:sulfuric_steam", {
      x: blockBelow.location.x + 0.5,
      y: blockBelow.location.y + 1.0,
      z: blockBelow.location.z + 0.5
    });

    if (!player.isSneaking) {
      player.applyDamage(4, { cause: "magic" });
      player.playSound("random.fizz", { volume: 0.8, pitch: 0.8 });
    }
  }
}, 20);

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const { block, player } = event;
  if (block.typeId !== "meridian:sulfuric_basalt") return;

  if (!player.isSneaking) {
    system.run(() => {
      player.applyDamage(4, { cause: "magic" });
      player.playSound("random.fizz", { volume: 1.0, pitch: 0.6 });
      player.dimension.spawnParticle("meridian:sulfuric_steam", {
        x: block.location.x + 0.5,
        y: block.location.y + 1.0,
        z: block.location.z + 0.5
      });
    });
  }
});
