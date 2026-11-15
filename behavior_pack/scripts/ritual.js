// behavior_pack/scripts/ritual.js
// PHASE 8 - Portal ritual ignition.
//
// HOW IT WORKS (engineering decisions, the PRD leaves the mechanics open)
// - Slot a Null Core: use meridian:null_core on a minecraft:chiseled_deepslate pedestal. The core is shown as an
//   amethyst cluster on top of the pedestal and recorded in a world dynamic property (validated again at ignition).
// - Place a minecraft:dragon_egg on top of meridian:sculk_altar (or right-click the altar/egg, or slot the last core).
// - Ignition needs: egg on the altar, 4 slotted pedestals within 12 blocks of the altar, and a Reinforced Deepslate
//   gate within 40 blocks: ANY complete rectangular ring of Reinforced Deepslate (outer size 5 to 40 blocks per side,
//   corners included) whose opening is empty (air, sculk vein or portal). Both X and Z orientations are searched, extra
//   Reinforced Deepslate touching the ring is ignored. The opening that gets filled is whatever size the ring has.
//   The search is time-sliced with system.runJob.
// - Sequence: purple beams core -> egg (3s), 5s Darkness to players within 32 blocks, roar, then the opening fills
//   with meridian:abyssal_portal. The egg is never consumed and is locked in place (interaction/break cancelled, and
//   put back every second if something removed it).
//
// LIMITATIONS
// - "Reverse Warden roar": vanilla has no reversed sound. mob.warden.roar is played at pitch 0.5 as an APPROXIMATION;
//   a real reversed sound needs a custom sound file registered in the resource pack sounds.json.
// - Dragon Egg physics: before ignition an unlocked egg can still be teleported by a click in survival; ritual clicks
//   on an egg resting on an altar are cancelled and treated as an ignition attempt.
// - Requires meridian:sculk_altar and meridian:abyssal_portal to be registered (Gemini Phase 6).
// - Portal orientation: the portal model is a flat pane along X. Frames that run along Z need the block state
//   meridian:axis = "z" (added in blocks/abyssal_portal.json with a 90 degree rotation). The fill now uses the axis of
//   the detected frame. /meridian:portal_refresh re-aligns a gate that was filled before this fix.

import {
  world,
  system,
  BlockVolume,
  CommandPermissionLevel,
  CustomCommandStatus,
  EntityComponentTypes,
  GameMode,
} from "@minecraft/server";
import { portalPermutation } from "./transit.js";

const ALTAR_ID = "meridian:sculk_altar";
const PEDESTAL_ID = "minecraft:chiseled_deepslate";
const CORE_ITEM = "meridian:null_core";
const CORE_MARKER = "minecraft:amethyst_cluster";
const EGG_ID = "minecraft:dragon_egg";
const FRAME_ID = "minecraft:reinforced_deepslate";
const PORTAL_ID = "meridian:abyssal_portal";

const FRAME_MIN_SIDE = 5;
const FRAME_MAX_SIDE = 40;
const PEDESTALS_REQUIRED = 4;
const PEDESTAL_RADIUS = 12;
const PEDESTAL_VERTICAL = 6;
const FRAME_SEARCH_XZ = 40;
const FRAME_SEARCH_Y = 40;
const EFFECT_RADIUS = 32;
const BEAM_TICKS = 60;
const DARKNESS_TICKS = 100;
const FILL_DELAY_TICKS = 20;
const EGG_CHECK_INTERVAL_TICKS = 20;

const CORES_PROPERTY = "meridian:ritual_cores";
const ALTARS_PROPERTY = "meridian:ritual_altars";

const coreKeys = new Set();
const ignitedAltars = new Set();
const busyAltars = new Set();

function loadSet(property, target) {
  const raw = world.getDynamicProperty(property);
  if (typeof raw !== "string") {
    return;
  }
  try {
    for (const key of JSON.parse(raw)) {
      target.add(key);
    }
  } catch (error) {
    console.warn("[meridian] Ritual registry " + property + " was unreadable and has been reset.");
  }
}

