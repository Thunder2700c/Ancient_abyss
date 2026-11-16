// The Ancient Abyss — Phase 21 world-generation rework.
//
// IMPORTANT ENGINE LIMITATION:
// A Bedrock custom dimension currently has a void generator and one default biome.
// This module therefore creates deterministic, player-proximal terrain and three
// biome-like vertical strata with Script API jobs. It is an approximation, not a
// native multi-biome/noise generator.

import { world, system, BlockVolume } from "@minecraft/server";
import { getAbyss, isInAbyss } from "./dimension.js";
import { sanctuarySteps } from "./sanctuary.js";

const WORLD_MIN_Y = -64;
const WORLD_MAX_Y = 319;
const HADAL_MIN_Y = -63;
const HADAL_MAX_Y = 24;
const FISSURE_MIN_Y = 30;
const FISSURE_MAX_Y = 120;
const CEILING_MIN_Y = 236;
const CEILING_MAX_Y = 300;
const PROTECT_RADIUS = 48;
const PROTECTED_PROPERTY = "meridian:protected_centers";

const TILE_SIZE = 2;
const TILES_PER_CHUNK = 16 / TILE_SIZE;
const SCAN_RADIUS_CHUNKS = 1;
const SCAN_INTERVAL_TICKS = 100;
const MAX_PENDING_CHUNKS = 64;
const MAX_KNOWN_CHUNKS = 2048;
const MAX_FAILURES_BEFORE_BACKOFF = 5;
const LEGACY_MARKER = "minecraft:bedrock";
const V2_MARKER = "minecraft:barrier";
const LEGACY_MARKER_OFFSET = { x: 0, y: -64, z: 0 };
const V2_MARKER_OFFSET = { x: 15, y: -64, z: 15 };

const BLOCK_FALLBACKS = {};

