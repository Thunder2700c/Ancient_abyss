// behavior_pack/scripts/transit.js
// PHASE 4 - Transit, safe landing platform, portal contact detection.
// PHASE 9 - Echo Shard fallback transit (bottom of this file).
// BUG FIX REVISION - return transit rewritten, portal block orientation helper added.
//
// Verified against the Bedrock Wiki connector: Entity.teleport(location, {dimension, facingLocation}),
// Dimension.fillBlocks, TickingAreaManager, CustomCommandRegistry.registerCommand (callback runs read-only, so world
// changes go through system.run).
//
// LIMITATIONS / ENGINEERING DECISIONS
// - Portal contact: a no-collision custom block has no reliable "entity inside" event in the Script API, so contact is
//   detected by polling the feet and head block of every player every 5 ticks (APPROXIMATION of a touch trigger).
// - 16:1 scaling: NOT POSSIBLE IN BEDROCK as walking physics. Applied at ENTRY only: Abyss X/Z = Overworld X/Z / 16.
// - Return rule (bug fix): leaving the Abyss ALWAYS teleports to the stored return point (dimension, x, y, z saved on
//   entry). With no stored point the player goes to the Overworld default spawn. The teleport runs inside system.run
//   with a ticking area holding the destination chunk loaded, and logs before/after/20-ticks-later to the content log.
// - Portal re-entry loop (probable cause of "stuck in the Abyss"): the stored return point is where the player touched
//   the Overworld portal, i.e. INSIDE a portal block, so after the 3 second lock the contact scan sent them straight back.
//   Fix: after every transit the player must step OUT of the portal blocks once before contact can trigger again.
// - Portal block orientation (bug 1): a custom block that defines an axis / cardinal direction state renders skewed when
//   placed with default states. portalPermutation(axis) sets any such state it finds. It can only fix what the block
//   defines: if the skew comes from the geometry or transformation in blocks/abyssal_portal.json, that file must change.
// - PHASE 9 fallback: right-click ANY minecraft:reinforced_deepslate block holding an Echo Shard. Sonic boom effect, a
//   1.5 second frame charge, then the player enters the Abyss (Y=32, 16:1 mapping) or, when already in the Abyss,
//   returns to the stored return point. One Echo Shard is consumed per use outside Creative (set ECHO_SHARD_COST to 0
//   to make it free).
// - The return gate on the platform (3x4 portal inside a Reinforced Deepslate frame) is an engineering decision. Its
//   portal blocks need meridian:abyssal_portal to be registered (Gemini Phase 6); if the block is missing the gate is
//   left as an open frame and a warning is logged.

import {
  world,
  system,
  BlockVolume,
  BlockPermutation,
  CommandPermissionLevel,
  CustomCommandStatus,
  EntityComponentTypes,
  GameMode,
} from "@minecraft/server";
import {
  ABYSS_ENTRY_Y,
  OVERWORLD_ID,
  getAbyss,
  isInAbyss,
  overworldToAbyss,
  requestSkySeal,
} from "./dimension.js";
import { ensureTerrainAround, registerProtectedCenter } from "./strata.js";

export const PORTAL_BLOCK_ID = "meridian:abyssal_portal";

const PLATFORM_FLOOR_Y = ABYSS_ENTRY_Y - 1;
const PLATFORM_RADIUS = 6;
const PLATFORM_HEADROOM_Y = ABYSS_ENTRY_Y + 4;
const PLATFORM_BLOCK = "minecraft:polished_deepslate";
const GATE_FRAME_BLOCK = "minecraft:reinforced_deepslate";
const LANTERN_BLOCK = "minecraft:soul_lantern";
const GATE_OFFSET_Z = -4;
const LOAD_HALF_SIZE = 16;
const PORTAL_SCAN_INTERVAL_TICKS = 5;
const TRANSIT_LOCK_TICKS = 60;
const PLATFORMS_PROPERTY = "meridian:platforms";
const RETURN_PROPERTY = "meridian:return_point";

const transitLocks = new Map();
const transitBusy = new Set();
const needsPortalExit = new Set();
const portalParticleTicks = new Map();
const builtPlatforms = new Set();
let platformsLoaded = false;
let areaCounter = 0;