function saveSet(property, source) {
  world.setDynamicProperty(property, JSON.stringify(Array.from(source)));
}

function keyOf(dimensionId, x, y, z) {
  return dimensionId + "|" + x + "|" + y + "|" + z;
}

function parseKey(key) {
  const parts = key.split("|");
  return { dimensionId: parts[0], x: Number(parts[1]), y: Number(parts[2]), z: Number(parts[3]) };
}

function safeBlock(dimension, location) {
  try {
    return dimension.getBlock(location);
  } catch (error) {
    return undefined;
  }
}

function tell(player, message) {
  try {
    player.sendMessage(message);
  } catch (error) {
    console.warn("[meridian] Could not message player: " + error);
  }
}

function consumeHeldCore(player) {
  if (player.matches({ gameMode: GameMode.Creative })) {
    return;
  }
  const container = player.getComponent(EntityComponentTypes.Inventory)?.container;
  if (!container) {
    return;
  }
  const slot = player.selectedSlotIndex;
  const item = container.getItem(slot);
  if (!item || item.typeId !== CORE_ITEM) {
    return;
  }
  if (item.amount > 1) {
    item.amount -= 1;
    container.setItem(slot, item);
  } else {
    container.setItem(slot, undefined);
  }
}

function findAltarNear(dimension, origin) {
  for (let dy = -PEDESTAL_VERTICAL; dy <= PEDESTAL_VERTICAL; dy++) {
    for (let dx = -PEDESTAL_RADIUS; dx <= PEDESTAL_RADIUS; dx++) {
      for (let dz = -PEDESTAL_RADIUS; dz <= PEDESTAL_RADIUS; dz++) {
        const block = safeBlock(dimension, { x: origin.x + dx, y: origin.y + dy, z: origin.z + dz });
        if (block?.typeId === ALTAR_ID) {
          return block.location;
        }
      }
    }
  }
  return undefined;
}

function slotCore(player, pedestal) {
  const above = pedestal.above();
  if (!above?.isAir) {
    tell(player, "§5[Ritual]§r §7Something blocks the pedestal.");
    return;
  }
  const dimension = pedestal.dimension;
  const key = keyOf(dimension.id, pedestal.location.x, pedestal.location.y, pedestal.location.z);
  if (coreKeys.has(key)) {
    return;
  }

  above.setType(CORE_MARKER);
  consumeHeldCore(player);
  coreKeys.add(key);
  saveSet(CORES_PROPERTY, coreKeys);
  try {
    dimension.spawnParticle("minecraft:dragon_breath_trail", {
      x: above.location.x + 0.5,
      y: above.location.y + 0.5,
      z: above.location.z + 0.5,
    });
    dimension.playSound("beacon.activate", above.location);
  } catch (error) {
    console.warn("[meridian] Core slot effects failed: " + error);
  }
  tell(player, "§5[Ritual]§r §7The Null Core locks into the pedestal.");

  const altar = findAltarNear(dimension, pedestal.location);
  if (altar) {
    tryIgnite(dimension, altar, player);
  }
}

function collectPedestals(dimension, altar) {
  const found = [];
  let dirty = false;
  for (const key of Array.from(coreKeys)) {
    const p = parseKey(key);
    if (p.dimensionId !== dimension.id) {
      continue;
    }
    if (Math.abs(p.x - altar.x) > PEDESTAL_RADIUS || Math.abs(p.z - altar.z) > PEDESTAL_RADIUS || Math.abs(p.y - altar.y) > PEDESTAL_VERTICAL) {
      continue;
    }
    const base = safeBlock(dimension, { x: p.x, y: p.y, z: p.z });
    const top = safeBlock(dimension, { x: p.x, y: p.y + 1, z: p.z });
    if (!base || !top) {
      continue;
    }
    if (base.typeId === PEDESTAL_ID && top.typeId === CORE_MARKER) {
      found.push({ x: p.x, y: p.y, z: p.z });
    } else {
      coreKeys.delete(key);
      dirty = true;
    }
  }
  if (dirty) {
    saveSet(CORES_PROPERTY, coreKeys);
  }
  return found;
}

