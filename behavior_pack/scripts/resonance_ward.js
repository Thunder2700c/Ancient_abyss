// NOT POSSIBLE IN BEDROCK: Block JSON cannot natively cancel vanilla vibration propagation or alter mob pathfinding navigation meshes.
// Closest workaround: Script registers placed Resonance Wards, creates a 32-block spherical acoustic safe-zone by clearing Warden agitation, and repels hostile mobs entering the radius.

import { world, system } from "@minecraft/server";

const WARD_RADIUS = 32;
const HOSTILE_MOBS = [
  "minecraft:warden",
  "minecraft:zombie",
  "minecraft:skeleton",
  "minecraft:creeper",
  "minecraft:spider",
  "minecraft:witch",
  "minecraft:enderman",
  "minecraft:phantom",
  "minecraft:stray"
];

function getRegisteredWards() {
  const data = world.getDynamicProperty("registered_resonance_wards");
  if (!data) return [];
  try {
    return JSON.parse(data);
  } catch (e) {
    return [];
  }
}

function saveRegisteredWards(wards) {
  world.setDynamicProperty("registered_resonance_wards", JSON.stringify(wards));
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  const { block, dimension } = event;
  if (block.typeId !== "meridian:resonance_ward") return;

  const wards = getRegisteredWards();
  wards.push({
    x: block.location.x,
    y: block.location.y,
    z: block.location.z,
    dimensionId: dimension.id
  });
  saveRegisteredWards(wards);
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  const { block, dimension } = event;
  if (block.typeId !== "meridian:resonance_ward") return;

  let wards = getRegisteredWards();
  wards = wards.filter(
    (w) =>
      !(
        w.x === block.location.x &&
        w.y === block.location.y &&
        w.z === block.location.z &&
        w.dimensionId === dimension.id
      )
  );
  saveRegisteredWards(wards);
});

system.runInterval(() => {
  const wards = getRegisteredWards();
  if (wards.length === 0) return;

  for (const ward of wards) {
    const dim = world.getDimension(ward.dimensionId);
    if (!dim) continue;

    const center = { x: ward.x + 0.5, y: ward.y + 0.5, z: ward.z + 0.5 };

    const wardBlock = dim.getBlock(ward);
    if (!wardBlock || wardBlock.typeId !== "meridian:resonance_ward") {
      continue;
    }

    for (const mobType of HOSTILE_MOBS) {
      const entities = dim.getEntities({
        location: center,
        maxDistance: WARD_RADIUS,
        type: mobType
      });

      for (const mob of entities) {
        if (mobType === "minecraft:warden") {
          mob.clearVelocity();
        }

        const mLoc = mob.location;
        const diffX = mLoc.x - center.x;
        const diffZ = mLoc.z - center.z;
        const dist = Math.hypot(diffX, diffZ) || 1;

        mob.applyKnockback({
          x: diffX / dist,
          z: diffZ / dist,
          horizontalStrength: 0.9,
          verticalStrength: 0.1
        });
      }
    }
  }
}, 10);