function fmt(position) {
  return Math.round(position.x * 10) / 10 + ", " + Math.round(position.y * 10) / 10 + ", " + Math.round(position.z * 10) / 10;
}

// Returns the portal block permutation with any axis / cardinal direction state set for a frame that spans the given
// horizontal axis ("x" = frame runs along X, "z" = frame runs along Z). Falls back to the plain block id string.
export function portalPermutation(axis) {
  try {
    const base = BlockPermutation.resolve(PORTAL_BLOCK_ID);
    const states = base.getAllStates();
    const wanted = {};
    for (const name of Object.keys(states)) {
      const lower = name.toLowerCase();
      if (lower.endsWith("axis")) {
        wanted[name] = axis;
      } else if (lower.endsWith("cardinal_direction")) {
        wanted[name] = axis === "x" ? "north" : "east";
      }
    }
    if (Object.keys(wanted).length === 0) {
      return base;
    }
    try {
      return BlockPermutation.resolve(PORTAL_BLOCK_ID, Object.assign({}, states, wanted));
    } catch (stateError) {
      console.warn("[meridian] Portal orientation state rejected, using default states: " + stateError);
      return base;
    }
  } catch (error) {
    return PORTAL_BLOCK_ID;
  }
}

function loadPlatforms() {
  if (platformsLoaded) {
    return;
  }
  platformsLoaded = true;
  const raw = world.getDynamicProperty(PLATFORMS_PROPERTY);
  if (typeof raw !== "string") {
    return;
  }
  try {
    for (const key of JSON.parse(raw)) {
      builtPlatforms.add(key);
    }
  } catch (error) {
    console.warn("[meridian] Platform registry was unreadable and has been reset.");
  }
}

function persistPlatforms() {
  world.setDynamicProperty(PLATFORMS_PROPERTY, JSON.stringify(Array.from(builtPlatforms)));
}

async function withLoadedArea(dimension, x, z, task) {
  areaCounter += 1;
  const areaId = "meridian_transit_" + areaCounter;
  const from = { x: Math.floor(x) - LOAD_HALF_SIZE, y: 0, z: Math.floor(z) - LOAD_HALF_SIZE };
  const to = { x: Math.floor(x) + LOAD_HALF_SIZE, y: 0, z: Math.floor(z) + LOAD_HALF_SIZE };
  let created = false;
  try {
    await world.tickingAreaManager.createTickingArea(areaId, { dimension: dimension, from: from, to: to });
    created = true;
    return await task();
  } finally {
    if (created) {
      try {
        world.tickingAreaManager.removeTickingArea(areaId);
      } catch (error) {
        console.warn("[meridian] Could not remove ticking area " + areaId + ": " + error);
      }
    }
  }
}

function fill(dimension, a, b, block) {
  dimension.fillBlocks(new BlockVolume(a, b), block);
}

async function buildPlatform(abyss, cx, cz) {
  loadPlatforms();
  const key = cx + "," + cz;
  if (builtPlatforms.has(key)) {
    return;
  }

  await withLoadedArea(abyss, cx, cz, async () => {
    const r = PLATFORM_RADIUS;

    fill(abyss, { x: cx - r, y: PLATFORM_FLOOR_Y, z: cz - r }, { x: cx + r, y: PLATFORM_FLOOR_Y, z: cz + r }, PLATFORM_BLOCK);
    fill(abyss, { x: cx - r, y: ABYSS_ENTRY_Y, z: cz - r }, { x: cx + r, y: PLATFORM_HEADROOM_Y, z: cz + r }, "minecraft:air");

    const gateZ = cz + GATE_OFFSET_Z;
    fill(abyss, { x: cx - 2, y: PLATFORM_FLOOR_Y, z: gateZ }, { x: cx + 2, y: PLATFORM_FLOOR_Y + 5, z: gateZ }, GATE_FRAME_BLOCK);
    try {
      fill(abyss, { x: cx - 1, y: ABYSS_ENTRY_Y, z: gateZ }, { x: cx + 1, y: ABYSS_ENTRY_Y + 3, z: gateZ }, portalPermutation("x"));
    } catch (error) {
      console.warn("[meridian] " + PORTAL_BLOCK_ID + " is not registered yet; return gate left as an open frame: " + error);
      fill(abyss, { x: cx - 1, y: ABYSS_ENTRY_Y, z: gateZ }, { x: cx + 1, y: ABYSS_ENTRY_Y + 3, z: gateZ }, "minecraft:air");
    }

    const corner = r - 1;
    for (const sx of [-corner, corner]) {
      for (const sz of [-corner, corner]) {
        const at = { x: cx + sx, y: ABYSS_ENTRY_Y, z: cz + sz };
        fill(abyss, at, at, LANTERN_BLOCK);
      }
    }
  });

  requestSkySeal(cx, cz);
  builtPlatforms.add(key);
  persistPlatforms();
}

