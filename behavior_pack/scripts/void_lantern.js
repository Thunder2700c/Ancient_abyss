// NOT POSSIBLE IN BEDROCK: Custom block JSON has no native mob spawn denial component or radius blocker.
// Closest workaround: Server tick loop scans player surroundings, identifies meridian:void_lantern blocks, repels/despawns hostile mobs within 16 blocks, and emits ambient spark particles.

import { world, system } from "@minecraft/server";

const SCAN_RADIUS = 16;
const HOSTILE_MOBS = [
  "minecraft:zombie",
  "minecraft:skeleton",
  "minecraft:creeper",
  "minecraft:spider",
  "minecraft:witch",
  "minecraft:enderman",
  "minecraft:phantom",
  "minecraft:stray"
];

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const pLoc = player.location;
    const dim = player.dimension;
    const px = Math.floor(pLoc.x);
    const py = Math.floor(pLoc.y);
    const pz = Math.floor(pLoc.z);

    const activeLanterns = [];

    for (let dx = -SCAN_RADIUS; dx <= SCAN_RADIUS; dx += 4) {
      for (let dy = -8; dy <= 8; dy += 4) {
        for (let dz = -SCAN_RADIUS; dz <= SCAN_RADIUS; dz += 4) {
          const block = dim.getBlock({ x: px + dx, y: py + dy, z: pz + dz });
          if (block && block.typeId === "meridian:void_lantern") {
            activeLanterns.push(block.location);
          }
        }
      }
    }

    for (const lanternLoc of activeLanterns) {
      dim.spawnParticle("meridian:void_lantern_sparks", {
        x: lanternLoc.x + 0.5,
        y: lanternLoc.y + 0.5,
        z: lanternLoc.z + 0.5
      });

      for (const mobType of HOSTILE_MOBS) {
        const entities = dim.getEntities({
          location: { x: lanternLoc.x + 0.5, y: lanternLoc.y + 0.5, z: lanternLoc.z + 0.5 },
          maxDistance: SCAN_RADIUS,
          type: mobType
        });

        for (const mob of entities) {
          const mLoc = mob.location;
          const diffX = mLoc.x - (lanternLoc.x + 0.5);
          const diffZ = mLoc.z - (lanternLoc.z + 0.5);
          const dist = Math.hypot(diffX, diffZ) || 1;

          mob.applyKnockback({
            x: diffX / dist,
            z: diffZ / dist,
            horizontalStrength: 0.8,
            verticalStrength: 0.2
          });
        }
      }
    }
  }
}, 20);