function cellKey(a, y) {
  return a + "," + y;
}

function ringComplete(plane, a0, y0, width, height) {
  // Validate all four sides. Checking only the top and right edges allowed
  // incomplete L-shaped frames to pass as a complete ritual gate.
  for (let i = 0; i < width; i++) {
    if (!plane.has(cellKey(a0 + i, y0))) {
      return false;
    }
    if (!plane.has(cellKey(a0 + i, y0 + height - 1))) {
      return false;
    }
  }
  for (let j = 0; j < height; j++) {
    if (!plane.has(cellKey(a0, y0 + j))) {
      return false;
    }
    if (!plane.has(cellKey(a0 + width - 1, y0 + j))) {
      return false;
    }
  }
  return true;
}

function interiorClear(dimension, from, to) {
  for (let x = from.x; x <= to.x; x++) {
    for (let y = from.y; y <= to.y; y++) {
      for (let z = from.z; z <= to.z; z++) {
        const block = safeBlock(dimension, { x: x, y: y, z: z });
        if (!block) {
          return false;
        }
        if (!block.isAir && block.typeId !== PORTAL_ID && block.typeId !== "minecraft:sculk_vein") {
          return false;
        }
      }
    }
  }
  return true;
}

function detectFrame(dimension, cells) {
  const list = Array.from(cells).map((key) => {
    const parts = key.split(",").map(Number);
    return { x: parts[0], y: parts[1], z: parts[2] };
  });

  for (const axis of ["x", "z"]) {
    const planes = new Map();
    for (const c of list) {
      const fixed = axis === "x" ? c.z : c.x;
      const a = axis === "x" ? c.x : c.z;
      let plane = planes.get(fixed);
      if (!plane) {
        plane = new Set();
        planes.set(fixed, plane);
      }
      plane.add(cellKey(a, c.y));
    }

    for (const [fixed, plane] of planes) {
      for (const key of plane) {
        const parts = key.split(",").map(Number);
        const a0 = parts[0];
        const y0 = parts[1];
        let rightRun = 1;
        while (rightRun < FRAME_MAX_SIDE && plane.has(cellKey(a0 + rightRun, y0))) {
          rightRun += 1;
        }
        let upRun = 1;
        while (upRun < FRAME_MAX_SIDE && plane.has(cellKey(a0, y0 + upRun))) {
          upRun += 1;
        }
        for (let width = FRAME_MIN_SIDE; width <= rightRun; width++) {
          for (let height = FRAME_MIN_SIDE; height <= upRun; height++) {
            if (!ringComplete(plane, a0, y0, width, height)) {
              continue;
            }
            const from = axis === "x" ? { x: a0 + 1, y: y0 + 1, z: fixed } : { x: fixed, y: y0 + 1, z: a0 + 1 };
            const to = axis === "x"
              ? { x: a0 + width - 2, y: y0 + height - 2, z: fixed }
              : { x: fixed, y: y0 + height - 2, z: a0 + width - 2 };
            if (interiorClear(dimension, from, to)) {
              return { from: from, to: to, axis: axis };
            }
          }
        }
      }
    }
  }
  return undefined;
}

function* scanFrameJob(dimension, center, resolve) {
  const cells = new Set();
  let checked = 0;
  for (let dy = -FRAME_SEARCH_Y; dy <= FRAME_SEARCH_Y; dy++) {
    for (let dx = -FRAME_SEARCH_XZ; dx <= FRAME_SEARCH_XZ; dx++) {
      for (let dz = -FRAME_SEARCH_XZ; dz <= FRAME_SEARCH_XZ; dz++) {
        const x = center.x + dx;
        const y = center.y + dy;
        const z = center.z + dz;
        if (safeBlock(dimension, { x: x, y: y, z: z })?.typeId === FRAME_ID) {
          cells.add(x + "," + y + "," + z);
        }
        checked += 1;
        if (checked % 3000 === 0) {
          yield;
        }
      }
    }
  }
  resolve({ frame: detectFrame(dimension, cells), count: cells.size });
}

