// behavior_pack/scripts/strata.js
// Bounded, player-proximal terrain generation for the void-based Ancient Abyss dimension.
// Bedrock does not expose a per-chunk custom noise-generator hook, so this builds nearby
// 16x16 chunks with Script API jobs and keeps the result stable with a bedrock marker.

import { world, system, BlockVolume } from "@minecraft/server";
import { getAbyss, isInAbyss } from "./dimension.js";
import { sanctuarySteps } from "./sanctuary.js";

const DIMENSION_ID = "meridian:ancient_abyss";
const FLOOR_MIN = -58;
const FLOOR_RANGE = 80;
const CEILING_TOP = 319;
const TOWER_MAX_TOP = 128;
const PROTECT_RADIUS = 48;
const PROTECTED_PROPERTY = "meridian:protected_centers";
const SCAN_RADIUS_CHUNKS = 1;
const SCAN_INTERVAL_TICKS = 100;
const MAX_ATTEMPTS = 3;

const BLOCK_FALLBACKS = {
  "meridian:raw_abyssal_silt_ore": "meridian:abyssal_silt"
};

const protectedCenters = [];
const knownChunks = new Set();
const attempts = new Map();
const pending = new Map();
const order = [];
let protectedLoaded = false;
let working = false;
let areaCounter = 0;

function block(id) {
  return BLOCK_FALLBACKS[id] ?? id;
}

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274125045);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

function noise(x, z, scale, seed) {
  const gx = Math.floor(x / scale);
  const gz = Math.floor(z / scale);
  const fx = smooth(x / scale - gx);
  const fz = smooth(z / scale - gz);
  const a = hash(gx, gz, seed);
  const b = hash(gx + 1, gz, seed);
  const c = hash(gx, gz + 1, seed);
  const d = hash(gx + 1, gz + 1, seed);
  const top = a + (b - a) * fx;
  const bottom = c + (d - c) * fx;
  return top + (bottom - top) * fz;
}

function floorTopAt(x, z) {
  const n = 0.6 * noise(x, z, 96, 11) + 0.4 * noise(x, z, 32, 12);
  return Math.max(-58, Math.min(24, Math.floor(FLOOR_MIN + FLOOR_RANGE * n)));
}

function ceilingBottomAt(x, z) {
  return CEILING_TOP - (24 + Math.floor(noise(x, z, 72, 19) * 70));
}

function loadProtected() {
  if (protectedLoaded) return;
  protectedLoaded = true;
  const raw = world.getDynamicProperty(PROTECTED_PROPERTY);
  if (typeof raw !== "string") return;
  try {
    const entries = JSON.parse(raw);
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (Number.isFinite(entry?.x) && Number.isFinite(entry?.z)) {
          protectedCenters.push({ x: Math.floor(entry.x), z: Math.floor(entry.z) });
        }
      }
    }
  } catch (error) {
    console.warn("[meridian] Protected-center registry was unreadable: " + error);
  }
}

export function registerProtectedCenter(x, z) {
  loadProtected();
  const center = { x: Math.floor(x), z: Math.floor(z) };
  if (protectedCenters.some((entry) => entry.x === center.x && entry.z === center.z)) return;
  protectedCenters.push(center);
  try {
    world.setDynamicProperty(PROTECTED_PROPERTY, JSON.stringify(protectedCenters));
  } catch (error) {
    console.warn("[meridian] Could not save a protected terrain center: " + error);
  }
}

function isProtected(x, z) {
  loadProtected();
  return protectedCenters.some((center) => Math.hypot(center.x - x, center.z - z) < PROTECT_RADIUS);
}

function put(dimension, x1, y1, z1, x2, y2, z2, id) {
  if (!id) return;
  const minY = Math.max(-64, Math.min(y1, y2));
  const maxY = Math.min(CEILING_TOP, Math.max(y1, y2));
  if (maxY < minY) return;
  const from = {
    x: Math.min(x1, x2),
    y: minY,
    z: Math.min(z1, z2)
  };
  const to = {
    x: Math.max(x1, x2),
    y: maxY,
    z: Math.max(z1, z2)
  };
  try {
    dimension.fillBlocks(new BlockVolume(from, to), block(id));
  } catch (error) {
    console.warn("[meridian] Could not place terrain block " + id + " at " + from.x + "," + from.y + "," + from.z + ": " + error);
  }
}

