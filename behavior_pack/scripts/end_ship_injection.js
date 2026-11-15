// Phase 7: End Ship Null Core cache and guardian setup.
// This is a loaded-area heuristic: it finds item-frame entities with an adjacent chest.
// Bedrock's supported Entity Script API does not expose the displayed item from an item-frame
// entity, so the script cannot positively identify that the frame currently displays an Elytra.
// The incomplete vanilla loot-table override was removed; vanilla End City loot is preserved.

import { world, system, ItemStack } from "@minecraft/server";

const END_ID = "minecraft:the_end";
const FRAME_ID = "minecraft:item_frame";
const CHEST_ID = "minecraft:chest";
const SHULKER_ID = "minecraft:shulker";
const CORE_ID = "meridian:null_core";

function frameKey(location) {
  return "meridian:end_ship_frame_" +
    Math.floor(location.x) + "_" +
    Math.floor(location.y) + "_" +
    Math.floor(location.z);
}

function findAdjacentChest(dimension, location) {
  const offsets = [
    { x: 0, y: 0, z: -1 },
    { x: 0, y: 0, z: 1 },
    { x: -1, y: 0, z: 0 },
    { x: 1, y: 0, z: 0 },
    { x: 0, y: -1, z: 0 }
  ];
  for (const offset of offsets) {
    try {
      const block = dimension.getBlock({
        x: Math.floor(location.x + offset.x),
        y: Math.floor(location.y + offset.y),
        z: Math.floor(location.z + offset.z)
      });
      if (block?.typeId === CHEST_ID) {
        return block;
      }
    } catch (error) {
      // Unloaded frame neighbors are skipped.
    }
  }
  return undefined;
}

function ensureGuardian(dimension, location) {
  const existing = dimension.getEntities({
    type: SHULKER_ID,
    location: location,
    maxDistance: 1.25
  });
  if (existing.length > 0) {
    return true;
  }
  try {
    dimension.spawnEntity(SHULKER_ID, location);
    return true;
  } catch (error) {
    return false;
  }
}

system.runInterval(() => {
  let endDim;
  try {
    endDim = world.getDimension(END_ID);
  } catch (error) {
    return;
  }

  for (const frame of endDim.getEntities({ type: FRAME_ID })) {
    const loc = frame.location;
    const baseKey = frameKey(loc);
    const completeKey = baseKey + "_complete";
    const coreKey = baseKey + "_core";

    if (world.getDynamicProperty(completeKey)) {
      continue;
    }

    const chest = findAdjacentChest(endDim, loc);
    if (!chest) {
      continue;
    }

    if (!world.getDynamicProperty(coreKey)) {
      const inventory = chest.getComponent("minecraft:inventory");
      const container = inventory?.container;
      if (!container) {
        continue;
      }

      const emptySlot = container.firstEmptySlot();
      if (emptySlot === undefined) {
        continue;
      }

      try {
        container.setItem(emptySlot, new ItemStack(CORE_ID, 4));
        world.setDynamicProperty(coreKey, true);
      } catch (error) {
        console.warn("[meridian] Could not insert Null Cores into End Ship chest: " + error);
        continue;
      }
    }

    // Spawn at most one guardian at each flank; retry missing guardians on later scans.
    const left = { x: loc.x - 1.5, y: loc.y, z: loc.z };
    const right = { x: loc.x + 1.5, y: loc.y, z: loc.z };
    const leftReady = ensureGuardian(endDim, left);
    const rightReady = ensureGuardian(endDim, right);

    if (leftReady && rightReady) {
      world.setDynamicProperty(completeKey, true);
    }
  }
}, 40);
