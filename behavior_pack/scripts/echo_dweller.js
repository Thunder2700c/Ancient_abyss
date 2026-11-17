// behavior_pack/scripts/echo_dweller.js
// PHASE 22 - Echo Dweller behaviour: Harmonic Trust, chimes, donations, silent sculk clearing.
//
// The Bedrock Wiki connector was not reachable while writing this phase. These calls come from my own knowledge and
// are NOT re-verified this turn: PlayerInteractWithEntityBeforeEvent (player, target, itemStack),
// PlayerBreakBlockAfterEvent (player, block, brokenBlockPermutation), Dimension.getEntities({ type }),
// Dimension.playSound(id, location, options), Entity.matches({ gameMode }). Sound ids: block.amethyst_block.chime
// with note.chime as fallback. If the content log shows one of these failing, tell me which.
//
// TRUST (stored on the PLAYER, dynamic property meridian:echo_trust, 0 to 100):
//   +1  per sculk vein / shrieker / sensor / sculk block broken while sneaking in the Abyss (approximates clearing
//       sculk "without triggering sonic waves"; real vibration tracking is not available per block).
//   +1  Amethyst Shard, +2 Echo Shard, +0.5 any Wool, donated by right-clicking a Dweller (APPROXIMATION of the village
//       pylon: there is no pylon block in the PRD list, so the Dweller takes the donation).
//   Healing Resonant Wardens adds trust in the Resonant Warden phase through addTrust().
//   Tiers: 1 from 0, 2 from 10, 3 from 25 (engineering decision; the PRD defines the tiers but not the thresholds).
//
// registerDwellerInteractHandler(fn): the trade screen phase registers a handler here. A handler returns true when
// it handled the click, which stops the default trust read-out.

import {
  world,
  system,
  EntityComponentTypes,
  EquipmentSlot,
  CommandPermissionLevel,
  CustomCommandStatus,
  GameMode,
} from "@minecraft/server";
import { ABYSS_ID, isInAbyss } from "./dimension.js";

export const DWELLER_ID = "meridian:echo_dweller";
const TRUST_PROPERTY = "meridian:echo_trust";
const TRUST_MAX = 100;
const TIER_2_TRUST = 10;
const TIER_3_TRUST = 25;
const AMBIENT_INTERVAL_TICKS = 100;
const AMBIENT_CHANCE = 0.35;
const SCULK_TRUST_BLOCKS = new Set([
  "minecraft:sculk_vein",
  "minecraft:sculk_shrieker",
  "minecraft:sculk_sensor",
  "minecraft:calibrated_sculk_sensor",
  "minecraft:sculk",
]);
const DONATIONS = new Map([
  ["minecraft:amethyst_shard", 1],
  ["minecraft:echo_shard", 2],
]);
const WOOL_TRUST = 0.5;

const interactHandlers = [];

export function registerDwellerInteractHandler(handler) {
  interactHandlers.push(handler);
}

export function getTrust(player) {
  const value = player.getDynamicProperty(TRUST_PROPERTY);
  return typeof value === "number" ? value : 0;
}

export function setTrust(player, amount) {
  player.setDynamicProperty(TRUST_PROPERTY, Math.max(0, Math.min(TRUST_MAX, amount)));
}

export function addTrust(player, amount) {
  setTrust(player, getTrust(player) + amount);
  return getTrust(player);
}

export function getTrustTier(player) {
  const trust = getTrust(player);
  if (trust >= TIER_3_TRUST) {
    return 3;
  }
  return trust >= TIER_2_TRUST ? 2 : 1;
}

export function chime(dimension, location, pitch) {
  try {
    dimension.playSound("block.amethyst_block.chime", location, { volume: 0.7, pitch: pitch });
  } catch (error) {
    try {
      dimension.playSound("note.chime", location, { volume: 0.7, pitch: pitch });
    } catch (fallbackError) {
      console.warn("[meridian] Chime sound failed: " + fallbackError);
    }
  }
}

function isCreative(player) {
  return player.matches({ gameMode: GameMode.Creative });
}

function consumeOne(player, item) {
  if (isCreative(player)) {
    return;
  }
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) {
    return;
  }
  const slot = player.selectedSlotIndex;
  if (item.amount > 1) {
    item.amount -= 1;
    container.setItem(slot, item);
  } else {
    container.setItem(slot, undefined);
  }
}

function donationValue(item) {
  if (!item) {
    return 0;
  }
  if (DONATIONS.has(item.typeId)) {
    return DONATIONS.get(item.typeId);
  }
  return item.typeId.endsWith("_wool") ? WOOL_TRUST : 0;
}

function handleInteract(player, dweller, item) {
  for (const handler of interactHandlers) {
    if (handler(player, dweller, item) === true) {
      return;
    }
  }

  const gift = donationValue(item);
  const location = dweller.location;
  if (gift > 0) {
    consumeOne(player, item);
    const trust = addTrust(player, gift);
    chime(dweller.dimension, location, 1.4);
    player.onScreenDisplay.setActionBar("§b♪ The Dweller chimes softly. Trust " + trust + " (tier " + getTrustTier(player) + ")");
    return;
  }
  chime(dweller.dimension, location, 1.0);
  player.onScreenDisplay.setActionBar("§b♪ Trust " + getTrust(player) + " (tier " + getTrustTier(player) + ")");
}

function ambientChimes() {
  let abyss;
  try {
    abyss = world.getDimension(ABYSS_ID);
  } catch (error) {
    return;
  }
  for (const dweller of abyss.getEntities({ type: DWELLER_ID })) {
    if (Math.random() < AMBIENT_CHANCE) {
      chime(abyss, dweller.location, 0.8 + Math.random() * 0.6);
    }
  }
}

export function registerDwellerCommands(customCommandRegistry) {
  customCommandRegistry.registerCommand(
    {
      name: "meridian:trust_add",
      description: "Test: add 5 Echo Dweller trust to yourself.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
      }
      system.run(() => {
        const trust = addTrust(player, 5);
        player.sendMessage("§b[Echo Dwellers]§r Trust is now " + trust + " (tier " + getTrustTier(player) + ").");
      });
      return { status: CustomCommandStatus.Success, message: "Adding trust..." };
    }
  );
}

export function initEchoDweller() {
  world.afterEvents.worldLoad.subscribe(() => {
    world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
      if (event.target.typeId !== DWELLER_ID) {
        return;
      }
      event.cancel = true;
      const player = event.player;
      const target = event.target;
      const item = event.itemStack;
      system.run(() => handleInteract(player, target, item));
    });

    world.afterEvents.playerBreakBlock.subscribe((event) => {
      const player = event.player;
      if (!isInAbyss(player) || !player.isSneaking) {
        return;
      }
      if (SCULK_TRUST_BLOCKS.has(event.brokenBlockPermutation.type.id)) {
        const trust = addTrust(player, 1);
        player.onScreenDisplay.setActionBar("§b♪ The sculk falls silent. Trust " + trust);
      }
    });

    system.runInterval(ambientChimes, AMBIENT_INTERVAL_TICKS);
  });
}