const protectedCenters = [];
const knownChunks = new Set();
const pending = new Map();
const queue = [];
const failures = new Map();
const retryAt = new Map();
let protectedLoaded = false;
let queueWorkerRunning = false;
let tickingAreaCounter = 0;
let worldSeed = 0;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function mixSeed(value) {
  const text = String(value ?? "0");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function loadWorldSeed() {
  try {
    worldSeed = mixSeed(world.seed);
  } catch (error) {
    worldSeed = 0;
    console.warn("[meridian] Could not read world seed; using deterministic fallback: " + error);
  }
}

function hash01(x, z, salt = 0) {
  let value = Math.imul((Math.floor(x) | 0) ^ worldSeed, 374761393);
  value = Math.imul(value + Math.imul((Math.floor(z) | 0) ^ salt, 668265263), 1274126177);
  value ^= value >>> 15;
  value = Math.imul(value, 2246822519);
  value ^= value >>> 13;
  return (value >>> 0) / 4294967296;
}

function fade(value) {
  return value * value * value * (value * (value * 6 - 15) + 10);
}

function valueNoise(x, z, scale, salt) {
  const gx = Math.floor(x / scale);
  const gz = Math.floor(z / scale);
  const tx = fade(x / scale - gx);
  const tz = fade(z / scale - gz);
  const a = hash01(gx, gz, salt);
  const b = hash01(gx + 1, gz, salt);
  const c = hash01(gx, gz + 1, salt);
  const d = hash01(gx + 1, gz + 1, salt);
  const north = a + (b - a) * tx;
  const south = c + (d - c) * tx;
  return north + (south - north) * tz;
}

function fractalNoise(x, z, baseScale, salt, octaves = 4) {
  let total = 0;
  let amplitude = 1;
  let amplitudeSum = 0;
  for (let octave = 0; octave < octaves; octave++) {
    total += valueNoise(x, z, baseScale / (2 ** octave), salt + octave * 101) * amplitude;
    amplitudeSum += amplitude;
    amplitude *= 0.5;
  }
  return total / amplitudeSum;
}

function ridgeNoise(x, z, scale, salt) {
  const value = fractalNoise(x, z, scale, salt, 3);
  return 1 - Math.abs(value * 2 - 1);
}

function floorTopAt(x, z) {
  const continental = fractalNoise(x, z, 192, 11, 4);
  const basin = fractalNoise(x, z, 72, 12, 4);
  const detail = fractalNoise(x, z, 26, 13, 3);
  const ridges = ridgeNoise(x, z, 104, 14);
  const trench = fractalNoise(x, z, 156, 15, 3);
  let height = -36
    + (continental - 0.5) * 50
    + (basin - 0.5) * 30
    + (detail - 0.5) * 14
    + (ridges - 0.48) * 15;
  if (trench > 0.72) height -= (trench - 0.72) * 50;
  return Math.floor(clamp(height, -60, HADAL_MAX_Y));
}


function biomeForChunk(chunkX, chunkZ) {
  // A low-frequency field creates broad, connected regions. The same chunk always
  // receives the same biome for a given world seed; this avoids random patchwork.
  const value = fractalNoise(chunkX * 16 + 8, chunkZ * 16 + 8, 720, 201, 2);
  if (value < 0.25) return "abyssal_garden";
  if (value < 0.50) return "shattered_shelf";
  if (value < 0.75) return "sulfuric_caldera";
  return "petrified_necropolis";
}

function floorTopAtForBiome(x, z, biome) {
  if (biome === "abyssal_garden") return floorTopAt(x, z);

  const continental = fractalNoise(x, z, 192, 211, 3);
  const detail = fractalNoise(x, z, 38, 212, 3);
  const ridges = ridgeNoise(x, z, 88, 213);

  if (biome === "shattered_shelf") {
    const height = -25 + (continental - 0.5) * 28 + (ridges - 0.45) * 28 + (detail - 0.5) * 8;
    return Math.floor(clamp(height, -56, 18));
  }

  if (biome === "sulfuric_caldera") {
    const caldera = fractalNoise(x, z, 116, 214, 3);
    let height = -42 + (continental - 0.5) * 22 + (detail - 0.5) * 10;
    if (caldera > 0.62) height -= (caldera - 0.62) * 54;
    if (ridges > 0.78) height += (ridges - 0.78) * 34;
    return Math.floor(clamp(height, -61, 12));
  }

  // Petrified Necropolis: broad, relatively level foundations with broken ridges.
  const height = -28 + (continental - 0.5) * 20 + (ridges - 0.5) * 18 + (detail - 0.5) * 6;
  return Math.floor(clamp(height, -52, 16));
}

function ceilingBottomAt(x, z) {
  const broad = fractalNoise(x, z, 176, 31, 4);
  const detail = fractalNoise(x, z, 58, 32, 3);
  const height = 270 + (broad - 0.5) * 38 + (detail - 0.5) * 20;
  return Math.floor(clamp(height, CEILING_MIN_Y, CEILING_MAX_Y));
}

function block(id) {
  return BLOCK_FALLBACKS[id] ?? id;
}

function loadProtected() {
  if (protectedLoaded) return;
  protectedLoaded = true;
  const raw = world.getDynamicProperty(PROTECTED_PROPERTY);
  if (typeof raw !== "string") return;
  try {
    const entries = JSON.parse(raw);
    if (!Array.isArray(entries)) return;
    for (const entry of entries) {
      if (Number.isFinite(entry?.x) && Number.isFinite(entry?.z)) {
        protectedCenters.push({ x: Math.floor(entry.x), z: Math.floor(entry.z) });
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
  const radiusSquared = PROTECT_RADIUS * PROTECT_RADIUS;
  return protectedCenters.some((center) => {
    const dx = center.x - x;
    const dz = center.z - z;
    return dx * dx + dz * dz < radiusSquared;
  });
}

function put(dimension, x1, y1, z1, x2, y2, z2, id) {
  if (!id) return;
  const from = {
    x: Math.min(x1, x2),
    y: Math.max(WORLD_MIN_Y, Math.min(y1, y2)),
    z: Math.min(z1, z2),
  };
  const to = {
    x: Math.max(x1, x2),
    y: Math.min(WORLD_MAX_Y, Math.max(y1, y2)),
    z: Math.max(z1, z2),
  };
  if (to.y < from.y) return;
  dimension.fillBlocks(new BlockVolume(from, to), block(id));
}


function* beginFloorChunk(dimension, chunkX, chunkZ) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  // Retain the legacy marker protocol; the completion marker is committed last.
  put(dimension, originX + 1, WORLD_MIN_Y, originZ, originX + 15, WORLD_MIN_Y, originZ + 15, "minecraft:bedrock");
  yield;
  put(dimension, originX, WORLD_MIN_Y, originZ + 1, originX, WORLD_MIN_Y, originZ + 15, "minecraft:bedrock");
  yield;
}

function* generateAbyssalGardenFloor(dimension, chunkX, chunkZ) {
  yield* beginFloorChunk(dimension, chunkX, chunkZ);
  const ox = chunkX * 16;
  const oz = chunkZ * 16;
  for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
    for (let tz = 0; tz < TILES_PER_CHUNK; tz++) {
      const x = ox + tx * TILE_SIZE;
      const z = oz + tz * TILE_SIZE;
      const sx = x + TILE_SIZE / 2;
      const sz = z + TILE_SIZE / 2;
      const surfaceY = floorTopAtForBiome(sx, sz, "abyssal_garden");
      const ridge = ridgeNoise(sx, sz, 34, 41);
      const shelf = ridge > 0.93 && hash01(sx, sz, 42) > 0.32;
      put(dimension, x, HADAL_MIN_Y, z, x + 1, surfaceY - 3, z + 1, "meridian:fractured_slate");
      yield;
      put(dimension, x, surfaceY - 2, z, x + 1, surfaceY, z + 1,
        shelf ? "meridian:fractured_slate" : "meridian:abyssal_silt");
      yield;
      if (!isProtected(sx, sz)) {
        const flora = hash01(sx, sz, 43);
        const ecology = fractalNoise(sx, sz, 42, 44, 3);
        if (ecology > 0.52 && flora < 0.13) {
          put(dimension, x, surfaceY + 1, z, x, surfaceY + 1, z, "meridian:glow_polyps");
          if (flora < 0.035) put(dimension, x + 1, surfaceY + 1, z + 1, x + 1, surfaceY + 1, z + 1, "meridian:glow_polyps");
        } else if (ecology < 0.42 && flora < 0.055) {
          put(dimension, x + 1, surfaceY + 1, z, x + 1, surfaceY + 1, z, "meridian:tendril_coral");
        }
      }
      yield;
    }
  }
}

function* generateShatteredShelfFloor(dimension, chunkX, chunkZ) {
  yield* beginFloorChunk(dimension, chunkX, chunkZ);
  const ox = chunkX * 16;
  const oz = chunkZ * 16;
  for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
    for (let tz = 0; tz < TILES_PER_CHUNK; tz++) {
      const x = ox + tx * TILE_SIZE;
      const z = oz + tz * TILE_SIZE;
      const sx = x + TILE_SIZE / 2;
      const sz = z + TILE_SIZE / 2;
      const surfaceY = floorTopAtForBiome(sx, sz, "shattered_shelf");
      put(dimension, x, HADAL_MIN_Y, z, x + 1, surfaceY - 3, z + 1, "meridian:fractured_slate");
      yield;
      put(dimension, x, surfaceY - 2, z, x + 1, surfaceY, z + 1,
        hash01(sx, sz, 221) > 0.62 ? "meridian:polished_slate" : "meridian:fractured_slate");
      yield;
      const ridge = ridgeNoise(sx, sz, 30, 222);
      if (!isProtected(sx, sz) && ridge > 0.84 && hash01(sx, sz, 223) > 0.55) {
        const rise = 2 + Math.floor(hash01(sx, sz, 224) * 5);
        put(dimension, x, surfaceY + 1, z, x + 1, surfaceY + rise, z + 1, "meridian:fractured_slate");
        yield;
      }
      yield;
    }
  }
}

function* generateSulfuricCalderaFloor(dimension, chunkX, chunkZ) {
  yield* beginFloorChunk(dimension, chunkX, chunkZ);
  const ox = chunkX * 16;
  const oz = chunkZ * 16;
  for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
    for (let tz = 0; tz < TILES_PER_CHUNK; tz++) {
      const x = ox + tx * TILE_SIZE;
      const z = oz + tz * TILE_SIZE;
      const sx = x + TILE_SIZE / 2;
      const sz = z + TILE_SIZE / 2;
      const surfaceY = floorTopAtForBiome(sx, sz, "sulfuric_caldera");
      put(dimension, x, HADAL_MIN_Y, z, x + 1, surfaceY - 3, z + 1, "meridian:fractured_slate");
      yield;
      put(dimension, x, surfaceY - 2, z, x + 1, surfaceY, z + 1, "meridian:sulfuric_basalt");
      yield;
      if (!isProtected(sx, sz) && hash01(sx, sz, 231) < 0.045) {
        put(dimension, x, surfaceY + 1, z, x + 1, surfaceY + 2, z + 1, "meridian:raw_abyssal_silt_ore");
        yield;
      }
      yield;
    }
  }
}