function generateCell(dimension, x, z) {
  const sx = x + 2;
  const sz = z + 2;
  const floorTop = floorTopAt(sx, sz);
  const pit = noise(sx, sz, 40, 14) > 0.84;
  const guarded = isProtected(sx, sz);

  if (!pit) {
    put(dimension, x, -64, z, x + 3, -64, z + 3, "minecraft:bedrock");
    put(dimension, x, -63, z, x + 3, floorTop - 3, z + 3, "meridian:fractured_slate");
    put(dimension, x, floorTop - 2, z, x + 3, floorTop, z + 3, "meridian:abyssal_silt");

    const plant = hash(x, z, 40);
    if (plant < 0.12) {
      put(dimension, sx, floorTop + 1, sz, sx, floorTop + 1, sz, "meridian:glow_polyps");
    } else if (plant < 0.19) {
      put(dimension, sx, floorTop + 1, sz, sx, floorTop + 1, sz, "meridian:tendril_coral");
    }

    const tower = noise(sx, sz, 56, 15);
    if (!guarded && tower > 0.66) {
      const top = Math.min(TOWER_MAX_TOP, Math.floor(40 + ((tower - 0.66) / 0.34) * 78));
      if (top > floorTop + 8) {
        put(dimension, x, floorTop + 1, z, x + 3, top - 4, z + 3, "meridian:fractured_slate");
        for (let y = floorTop + 10; y < top - 4; y += 14) {
          put(dimension, x, y, z, x + 3, y + 1, z + 3, "meridian:gloomstone");
        }
        put(dimension, x, top - 3, z, x + 3, top, z + 3, "meridian:sulfuric_basalt");
        if (hash(x, z, 16) < 0.12) {
          const height = 6 + Math.floor(hash(x, z, 17) * 14);
          put(dimension, x + 1, top + 1, z + 1, x + 2, Math.min(CEILING_TOP - 4, top + height), z + 2, "meridian:sulfuric_basalt");
        }
        if (hash(x, z, 18) < 0.4) {
          put(dimension, x + 1, top - 7, z + 1, x + 1, top - 7, z + 1, "meridian:abyssal_silt");
        }
      }
    }
  }

  const ceilBottom = ceilingBottomAt(sx, sz);
  put(dimension, x, ceilBottom + 3, z, x + 3, CEILING_TOP, z + 3, "meridian:fractured_slate");
  put(dimension, x, ceilBottom, z, x + 3, ceilBottom + 2, z + 3, "meridian:petrified_gloom_roots");

  if (!guarded) {
    const roll = hash(x, z, 20);
    if (roll < 0.2) {
      const length = 8 + Math.floor(hash(x, z, 21) * 100);
      const bottom = Math.max(125, ceilBottom - length);
      put(dimension, x + 1, bottom + 4, z + 1, x + 2, ceilBottom - 1, z + 2, "meridian:fractured_slate");
      put(dimension, x + 1, bottom, z + 1, x + 1, bottom + 3, z + 1, "meridian:petrified_gloom_roots");
    } else if (roll < 0.23) {
      const bottom = Math.max(130, ceilBottom - 60 - Math.floor(hash(x, z, 22) * 60));
      put(dimension, x, bottom + 2, z, x + 3, ceilBottom - 1, z + 3, "meridian:polished_slate");
      put(dimension, x, bottom, z, x + 3, bottom + 1, z + 3, "meridian:chiseled_abyssal_bricks");
      put(dimension, x + 1, bottom - 1, z + 1, x + 1, bottom - 1, z + 1, "meridian:void_lantern");
    }
  }
}

function buildCathedral(dimension, chunkX, chunkZ) {
  if (hash(chunkX, chunkZ, 30) >= 0.02) return;
  const x0 = chunkX * 16;
  const z0 = chunkZ * 16;
  const centerX = x0 + 8;
  const centerZ = z0 + 8;
  if (isProtected(centerX, centerZ)) return;

  const yBase = 142 + Math.floor(hash(chunkX, chunkZ, 31) * 32);
  const roofY = yBase + 11;
  const bricks = "meridian:chiseled_abyssal_bricks";

  put(dimension, x0 + 1, yBase, z0 + 1, x0 + 14, roofY, z0 + 14, bricks);
  put(dimension, x0 + 2, yBase + 1, z0 + 2, x0 + 13, roofY - 1, z0 + 13, "minecraft:air");
  put(dimension, x0 + 2, yBase, z0 + 2, x0 + 13, yBase, z0 + 13, "meridian:polished_slate");
  put(dimension, x0 + 7, yBase + 1, z0 + 1, x0 + 8, yBase + 4, z0 + 1, "minecraft:air");

  for (const px of [x0 + 2, x0 + 12]) {
    for (const pz of [z0 + 2, z0 + 12]) {
      put(dimension, px, roofY + 1, pz, px + 1, Math.min(CEILING_TOP - 2, roofY + 18), pz + 1, "meridian:polished_slate");
      put(dimension, px, yBase + 1, pz, px, yBase + 1, pz, "meridian:void_lantern");
    }
  }

  const chest = { x: centerX, y: yBase + 1, z: z0 + 12 };
  put(dimension, chest.x, chest.y, chest.z, chest.x, chest.y, chest.z, "minecraft:chest");
}

