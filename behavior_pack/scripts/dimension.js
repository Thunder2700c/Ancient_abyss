// behavior_pack/scripts/dimension.js
// PHASE 3 - The Ancient Abyss: dimension registration, bounds, environment.
//
// Verified against the Bedrock Wiki connector:
//   - DimensionRegistry.registerCustomDimension(typeId) exists, must run in system.beforeEvents.startup,
//     creates a VOID-generator dimension.
//   - Dimension.heightRange (NumberRange {min,max}), Dimension.fillBlocks(volume, block, options) (max 32768 blocks per call),
//     TickingAreaManager.createTickingArea(id, options) -> Promise<void>, removeTickingArea(id).
//
// ---------------------------------------------------------------------------
// LIMITATION REPORT (Phase 3)
// ---------------------------------------------------------------------------
// 1. World bounds Y -64..320 (384 tall): SUPPORTED. A script-registered custom dimension uses the default
//    height range (-64 to 320). verifyAbyssBounds() reads Dimension.heightRange on world load and warns if it differs.
//
// 2. Fixed time 18000: NOT POSSIBLE IN BEDROCK (per-dimension). Reason: WorldClockRegistry.registerClock exists,
//    but no documented API binds a custom dimension to its own clock; the time of day stays global.
//    Closest workaround: sealed ceiling (item 3) removes skylight so the Abyss is dark at any global time;
//    fog/sky colour belongs in the resource pack (biomes_client.json / fog files).
//
// 3. Zero natural skylight: APPROXIMATION. There is no per-dimension "has_skylight" switch. Skylight is blocked by
//    laying an opaque ceiling layer at Y=319 (like the Nether roof). requestSkySeal() builds it lazily, one
//    64x64 cell (+16 block margin so light cannot leak in sideways) at a time, around every player in the Abyss.
//    Only cells near players are sealed; unvisited areas are still lit by the sky.
//    Phase 21 replaces SKY_SEAL_BLOCK with the Petrified Gloom-Roots ceiling (air-only fill never overwrites it).
//
// 4. Ambient light floor 0.08: NOT POSSIBLE IN BEDROCK. Reason: ambient/minimum brightness is a client-side
//    rendering setting with no scripting or dimension component. Workaround: none needed; the dimension stays
//    truly dark, and light comes only from placed sources (Void Lanterns, Glow-Polyps, Soul Lanterns).
//
// 5. True 16:1 coordinate scaling: NOT POSSIBLE IN BEDROCK. Reason: the engine has no per-dimension coordinate
//    scale, so walking does not map 16:1. Workaround: overworldToAbyss()/abyssToOverworld() below apply the 16:1
//    mapping at every scripted transit (portal, Echo Shard fallback), used by Phase 4.
//
// 6. Water that does not evaporate / heat rejection: NOT POSSIBLE IN BEDROCK (per-dimension water physics).
//    Reason: no API or dimension component exposes ultrawarm/water behaviour. Behaviour is the engine default
//    for a custom dimension; nothing is scripted here.
//
// 7. Native custom biomes and terrain generation: NOT POSSIBLE IN BEDROCK in the Script API; the dimension is a
//    void generator. Handled by the scripted strata approximation in Phase 21.
// ---------------------------------------------------------------------------

import { world, system, BlockVolume } from "@minecraft/server";

export const OVERWORLD_ID = "minecraft:overworld";
export const ABYSS_ID = "meridian:ancient_abyss";

export const COORDINATE_SCALE = 16;
export const ABYSS_MIN_Y = -64;
export const ABYSS_MAX_Y = 320;
export const ABYSS_CEILING_Y = 319;
export const ABYSS_ENTRY_Y = 32;
export const OVERWORLD_RETURN_Y = -50;

export const SKY_SEAL_BLOCK = "minecraft:deepslate";

const SEAL_CELL_SIZE = 64;
const SEAL_MARGIN = 16;
const SEAL_LOOKAHEAD = 24;
const SEAL_CHECK_INTERVAL_TICKS = 40;
const SEAL_MAX_FAILURES = 3;
const SEALED_PROPERTY = "meridian:sealed_cells";

const sealedCells = new Set();
const pendingCells = new Set();
const failedCells = new Map();
const sealQueue = [];
let sealWorkerRunning = false;
let sealedLoaded = false;

export function getAbyss() {
  try {
    return world.getDimension(ABYSS_ID);
  } catch (error) {
    return undefined;
  }
}

export function isInAbyss(entity) {
  try {
    return entity.dimension.id === ABYSS_ID;
  } catch (error) {
    return false;
  }
}

// Overworld -> Abyss: 100 Overworld blocks become 6.25 Abyss blocks (16:1 compression).
export function overworldToAbyss(position, y = ABYSS_ENTRY_Y) {
  return {
    x: position.x / COORDINATE_SCALE,
    y: y,
    z: position.z / COORDINATE_SCALE,
  };
}

// Abyss -> Overworld: 100 Abyss blocks become 1,600 Overworld blocks.
export function abyssToOverworld(position, y = OVERWORLD_RETURN_Y) {
  return {
    x: position.x * COORDINATE_SCALE,
    y: y,
    z: position.z * COORDINATE_SCALE,
  };
}

export function registerAbyssDimension(dimensionRegistry) {
  try {
    dimensionRegistry.registerCustomDimension(ABYSS_ID);
  } catch (error) {
    console.warn("[meridian] Script registration of " + ABYSS_ID + " skipped (the dimensions/ancient_abyss.json file takes priority): " + error);
  }
}

