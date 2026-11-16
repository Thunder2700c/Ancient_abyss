// PHASE 24 — Resonant Warden.
import {
  world,
  system,
  EntityComponentTypes,
  GameMode
} from "@minecraft/server";
import { addTrust } from "./echo_dweller.js";

const WARDEN_ID = "meridian:resonant_warden";
const BASE_ID = "minecraft:sculk";
const TORSO_ID = "minecraft:sculk_catalyst";
const ARM_ID = "minecraft:sculk_sensor";
const HEAD_ID = "minecraft:calibrated_sculk_sensor";
const ECHO_SHARD_ID = "minecraft:echo_shard";
const SCULK_VEIN_ID = "minecraft:sculk_vein";
const OWNER_TAG_PREFIX = "meridian:warden_owner:";
const PULSE_INTERVAL_TICKS = 100;
const PULSE_SCAN_INTERVAL_TICKS = 10;
const PULSE_RADIUS = 7;
const FOLLOW_START_DISTANCE = 4;
const TELEPORT_DISTANCE = 24;

let elapsedTicks = 0;
const lastPulseTick = new Map();

function readType(dimension, x, y, z) {
  try {
    return dimension.getBlock({ x, y, z })?.typeId;
  } catch (error) {
    return undefined;
  }
}

function findAssembly(dimension, head) {
  const x = head.x;
  const y = head.y;
  const z = head.z;
  if (
    readType(dimension, x, y - 2, z) !== BASE_ID ||
    readType(dimension, x, y - 1, z) !== TORSO_ID ||
    readType(dimension, x, y, z) !== HEAD_ID
  ) {
    return undefined;
  }

  const armPairs = [
    [
      { x: x - 1, y: y - 1, z },
      { x: x + 1, y: y - 1, z }
    ],
    [
      { x, y: y - 1, z: z - 1 },
      { x, y: y - 1, z: z + 1 }
    ]
  ];

  for (const arms of armPairs) {
    if (
      readType(dimension, arms[0].x, arms[0].y, arms[0].z) === ARM_ID &&
      readType(dimension, arms[1].x, arms[1].y, arms[1].z) === ARM_ID
    ) {
      return {
        blocks: [
          { x, y: y - 2, z, typeId: BASE_ID },
          { x, y: y - 1, z, typeId: TORSO_ID },
          { x, y, z, typeId: HEAD_ID },
          { ...arms[0], typeId: ARM_ID },
          { ...arms[1], typeId: ARM_ID }
        ],
        spawn: { x: x + 0.5, y: y - 1, z: z + 0.5 }
      };
    }
  }
  return undefined;
}

function isCreative(player) {
  try {
    return player.getGameMode() === GameMode.Creative;
  } catch (error) {
    return false;
  }
}

function consumeHeldItem(player, expectedTypeId) {
  if (isCreative(player)) return true;
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) return false;

  const slot = player.selectedSlotIndex;
  const current = container.getItem(slot);
  if (!current || current.typeId !== expectedTypeId || current.amount < 1) return false;

  if (current.amount === 1) {
    container.setItem(slot, undefined);
  } else {
    const updated = current.clone();
    updated.amount -= 1;
    container.setItem(slot, updated);
  }
  return true;
}

function restoreAssembly(dimension, blocks) {
  for (const entry of blocks) {
    try {
      const block = dimension.getBlock({ x: entry.x, y: entry.y, z: entry.z });
      if (block?.isAir) block.setType(entry.typeId);
    } catch (error) {
      console.warn("[Ancient Abyss] Could not restore a Resonant Warden assembly block: " + error);
    }
  }
}

