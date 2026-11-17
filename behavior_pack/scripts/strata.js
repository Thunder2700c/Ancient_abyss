// The Ancient Abyss — Phase 21 world-generation rework.
//
// IMPORTANT ENGINE LIMITATION:
// A Bedrock custom dimension currently has a void generator and one default biome.
// This module creates deterministic, player-proximal terrain across four large
// scripted biome regions. It is an approximation, not four native Bedrock biome generators.

import { world, system, BlockVolume } from "@minecraft/server";
import { getAbyss, isInAbyss } from "./dimension.js";
import { sanctuarySteps } from "./sanctuary.js";
import { biomeForChunk } from "./terrain/biome_selector.js";
import { generateAbyssalGardenFloor } from "./terrain/generators/abyssal_garden.js";
import { generateShatteredShelfFloor } from "./terrain/generators/shattered_shelf.js";
import { generateSulfuricCalderaFloor } from "./terrain/generators/sulfuric_caldera.js";
import { generatePetrifiedNecropolisFloor } from "./terrain/generators/petrified_necropolis.js";

const WORLD_MIN_Y = -64;
const WORLD_MAX_Y = 319;
const HADAL_MIN_Y = -63;
const HADAL_MAX_Y = 24;
const CAVE_MIN_Y = -59;
const CAVE_SURFACE_MARGIN = 5;
const CEILING_MIN_CLEARANCE = 40;
const CEILING_MAX_CLEARANCE = 60;
const CEILING_ROOF_Y = 144;
const PROTECT_RADIUS = 48;
const PROTECTED_PROPERTY = "meridian:protected_centers";

const TILE_SIZE = 2;
const TILES_PER_CHUNK = 16 / TILE_SIZE;
const SCAN_RADIUS_CHUNKS = 1;
const SCAN_INTERVAL_TICKS = 10;
const MAX_PENDING_CHUNKS = 64;
const MAX_CONCURRENT_CHUNK_WORKERS = 2;
const PREFETCH_MIN_DISTANCE = 16;
const PREFETCH_MAX_DISTANCE = 32;
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
let queueWorkersRunning = 0;
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

// Shared region lookup for atmosphere and other biome-aware systems.
export function getTerrainBiomeAt(x, z) {
  return biomeForChunk(Math.floor(x / 16), Math.floor(z / 16), hash01);
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

function ceilingBottomAt(x, z, biome) {
  // The visible underside follows the local terrain, like a Nether roofline.
  // Every point keeps a deterministic 40–60 block vertical gap above the floor.
  const broad = fractalNoise(x, z, 176, 31, 4);
  const detail = fractalNoise(x, z, 58, 32, 3);
  const blend = clamp(broad * 0.65 + detail * 0.35, 0, 0.999999);
  const clearance = CEILING_MIN_CLEARANCE
    + Math.floor(blend * (CEILING_MAX_CLEARANCE - CEILING_MIN_CLEARANCE + 1));
  return floorTopAtForBiome(x, z, biome) + clearance;
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

const GENERATOR_CONTEXT = {
  beginFloorChunk,
  TILE_SIZE,
  TILES_PER_CHUNK,
  floorTopAtForBiome,
  ridgeNoise,
  fractalNoise,
  hash01,
  put,
  HADAL_MIN_Y,
  isProtected,
};

function* generateFissureWalls(dimension, chunkX, chunkZ, biome) {
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
        const floorY = floorTopAtForBiome(sx, sz, biome);
        const roofY = ceilingBottomAt(sx, sz, biome);
        const baseY = floorY + 2 + Math.floor(fractalNoise(sx, sz, 88, 62, 2) * 3);
        const desiredHeight = 16 + Math.floor(fractalNoise(sx, sz, 38, 63, 3) * 28);
        const topY = Math.min(roofY - 5, baseY + desiredHeight);
        if (topY <= baseY + 17) {
          yield;
          continue;
        }
        put(dimension, x, baseY, z, x + 3, baseY + 5, z + 3, "meridian:sulfuric_basalt");
        yield;
        put(dimension, x + 1, baseY + 6, z + 1, x + 2, topY - 4, z + 2, "meridian:sulfuric_basalt");
        put(dimension, x + 1, baseY + 10, z + 1, x + 2, topY - 5, z + 2, "meridian:gloomstone");
        yield;
        put(dimension, x + 1, topY - 3, z + 1, x + 2, topY, z + 2, "meridian:sulfuric_basalt");
        yield;
        if (hash01(sx, sz, 64) > 0.62) {
          put(dimension, x + 1, baseY + 7, z + 1, x + 1, baseY + 9, z + 1, "meridian:raw_abyssal_silt_ore");
        }
      }
      yield;
    }
  }
}

