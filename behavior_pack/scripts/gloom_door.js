// Gloom Door interaction. Placement and linked-part removal are handled by
// Bedrock's native minecraft:multi_block trait; this script only toggles the pair.
import { world, system } from "@minecraft/server";

const DOOR_ID = "meridian:gloom_door";
const OPEN_STATE = "meridian:door_open";
const PART_STATE = "minecraft:multi_block_part";

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.block.typeId !== DOOR_ID) return;

  event.cancel = true;
  if (!event.isFirstEvent) return;

  const dimension = event.block.dimension;
  const location = { ...event.block.location };

  system.run(() => {
    const clicked = dimension.getBlock(location);
    if (!clicked || clicked.typeId !== DOOR_ID) return;

    const parts = clicked.getParts();
    if (!parts || parts.length !== 2) return;

    const nextOpen = clicked.permutation.getState(OPEN_STATE) !== true;
    let changed = 0;

    for (const part of parts) {
      if (part.typeId !== DOOR_ID) continue;
      part.setPermutation(part.permutation.withState(OPEN_STATE, nextOpen));
      changed += 1;
    }

    if (changed === 2) {
      dimension.playSound(
        nextOpen ? "open.wooden_door" : "close.wooden_door",
        clicked.location
      );
    }
  });
});
