// NOT POSSIBLE IN BEDROCK: A custom block cannot subtract exactly two levels from the
// block-light field around itself. minecraft:light_dampening affects light passing through
// the block, not neighboring blocks. This script is a player-vision approximation only:
// Darkness is refreshed while a player is within a 3-block spherical radius of gloomstone.

import { world, system } from "@minecraft/server";

const GLOOMSTONE_ID = "meridian:gloomstone";
const EFFECT_RADIUS_SQUARED = 9;

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    try {
      const loc = player.location;
      const dim = player.dimension;
      const px = Math.floor(loc.x);
      const py = Math.floor(loc.y);
      const pz = Math.floor(loc.z);
      let nearGloomstone = false;

      for (let dx = -3; dx <= 3 && !nearGloomstone; dx++) {
        for (let dy = -3; dy <= 3 && !nearGloomstone; dy++) {
          for (let dz = -3; dz <= 3 && !nearGloomstone; dz++) {
            if (dx * dx + dy * dy + dz * dz > EFFECT_RADIUS_SQUARED) {
              continue;
            }
            const block = dim.getBlock({ x: px + dx, y: py + dy, z: pz + dz });
            if (block?.typeId === GLOOMSTONE_ID) {
              nearGloomstone = true;
            }
          }
        }
      }

      if (nearGloomstone) {
        player.addEffect("darkness", 40, { amplifier: 0, showParticles: false });
      }
    } catch (error) {
      console.warn("[meridian] Gloomstone scan skipped " + player.name + ": " + error);
    }
  }
}, 20);