function* generateBlackSmoker(dimension, chunkX, chunkZ, biome) {
  const roll = hash01(chunkX, chunkZ, 71);
  if (roll > 0.46) return;
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  const centerX = originX + 4 + Math.floor(hash01(chunkX, chunkZ, 72) * 8);
  const centerZ = originZ + 4 + Math.floor(hash01(chunkX, chunkZ, 73) * 8);
  if (isProtected(centerX, centerZ)) return;

  const floorY = floorTopAtForBiome(centerX, centerZ, biome);
  const roofY = ceilingBottomAt(centerX, centerZ, biome);
  const baseY = floorY + 2 + Math.floor(hash01(chunkX, chunkZ, 74) * 4);
  const topLimit = roofY - 5;
  if (topLimit - baseY < 14) return;
  const desiredTop = baseY + 24 + Math.floor(hash01(chunkX, chunkZ, 75) * 24);
  const topY = Math.min(topLimit, desiredTop);
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

function carveCaveBox(dimension, originX, originZ, biome, x, y, z, radiusX, radiusY, radiusZ) {
  const cx = clamp(Math.round(x), originX, originX + 15);
  const cz = clamp(Math.round(z), originZ, originZ + 15);
  if (isProtected(cx, cz)) return false;
  const surfaceY = floorTopAtForBiome(cx, cz, biome);
  const maxCaveY = surfaceY - CAVE_SURFACE_MARGIN;
  if (maxCaveY <= CAVE_MIN_Y + 1) return false;

  const cy = clamp(Math.round(y), CAVE_MIN_Y + 1, maxCaveY);
  const fromX = Math.max(originX, Math.floor(cx - radiusX));
  const toX = Math.min(originX + 15, Math.ceil(cx + radiusX));
  const fromZ = Math.max(originZ, Math.floor(cz - radiusZ));
  const toZ = Math.min(originZ + 15, Math.ceil(cz + radiusZ));
  const fromY = Math.max(CAVE_MIN_Y, cy - Math.max(0, Math.floor(radiusY)));
  const toY = Math.min(maxCaveY, cy + Math.max(0, Math.floor(radiusY)));
  if (toX < fromX || toZ < fromZ || toY < fromY) return false;

  put(dimension, fromX, fromY, fromZ, toX, toY, toZ, "minecraft:air");
  return true;
}

function* carveCaveChamber(dimension, originX, originZ, biome, centerX, centerY, centerZ, radiusX, radiusY, radiusZ) {
  for (let dy = -radiusY; dy <= radiusY; dy++) {
    const shape = Math.sqrt(Math.max(0, 1 - (dy * dy) / ((radiusY + 0.5) * (radiusY + 0.5))));
    const sliceX = Math.max(1, Math.floor(radiusX * shape));
    const sliceZ = Math.max(1, Math.floor(radiusZ * shape));
    carveCaveBox(
      dimension, originX, originZ, biome,
      centerX, centerY + dy, centerZ,
      sliceX, 0, sliceZ,
    );
    yield;
  }
}

function* carveWindingCave(dimension, chunkX, chunkZ, biome, startX, startY, startZ, steps, radius, verticalRadius, salt) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  let x = startX;
  let y = startY;
  let z = startZ;
  let angle = hash01(Math.floor(startX), Math.floor(startZ), salt) * Math.PI * 2;

  for (let step = 0; step < steps; step++) {
    const widen = hash01(chunkX * 16 + step, chunkZ * 16 + salt, salt + 1) > 0.88 ? 1 : 0;
    carveCaveBox(
      dimension, originX, originZ, biome,
      x, y, z,
      radius + widen, verticalRadius, radius + widen,
    );
    yield;

    angle += (hash01(chunkX * 16 + step, chunkZ * 16 + salt, salt + 2) - 0.5) * 1.18;
    x = clamp(x + Math.cos(angle) * 1.35, originX + 1, originX + 14);
    z = clamp(z + Math.sin(angle) * 1.35, originZ + 1, originZ + 14);
    y += (hash01(chunkX * 16 + step, chunkZ * 16 + salt, salt + 3) - 0.5) * 1.55;
  }
}