function* generatePetrifiedNecropolisFloor(dimension, chunkX, chunkZ) {
  yield* beginFloorChunk(dimension, chunkX, chunkZ);
  const ox = chunkX * 16;
  const oz = chunkZ * 16;
  for (let tx = 0; tx < TILES_PER_CHUNK; tx++) {
    for (let tz = 0; tz < TILES_PER_CHUNK; tz++) {
      const x = ox + tx * TILE_SIZE;
      const z = oz + tz * TILE_SIZE;
      const sx = x + TILE_SIZE / 2;
      const sz = z + TILE_SIZE / 2;
      const surfaceY = floorTopAtForBiome(sx, sz, "petrified_necropolis");
      put(dimension, x, HADAL_MIN_Y, z, x + 1, surfaceY - 3, z + 1, "meridian:fractured_slate");
      yield;
      put(dimension, x, surfaceY - 2, z, x + 1, surfaceY, z + 1,
        hash01(sx, sz, 241) > 0.70 ? "meridian:chiseled_abyssal_bricks" : "meridian:polished_slate");
      yield;
      yield;
    }
  }

  // Occasional broken street pylons make this region read as an abandoned city.
  if (hash01(chunkX, chunkZ, 242) < 0.22 && !isProtected(ox + 8, oz + 8)) {
    const cx = ox + 8;
    const cz = oz + 8;
    const baseY = floorTopAtForBiome(cx, cz, "petrified_necropolis");
    const height = 8 + Math.floor(hash01(chunkX, chunkZ, 243) * 25);
    for (const [dx, dz, scale] of [[-5, -5, 1], [-5, 5, 2], [5, -5, 2], [5, 5, 1]]) {
      const topY = baseY + Math.max(4, height - scale * 5);
      put(dimension, cx + dx, baseY + 1, cz + dz, cx + dx + 1, topY, cz + dz + 1, "meridian:chiseled_abyssal_bricks");
      yield;
      put(dimension, cx + dx - 1, topY, cz + dz - 1, cx + dx + 2, topY + 1, cz + dz + 2, "meridian:polished_slate");
      yield;
    }
  }
}

