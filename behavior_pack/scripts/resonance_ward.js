// Resonance Ward — persistent hostile-mob repulsion field.
// Bedrock scripts cannot cancel vanilla vibration propagation or rewrite mob
// navigation meshes. This implementation is a practical knockback-based ward.

import { world, system } from "@minecraft/server";

const WARD_ID = "meridian:resonance_ward";
const WARD_PROPERTY = "meridian:registered_resonance_wards";
const WARD_RADIUS = 32;

function getRegisteredWards() {
  const data = world.getDynamicProperty(WARD_PROPERTY);
  if (typeof data !== "string" || data.length === 0) return [];
  try {
    const parsed = JSON.parse(data);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((ward) =>
      ward &&
      typeof ward.dimensionId === "string" &&
      Number.isFinite(ward.x) &&
      Number.isFinite(ward.y) &&
      Number.isFinite(ward.z)
    );
  } catch (error) {
    console.warn("[meridian] Resonance Ward registry was unreadable: " + error);
    return [];
  }
}

function saveRegisteredWards(wards) {
  world.setDynamicProperty(WARD_PROPERTY, JSON.stringify(wards));
}

function sameWard(a, b) {
  return a.dimensionId === b.dimensionId &&
    a.x === b.x && a.y === b.y && a.z === b.z;
}

function registerWard(dimensionId, location) {
  const entry = {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
    dimensionId
  };
  const wards = getRegisteredWards();
  if (!wards.some((ward) => sameWard(ward, entry))) {
    wards.push(entry);
    saveRegisteredWards(wards);
  }
}

function unregisterWard(dimensionId, location) {
  const entry = {
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z),
    dimensionId
  };
  const wards = getRegisteredWards();
  const remaining = wards.filter((ward) => !sameWard(ward, entry));
  if (remaining.length !== wards.length) saveRegisteredWards(remaining);
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  if (event.block.typeId === WARD_ID) {
    registerWard(event.dimension.id, event.block.location);
  }
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.block.typeId === WARD_ID) {
    unregisterWard(event.dimension.id, event.block.location);
  }
});

system.runInterval(() => {
  const wards = getRegisteredWards();
  if (wards.length === 0) return;

  const active = [];
  let registryChanged = false;

  for (const ward of wards) {
    try {
      const dimension = world.getDimension(ward.dimensionId);
      const wardBlock = dimension.getBlock(ward);

      // An undefined block can mean the chunk is not currently queryable.
      // Keep that record; remove only a loaded location confirmed to be empty
      // or occupied by a different block.
      if (!wardBlock) {
        active.push(ward);
        continue;
      }
      if (wardBlock.typeId !== WARD_ID) {
        registryChanged = true;
        continue;
      }

      active.push(ward);
      const center = {
        x: ward.x + 0.5,
        y: ward.y + 0.5,
        z: ward.z + 0.5
      };

      const monsters = dimension.getEntities({
        location: center,
        maxDistance: WARD_RADIUS,
        families: ["monster"]
      });

      for (const monster of monsters) {
        try {
          if (monster.typeId === "minecraft:warden") {
            monster.clearVelocity();
          }

          const location = monster.location;
          const dx = location.x - center.x;
          const dz = location.z - center.z;
          const distance = Math.hypot(dx, dz) || 1;

          monster.applyKnockback({
            x: (dx / distance) * 0.9,
            z: (dz / distance) * 0.9
          }, 0.1);
        } catch (error) {
          // Entities can become invalid between the query and the push.
        }
      }
    } catch (error) {
      // Preserve the record when its dimension/chunk cannot currently be read.
      active.push(ward);
      console.warn("[meridian] Resonance Ward scan deferred: " + error);
    }
  }

  if (registryChanged) {
    saveRegisteredWards(active);
  }
}, 10);
