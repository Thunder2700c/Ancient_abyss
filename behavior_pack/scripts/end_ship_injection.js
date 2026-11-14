
import { world, system, ItemStack } from "@minecraft/server";

system.runInterval(() => {
  const endDim = world.getDimension("minecraft:the_end");
  if (!endDim) return;

  const itemFrames = endDim.getEntities({ type: "minecraft:item_frame" });

  for (const frame of itemFrames) {
    const loc = frame.location;
    const chunkKey = `end_ship_vault_${Math.floor(loc.x / 16)}_${Math.floor(loc.z / 16)}`;

    if (world.getDynamicProperty(chunkKey)) {
      continue;
    }

    // Verify chest behind the Elytra frame
    let targetChest = null;
    const scanOffsets = [
      { x: 0, y: 0, z: -1 },
      { x: 0, y: 0, z: 1 },
      { x: -1, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 0, y: -1, z: 0 }
    ];

    for (const offset of scanOffsets) {
      const block = endDim.getBlock({
        x: Math.floor(loc.x + offset.x),
        y: Math.floor(loc.y + offset.y),
        z: Math.floor(loc.z + offset.z)
      });
      if (block && block.typeId === "minecraft:chest") {
        targetChest = block;
        break;
      }
    }

    if (!targetChest) continue;

    const inventory = targetChest.getComponent("minecraft:inventory");
    if (!inventory || !inventory.container) continue;

    // Guaranteed 4 Null Cores insertion
    const container = inventory.container;
    const nullCoreItem = new ItemStack("meridian:null_core", 4);
    container.addItem(nullCoreItem);

    // Spawn 2 Shulkers guarding the frame
    try {
      endDim.spawnEntity("minecraft:shulker", { x: loc.x - 1.5, y: loc.y, z: loc.z });
      endDim.spawnEntity("minecraft:shulker", { x: loc.x + 1.5, y: loc.y, z: loc.z });
    } catch (e) {
      // Shulker spawn clearance protection
    }

    world.setDynamicProperty(chunkKey, true);
  }
}, 40);