function readReturnPoint(player) {
  const raw = player.getDynamicProperty(RETURN_PROPERTY);
  if (typeof raw !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(raw);
  } catch (error) {
    return undefined;
  }
}

function lockTransit(player) {
  transitLocks.set(player.id, system.currentTick + TRANSIT_LOCK_TICKS);
  needsPortalExit.add(player.id);
}

// Runs the teleport with content-log evidence before, right after, and 20 ticks later.
function performTeleport(player, destination, dimension, label) {
  console.warn("[meridian] " + label + ": teleporting " + player.name + " to " + dimension.id + " (" + fmt(destination) + ") BEFORE");
  player.teleport(destination, { dimension: dimension });
  console.warn("[meridian] " + label + ": teleport call returned. Player reports " + player.dimension.id + " (" + fmt(player.location) + ") AFTER");
  lockTransit(player);
  system.runTimeout(() => {
    try {
      const arrived = player.dimension.id === dimension.id;
      console.warn(
        "[meridian] " + label + ": 20 ticks later player is in " + player.dimension.id + " (" + fmt(player.location) + "). " +
          (arrived ? "Teleport succeeded." : "Teleport DID NOT take effect.")
      );
    } catch (error) {
      console.warn("[meridian] " + label + ": post-check skipped: " + error);
    }
  }, 20);
}

export async function enterAbyss(player) {
  if (transitBusy.has(player.id)) {
    return false;
  }
  transitBusy.add(player.id);
  try {
    const abyss = getAbyss();
    if (!abyss) {
      player.sendMessage("§c[Abyss] The Ancient Abyss dimension is not registered. Enable the Beta APIs experiment.");
      return false;
    }

    const origin = player.location;
    const target = overworldToAbyss(origin);
    const cx = Math.floor(target.x);
    const cz = Math.floor(target.z);

    registerProtectedCenter(cx, cz);
    try {
      await ensureTerrainAround(abyss, cx, cz, 2);
    } catch (terrainError) {
      console.warn("[meridian] Terrain generation before landing failed: " + terrainError);
    }
    await buildPlatform(abyss, cx, cz);

    player.setDynamicProperty(
      RETURN_PROPERTY,
      JSON.stringify({ d: player.dimension.id, x: origin.x, y: origin.y, z: origin.z, ax: cx + 0.5, az: cz + 0.5 })
    );
    console.warn("[meridian] enterAbyss: return point saved as " + player.dimension.id + " (" + fmt(origin) + ")");
    player.teleport(
      { x: cx + 0.5, y: ABYSS_ENTRY_Y, z: cz + 0.5 },
      { dimension: abyss, facingLocation: { x: cx + 0.5, y: ABYSS_ENTRY_Y + 1, z: cz + GATE_OFFSET_Z } }
    );
    lockTransit(player);
    return true;
  } catch (error) {
    console.warn("[meridian] enterAbyss failed: " + error);
    return false;
  } finally {
    transitBusy.delete(player.id);
  }
}

