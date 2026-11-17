// PHASE 23 — Resonant Village Pylon donations.
import { world, system, EntityComponentTypes, GameMode } from "@minecraft/server";
import { addTrust, chime } from "./echo_dweller.js";

const PYLON_ID = "meridian:harmonic_pylon";
const DONATION_VALUES = new Map([
  ["minecraft:amethyst_shard", 1],
  ["minecraft:echo_shard", 2],
]);

function donationValue(typeId) {
  if (DONATION_VALUES.has(typeId)) return DONATION_VALUES.get(typeId);
  return typeId.startsWith("minecraft:") && typeId.endsWith("_wool") ? 0.5 : 0;
}

function consumeSelectedItem(player, expectedTypeId) {
  if (player.getGameMode() === GameMode.Creative) return true;
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) return false;
  const slot = player.selectedSlotIndex;
  const current = container.getItem(slot);
  if (!current || current.typeId !== expectedTypeId || current.amount < 1) return false;
  if (current.amount === 1) container.setItem(slot, undefined);
  else {
    const updated = current.clone();
    updated.amount -= 1;
    container.setItem(slot, updated);
  }
  return true;
}

world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
  if (event.block.typeId !== PYLON_ID) return;
  event.cancel = true;
  if (!event.isFirstEvent) return;
  const player = event.player;
  const typeId = event.itemStack?.typeId;
  const value = typeId ? donationValue(typeId) : 0;
  const location = {
    x: event.block.location.x + 0.5,
    y: event.block.location.y + 0.5,
    z: event.block.location.z + 0.5,
  };

  system.run(() => {
    if (!typeId || value <= 0) {
      player.sendMessage("§b[Resonant Pylon]§r §7Offer an Amethyst Shard, Echo Shard, or any colour of Wool.");
      return;
    }
    if (!consumeSelectedItem(player, typeId)) {
      player.sendMessage("§c[Resonant Pylon]§r §7Your offering changed before it could be accepted.");
      return;
    }
    const trust = addTrust(player, value);
    chime(player.dimension, location, 1.35);
    player.onScreenDisplay.setActionBar("§b♪ The Pylon resonates. Trust +" + value + " (total " + trust + ")");
  });
});
