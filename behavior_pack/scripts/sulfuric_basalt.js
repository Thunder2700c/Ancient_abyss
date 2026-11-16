// Phase 13 — Sulfuric Basalt hazard.
// The Script API has no dedicated thermal/armor-piercing damage source or continuous
// block-mining progress event. The closest workable path is magic damage on contact
// and on block-hit events, rate-limited to one hit per player per second.
//
// Runtime armor interaction still needs in-game verification; this does not claim
// a native thermal damage type.

import { world, system } from "@minecraft/server";

const BASALT_ID = "meridian:sulfuric_basalt";
const DAMAGE_PER_SECOND = 4;
const DAMAGE_INTERVAL_TICKS = 20;
const lastDamageTick = new Map();

function applyBasaltHazard(player, block) {
  if (player.isSneaking) {
    return;
  }

  const now = system.currentTick;
  const last = lastDamageTick.get(player.id) ?? -DAMAGE_INTERVAL_TICKS;
  if (now - last < DAMAGE_INTERVAL_TICKS) {
    return;
  }
  lastDamageTick.set(player.id, now);

  player.applyDamage(DAMAGE_PER_SECOND, { cause: "magic" });
  try {
    player.playSound("random.fizz", { volume: 0.8, pitch: 0.8 });
    block.dimension.spawnParticle("meridian:sulfuric_steam", {
      x: block.location.x + 0.5,
      y: block.location.y + 1.0,
      z: block.location.z + 0.5
    });
  } catch (error) {
    console.warn("[meridian] Sulfuric Basalt contact effects failed: " + error);
  }
}

// Standing contact hazard.
system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const loc = player.location;
      const blockBelow = player.dimension.getBlock({
        x: Math.floor(loc.x),
        y: Math.floor(loc.y - 0.1),
        z: Math.floor(loc.z)
      });
      if (blockBelow?.typeId !== BASALT_ID) {
        continue;
      }

      if (!player.isSneaking) {
        try {
          blockBelow.dimension.spawnParticle("meridian:sulfuric_steam", {
            x: blockBelow.location.x + 0.5,
            y: blockBelow.location.y + 1.0,
            z: blockBelow.location.z + 0.5
          });
        } catch (error) {
          // Particle failure must not stop the damage scan.
        }
        applyBasaltHazard(player, blockBelow);
      }
    } catch (error) {
      console.warn("[meridian] Sulfuric Basalt scan skipped " + player.name + ": " + error);
    }
  }
}, DAMAGE_INTERVAL_TICKS);

// Mining/hitting hazard: deal the same 4 damage at most once per second while the
// player repeatedly hits a Sulfuric Basalt block without sneaking.
world.afterEvents.entityHitBlock.subscribe((event) => {
  const player = event.damagingEntity;
  const block = event.hitBlock;
  if (player.typeId !== "minecraft:player" || block.typeId !== BASALT_ID) {
    return;
  }
  applyBasaltHazard(player, block);
});

world.afterEvents.playerLeave.subscribe((event) => {
  lastDamageTick.delete(event.playerId);
});