function* generateFissureWalls(dimension, chunkX, chunkZ) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  for (let cellX = 0; cellX < 4; cellX++) {
    for (let cellZ = 0; cellZ < 4; cellZ++) {
      const x = originX + cellX * 4;
      const z = originZ + cellZ * 4;
      const sx = x + 2;
      const sz = z + 2;
      if (isProtected(sx, sz)) {
        yield;
        continue;
      }
      const ridge = ridgeNoise(sx, sz, 44, 61);
      if (ridge > 0.94) {
        const baseY = FISSURE_MIN_Y + Math.floor(fractalNoise(sx, sz, 88, 62, 2) * 15);
        const height = 28 + Math.floor(fractalNoise(sx, sz, 38, 63, 3) * 58);
        const topY = Math.min(FISSURE_MAX_Y - 2, baseY + height);
        put(dimension, x, baseY, z, x + 3, baseY + 5, z + 3, "meridian:sulfuric_basalt");
        yield;
        if (topY > baseY + 10) {
          put(dimension, x + 1, baseY + 6, z + 1, x + 2, topY - 4, z + 2, "meridian:sulfuric_basalt");
          put(dimension, x + 1, baseY + 10, z + 1, x + 2, topY - 5, z + 2, "meridian:gloomstone");
          yield;
          put(dimension, x + 1, topY - 3, z + 1, x + 2, topY, z + 2, "meridian:sulfuric_basalt");
          yield;
        }
        if (hash01(sx, sz, 64) > 0.62) {
          put(dimension, x + 1, baseY + 7, z + 1, x + 1, baseY + 9, z + 1, "meridian:raw_abyssal_silt_ore");
        }
      }
      yield;
    }
  }
}