function* generateChunkJob(dimension, chunkX, chunkZ, complete) {
  const x0 = chunkX * 16;
  const z0 = chunkZ * 16;
  try {
    for (let bx = 0; bx < 4; bx++) {
      for (let bz = 0; bz < 4; bz++) {
        generateCell(dimension, x0 + bx * 4, z0 + bz * 4);
        yield;
      }
    }
    buildCathedral(dimension, chunkX, chunkZ);
    if (hash(chunkX, chunkZ, 50) < 0.012 && hash(chunkX, chunkZ, 30) >= 0.02 && !isProtected(x0 + 8, z0 + 8)) {
      yield* sanctuarySteps(dimension, chunkX, chunkZ, ceilingBottomAt(x0 + 8, z0 + 8), {
        put: (ax, ay, az, bx, by, bz, id) => put(dimension, ax, ay, az, bx, by, bz, id),
        block: block
      });
    }
    put(dimension, x0, -64, z0, x0, -64, z0, "minecraft:bedrock");
    complete(true);
  } catch (error) {
    console.warn("[meridian] Terrain generation failed for chunk " + chunkX + "," + chunkZ + ": " + error);
    complete(false);
  }
}

async function processChunk(dimension, job) {
  const x0 = job.cx * 16;
  const z0 = job.cz * 16;
  const areaId = "meridian_gen_" + (++areaCounter);
  let areaCreated = false;

  try {
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension,
      from: { x: x0, y: 0, z: z0 },
      to: { x: x0 + 15, y: 0, z: z0 + 15 }
    });
    areaCreated = true;

    const marker = dimension.getBlock({ x: x0, y: -64, z: z0 });
    if (marker?.typeId === "minecraft:bedrock") {
      knownChunks.add(job.key);
      return;
    }

    const success = await new Promise((resolve) => {
      system.runJob(generateChunkJob(dimension, job.cx, job.cz, resolve));
    });
    if (success) {
      knownChunks.add(job.key);
      attempts.delete(job.key);
    } else {
      const count = (attempts.get(job.key) ?? 0) + 1;
      attempts.set(job.key, count);
      if (count >= MAX_ATTEMPTS) knownChunks.add(job.key);
    }
  } catch (error) {
    const count = (attempts.get(job.key) ?? 0) + 1;
    attempts.set(job.key, count);
    if (count >= MAX_ATTEMPTS) knownChunks.add(job.key);
    console.warn("[meridian] Could not generate terrain chunk " + job.key + ": " + error);
  } finally {
    if (areaCreated) {
      try {
        world.tickingAreaManager.removeTickingArea(areaId);
      } catch (error) {
        console.warn("[meridian] Could not remove terrain ticking area " + areaId + ": " + error);
      }
    }
  }
}

async function workQueue(dimension) {
  if (working) return;
  working = true;
  try {
    while (order.length > 0) {
      const job = order.shift();
      await processChunk(dimension, job);
      pending.delete(job.key);
      for (const resolve of job.waiters) resolve();
    }
  } finally {
    working = false;
    if (order.length > 0) void workQueue(dimension);
  }
}

function enqueue(dimension, chunkX, chunkZ) {
  const key = chunkX + "," + chunkZ;
  if (knownChunks.has(key)) return Promise.resolve();

  let job = pending.get(key);
  if (!job) {
    job = { key, cx: chunkX, cz: chunkZ, waiters: [] };
    pending.set(key, job);
    order.push(job);
  }

  const done = new Promise((resolve) => job.waiters.push(resolve));
  void workQueue(dimension);
  return done;
}

// Generate or verify every chunk in a square around the requested position.
export function ensureTerrainAround(dimension, x, z, radiusChunks = SCAN_RADIUS_CHUNKS) {
  const centerX = Math.floor(x / 16);
  const centerZ = Math.floor(z / 16);
  const radius = Math.max(0, Math.min(2, Math.floor(radiusChunks)));
  const chunks = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      chunks.push({ x: centerX + dx, z: centerZ + dz, distance: dx * dx + dz * dz });
    }
  }
  chunks.sort((a, b) => a.distance - b.distance);
  return Promise.all(chunks.map((chunk) => enqueue(dimension, chunk.x, chunk.z)));
}

function scanPlayers() {
  const abyss = getAbyss();
  if (!abyss) return;
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player)) continue;
      const p = player.location;
      void ensureTerrainAround(abyss, p.x, p.z).catch((error) => {
        console.warn("[meridian] Nearby terrain scan failed: " + error);
      });
    } catch (error) {
      console.warn("[meridian] Skipped a player during terrain scan: " + error);
    }
  }
}

export function initStrata() {
  world.afterEvents.worldLoad.subscribe(() => {
    loadProtected();
    system.runInterval(scanPlayers, SCAN_INTERVAL_TICKS);
  });
}