export async function leaveAbyss(player) {
  if (transitBusy.has(player.id)) {
    return false;
  }
  transitBusy.add(player.id);

  let destination;
  let destinationDimension;
  try {
    const stored = readReturnPoint(player);
    if (stored) {
      destinationDimension = world.getDimension(stored.d);
      destination = { x: stored.x, y: stored.y, z: stored.z };
      console.warn("[meridian] leaveAbyss: stored return point found: " + stored.d + " (" + fmt(destination) + ")");
    }
  } catch (error) {
    console.warn("[meridian] leaveAbyss: stored return point unusable: " + error);
    destination = undefined;
  }

  if (!destination) {
    destinationDimension = world.getDimension(OVERWORLD_ID);
    destination = world.getDefaultSpawnLocation();
    console.warn("[meridian] leaveAbyss: no return point, using Overworld default spawn (" + fmt(destination) + ")");
  }

  const teleportInNextTick = () =>
    new Promise((resolve) => {
      system.run(() => {
        try {
          performTeleport(player, destination, destinationDimension, "leaveAbyss");
        } catch (error) {
          console.warn("[meridian] leaveAbyss: teleport threw: " + error);
        } finally {
          resolve();
        }
      });
    });

  try {
    try {
      await withLoadedArea(destinationDimension, destination.x, destination.z, teleportInNextTick);
    } catch (areaError) {
      console.warn("[meridian] leaveAbyss: could not hold the destination chunk loaded, teleporting anyway: " + areaError);
      await teleportInNextTick();
    }
    return true;
  } finally {
    transitBusy.delete(player.id);
  }
}

function scanPortalContact() {
  const tick = system.currentTick;
  for (const player of world.getAllPlayers()) {
    try {
      if (transitBusy.has(player.id)) {
        continue;
      }
      const p = player.location;
      const bx = Math.floor(p.x);
      const by = Math.floor(p.y);
      const bz = Math.floor(p.z);
      const feet = player.dimension.getBlock({ x: bx, y: by, z: bz });
      const head = player.dimension.getBlock({ x: bx, y: by + 1, z: bz });
      const inside = feet?.typeId === PORTAL_BLOCK_ID || head?.typeId === PORTAL_BLOCK_ID;

      // The portal is a no-collision block, so its visual emitter is triggered by
      // the same contact poll used for transit. Throttle per player to avoid
      // spawning particles on every 5-tick scan.
      if (inside && tick - (portalParticleTicks.get(player.id) ?? -20) >= 20) {
        try {
          player.dimension.spawnParticle("meridian:abyssal_portal_particle", {
            x: p.x,
            y: p.y + 0.8,
            z: p.z
          });
          portalParticleTicks.set(player.id, tick);
        } catch (particleError) {
          console.warn("[meridian] Portal particle could not be spawned: " + particleError);
        }
      }

      if (needsPortalExit.has(player.id)) {
        if (!inside) {
          needsPortalExit.delete(player.id);
        }
        continue;
      }
      if ((transitLocks.get(player.id) ?? 0) > tick || !inside) {
        continue;
      }
      if (isInAbyss(player)) {
        leaveAbyss(player);
      } else {
        enterAbyss(player);
      }
    } catch (error) {
      console.warn("[meridian] Portal scan skipped a player: " + error);
    }
  }
}

export function registerTransitCommands(customCommandRegistry) {
  const definitions = [
    {
      name: "meridian:abyss_enter",
      description: "Test transit: enter the Ancient Abyss using the 16:1 mapping.",
      run: (player) => {
        if (isInAbyss(player)) {
          return { status: CustomCommandStatus.Failure, message: "You are already in the Ancient Abyss." };
        }
        system.run(() => enterAbyss(player));
        return { status: CustomCommandStatus.Success, message: "Descending into the Ancient Abyss..." };
      },
    },
    {
      name: "meridian:abyss_leave",
      description: "Test transit: leave the Ancient Abyss.",
      run: (player) => {
        if (!isInAbyss(player)) {
          return { status: CustomCommandStatus.Failure, message: "You are not in the Ancient Abyss." };
        }
        system.run(() => leaveAbyss(player));
        return { status: CustomCommandStatus.Success, message: "Returning to the surface..." };
      },
    },
  ];

  for (const definition of definitions) {
    customCommandRegistry.registerCommand(
      {
        name: definition.name,
        description: definition.description,
        permissionLevel: CommandPermissionLevel.GameDirectors,
        cheatsRequired: true,
      },
      (origin) => {
        const player = origin.sourceEntity;
        if (!player || player.typeId !== "minecraft:player") {
          return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
        }
        return definition.run(player);
      }
    );
  }
}