function* generateBlackSmoker(dimension, chunkX, chunkZ) {
  const roll = hash01(chunkX, chunkZ, 71);
  if (roll > 0.46) return;
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  const centerX = originX + 4 + Math.floor(hash01(chunkX, chunkZ, 72) * 8);
  const centerZ = originZ + 4 + Math.floor(hash01(chunkX, chunkZ, 73) * 8);
  if (isProtected(centerX, centerZ)) return;

  const baseY = 36 + Math.floor(hash01(chunkX, chunkZ, 74) * 38);
  const topY = Math.min(116, baseY + 26 + Math.floor(hash01(chunkX, chunkZ, 75) * 44));
  const height = topY - baseY;
  put(dimension, centerX - 4, baseY, centerZ - 4, centerX + 4, baseY + 3, centerZ + 4, "meridian:sulfuric_basalt");
  yield;
  put(dimension, centerX - 3, baseY + 4, centerZ - 3, centerX + 3, baseY + 10, centerZ + 3, "meridian:sulfuric_basalt");
  yield;
  if (height > 18) {
    put(dimension, centerX - 2, baseY + 11, centerZ - 2, centerX + 2, topY - 5, centerZ + 2, "meridian:sulfuric_basalt");
    put(dimension, centerX - 1, baseY + 13, centerZ - 1, centerX + 1, topY - 7, centerZ + 1, "meridian:gloomstone");
    yield;
  }
  put(dimension, centerX - 3, topY - 4, centerZ - 3, centerX + 3, topY, centerZ + 3, "meridian:sulfuric_basalt");
  put(dimension, centerX - 1, topY - 3, centerZ - 1, centerX + 1, topY - 1, centerZ + 1, "minecraft:air");
  put(dimension, centerX, topY, centerZ, centerX, topY, centerZ, "meridian:gloomstone");
  yield;
}


function* generateInvertedCeiling(dimension, chunkX, chunkZ, biome) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  for (let tileX = 0; tileX < TILES_PER_CHUNK; tileX++) {
    for (let tileZ = 0; tileZ < TILES_PER_CHUNK; tileZ++) {
      const x = originX + tileX * TILE_SIZE;
      const z = originZ + tileZ * TILE_SIZE;
      const sx = x + TILE_SIZE / 2;
      const sz = z + TILE_SIZE / 2;
      const undersideY = ceilingBottomAt(sx, sz);
      put(dimension, x, undersideY, z, x + 1, undersideY + 2, z + 1, "meridian:petrified_gloom_roots");
      yield;
      put(dimension, x, undersideY + 3, z, x + 1, WORLD_MAX_Y, z + 1, "meridian:fractured_slate");
      yield;

      if (!isProtected(sx, sz) && hash01(sx, sz, 81) < 0.08) {
        const floorY = floorTopAtForBiome(sx, sz, biome);
        const gap = Math.floor(hash01(sx, sz, 82) * 4);
        // Root tip sits at floorY + 1..4: ground contact or at most three air blocks.
        const bottomY = Math.min(undersideY - 4, floorY + 1 + gap);
        const width = hash01(sx, sz, 83) > 0.90 ? 1 : 0;
        put(dimension, sx - width, bottomY, sz - width, sx + width, undersideY - 1, sz + width, "meridian:petrified_gloom_roots");
        yield;
      }
      yield;
    }
  }
}

function* buildInvertedCathedral(dimension, chunkX, chunkZ, biome) {
  const structureChance = biome === "petrified_necropolis" ? 0.075 : 0.012;
  if (hash01(chunkX, chunkZ, 91) > structureChance) return;
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  const centerX = originX + 8;
  const centerZ = originZ + 8;
  if (isProtected(centerX, centerZ)) return;

  const anchorY = ceilingBottomAt(centerX, centerZ) - 2;
  const floorY = floorTopAtForBiome(centerX, centerZ, biome);
  // The inverted structure is scaled to the actual local terrain height and reaches the ground.
  const lowerY = Math.max(WORLD_MIN_Y + 1, floorY + 1);
  const brick = "meridian:chiseled_abyssal_bricks";
  put(dimension, centerX - 6, anchorY, centerZ - 6, centerX + 6, anchorY + 1, centerZ + 6, brick);
  yield;
  put(dimension, centerX - 5, anchorY - 1, centerZ - 5, centerX + 5, anchorY + 1, centerZ + 5, "minecraft:air");
  yield;

  for (const [dx, dz] of [[-5, -5], [-5, 5], [5, -5], [5, 5]]) {
    put(dimension, centerX + dx - 1, lowerY, centerZ + dz - 1, centerX + dx + 1, anchorY - 1, centerZ + dz + 1, brick);
    yield;
  }
  put(dimension, centerX - 5, anchorY - 8, centerZ - 1, centerX + 5, anchorY - 7, centerZ + 1, brick);
  yield;
  put(dimension, centerX - 1, anchorY - 8, centerZ - 5, centerX + 1, anchorY - 7, centerZ + 5, brick);
  yield;
  put(dimension, centerX - 1, lowerY, centerZ - 1, centerX + 1, anchorY - 9, centerZ + 1, "meridian:polished_slate");
  yield;
  put(dimension, centerX, anchorY - 13, centerZ, centerX, anchorY - 13, centerZ, "meridian:void_lantern");
  yield;
}