function findFrame(dimension, center) {
  return new Promise((resolve) => {
    system.runJob(scanFrameJob(dimension, center, resolve));
  });
}

function drawBeams(dimension, from, to) {
  const start = { x: from.x + 0.5, y: from.y + 1.5, z: from.z + 0.5 };
  const end = { x: to.x + 0.5, y: to.y + 1.5, z: to.z + 0.5 };
  const length = Math.hypot(end.x - start.x, end.y - start.y, end.z - start.z);
  const steps = Math.max(1, Math.ceil(length));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    try {
      dimension.spawnParticle("minecraft:dragon_breath_trail", {
        x: start.x + (end.x - start.x) * t,
        y: start.y + (end.y - start.y) * t,
        z: start.z + (end.z - start.z) * t,
      });
    } catch (error) {
      return;
    }
  }
}

async function tryIgnite(dimension, altar, player) {
  const altarKey = keyOf(dimension.id, altar.x, altar.y, altar.z);
  if (ignitedAltars.has(altarKey)) {
    tell(player, "§5[Ritual]§r §7The conduit already hums with void energy.");
    return;
  }
  if (busyAltars.has(altarKey)) {
    return;
  }
  if (safeBlock(dimension, { x: altar.x, y: altar.y + 1, z: altar.z })?.typeId !== EGG_ID) {
    tell(player, "§5[Ritual]§r §7The Dragon Egg must rest on the Sculk Altar.");
    return;
  }
  const pedestals = collectPedestals(dimension, altar);
  if (pedestals.length < PEDESTALS_REQUIRED) {
    tell(player, "§5[Ritual]§r §7Null Cores slotted: " + pedestals.length + "/" + PEDESTALS_REQUIRED + ".");
    return;
  }

  busyAltars.add(altarKey);
  try {
    const result = await findFrame(dimension, altar);
    const frame = result.frame;
    if (!frame) {
      tell(
        player,
        "§5[Ritual]§r §7No complete Reinforced Deepslate ring with an empty opening found. Reinforced Deepslate blocks seen within range: " +
          result.count +
          "."
      );
      busyAltars.delete(altarKey);
      return;
    }

    const beamTimer = system.runInterval(() => {
      for (const pedestal of pedestals) {
        drawBeams(dimension, pedestal, altar);
      }
    }, 4);

    system.runTimeout(() => {
      system.clearRun(beamTimer);
      const center = { x: altar.x + 0.5, y: altar.y + 1.5, z: altar.z + 0.5 };
      for (const nearby of dimension.getPlayers({ location: center, maxDistance: EFFECT_RADIUS })) {
        nearby.addEffect("darkness", DARKNESS_TICKS, { amplifier: 0, showParticles: false });
      }
      try {
        dimension.spawnParticle("minecraft:sonic_explosion", center);
        dimension.playSound("mob.warden.roar", center, { volume: 4, pitch: 0.5 });
      } catch (error) {
        console.warn("[meridian] Ignition effects failed: " + error);
      }

      system.runTimeout(() => {
        try {
          dimension.fillBlocks(new BlockVolume(frame.from, frame.to), portalPermutation(frame.axis));
          ignitedAltars.add(altarKey);
          saveSet(ALTARS_PROPERTY, ignitedAltars);
          dimension.playSound("mob.warden.sonic_boom", center, { volume: 4 });
        } catch (error) {
          console.warn("[meridian] Could not fill the gate with " + PORTAL_ID + ": " + error);
        }
        busyAltars.delete(altarKey);
      }, FILL_DELAY_TICKS);
    }, BEAM_TICKS);
  } catch (error) {
    console.warn("[meridian] Ignition failed: " + error);
    busyAltars.delete(altarKey);
  }
}

