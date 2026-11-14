// NOT POSSIBLE IN BEDROCK: Custom block JSON cannot dynamically alter or reduce the external light level emitted by neighboring blocks.
// Closest workaround: Server tick loop scans a 3-block radius around players for gloomstone and applies Darkness to simulate local light absorption.

import { world, system } from "@minecraft/server";

system.runInterval(() => {
  for (const player of world.getAllPlayers()) {
    const loc = player.location;
    const dim = player.dimension;
    const px = Math.floor(loc.x);
    const py = Math.floor(loc.y);
    const pz = Math.floor(loc.z);

    let nearGloomstone = false;

    for (let dx = -3; dx <= 3 && !nearGloomstone; dx++) {
      for (let dy = -2; dy <= 2 && !nearGloomstone; dy++) {
        for (let dz = -3; dz <= 3 && !nearGloomstone; dz++) {
          const block = dim.getBlock({ x: px + dx, y: py + dy, z: pz + dz });
          if (block && block.typeId === "meridian:gloomstone") {
            nearGloomstone = true;
          }
        }
      }
    }

    if (nearGloomstone) {
      player.addEffect("darkness", 40, { amplifier: 0, showParticles: false });
    }
  }
}, 20);