function* generateChunkJob(dimension, chunkX, chunkZ, complete) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  try {
    const biome = biomeForChunk(chunkX, chunkZ);
    if (biome === "abyssal_garden") {
      yield* generateAbyssalGardenFloor(dimension, chunkX, chunkZ);
    } else if (biome === "shattered_shelf") {
      yield* generateShatteredShelfFloor(dimension, chunkX, chunkZ);
    } else if (biome === "sulfuric_caldera") {
      yield* generateSulfuricCalderaFloor(dimension, chunkX, chunkZ);
      yield* generateBlackSmoker(dimension, chunkX, chunkZ);
    } else {
      yield* generatePetrifiedNecropolisFloor(dimension, chunkX, chunkZ);
    }
    yield* generateFissureWalls(dimension, chunkX, chunkZ);
    yield* generateInvertedCeiling(dimension, chunkX, chunkZ, biome);

    yield* buildInvertedCathedral(dimension, chunkX, chunkZ, biome);
    if (hash01(chunkX, chunkZ, 101) < 0.009 && hash01(chunkX, chunkZ, 91) >= 0.026 && !isProtected(originX + 8, originZ + 8)) {
      yield* sanctuarySteps(dimension, chunkX, chunkZ, ceilingBottomAt(originX + 8, originZ + 8), {
        put: (ax, ay, az, bx, by, bz, id) => put(dimension, ax, ay, az, bx, by, bz, id),
        block,
      });
    }

    // This is deliberately written last. The previous script placed its bedrock
    // marker at the start of generation, which could permanently bless a partial chunk.
    put(
      dimension,
      originX + V2_MARKER_OFFSET.x,
      V2_MARKER_OFFSET.y,
      originZ + V2_MARKER_OFFSET.z,
      originX + V2_MARKER_OFFSET.x,
      V2_MARKER_OFFSET.y,
      originZ + V2_MARKER_OFFSET.z,
      V2_MARKER,
    );
    yield;
    // Commit the legacy marker coordinate only after the V2 marker is present.
    put(dimension, originX, WORLD_MIN_Y, originZ, originX, WORLD_MIN_Y, originZ, "minecraft:bedrock");
    complete(true);
  } catch (error) {
    console.warn("[meridian] Terrain generation failed for chunk " + chunkX + "," + chunkZ + ": " + error);
    complete(false);
  }
}

function getChunkKey(chunkX, chunkZ) {
  return chunkX + "," + chunkZ;
}

function rememberChunk(key) {
  knownChunks.delete(key);
  knownChunks.add(key);
  if (knownChunks.size > MAX_KNOWN_CHUNKS) {
    const oldest = knownChunks.values().next().value;
    if (oldest !== undefined) knownChunks.delete(oldest);
  }
}

