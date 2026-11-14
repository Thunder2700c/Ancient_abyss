import { world, system } from "@minecraft/server";

const TRANSIT_COOLDOWN_TICKS = 80;

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const loc = player.location;
    const dimension = player.dimension;

    const blockFeet = dimension.getBlock({
      x: Math.floor(loc.x),
      y: Math.floor(loc.y),
      z: Math.floor(loc.z)
    });

    const blockWaist = dimension.getBlock({
      x: Math.floor(loc.x),
      y: Math.floor(loc.y + 0.9),
      z: Math.floor(loc.z)
    });

    const isInsidePortal =
      (blockFeet && blockFeet.typeId === "meridian:abyssal_portal") ||
      (blockWaist && blockWaist.typeId === "meridian:abyssal_portal");

    if (!isInsidePortal) {
      continue;
    }

    const currentTick = system.currentTick;
    const lastTransit = player.getDynamicProperty("portal_transit_tick") ?? 0;

    if (currentTick - lastTransit < TRANSIT_COOLDOWN_TICKS) {
      continue;
    }

    player.setDynamicProperty("portal_transit_tick", currentTick);

    dimension.spawnParticle("meridian:abyssal_portal_particle", {
      x: loc.x,
      y: loc.y + 1.0,
      z: loc.z
    });

    player.addEffect("darkness", 100, { amplifier: 0, showParticles: false });
    player.playSound("ambient.cave", { volume: 1.0, pitch: 0.5 });
    player.playSound("respawn_anchor.deplete", { volume: 1.0, pitch: 0.7 });

    system.runTimeout(() => {
      try {
        if (dimension.id === "minecraft:overworld") {
          const abyssDim = world.getDimension("meridian:ancient_abyss");
          if (abyssDim) {
            player.teleport(
              { x: Math.floor(loc.x / 16), y: 32, z: Math.floor(loc.z / 16) },
              { dimension: abyssDim, checkForBlocks: false }
            );
            player.sendMessage("§5[The Ancient Abyss]§r §7The crushing hadal void pulls you into hyperspace...");
          }
        } else if (dimension.id === "meridian:ancient_abyss") {
          const overworldDim = world.getDimension("minecraft:overworld");
          if (overworldDim) {
            player.teleport(
              { x: Math.floor(loc.x * 16), y: -50, z: Math.floor(loc.z * 16) },
              { dimension: overworldDim, checkForBlocks: false }
            );
            player.sendMessage("§3[Overworld]§r §7You decompress through the ancient gate.");
          }
        }
      } catch (err) {
        // Safe dimension resolution fallback
      }
    }, 20);
  }
}, 4);
