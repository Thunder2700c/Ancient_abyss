// Void Lantern — persistent hostile-mob repulsion field.
// Bedrock does not expose a native custom-block spawn-denial radius, so this
// implementation records lantern locations and pushes monster-family entities away.

import { world, system } from "@minecraft/server";

const LANTERN_ID = "meridian:void_lantern";
const LANTERN_PROPERTY = "meridian:registered_void_lanterns";
const REPULSION_RADIUS = 16;
const SCAN_INTERVAL_TICKS = 20;
const PLAYER_ACTIVE_RADIUS = 40;

function readLanterns() {
  const raw = world.getDynamicProperty(LANTERN_PROPERTY);
  if (typeof raw !== "string" || raw.length === 0) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry) =>
      entry &&
      typeof entry.dimensionId === "string" &&
      Number.isFinite(entry.x) &&
      Number.isFinite(entry.y) &&
      Number.isFinite(entry.z)
    );
  } catch (error) {
    console.warn("[meridian] Void Lantern registry was unreadable: " + error);
    return [];
  }
}

function saveLanterns(lanterns) {
  world.setDynamicProperty(LANTERN_PROPERTY, JSON.stringify(lanterns));
}

function sameLocation(a, b) {
  return a.dimensionId === b.dimensionId &&
    a.x === b.x && a.y === b.y && a.z === b.z;
}

export function registerVoidLantern(dimensionId, location) {
  const entry = {
    dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
  const lanterns = readLanterns();
  if (!lanterns.some((existing) => sameLocation(existing, entry))) {
    lanterns.push(entry);
    saveLanterns(lanterns);
  }
}

function unregisterVoidLantern(dimensionId, location) {
  const entry = {
    dimensionId,
    x: Math.floor(location.x),
    y: Math.floor(location.y),
    z: Math.floor(location.z)
  };
  const lanterns = readLanterns();
  const remaining = lanterns.filter((existing) => !sameLocation(existing, entry));
  if (remaining.length !== lanterns.length) saveLanterns(remaining);
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  if (event.block.typeId === LANTERN_ID) {
    registerVoidLantern(event.dimension.id, event.block.location);
  }
});

world.beforeEvents.playerBreakBlock.subscribe((event) => {
  if (event.block.typeId === LANTERN_ID) {
    unregisterVoidLantern(event.dimension.id, event.block.location);
  }
});

function hasNearbyPlayer(dimension, center) {
  try {
    return dimension.getPlayers({
      location: center,
      maxDistance: PLAYER_ACTIVE_RADIUS
    }).length > 0;
  } catch (error) {
    return false;
  }
}

function repelMonsters(dimension, center) {
  try {
    dimension.spawnParticle("meridian:void_lantern_sparks", center);
  } catch (error) {
    // Particle failure must not disable the repulsion field.
  }

  let monsters;
  try {
    monsters = dimension.getEntities({
      location: center,
      maxDistance: REPULSION_RADIUS,
      families: ["monster"]
    });
  } catch (error) {
    console.warn("[meridian] Void Lantern entity query failed: " + error);
    return;
  }

  for (const monster of monsters) {
    try {
      const location = monster.location;
      const dx = location.x - center.x;
      const dz = location.z - center.z;
      const distance = Math.hypot(dx, dz) || 1;
      monster.applyKnockback({
        x: (dx / distance) * 0.8,
        z: (dz / distance) * 0.8
      }, 0.2);
    } catch (error) {
      // An entity can become invalid between the query and the push.
    }
  }
}

system.runInterval(() => {
  const lanterns = readLanterns();
  if (lanterns.length === 0) return;

  const active = [];
  let registryChanged = false;

  for (const lantern of lanterns) {
    try {
      const dimension = world.getDimension(lantern.dimensionId);
      const block = dimension.getBlock(lantern);

      // Keep unknown/unloaded locations for the next pass; prune only a loaded
      // position that is confirmed not to contain a Void Lantern.
      if (!block) {
        active.push(lantern);
        continue;
      }
      if (block.typeId !== LANTERN_ID) {
        registryChanged = true;
        continue;
      }

      active.push(lantern);
      const center = {
        x: lantern.x + 0.5,
        y: lantern.y + 0.5,
        z: lantern.z + 0.5
      };
      if (hasNearbyPlayer(dimension, center)) {
        repelMonsters(dimension, center);
      }
    } catch (error) {
      // Preserve records when their dimension/chunk cannot currently be queried.
      active.push(lantern);
    }
  }

  if (registryChanged) {
    saveLanterns(active);
  }
}, SCAN_INTERVAL_TICKS);