function* connectCaveToChunkEdge(dimension, chunkX, chunkZ, biome, side, centerX, centerY, centerZ) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  const horizontalEdge = side === "east" || side === "west";
  const edgeChunkX = side === "east" ? chunkX : side === "west" ? chunkX - 1 : chunkX;
  const edgeChunkZ = side === "south" ? chunkZ : side === "north" ? chunkZ - 1 : chunkZ;
  const axis = horizontalEdge ? 0 : 1;
  const edgeSalt = 730 + axis;

  // Adjacent chunks calculate the same edge key, portal roll, position, and height.
  if (hash01(edgeChunkX, edgeChunkZ, edgeSalt) > 0.30) return;
  const along = 3 + Math.floor(hash01(edgeChunkX, edgeChunkZ, edgeSalt + 1) * 10);
  const phase = hash01(edgeChunkX, edgeChunkZ, edgeSalt + 2) * Math.PI * 2;

  let edgeY = CAVE_MIN_Y + 2;
  if (horizontalEdge) {
    const leftBiome = biomeForChunk(edgeChunkX, edgeChunkZ, hash01);
    const rightBiome = biomeForChunk(edgeChunkX + 1, edgeChunkZ, hash01);
    const worldZ = originZ + along;
    const leftSurface = floorTopAtForBiome(edgeChunkX * 16 + 15, worldZ, leftBiome);
    const rightSurface = floorTopAtForBiome((edgeChunkX + 1) * 16, worldZ, rightBiome);
    const top = Math.min(leftSurface, rightSurface) - CAVE_SURFACE_MARGIN;
    if (top <= edgeY + 1) return;
    const level = Math.sqrt(hash01(edgeChunkX, edgeChunkZ, edgeSalt + 3));
    edgeY += Math.floor(level * (top - edgeY));
  } else {
    const northBiome = biomeForChunk(edgeChunkX, edgeChunkZ, hash01);
    const southBiome = biomeForChunk(edgeChunkX, edgeChunkZ + 1, hash01);
    const worldX = originX + along;
    const northSurface = floorTopAtForBiome(worldX, edgeChunkZ * 16 + 15, northBiome);
    const southSurface = floorTopAtForBiome(worldX, (edgeChunkZ + 1) * 16, southBiome);
    const top = Math.min(northSurface, southSurface) - CAVE_SURFACE_MARGIN;
    if (top <= edgeY + 1) return;
    const level = Math.sqrt(hash01(edgeChunkX, edgeChunkZ, edgeSalt + 3));
    edgeY += Math.floor(level * (top - edgeY));
  }

  let targetX = originX + 8;
  let targetZ = originZ + 8;
  if (side === "east") { targetX = originX + 15; targetZ = originZ + along; }
  else if (side === "west") { targetX = originX; targetZ = originZ + along; }
  else if (side === "south") { targetX = originX + along; targetZ = originZ + 15; }
  else { targetX = originX + along; targetZ = originZ; }

  const steps = 8;
  for (let step = 1; step <= steps; step++) {
    const t = step / steps;
    const curve = Math.sin(t * Math.PI) * Math.sin(t * Math.PI * 2 + phase) * 1.15;
    const x = centerX + (targetX - centerX) * t + (horizontalEdge ? 0 : curve);
    const z = centerZ + (targetZ - centerZ) * t + (horizontalEdge ? curve : 0);
    const y = centerY + (edgeY - centerY) * t
      + Math.sin(t * Math.PI * 2 + phase) * 0.75;
    carveCaveBox(dimension, originX, originZ, biome, x, y, z, 2, 1, 2);
    yield;
  }
}

function* generateSurfaceCaveMouth(dimension, chunkX, chunkZ, biome, centerX, centerZ, surfaceY, caveY, salt) {
  const originX = chunkX * 16;
  const originZ = chunkZ * 16;
  const depth = surfaceY - caveY;
  if (depth < 4 || isProtected(centerX, centerZ)) return;

  const phase = hash01(chunkX, chunkZ, salt) * Math.PI * 2;
  const maxRadius = 2 + Math.floor(hash01(chunkX, chunkZ, salt + 1) * 2);
  for (let step = 0; step <= depth; step++) {
    const t = step / Math.max(1, depth);
    const driftX = Math.sin(t * Math.PI * 1.35 + phase) * 0.85;
    const driftZ = Math.cos(t * Math.PI * 1.15 + phase) * 0.85;
    const radius = 2 + Math.floor(t * (maxRadius - 2));
    const x = clamp(Math.round(centerX + driftX), originX + 2, originX + 13);
    const z = clamp(Math.round(centerZ + driftZ), originZ + 2, originZ + 13);
    const y = surfaceY - step;
    put(dimension, x - radius, y, z - radius, x + radius, y, z + radius, "minecraft:air");
    yield;
  }
}