function verifyAbyssBounds() {
  const abyss = getAbyss();
  if (!abyss) {
    console.error("[meridian] " + ABYSS_ID + " is not registered. Enable the Beta APIs experiment and check both pack manifests.");
    return;
  }
  try {
    const range = abyss.heightRange;
    if (range.min !== ABYSS_MIN_Y || range.max !== ABYSS_MAX_Y) {
      console.warn("[meridian] Abyss height range is " + range.min + " to " + range.max + ", expected " + ABYSS_MIN_Y + " to " + ABYSS_MAX_Y + ".");
    } else {
      console.warn("[meridian] Abyss registered. Height range " + range.min + " to " + range.max + " confirmed.");
    }
  } catch (error) {
    console.warn("[meridian] Could not read Abyss height range: " + error);
  }
}

function loadSealedCells() {
  if (sealedLoaded) {
    return;
  }
  sealedLoaded = true;
  const raw = world.getDynamicProperty(SEALED_PROPERTY);
  if (typeof raw !== "string") {
    return;
  }
  try {
    const list = JSON.parse(raw);
    for (const key of list) {
      sealedCells.add(key);
    }
  } catch (error) {
    console.warn("[meridian] Sealed cell registry was unreadable and has been reset.");
  }
}

function persistSealedCells() {
  world.setDynamicProperty(SEALED_PROPERTY, JSON.stringify(Array.from(sealedCells)));
}

function cellKey(rx, rz) {
  return rx + "," + rz;
}

function cellAreaId(rx, rz) {
  return "meridian_seal_" + String(rx).replace("-", "n") + "_" + String(rz).replace("-", "n");
}

// Queue the ceiling cell that contains (x, z) for sealing. Safe to call repeatedly.
export function requestSkySeal(x, z) {
  loadSealedCells();
  const rx = Math.floor(x / SEAL_CELL_SIZE);
  const rz = Math.floor(z / SEAL_CELL_SIZE);
  const key = cellKey(rx, rz);
  if (sealedCells.has(key) || pendingCells.has(key)) {
    return;
  }
  if ((failedCells.get(key) ?? 0) >= SEAL_MAX_FAILURES) {
    return;
  }
  pendingCells.add(key);
  sealQueue.push({ rx: rx, rz: rz });
  runSealWorker();
}

async function runSealWorker() {
  if (sealWorkerRunning) {
    return;
  }
  sealWorkerRunning = true;
  try {
    while (sealQueue.length > 0) {
      const job = sealQueue.shift();
      await sealCell(job.rx, job.rz);
    }
  } finally {
    sealWorkerRunning = false;
  }
}

async function sealCell(rx, rz) {
  const key = cellKey(rx, rz);
  const abyss = getAbyss();
  if (!abyss) {
    pendingCells.delete(key);
    return;
  }

  const from = {
    x: rx * SEAL_CELL_SIZE - SEAL_MARGIN,
    y: ABYSS_CEILING_Y,
    z: rz * SEAL_CELL_SIZE - SEAL_MARGIN,
  };
  const to = {
    x: rx * SEAL_CELL_SIZE + SEAL_CELL_SIZE - 1 + SEAL_MARGIN,
    y: ABYSS_CEILING_Y,
    z: rz * SEAL_CELL_SIZE + SEAL_CELL_SIZE - 1 + SEAL_MARGIN,
  };
  const areaId = cellAreaId(rx, rz);
  let areaCreated = false;

  try {
    try {
      world.tickingAreaManager.removeTickingArea(areaId);
    } catch (staleError) {
      // No stale ticking area with this id; nothing to clear.
    }
    await world.tickingAreaManager.createTickingArea(areaId, { dimension: abyss, from: from, to: to });
    areaCreated = true;
    abyss.fillBlocks(new BlockVolume(from, to), SKY_SEAL_BLOCK, {
      blockFilter: { includeTypes: ["minecraft:air"] },
    });
    sealedCells.add(key);
    persistSealedCells();
  } catch (error) {
    failedCells.set(key, (failedCells.get(key) ?? 0) + 1);
    console.warn("[meridian] Sky seal failed for cell " + key + ": " + error);
  } finally {
    pendingCells.delete(key);
    if (areaCreated) {
      try {
        world.tickingAreaManager.removeTickingArea(areaId);
      } catch (removeError) {
        console.warn("[meridian] Could not remove ticking area " + areaId + ": " + removeError);
      }
    }
  }
}

function scanPlayersForSkySeal() {
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player)) {
        continue;
      }
      const p = player.location;
      requestSkySeal(p.x, p.z);
      requestSkySeal(p.x + SEAL_LOOKAHEAD, p.z + SEAL_LOOKAHEAD);
      requestSkySeal(p.x + SEAL_LOOKAHEAD, p.z - SEAL_LOOKAHEAD);
      requestSkySeal(p.x - SEAL_LOOKAHEAD, p.z + SEAL_LOOKAHEAD);
      requestSkySeal(p.x - SEAL_LOOKAHEAD, p.z - SEAL_LOOKAHEAD);
    } catch (error) {
      console.warn("[meridian] Sky seal scan skipped a player: " + error);
    }
  }
}

export function initAbyssEnvironment() {
  world.afterEvents.worldLoad.subscribe(() => {
    verifyAbyssBounds();
    loadSealedCells();

    world.afterEvents.playerDimensionChange.subscribe((event) => {
      if (event.toDimension.id !== ABYSS_ID) {
        return;
      }
      const location = event.toLocation ?? event.player.location;
      requestSkySeal(location.x, location.z);
    });

    system.runInterval(scanPlayersForSkySeal, SEAL_CHECK_INTERVAL_TICKS);
  });
}