const ECHO_SHARD_ID = "minecraft:echo_shard";
const FRAME_BLOCK_ID = "minecraft:reinforced_deepslate";
const ECHO_CHARGE_TICKS = 30;
const ECHO_SHARD_COST = 1;
const echoCharging = new Set();

function heldItemAvailable(player, typeId, amount) {
  if (amount <= 0 || player.matches({ gameMode: GameMode.Creative })) {
    return true;
  }
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) {
    return false;
  }
  const item = container.getItem(player.selectedSlotIndex);
  return !!item && item.typeId === typeId && item.amount >= amount;
}

function consumeHeldItem(player, typeId, amount) {
  if (amount <= 0 || player.matches({ gameMode: GameMode.Creative })) {
    return true;
  }
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) {
    return false;
  }
  const slot = player.selectedSlotIndex;
  const item = container.getItem(slot);
  if (!item || item.typeId !== typeId || item.amount < amount) {
    return false;
  }
  if (item.amount > amount) {
    item.amount -= amount;
    container.setItem(slot, item);
  } else {
    container.setItem(slot, undefined);
  }
  return true;
}

function startEchoTransit(player, block) {
  if (echoCharging.has(player.id) || transitBusy.has(player.id)) {
    return;
  }
  if (!heldItemAvailable(player, ECHO_SHARD_ID, ECHO_SHARD_COST)) {
    return;
  }
  echoCharging.add(player.id);

  const dimension = block.dimension;
  const center = { x: block.location.x + 0.5, y: block.location.y + 0.5, z: block.location.z + 0.5 };
  try {
    dimension.spawnParticle("minecraft:sonic_explosion", center);
    dimension.playSound("mob.warden.sonic_boom", center);
  } catch (error) {
    console.warn("[meridian] Echo Shard effects failed: " + error);
  }

  const pulse = system.runInterval(() => {
    try {
      dimension.spawnParticle("minecraft:dragon_breath_trail", center);
    } catch (error) {
      system.clearRun(pulse);
    }
  }, 5);

  system.runTimeout(async () => {
    system.clearRun(pulse);
    try {
      const succeeded = isInAbyss(player)
        ? await leaveAbyss(player)
        : await enterAbyss(player);
      if (succeeded) {
        // Consume only after the transit routine reports success. If the player
        // changes their selected slot during the charge, leave the shard intact.
        if (!consumeHeldItem(player, ECHO_SHARD_ID, ECHO_SHARD_COST)) {
          player.sendMessage("§e[Abyss] Transit succeeded, but the Echo Shard was not consumed because it is no longer in your selected slot.");
        }
      } else {
        player.sendMessage("§c[Abyss] Transit failed. Your Echo Shard was not consumed.");
      }
    } catch (error) {
      console.warn("[meridian] Echo Shard transit skipped: " + error);
      try {
        player.sendMessage("§c[Abyss] Transit failed. Your Echo Shard was not consumed.");
      } catch (messageError) {}
    } finally {
      echoCharging.delete(player.id);
    }
  }, ECHO_CHARGE_TICKS);
}

export function initTransit() {
  world.afterEvents.worldLoad.subscribe(() => {
    loadPlatforms();
    world.afterEvents.playerLeave.subscribe((event) => {
      transitLocks.delete(event.playerId);
      transitBusy.delete(event.playerId);
      needsPortalExit.delete(event.playerId);
      echoCharging.delete(event.playerId);
      portalParticleTicks.delete(event.playerId);
    });
    world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
      if (event.block.typeId !== FRAME_BLOCK_ID || event.itemStack?.typeId !== ECHO_SHARD_ID) {
        return;
      }
      event.cancel = true;
      if (event.isFirstEvent) {
        const player = event.player;
        const block = event.block;
        system.run(() => startEchoTransit(player, block));
      }
    });
    system.runInterval(scanPortalContact, PORTAL_SCAN_INTERVAL_TICKS);
  });
}