function assembleWarden(player, dimension, headLocation) {
  const assembly = findAssembly(dimension, headLocation);
  if (!assembly) {
    player.sendMessage("§3[Resonant Warden]§r §7The pattern is incomplete. Build Sculk → Catalyst → Calibrated Sensor vertically, with two Sculk Sensors as opposite arms.");
    return;
  }

  const existing = dimension.getEntities({
    type: WARDEN_ID,
    location: assembly.spawn,
    maxDistance: 2
  });
  if (existing.length > 0) {
    player.sendMessage("§3[Resonant Warden]§r §7A Warden is already bound to this assembly site.");
    return;
  }

  for (const entry of assembly.blocks) {
    try {
      dimension.getBlock({ x: entry.x, y: entry.y, z: entry.z }).setType("minecraft:air");
    } catch (error) {
      restoreAssembly(dimension, assembly.blocks);
      player.sendMessage("§c[Resonant Warden]§r §7The assembly could not be dismantled safely. No Echo Shard was consumed.");
      return;
    }
  }

  let warden;
  try {
    warden = dimension.spawnEntity(WARDEN_ID, assembly.spawn);
    warden.addTag(OWNER_TAG_PREFIX + player.id);
  } catch (error) {
    if (warden) {
      try { warden.remove(); } catch (removeError) {}
    }
    restoreAssembly(dimension, assembly.blocks);
    player.sendMessage("§c[Resonant Warden]§r §7The guardian could not awaken. The structure was restored and no Echo Shard was consumed.");
    console.warn("[Ancient Abyss] Resonant Warden spawn failed: " + error);
    return;
  }

  if (!consumeHeldItem(player, ECHO_SHARD_ID)) {
    try { warden.remove(); } catch (error) {}
    restoreAssembly(dimension, assembly.blocks);
    player.sendMessage("§c[Resonant Warden]§r §7Your Echo Shard changed before activation. The structure was restored.");
    return;
  }

  try {
    dimension.spawnParticle("minecraft:sonic_explosion", {
      x: assembly.spawn.x,
      y: assembly.spawn.y + 1.2,
      z: assembly.spawn.z
    });
    dimension.playSound("mob.warden.emerge", assembly.spawn, { volume: 2.0, pitch: 0.8 });
  } catch (error) {
    console.warn("[Ancient Abyss] Resonant Warden awakening effect failed: " + error);
  }
  player.sendMessage("§3[Resonant Warden]§r §bThe guardian answers your Echo Shard and binds its loyalty to you.");
}

function handleHealing(player, warden, itemStack) {
  const typeId = itemStack?.typeId;
  if (typeId !== SCULK_VEIN_ID && typeId !== ECHO_SHARD_ID) return false;

  const healAmount = typeId === ECHO_SHARD_ID ? 20 : 8;
  const trustAmount = typeId === ECHO_SHARD_ID ? 2 : 1;
  const health = warden.getComponent(EntityComponentTypes.Health);
  if (!health || health.currentValue >= health.effectiveMax) {
    player.sendMessage("§3[Resonant Warden]§r §7The guardian does not need healing.");
    return true;
  }

  if (!consumeHeldItem(player, typeId)) {
    player.sendMessage("§c[Resonant Warden]§r §7Your healing item changed before it could be used.");
    return true;
  }

  health.setCurrentValue(Math.min(health.effectiveMax, health.currentValue + healAmount));
  try {
    addTrust(player, trustAmount);
  } catch (error) {
    console.warn("[Ancient Abyss] Warden healing trust could not be recorded: " + error);
  }
  try {
    warden.dimension.spawnParticle("minecraft:totem_particle", {
      x: warden.location.x,
      y: warden.location.y + 1.4,
      z: warden.location.z
    });
    warden.dimension.playSound("block.amethyst_block.chime", warden.location, { volume: 0.9, pitch: 1.2 });
  } catch (error) {
    console.warn("[Ancient Abyss] Warden healing effect failed: " + error);
  }
  player.onScreenDisplay.setActionBar("§bResonance restored: +" + healAmount + " health · Trust +" + trustAmount);
  return true;
}

function getOwner(warden, players) {
  const ownerTag = warden.getTags().find((tag) => tag.startsWith(OWNER_TAG_PREFIX));
  if (!ownerTag) return undefined;
  const ownerId = ownerTag.slice(OWNER_TAG_PREFIX.length);
  return players.find((player) => player.id === ownerId);
}