function* generateUndergroundCaves(dimension, chunkX, chunkZ, biome) {
  const ox = chunkX * 16;
  const oz = chunkZ * 16;
  const centerX = ox + 5 + Math.floor(hash01(chunkX, chunkZ, 310) * 6);
  const centerZ = oz + 5 + Math.floor(hash01(chunkX, chunkZ, 311) * 6);
  const surface = floorTopAtForBiome(centerX, centerZ, biome);

  // Leave protected sanctuaries and their approach terrain untouched.
  if (isProtected(centerX, centerZ)) return;

  // Deep ocean trenches do not have enough stone thickness for safe multi-level caves.
  if (surface < -50) return;

  // The upper system deliberately sits close to the local surface, rather than
  // concentrating every passage at the bottom of the terrain column.
  const upperDepth = 6 + Math.floor(hash01(chunkX, chunkZ, 312) * 8);
  const upperY = clamp(surface - upperDepth, CAVE_MIN_Y + 3, surface - CAVE_SURFACE_MARGIN - 1);

  // Cheese-style chamber: broad, irregular rooms with a rounded ceiling and floor.
  if (hash01(chunkX, chunkZ, 313) < 0.62) {
    const roomX = 4 + Math.floor(hash01(chunkX, chunkZ, 314) * 4);
    const roomZ = 4 + Math.floor(hash01(chunkX, chunkZ, 315) * 4);
    const roomY = 3 + Math.floor(hash01(chunkX, chunkZ, 316) * 3);
    yield* carveCaveChamber(dimension, ox, oz, biome, centerX, upperY, centerZ, roomX, roomY, roomZ);
  }

  // Some upper caves collapse through the surface, forming walk-in sinkholes.
  if (hash01(chunkX, chunkZ, 331) < 0.18) {
    yield* generateSurfaceCaveMouth(
      dimension, chunkX, chunkZ, biome,
      centerX, centerZ, surface, upperY, 332,
    );
  }

  // Spaghetti-style main tunnel and a narrower branch form a local cave network.
  const mainSteps = 20 + Math.floor(hash01(chunkX, chunkZ, 317) * 8);
  yield* carveWindingCave(dimension, chunkX, chunkZ, biome, centerX, upperY, centerZ, mainSteps, 2, 1, 318);
  const branchStartX = clamp(centerX + (hash01(chunkX, chunkZ, 319) > 0.5 ? 3 : -3), ox + 1, ox + 14);
  const branchStartZ = clamp(centerZ + (hash01(chunkX, chunkZ, 320) > 0.5 ? 3 : -3), oz + 1, oz + 14);
  const branchY = clamp(upperY - 3, CAVE_MIN_Y + 2, surface - CAVE_SURFACE_MARGIN - 1);
  yield* carveWindingCave(
    dimension, chunkX, chunkZ, biome,
    branchStartX, branchY, branchStartZ,
    11 + Math.floor(hash01(chunkX, chunkZ, 321) * 7), 1, 1, 322,
  );

  // A lower noodle passage and occasional lower chamber add depth variety.
  const lowerY = clamp(upperY - (8 + Math.floor(hash01(chunkX, chunkZ, 323) * 15)), CAVE_MIN_Y + 2, upperY - 4);
  if (lowerY < upperY - 5) {
    if (hash01(chunkX, chunkZ, 324) < 0.28) {
      yield* carveCaveChamber(
        dimension, ox, oz, biome,
        centerX + 1, lowerY, centerZ - 1,
        3 + Math.floor(hash01(chunkX, chunkZ, 325) * 3),
        2 + Math.floor(hash01(chunkX, chunkZ, 326) * 2),
        3 + Math.floor(hash01(chunkX, chunkZ, 327) * 3),
      );
    }
    yield* carveWindingCave(
      dimension, chunkX, chunkZ, biome,
      centerX + 1, lowerY, centerZ - 1,
      14 + Math.floor(hash01(chunkX, chunkZ, 328) * 7), 1, 1, 329,
    );

    // Occasional narrow vertical shafts connect the upper and lower cave levels.
    if (hash01(chunkX, chunkZ, 330) < 0.24) {
      const distance = upperY - lowerY;
      const shaftSteps = Math.max(4, Math.ceil(distance / 2));
      for (let step = 0; step <= shaftSteps; step++) {
        const t = step / shaftSteps;
        const driftX = Math.sin(t * Math.PI * 2) * 1.2;
        const driftZ = Math.cos(t * Math.PI * 2) * 1.2;
        carveCaveBox(dimension, ox, oz, biome, centerX + driftX, lowerY + distance * t, centerZ + driftZ, 1, 0, 1);
        yield;
      }
    }
  }

  // Deterministic portals line up across chunk borders without editing adjacent chunks.
  for (const side of ["north", "south", "west", "east"]) {
    yield* connectCaveToChunkEdge(dimension, chunkX, chunkZ, biome, side, centerX, upperY, centerZ);
  }
}

