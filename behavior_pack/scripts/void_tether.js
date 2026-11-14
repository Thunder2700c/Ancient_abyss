// behavior_pack/scripts/void_tether.js
// PHASE 5 - Void Tether (void rescue) and Anti-Elytra Law.
//
// Verified: Player.isGliding (since 1.20.40), Block.isAir, Dimension.spawnParticle, Entity.teleport,
// dynamic properties on players. Wall-clock time (Date.now) is used so cooldowns survive reloads.
//
// CONFLICT FLAG: the PRD gates the Void Tether behind FULL Abyssalite armor, but Phase 5 must work before that gear
// exists. Resolution: tetherConfig.requireFullSet is false now (any player is rescued). The Phase 20 script sets
// tetherConfig.requireFullSet = true to enforce the PRD rule; hasFullAbyssaliteSet() is already implemented here.
//
// LIMITATIONS
// - True "elytra disabled" flag: NOT POSSIBLE IN BEDROCK. Workaround: while a player glides in the Abyss the chest Elytra
//   loses durability fast, down to 1 durability left (a nearly broken Elytra cannot glide), the item is never deleted.
// - Firework boost: itemUse is cancelled while gliding in the Abyss; a spawned firework rocket next to a gliding player
//   is removed as a fallback (covers dispensers and crossbows).
// - The launch is a teleport 20 blocks up (Player.applyKnockback changed signature between API versions), moved to the
//   first 2-block-high air pocket if that spot is inside blocks.

import { world, system, EquipmentSlot, EntityComponentTypes } from "@minecraft/server";
import { isInAbyss } from "./dimension.js";

export const tetherConfig = { requireFullSet: false };

const VOID_TRIGGER_Y = -70;
const LAUNCH_HEIGHT = 20;
const SLOW_FALLING_TICKS = 200;
const COOLDOWN_MS = 180000;
const COOLDOWN_PROPERTY = "meridian:tether_ready_at";
const TETHER_INTERVAL_TICKS = 2;

const ELYTRA_ID = "minecraft:elytra";
const ELYTRA_INTERVAL_TICKS = 4;
const ELYTRA_DRAIN_PER_STEP = 12;
const ELYTRA_MESSAGE_GAP_MS = 5000;
const FIREWORK_ID = "minecraft:firework_rocket";
const FIREWORK_CLEAR_RADIUS = 4;

const ARMOR_SET = [
  [EquipmentSlot.Head, "meridian:abyssalite_helmet"],
  [EquipmentSlot.Chest, "meridian:abyssalite_chestplate"],
  [EquipmentSlot.Legs, "meridian:abyssalite_leggings"],
  [EquipmentSlot.Feet, "meridian:abyssalite_boots"],
];

const lastElytraMessage = new Map();

export function hasFullAbyssaliteSet(player) {
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  if (!equippable) {
    return false;
  }
  for (const [slot, typeId] of ARMOR_SET) {
    if (equippable.getEquipment(slot)?.typeId !== typeId) {
      return false;
    }
  }
  return true;
}

function findClearY(dimension, x, z, startY) {
  for (let y = startY; y < startY + 64; y++) {
    const feet = dimension.getBlock({ x: Math.floor(x), y: y, z: Math.floor(z) });
    const head = dimension.getBlock({ x: Math.floor(x), y: y + 1, z: Math.floor(z) });
    if (feet?.isAir && head?.isAir) {
      return y;
    }
  }
  return startY;
}

function triggerTether(player) {
  const from = player.location;
  const dimension = player.dimension;
  const y = findClearY(dimension, from.x, from.z, Math.floor(from.y) + LAUNCH_HEIGHT);
  const to = { x: from.x, y: y, z: from.z };

  player.setDynamicProperty(COOLDOWN_PROPERTY, Date.now() + COOLDOWN_MS);
  player.teleport(to);
  player.addEffect("slow_falling", SLOW_FALLING_TICKS, { amplifier: 0, showParticles: true });
  player.sendMessage({ rawtext: [{ translate: "message.meridian.void_tether" }] });
  try {
    dimension.spawnParticle("minecraft:sonic_explosion", to);
    dimension.playSound("mob.warden.sonic_boom", to);
  } catch (error) {
    console.warn("[meridian] Void Tether effects failed: " + error);
  }
}

function scanVoid() {
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player) || player.location.y >= VOID_TRIGGER_Y) {
        continue;
      }
      const readyAt = player.getDynamicProperty(COOLDOWN_PROPERTY);
      if (typeof readyAt === "number" && Date.now() < readyAt) {
        continue;
      }
      if (tetherConfig.requireFullSet && !hasFullAbyssaliteSet(player)) {
        continue;
      }
      triggerTether(player);
    } catch (error) {
      console.warn("[meridian] Void scan skipped a player: " + error);
    }
  }
}

function drainElytra(player) {
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  const chest = equippable?.getEquipment(EquipmentSlot.Chest);
  if (!chest || chest.typeId !== ELYTRA_ID) {
    return;
  }
  const durability = chest.getComponent("minecraft:durability");
  if (!durability) {
    return;
  }
  const limit = durability.maxDurability - 1;
  if (durability.damage < limit) {
    durability.damage = Math.min(durability.damage + ELYTRA_DRAIN_PER_STEP, limit);
    equippable.setEquipment(EquipmentSlot.Chest, chest);
  }

  const now = Date.now();
  if (now - (lastElytraMessage.get(player.id) ?? 0) > ELYTRA_MESSAGE_GAP_MS) {
    lastElytraMessage.set(player.id, now);
    player.sendMessage({ rawtext: [{ translate: "message.meridian.anti_elytra" }] });
  }
}

function scanGliders() {
  for (const player of world.getAllPlayers()) {
    try {
      if (isInAbyss(player) && player.isGliding) {
        drainElytra(player);
      }
    } catch (error) {
      console.warn("[meridian] Glide scan skipped a player: " + error);
    }
  }
}

export function initVoidTether() {
  world.afterEvents.worldLoad.subscribe(() => {
    system.runInterval(scanVoid, TETHER_INTERVAL_TICKS);
    system.runInterval(scanGliders, ELYTRA_INTERVAL_TICKS);

    world.beforeEvents.itemUse.subscribe((event) => {
      if (event.itemStack.typeId === FIREWORK_ID && isInAbyss(event.source) && event.source.isGliding) {
        event.cancel = true;
      }
    });

    world.afterEvents.entitySpawn.subscribe((event) => {
      const entity = event.entity;
      if (entity.typeId !== FIREWORK_ID || entity.dimension.id !== "meridian:ancient_abyss") {
        return;
      }
      const nearby = entity.dimension.getPlayers({ location: entity.location, maxDistance: FIREWORK_CLEAR_RADIUS });
      if (nearby.some((player) => player.isGliding)) {
        entity.remove();
      }
    });

    world.afterEvents.playerLeave.subscribe((event) => {
      lastElytraMessage.delete(event.playerId);
    });
  });
}
