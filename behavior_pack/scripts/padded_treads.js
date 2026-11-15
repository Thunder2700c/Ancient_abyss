// PHASE 23 — Padded Treads scripted passive.
// This is not a native enchantment registration. Bedrock exposes no public
// custom-enchantment registration API. The passive grants Speed I while
// sneaking and sets a tag for later Ancient Abyss entity-AI integrations.
// It does NOT cancel vanilla sound or sculk-vibration events.
import { world, system, EntityComponentTypes, EquipmentSlot } from "@minecraft/server";

export const PADDED_TREADS_ID = "meridian:padded_treads";
export const PADDED_TREADS_TAG = "meridian:padded_treads";

function updatePlayer(player) {
  try {
    const equippable = player.getComponent(EntityComponentTypes.Equippable);
    const boots = equippable?.getEquipment(EquipmentSlot.Feet);
    const wearing = boots?.typeId === PADDED_TREADS_ID;
    if (wearing) {
      if (!player.hasTag(PADDED_TREADS_TAG)) player.addTag(PADDED_TREADS_TAG);
      if (player.isSneaking) player.addEffect("speed", 15, { amplifier: 0, showParticles: false });
    } else if (player.hasTag(PADDED_TREADS_TAG)) {
      player.removeTag(PADDED_TREADS_TAG);
    }
  } catch (error) {
    console.warn("[Ancient Abyss] Padded Treads update failed: " + error);
  }
}

export function isPaddedTreadsActive(player) {
  try { return player.hasTag(PADDED_TREADS_TAG); }
  catch (error) { return false; }
}

export function initPaddedTreads() {
  system.runInterval(() => {
    for (const player of world.getAllPlayers()) updatePlayer(player);
  }, 10);
}