const ORE_HOSTS = {
  abyssal_garden: ["meridian:fractured_slate", "meridian:abyssal_silt"],
  shattered_shelf: ["meridian:fractured_slate", "meridian:polished_slate"],
  sulfuric_caldera: ["meridian:fractured_slate", "meridian:sulfuric_basalt"],
  petrified_necropolis: ["meridian:fractured_slate", "meridian:polished_slate", "meridian:chiseled_abyssal_bricks"],
};
const IRON_ORE_BY_BIOME = {
  abyssal_garden: "meridian:abyssal_iron_garden",
  shattered_shelf: "meridian:abyssal_iron_shelf",
  sulfuric_caldera: "meridian:abyssal_iron_caldera",
  petrified_necropolis: "meridian:abyssal_iron_necropolis",
};
const GOLD_ORE_BY_BIOME = {
  abyssal_garden: "meridian:abyssal_gold_garden",
  shattered_shelf: "meridian:abyssal_gold_shelf",
  sulfuric_caldera: "meridian:abyssal_gold_caldera",
  petrified_necropolis: "meridian:abyssal_gold_necropolis",
};
const ABYSSALITE_ORE_BY_BIOME = {
  abyssal_garden: "meridian:abyssalite_ore_garden",
  shattered_shelf: "meridian:abyssalite_ore_shelf",
  sulfuric_caldera: "meridian:abyssalite_ore_caldera",
  petrified_necropolis: "meridian:abyssalite_ore_necropolis",
};