async function processChunk(dimension, job) {
  const originX = job.chunkX * 16;
  const originZ = job.chunkZ * 16;
  const markerV2 = { x: originX + V2_MARKER_OFFSET.x, y: V2_MARKER_OFFSET.y, z: originZ + V2_MARKER_OFFSET.z };
  const markerLegacy = { x: originX + LEGACY_MARKER_OFFSET.x, y: LEGACY_MARKER_OFFSET.y, z: originZ + LEGACY_MARKER_OFFSET.z };
  const areaId = "meridian_gen_" + (++tickingAreaCounter);
  const options = {
    dimension,
    from: { x: originX, y: 0, z: originZ },
    to: { x: originX + 15, y: 0, z: originZ + 15 },
  };
  let areaCreated = false;

  try {
    const manager = world.tickingAreaManager;
    if (!manager.hasCapacity(options)) {
      throw new Error("No ticking-area capacity is available for " + job.key);
    }
    if (manager.hasTickingArea(areaId)) manager.removeTickingArea(areaId);
    await manager.createTickingArea(areaId, options);
    areaCreated = true;

    const completeMarker = dimension.getBlock(markerV2);
    if (completeMarker?.typeId === V2_MARKER) {
      rememberChunk(job.key);
      failures.delete(job.key);
      retryAt.delete(job.key);
      return;
    }

    // Preserve V1 terrain and player builds. Legacy chunks are not destructively migrated.
    const legacyMarker = dimension.getBlock(markerLegacy);
    if (legacyMarker?.typeId === LEGACY_MARKER) {
      rememberChunk(job.key);
      failures.delete(job.key);
      retryAt.delete(job.key);
      return;
    }

    const success = await new Promise((resolve) => {
      system.runJob(generateChunkJob(dimension, job.chunkX, job.chunkZ, resolve));
    });
    if (!success) throw new Error("Generator job did not complete for " + job.key);
    rememberChunk(job.key);
    failures.delete(job.key);
    retryAt.delete(job.key);
  } catch (error) {
    const attempt = (failures.get(job.key) ?? 0) + 1;
    failures.set(job.key, attempt);
    const backoff = Math.min(6000, 100 * (2 ** Math.min(attempt, MAX_FAILURES_BEFORE_BACKOFF)));
    retryAt.set(job.key, system.currentTick + backoff);
    console.warn("[meridian] Could not generate chunk " + job.key + " (attempt " + attempt + "): " + error);
    throw error;
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

async function runQueue(dimension) {
  if (queueWorkerRunning) return;
  queueWorkerRunning = true;
  try {
    while (queue.length > 0) {
      const job = queue.shift();
      try {
        await processChunk(dimension, job);
        for (const resolve of job.waiters) resolve();
      } catch (error) {
        for (const reject of job.rejecters) reject(error);
      } finally {
        pending.delete(job.key);
      }
    }
  } finally {
    queueWorkerRunning = false;
    if (queue.length > 0) void runQueue(dimension);
  }
}

function enqueue(dimension, chunkX, chunkZ) {
  const key = getChunkKey(chunkX, chunkZ);
  if (knownChunks.has(key)) return Promise.resolve();

  const retryTick = retryAt.get(key) ?? 0;
  if (system.currentTick < retryTick) {
    return Promise.reject(new Error("Terrain chunk " + key + " is waiting for retry backoff"));
  }

  let job = pending.get(key);
  if (!job) {
    if (pending.size >= MAX_PENDING_CHUNKS) {
      return Promise.reject(new Error("Terrain generation queue is full"));
    }
    job = { key, chunkX, chunkZ, waiters: [], rejecters: [] };
    pending.set(key, job);
    queue.push(job);
  }
  const done = new Promise((resolve, reject) => {
    job.waiters.push(resolve);
    job.rejecters.push(reject);
  });
  void runQueue(dimension);
  return done;
}

export function ensureTerrainAround(dimension, x, z, radiusChunks = SCAN_RADIUS_CHUNKS) {
  const centerChunkX = Math.floor(x / 16);
  const centerChunkZ = Math.floor(z / 16);
  const radius = clamp(Math.floor(radiusChunks), 0, 2);
  const chunks = [];
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      chunks.push({ chunkX: centerChunkX + dx, chunkZ: centerChunkZ + dz, distance: dx * dx + dz * dz });
    }
  }
  chunks.sort((a, b) => a.distance - b.distance);
  return Promise.all(chunks.map((entry) => enqueue(dimension, entry.chunkX, entry.chunkZ)));
}

function scanPlayers() {
  const abyss = getAbyss();
  if (!abyss) return;
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player)) continue;
      const location = player.location;
      void ensureTerrainAround(abyss, location.x, location.z).catch((error) => {
        console.warn("[meridian] Nearby terrain generation deferred: " + error);
      });
    } catch (error) {
      console.warn("[meridian] Skipped a player during terrain scan: " + error);
    }
  }
}

export function initStrata() {
  world.afterEvents.worldLoad.subscribe(() => {
    loadWorldSeed();
    loadProtected();
    system.runInterval(scanPlayers, SCAN_INTERVAL_TICKS);
    console.info("[meridian] Phase 21 scripted strata generator ready. World seed hash: " + worldSeed);
  });
}
