// Two-block Gloom Door support.
// A placed lower half creates its upper half; either half breaking removes its partner.
import { world, system, EntityComponentTypes, GameMode, ItemStack } from "@minecraft/server";

const DOOR_ID = "meridian:gloom_door";
const HALF_STATE = "meridian:door_half";
const OPEN_STATE = "meridian:door_open";
const AIR_IDS = new Set(["minecraft:air", "minecraft:cave_air", "minecraft:void_air"]);

function isDoor(block) {
  return !!block && block.typeId === DOOR_ID;
}

function locationAt(location, yOffset) {
  return { x: location.x, y: location.y + yOffset, z: location.z };
}

function refundDoor(player) {
  if (player.getGameMode() === GameMode.Creative) return;
  const inventory = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!inventory) return;
  const overflow = inventory.addItem(new ItemStack(DOOR_ID, 1));
  if (overflow) player.dimension.spawnItem(overflow, player.location);
}

function setDoorPairOpen(dimension, location, open) {
  const clicked = dimension.getBlock(location);
  if (!isDoor(clicked)) return false;
  const half = clicked.permutation.getState(HALF_STATE);
  const lowerLocation = half === "upper" ? locationAt(location, -1) : location;
  const upperLocation = locationAt(lowerLocation, 1);
  const lowerBlock = dimension.getBlock(lowerLocation);
  const upperBlock = dimension.getBlock(upperLocation);
  if (!isDoor(lowerBlock) || !isDoor(upperBlock)) return false;

  for (const block of [lowerBlock, upperBlock]) {
    block.setPermutation(block.permutation.withState(OPEN_STATE, open));
  }
  return true;
}

world.afterEvents.playerPlaceBlock.subscribe((event) => {
  if (!isDoor(event.block)) return;
  const dimension = event.dimension;
  const location = { ...event.block.location };

  system.run(() => {
    const lower = dimension.getBlock(location);
    if (!isDoor(lower)) return;
    const upperLocation = locationAt(location, 1);
    const upper = dimension.getBlock(upperLocation);
    if (!upper || !AIR_IDS.has(upper.typeId)) {
      lower.setType("minecraft:air");
      refundDoor(event.player);
      try {
        event.player.sendMessage("§cThe Gloom Door needs two clear vertical spaces.");
      } catch {}
      return;
    }

    const lowerPermutation = lower.permutation
      .withState(HALF_STATE, "lower")
      .withState(OPEN_STATE, false);
    lower.setPermutation(lowerPermutation);
    upper.setPermutation(lowerPermutation.withState(HALF_STATE, "upper"));
    dimension.playSound("place.wood", lowerLocation);
  });
});

world.afterEvents.playerBreakBlock.subscribe((event) => {
  if (event.brokenBlockPermutation.type.id !== DOOR_ID) return;
  const half = event.brokenBlockPermutation.getState(HALF_STATE);
  const brokenLocation = event.block.location;
  const partnerLocation = locationAt(brokenLocation, half === "upper" ? -1 : 1);

  system.run(() => {
    const partner = event.dimension.getBlock(partnerLocation);
    if (isDoor(partner)) partner.setType("minecraft:air");
  });
});

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (!isDoor(event.block)) return;
  event.cancel = true;
  const dimension = event.dimension;
  const location = { ...event.block.location };

  system.run(() => {
    const block = dimension.getBlock(location);
    if (!isDoor(block)) return;
    const isOpen = block.permutation.getState(OPEN_STATE) === true;
    const nextOpen = !isOpen;
    if (setDoorPairOpen(dimension, location, nextOpen)) {
      dimension.playSound(nextOpen ? "open.wooden_door" : "close.wooden_door", block.location);
    }
  });
});