function* generateOreVeins(dimension, chunkX, chunkZ, biome) {
  const ox = chunkX * 16, oz = chunkZ * 16;
  const hosts = ORE_HOSTS[biome] ?? ORE_HOSTS.abyssal_garden;
  for (let vein = 0; vein < 5; vein++) {
    const x = ox + 2 + Math.floor(hash01(chunkX, chunkZ, 400 + vein) * 12);
    const z = oz + 2 + Math.floor(hash01(chunkX, chunkZ, 410 + vein) * 12);
    if (isProtected(x, z)) { yield; continue; }
    const surface = floorTopAtForBiome(x, z, biome);
    const y = clamp(-56 + Math.floor(hash01(chunkX, chunkZ, 420 + vein) * Math.max(2, surface + 52)), -59, surface - 4);
    const roll = hash01(chunkX, chunkZ, 430 + vein);
    const ore = roll < 0.43 ? IRON_ORE_BY_BIOME[biome]
      : roll < 0.72 ? GOLD_ORE_BY_BIOME[biome]
      : ABYSSALITE_ORE_BY_BIOME[biome];
    const count = 3 + Math.floor(hash01(chunkX, chunkZ, 440 + vein) * 3);
    for (let i = 0; i < count; i++) {
      const bx = clamp(x + (i % 3) - 1, ox + 1, ox + 14);
      const bz = clamp(z + Math.floor(i / 3), oz + 1, oz + 14);
      const by = clamp(y + (i % 2), -59, surface - 4);
      try {
        const target = dimension.getBlock({ x: bx, y: by, z: bz });
        if (target && hosts.includes(target.typeId)) target.setType(ore);
      } catch (error) { /* a missing/out-of-bounds candidate is skipped */ }
      yield;
    }
  }
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
      const undersideY = ceilingBottomAt(sx, sz, biome);
      put(dimension, x, undersideY, z, x + 1, undersideY + 2, z + 1, "meridian:petrified_gloom_roots");
      yield;
      // A thick, continuous low roof replaces the old ceiling columns that reached Y=319.
      put(dimension, x, undersideY + 3, z, x + 1, CEILING_ROOF_Y, z + 1, "meridian:fractured_slate");
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

  const anchorY = ceilingBottomAt(centerX, centerZ, biome) - 2;
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
    const biome = biomeForChunk(chunkX, chunkZ, hash01);
    if (biome === "abyssal_garden") {
      yield* generateAbyssalGardenFloor(dimension, chunkX, chunkZ, GENERATOR_CONTEXT);
    } else if (biome === "shattered_shelf") {
      yield* generateShatteredShelfFloor(dimension, chunkX, chunkZ, GENERATOR_CONTEXT);
    } else if (biome === "sulfuric_caldera") {
      yield* generateSulfuricCalderaFloor(dimension, chunkX, chunkZ, GENERATOR_CONTEXT);
      yield* generateBlackSmoker(dimension, chunkX, chunkZ, biome);
    } else {
      yield* generatePetrifiedNecropolisFloor(dimension, chunkX, chunkZ, GENERATOR_CONTEXT);
    }
    yield* generateFissureWalls(dimension, chunkX, chunkZ, biome);
    yield* generateUndergroundCaves(dimension, chunkX, chunkZ, biome);
    yield* generateOreVeins(dimension, chunkX, chunkZ, biome);
    yield* generateInvertedCeiling(dimension, chunkX, chunkZ, biome);

    const cathedralChance = biome === "petrified_necropolis" ? 0.075 : 0.012;
    yield* buildInvertedCathedral(dimension, chunkX, chunkZ, biome);
    if (hash01(chunkX, chunkZ, 101) < 0.009 && hash01(chunkX, chunkZ, 91) >= cathedralChance && !isProtected(originX + 8, originZ + 8)) {
      yield* sanctuarySteps(dimension, chunkX, chunkZ, ceilingBottomAt(originX + 8, originZ + 8, biome), {
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

function prioritizeQueue(centerChunkX, centerChunkZ) {
  for (const job of queue) {
    const dx = job.chunkX - centerChunkX;
    const dz = job.chunkZ - centerChunkZ;
    job.priority = dx * dx + dz * dz;
  }
  queue.sort((a, b) => a.priority - b.priority);
}

async function runQueueWorker(dimension) {
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
    queueWorkersRunning = Math.max(0, queueWorkersRunning - 1);
    if (queue.length > 0) startQueueWorkers(dimension);
  }
}

function startQueueWorkers(dimension) {
  while (queueWorkersRunning < MAX_CONCURRENT_CHUNK_WORKERS && queue.length > 0) {
    queueWorkersRunning += 1;
    void runQueueWorker(dimension);
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
    job = { key, chunkX, chunkZ, priority: Infinity, waiters: [], rejecters: [] };
    pending.set(key, job);
    queue.push(job);
  }
  const done = new Promise((resolve, reject) => {
    job.waiters.push(resolve);
    job.rejecters.push(reject);
  });
  startQueueWorkers(dimension);
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
  const jobs = chunks.map((entry) => enqueue(dimension, entry.chunkX, entry.chunkZ));
  prioritizeQueue(centerChunkX, centerChunkZ);
  return Promise.all(jobs);
}

function scanPlayers() {
  const abyss = getAbyss();
  if (!abyss) return;
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player)) continue;
      const location = player.location;
      const centerChunkX = Math.floor(location.x / 16);
      const centerChunkZ = Math.floor(location.z / 16);

      // Keep the current 3x3 area ahead of the player. The scan runs twice per second
      // rather than once every five seconds, so a chunk is requested before it is entered.
      void ensureTerrainAround(abyss, location.x, location.z, SCAN_RADIUS_CHUNKS).catch((error) => {
        console.warn("[meridian] Nearby terrain generation deferred: " + error);
      });

      // Predict the walking/flying direction and queue the next 1–2 chunks early.
      const velocity = player.getVelocity();
      const speed = Math.hypot(velocity.x, velocity.z);
      if (speed > 0.03) {
        const lead = clamp(Math.ceil(speed * 120), PREFETCH_MIN_DISTANCE, PREFETCH_MAX_DISTANCE);
        const aheadX = location.x + (velocity.x / speed) * lead;
        const aheadZ = location.z + (velocity.z / speed) * lead;
        void ensureTerrainAround(abyss, aheadX, aheadZ, SCAN_RADIUS_CHUNKS).catch((error) => {
          console.warn("[meridian] Forward terrain prefetch deferred: " + error);
        });
      }

      // Re-rank queued work relative to the player's current chunk so stale requests
      // behind a moving player cannot monopolize the generator queue.
      prioritizeQueue(centerChunkX, centerChunkZ);
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