function followOwner(warden, owner) {
  if (!owner || owner.dimension.id !== warden.dimension.id) return;
  const here = warden.location;
  const there = owner.location;
  const dx = there.x - here.x;
  const dz = there.z - here.z;
  const horizontalDistance = Math.hypot(dx, dz);
  const verticalDistance = Math.abs(there.y - here.y);

  if (horizontalDistance > TELEPORT_DISTANCE || verticalDistance > 12) {
    try {
      warden.teleport(
        { x: there.x + 1.5, y: there.y, z: there.z + 1.5 },
        { dimension: owner.dimension, checkForBlocks: true }
      );
    } catch (error) {
      console.warn("[Ancient Abyss] Resonant Warden could not rejoin its owner: " + error);
    }
    return;
  }

  if (horizontalDistance > FOLLOW_START_DISTANCE) {
    const strength = Math.min(0.45, 0.12 + (horizontalDistance - FOLLOW_START_DISTANCE) * 0.018);
    try {
      warden.applyKnockback(
        { x: dx / horizontalDistance, z: dz / horizontalDistance },
        strength
      );
    } catch (error) {
      // The navigation system can reject a push while the entity is changing state.
    }
  }
}

function pulse(warden, hostiles) {
  const origin = warden.location;
  try {
    warden.dimension.spawnParticle("minecraft:sonic_explosion", {
      x: origin.x,
      y: origin.y + 1.3,
      z: origin.z
    });
    warden.dimension.playSound("mob.warden.sonic_boom", origin, { volume: 1.8, pitch: 0.9 });
  } catch (error) {
    console.warn("[Ancient Abyss] Resonant Warden pulse effect failed: " + error);
  }

  for (const hostile of hostiles) {
    try {
      const target = hostile.location;
      const dx = target.x - origin.x;
      const dz = target.z - origin.z;
      const distance = Math.hypot(dx, dz) || 1;
      hostile.applyKnockback(
        { x: dx / distance, z: dz / distance },
        1.35
      );
      hostile.addEffect("slowness", 60, { amplifier: 1, showParticles: false });
      hostile.addEffect("weakness", 60, { amplifier: 0, showParticles: false });
    } catch (error) {
      // A target may despawn between the query and the effect application.
    }
  }
}

function updateWardens() {
  elapsedTicks += PULSE_SCAN_INTERVAL_TICKS;
  const players = world.getAllPlayers();
  const dimensionIds = [
    "minecraft:overworld",
    "minecraft:nether",
    "minecraft:the_end",
    "meridian:ancient_abyss"
  ];
  const activeIds = new Set();

  for (const dimensionId of dimensionIds) {
    let dimension;
    try {
      dimension = world.getDimension(dimensionId);
    } catch (error) {
      continue;
    }

    let wardens;
    try {
      wardens = dimension.getEntities({ type: WARDEN_ID });
    } catch (error) {
      continue;
    }

    for (const warden of wardens) {
      activeIds.add(warden.id);
      const owner = getOwner(warden, players);
      followOwner(warden, owner);

      let hostiles = [];
      try {
        hostiles = dimension.getEntities({
          location: warden.location,
          maxDistance: PULSE_RADIUS,
          families: ["monster"]
        });
      } catch (error) {
        continue;
      }

      if (hostiles.length === 0) continue;
      const lastPulse = lastPulseTick.get(warden.id) ?? -PULSE_INTERVAL_TICKS;
      if (elapsedTicks - lastPulse < PULSE_INTERVAL_TICKS) continue;

      lastPulseTick.set(warden.id, elapsedTicks);
      pulse(warden, hostiles);
    }
  }

  for (const id of lastPulseTick.keys()) {
    if (!activeIds.has(id)) lastPulseTick.delete(id);
  }
}

export function initResonantWarden() {
  world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
    if (event.block.typeId !== HEAD_ID || event.itemStack?.typeId !== ECHO_SHARD_ID) return;
    event.cancel = true;
    if (!event.isFirstEvent) return;

    const player = event.player;
    const dimension = event.block.dimension;
    const head = {
      x: event.block.location.x,
      y: event.block.location.y,
      z: event.block.location.z
    };
    system.run(() => assembleWarden(player, dimension, head));
  });

  world.beforeEvents.playerInteractWithEntity.subscribe((event) => {
    if (event.target.typeId !== WARDEN_ID) return;
    const typeId = event.itemStack?.typeId;
    if (typeId !== SCULK_VEIN_ID && typeId !== ECHO_SHARD_ID) return;
    event.cancel = true;
    if (!event.isFirstEvent) return;

    const player = event.player;
    const warden = event.target;
    const item = event.itemStack;
    system.run(() => handleHealing(player, warden, item));
  });

  system.runInterval(updateWardens, PULSE_SCAN_INTERVAL_TICKS);
}