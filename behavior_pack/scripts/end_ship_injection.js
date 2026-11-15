// Phase 7: End Ship Null Core cache and guardian setup.
// Bedrock item frames are blocks, not minecraft:item_frame entities. Scan a small
// area around each End player, inspect the documented BlockItemFrameComponent,
// and only inject into a chest next to a frame that actually displays an Elytra.

import { world, system, ItemStack } from "@minecraft/server";

const END_ID = "minecraft:the_end";
const FRAME_BLOCK_ID = "minecraft:frame";
const FRAME_COMPONENT_ID = "minecraft:item_frame";
const CHEST_ID = "minecraft:chest";
const SHULKER_ID = "minecraft:shulker";
const ELYTRA_ID = "minecraft:elytra";
const CORE_ID = "meridian:null_core";

const SCAN_RADIUS_XZ = 12;
const SCAN_RADIUS_Y = 6;
const SCAN_INTERVAL_TICKS = 100;

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
        x: location.x + offset.x,
        y: location.y + offset.y,
        z: location.z + offset.z
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

function processElytraFrame(dimension, frameBlock) {
  const loc = frameBlock.location;
  const baseKey = frameKey(loc);
  const completeKey = baseKey + "_complete";
  const coreKey = baseKey + "_core";

  if (world.getDynamicProperty(completeKey)) {
    return;
  }

  let framedItem;
  try {
    framedItem = frameBlock.getComponent(FRAME_COMPONENT_ID)?.getFramedItem();
  } catch (error) {
    return;
  }
  if (framedItem?.typeId !== ELYTRA_ID) {
    return;
  }

  const chest = findAdjacentChest(dimension, loc);
  if (!chest) {
    return;
  }

  if (!world.getDynamicProperty(coreKey)) {
    const container = chest.getComponent("minecraft:inventory")?.container;
    if (!container) {
      return;
    }
    const emptySlot = container.firstEmptySlot();
    if (emptySlot === undefined) {
      return;
    }
    try {
      container.setItem(emptySlot, new ItemStack(CORE_ID, 4));
      world.setDynamicProperty(coreKey, true);
    } catch (error) {
      console.warn("[meridian] Could not insert Null Cores into End Ship chest: " + error);
      return;
    }
  }

  // Spawn at most one guardian at each flank; retry missing guardians on later scans.
  const left = { x: loc.x + 0.5 - 1.5, y: loc.y + 0.5, z: loc.z + 0.5 };
  const right = { x: loc.x + 0.5 + 1.5, y: loc.y + 0.5, z: loc.z + 0.5 };
  const leftReady = ensureGuardian(dimension, left);
  const rightReady = ensureGuardian(dimension, right);

  if (leftReady && rightReady) {
    world.setDynamicProperty(completeKey, true);
  }
}

system.runInterval(() => {
  let endDim;
  try {
    endDim = world.getDimension(END_ID);
  } catch (error) {
    return;
  }

  for (const player of world.getAllPlayers()) {
    if (player.dimension.id !== END_ID) {
      continue;
    }

    const center = player.location;
    const cx = Math.floor(center.x);
    const cy = Math.floor(center.y);
    const cz = Math.floor(center.z);

    for (let x = cx - SCAN_RADIUS_XZ; x <= cx + SCAN_RADIUS_XZ; x++) {
      for (let y = cy - SCAN_RADIUS_Y; y <= cy + SCAN_RADIUS_Y; y++) {
        for (let z = cz - SCAN_RADIUS_XZ; z <= cz + SCAN_RADIUS_XZ; z++) {
          let block;
          try {
            block = endDim.getBlock({ x: x, y: y, z: z });
          } catch (error) {
            continue;
          }
          if (block?.typeId === FRAME_BLOCK_ID) {
            processElytraFrame(endDim, block);
          }
        }
      }
    }
  }
}, SCAN_INTERVAL_TICKS);