// Re-fills the gate nearest to the player with correctly oriented portal blocks (fixes portals placed sideways).
async function refreshPortal(player) {
  const dimension = player.dimension;
  const result = await findFrame(dimension, player.location);
  if (!result.frame) {
    tell(player, "§5[Ritual]§r §7No Reinforced Deepslate gate found within " + FRAME_SEARCH_XZ + " blocks of you.");
    return;
  }
  try {
    dimension.fillBlocks(new BlockVolume(result.frame.from, result.frame.to), portalPermutation(result.frame.axis));
    tell(player, "§5[Ritual]§r §7Portal re-aligned to the frame (axis " + result.frame.axis + ").");
  } catch (error) {
    tell(player, "§5[Ritual]§r §7Could not refill the gate: " + error);
  }
}

export function registerRitualCommands(customCommandRegistry) {
  customCommandRegistry.registerCommand(
    {
      name: "meridian:portal_refresh",
      description: "Re-fill the nearest Reinforced Deepslate gate with correctly oriented portal blocks.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
    },
    (origin) => {
      const player = origin.sourceEntity;
      if (!player || player.typeId !== "minecraft:player") {
        return { status: CustomCommandStatus.Failure, message: "This command must be run by a player." };
      }
      system.run(() => refreshPortal(player));
      return { status: CustomCommandStatus.Success, message: "Aligning the portal to the frame..." };
    }
  );
}

function altarBelowEgg(block) {
  const below = block.below();
  return below?.typeId === ALTAR_ID ? below : undefined;
}

function isLockedEgg(block) {
  if (block.typeId !== EGG_ID) {
    return false;
  }
  const altar = altarBelowEgg(block);
  if (!altar) {
    return false;
  }
  return ignitedAltars.has(keyOf(block.dimension.id, altar.location.x, altar.location.y, altar.location.z));
}

function restoreEggs() {
  for (const key of ignitedAltars) {
    const p = parseKey(key);
    let dimension;
    try {
      dimension = world.getDimension(p.dimensionId);
    } catch (error) {
      continue;
    }
    const altar = safeBlock(dimension, { x: p.x, y: p.y, z: p.z });
    const above = safeBlock(dimension, { x: p.x, y: p.y + 1, z: p.z });
    if (altar?.typeId === ALTAR_ID && above && above.typeId !== EGG_ID) {
      above.setType(EGG_ID);
    }
  }
}

export function initRitual() {
  world.afterEvents.worldLoad.subscribe(() => {
    loadSet(CORES_PROPERTY, coreKeys);
    loadSet(ALTARS_PROPERTY, ignitedAltars);

    world.beforeEvents.playerInteractWithBlock.subscribe((event) => {
      const block = event.block;
      const player = event.player;
      if (block.typeId === PEDESTAL_ID && event.itemStack?.typeId === CORE_ITEM) {
        event.cancel = true;
        if (event.isFirstEvent) {
          system.run(() => slotCore(player, block));
        }
        return;
      }
      if (block.typeId === ALTAR_ID && !event.itemStack && event.isFirstEvent) {
        const dimension = block.dimension;
        const location = block.location;
        system.run(() => tryIgnite(dimension, location, player));
        return;
      }
      if (block.typeId === EGG_ID) {
        const altar = altarBelowEgg(block);
        if (altar) {
          event.cancel = true;
          if (event.isFirstEvent) {
            const dimension = block.dimension;
            const location = altar.location;
            system.run(() => tryIgnite(dimension, location, player));
          }
        }
      }
    });

    world.beforeEvents.playerBreakBlock.subscribe((event) => {
      if (isLockedEgg(event.block)) {
        event.cancel = true;
      }
    });

    world.afterEvents.playerPlaceBlock.subscribe((event) => {
      if (event.block.typeId !== EGG_ID) {
        return;
      }
      const altar = altarBelowEgg(event.block);
      if (altar) {
        tryIgnite(event.block.dimension, altar.location, event.player);
      }
    });

    system.runInterval(restoreEggs, EGG_CHECK_INTERVAL_TICKS);
  });
}
