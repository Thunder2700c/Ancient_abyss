import { world, system } from "@minecraft/server";

const DIMENSION_ID = "meridian:ancient_abyss";
const FLAG_PROP = "meridian:strata_generated";
const REGION_RADIUS = 64;
const Y_MIN = -64;
const Y_MAX = 320;

const HADAL_MAX_Y = 30;
const FISSURE_MAX_Y = 120;

const HADAL_BLOCKS = [
	"meridian:abyssal_silt",
	"meridian:abyssal_silt",
	"meridian:abyssal_silt",
	"meridian:glow_polyps",
	"meridian:tendril_coral"
];

const FISSURE_BLOCKS = [
	"meridian:sulfuric_basalt",
	"meridian:sulfuric_basalt",
	"meridian:gloomstone",
	"meridian:sulfuric_basalt",
	"meridian:raw_abyssal_silt_ore"
];

const NECROPOLIS_BLOCKS = [
	"meridian:fractured_slate",
	"meridian:fractured_slate",
	"meridian:polished_slate",
	"meridian:petrified_gloom_roots",
	"meridian:fractured_slate"
];

function hashPick(x, y, z, table) {
	let h = (x * 374761393 + y * 668265263 + z * 2246822519) >>> 0;
	h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
	return table[h % table.length];
}

function pickBlockForY(x, y, z) {
	if (y <= HADAL_MAX_Y) {
		return hashPick(x, y, z, HADAL_BLOCKS);
	}
	if (y <= FISSURE_MAX_Y) {
		return hashPick(x, y, z, FISSURE_BLOCKS);
	}
	return hashPick(x, y, z, NECROPOLIS_BLOCKS);
}

function* generateStrataJob(dimension) {
	for (let x = -REGION_RADIUS; x <= REGION_RADIUS; x++) {
		for (let z = -REGION_RADIUS; z <= REGION_RADIUS; z++) {
			const edgeDistSq = x * x + z * z;
			if (edgeDistSq > REGION_RADIUS * REGION_RADIUS) {
				continue;
			}
			for (let y = Y_MIN; y <= Y_MAX; y++) {
				const isShell =
					x === -REGION_RADIUS || x === REGION_RADIUS ||
					z === -REGION_RADIUS || z === REGION_RADIUS ||
					y === Y_MIN || y === Y_MAX;
				if (isShell) {
					yield;
					continue;
				}
				const blockId = pickBlockForY(x, y, z);
				try {
					dimension.getBlock({ x: x, y: y, z: z })?.setType(blockId);
				} catch (e) {
					// Column outside loaded/generatable range for this dimension type; skip.
				}
				yield;
			}
		}
	}

	world.setDynamicProperty(FLAG_PROP, true);
	world.sendMessage("message.meridian.strata_complete");
}

function tryRunStrataGeneration() {
	const alreadyGenerated = world.getDynamicProperty(FLAG_PROP);
	if (alreadyGenerated === true) {
		return;
	}

	let dimension;
	try {
		dimension = world.getDimension(DIMENSION_ID);
	} catch (e) {
		return;
	}
	if (!dimension) {
		return;
	}

	world.setDynamicProperty(FLAG_PROP, "running");
	system.runJob(generateStrataJob(dimension));
}

world.afterEvents.playerDimensionChange.subscribe((event) => {
	if (event.toDimension?.id !== DIMENSION_ID) {
		return;
	}
	const state = world.getDynamicProperty(FLAG_PROP);
	if (state === undefined) {
		tryRunStrataGeneration();
	}
});

// NOT POSSIBLE IN BEDROCK: true infinite, chunk-streamed custom terrain generation
// via script (Bedrock custom dimensions only support fixed built-in generator types,
// no per-chunk scripted noise generator hook). Workaround used above: a single bounded
// cylindrical region (radius 64, Y -64 to 320) is filled once via system.runJob on first
// dimension entry, guarded by a world dynamic property so it only runs once. This is an
// approximation of the three strata bands, not a true infinite generator.
const protectedCenters = [];
let working = false;
let areaCounter = 0;
let protectedLoaded = false;

function block(id) {
  if (resolved.has(id)) {
    return resolved.get(id);
  }
  let result = id;
  if (id.startsWith("meridian:") && !BlockTypes.get(id)) {
    result = STAND_INS[id];
    console.warn("[meridian] " + id + " is not registered; strata use " + (result ?? "nothing") + " instead.");
  }
  resolved.set(id, result);
  return result;
}

function hash(ix, iz, seed) {
  let h = Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
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
  return Math.floor(FLOOR_MIN + FLOOR_RANGE * (0.6 * noise(x, z, 96, 11) + 0.4 * noise(x, z, 32, 12)));
}

function ceilingBottomAt(x, z) {
  return 320 - (24 + Math.floor(noise(x, z, 72, 19) * 70));
}

function loadProtected() {
  if (protectedLoaded) {
    return;
  }
  protectedLoaded = true;
  const raw = world.getDynamicProperty(PROTECTED_PROPERTY);
  if (typeof raw !== "string") {
    return;
  }
  try {
    for (const entry of JSON.parse(raw)) {
      protectedCenters.push(entry);
    }
  } catch (error) {
    console.warn("[meridian] Protected centers were unreadable and have been reset.");
  }
}

export function registerProtectedCenter(x, z) {
  loadProtected();
  const rx = Math.floor(x);
  const rz = Math.floor(z);
  if (protectedCenters.some((c) => c.x === rx && c.z === rz)) {
    return;
  }
  protectedCenters.push({ x: rx, z: rz });
  world.setDynamicProperty(PROTECTED_PROPERTY, JSON.stringify(protectedCenters));
}

function isProtected(x, z) {
  for (const c of protectedCenters) {
    if (Math.hypot(c.x - x, c.z - z) < PROTECT_RADIUS) {
      return true;
    }
  }
  return false;
}

function put(dimension, x1, y1, z1, x2, y2, z2, id) {
  if (!id || y2 < y1) {
    return;
  }
  dimension.fillBlocks(
    new BlockVolume(
      { x: Math.min(x1, x2), y: Math.min(y1, y2), z: Math.min(z1, z2) },
      { x: Math.max(x1, x2), y: Math.max(y2, y1), z: Math.max(z1, z2) }
    ),
    id
  );
}

function generateCell(dimension, x, z) {
  const sx = x + 2;
  const sz = z + 2;
  const floorTop = floorTopAt(sx, sz);
  const pit = noise(sx, sz, 40, 14) > 0.82;
  const guarded = isProtected(sx, sz);

  if (!pit) {
    put(dimension, x, -64, z, x + 3, -64, z + 3, "minecraft:bedrock");
    put(dimension, x, -63, z, x + 3, floorTop - 3, z + 3, block("meridian:fractured_slate"));
    put(dimension, x, floorTop - 2, z, x + 3, floorTop, z + 3, block("meridian:abyssal_silt"));

    const plant = hash(x, z, 40);
    if (plant < 0.14) {
      put(dimension, sx, floorTop + 1, sz, sx, floorTop + 1, sz, block("meridian:glow_polyps"));
    } else if (plant < 0.21) {
      put(dimension, sx, floorTop + 1, sz, sx, floorTop + 1, sz, block("meridian:tendril_coral"));
    }

    const tower = noise(sx, sz, 56, 15);
    if (!guarded && tower > 0.64) {
      const top = Math.min(TOWER_MAX_TOP, Math.floor(40 + ((tower - 0.64) / 0.36) * 78));
      if (top > floorTop + 8) {
        put(dimension, x, floorTop + 1, z, x + 3, top - 4, z + 3, block("meridian:fractured_slate"));
        for (let y = floorTop + 10; y < top - 4; y += 14) {
          put(dimension, x, y, z, x + 3, y + 1, z + 3, block("meridian:gloomstone"));
        }
        put(dimension, x, top - 3, z, x + 3, top, z + 3, block("meridian:sulfuric_basalt"));
        if (hash(x, z, 16) < 0.12) {
          const height = 6 + Math.floor(hash(x, z, 17) * 14);
          put(dimension, x + 1, top + 1, z + 1, x + 2, top + height, z + 2, block("meridian:sulfuric_basalt"));
        }
        if (hash(x, z, 18) < 0.4) {
          put(dimension, x + 1, top - 7, z + 1, x + 1, top - 7, z + 1, block("meridian:abyssal_silt"));
        }
      }
    }
  }

  const ceilBottom = ceilingBottomAt(sx, sz);
  put(dimension, x, ceilBottom + 3, z, x + 3, CEILING_TOP, z + 3, block("meridian:fractured_slate"));
  put(dimension, x, ceilBottom, z, x + 3, ceilBottom + 2, z + 3, block("meridian:petrified_gloom_roots"));

  if (!guarded) {
    const roll = hash(x, z, 20);
    if (roll < 0.2) {
      const length = 8 + Math.floor(hash(x, z, 21) * 100);
      const bottom = Math.max(125, ceilBottom - length);
      put(dimension, x + 1, bottom + 4, z + 1, x + 2, ceilBottom - 1, z + 2, block("meridian:fractured_slate"));
      put(dimension, x + 1, bottom, z + 1, x + 1, bottom + 3, z + 1, block("meridian:petrified_gloom_roots"));
    } else if (roll < 0.23) {
      const bottom = Math.max(130, ceilBottom - 60 - Math.floor(hash(x, z, 22) * 60));
      put(dimension, x, bottom + 2, z, x + 3, ceilBottom - 1, z + 3, block("meridian:polished_slate"));
      put(dimension, x, bottom, z, x + 3, bottom + 1, z + 3, block("meridian:chiseled_abyssal_bricks"));
      put(dimension, x + 1, bottom - 1, z + 1, x + 1, bottom - 1, z + 1, block("meridian:void_lantern"));
    }
  }
}

function buildCathedral(dimension, cx, cz) {
  if (hash(cx, cz, 30) >= 0.02) {
    return;
  }
  const x0 = cx * 16;
  const z0 = cz * 16;
  if (isProtected(x0 + 8, z0 + 8)) {
    return;
  }
  const yBase = 140 + Math.floor(hash(cx, cz, 31) * 40);
  const roofY = yBase + 11;
  const ceilBottom = ceilingBottomAt(x0 + 8, z0 + 8);
  const bricks = block("meridian:chiseled_abyssal_bricks");

  put(dimension, x0 + 1, yBase, z0 + 1, x0 + 14, roofY, z0 + 14, bricks);
  put(dimension, x0 + 2, yBase + 1, z0 + 2, x0 + 13, roofY - 1, z0 + 13, "minecraft:air");
  put(dimension, x0 + 2, yBase, z0 + 2, x0 + 13, yBase, z0 + 13, block("meridian:polished_slate"));
  put(dimension, x0 + 7, yBase + 1, z0 + 1, x0 + 8, yBase + 4, z0 + 1, "minecraft:air");

  for (const px of [x0 + 2, x0 + 12]) {
    for (const pz of [z0 + 2, z0 + 12]) {
      put(dimension, px, roofY + 1, pz, px + 1, ceilBottom - 1, pz + 1, block("meridian:polished_slate"));
      put(dimension, px, yBase + 1, pz, px, yBase + 1, pz, block("meridian:void_lantern"));
    }
  }

  const chest = { x: x0 + 8, y: yBase + 1, z: z0 + 12 };
  put(dimension, chest.x, chest.y, chest.z, chest.x, chest.y, chest.z, "minecraft:chest");
  try {
    dimension.runCommand("loot insert " + chest.x + " " + chest.y + " " + chest.z + ' loot "' + VAULT_LOOT_TABLE + '"');
  } catch (error) {
    console.warn("[meridian] Vault loot table '" + VAULT_LOOT_TABLE + "' could not be applied: " + error);
  }
}

function* chunkJob(dimension, cx, cz, finish) {
  const x0 = cx * 16;
  const z0 = cz * 16;
  try {
    for (let bx = 0; bx < 4; bx++) {
      for (let bz = 0; bz < 4; bz++) {
        generateCell(dimension, x0 + bx * 4, z0 + bz * 4);
        yield;
      }
    }
    buildCathedral(dimension, cx, cz);
    if (hash(cx, cz, 50) < 0.012 && hash(cx, cz, 30) >= 0.02 && !isProtected(x0 + 8, z0 + 8)) {
      yield* sanctuarySteps(dimension, cx, cz, ceilingBottomAt(x0 + 8, z0 + 8), {
        put: (ax, ay, az, bx, by, bz, id) => put(dimension, ax, ay, az, bx, by, bz, id),
        block: block,
      });
    }
    put(dimension, x0, -64, z0, x0, -64, z0, "minecraft:bedrock");
    finish(true);
  } catch (error) {
    console.warn("[meridian] Strata generation failed for chunk " + cx + "," + cz + ": " + error);
    finish(false);
  }
}

async function processChunk(dimension, job) {
  const x0 = job.cx * 16;
  const z0 = job.cz * 16;
  areaCounter += 1;
  const areaId = "meridian_gen_" + areaCounter;
  let created = false;
  try {
    await world.tickingAreaManager.createTickingArea(areaId, {
      dimension: dimension,
      from: { x: x0, y: 0, z: z0 },
      to: { x: x0 + 15, y: 0, z: z0 + 15 },
    });
    created = true;
    const marker = dimension.getBlock({ x: x0, y: -64, z: z0 });
    if (marker?.typeId === "minecraft:bedrock") {
      knownChunks.add(job.key);
      return;
    }
    const ok = await new Promise((resolve) => {
      system.runJob(chunkJob(dimension, job.cx, job.cz, resolve));
    });
    if (ok) {
      knownChunks.add(job.key);
    } else {
      const count = (attempts.get(job.key) ?? 0) + 1;
      attempts.set(job.key, count);
      if (count >= MAX_ATTEMPTS) {
        knownChunks.add(job.key);
      }
    }
  } catch (error) {
    console.warn("[meridian] Strata chunk " + job.key + " skipped: " + error);
    attempts.set(job.key, (attempts.get(job.key) ?? 0) + 1);
    if ((attempts.get(job.key) ?? 0) >= MAX_ATTEMPTS) {
      knownChunks.add(job.key);
    }
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

async function work(dimension) {
  if (working) {
    return;
  }
  working = true;
  try {
    while (order.length > 0) {
      const job = order.shift();
      await processChunk(dimension, job);
      pending.delete(job.key);
      for (const waiter of job.waiters) {
        waiter();
      }
    }
  } finally {
    working = false;
  }
}

function enqueue(dimension, cx, cz) {
  const key = cx + "," + cz;
  if (knownChunks.has(key)) {
    return Promise.resolve();
  }
  let job = pending.get(key);
  if (!job) {
    job = { key: key, cx: cx, cz: cz, waiters: [] };
    pending.set(key, job);
    order.push(job);
  }
  const done = new Promise((resolve) => job.waiters.push(resolve));
  work(dimension);
  return done;
}

// Generates (or confirms) every chunk within radiusChunks of the given block position. Resolves when all are done.
export function ensureTerrainAround(dimension, x, z, radiusChunks) {
  const ccx = Math.floor(x / 16);
  const ccz = Math.floor(z / 16);
  const list = [];
  for (let dx = -radiusChunks; dx <= radiusChunks; dx++) {
    for (let dz = -radiusChunks; dz <= radiusChunks; dz++) {
      list.push({ cx: ccx + dx, cz: ccz + dz, d: dx * dx + dz * dz });
    }
  }
  list.sort((a, b) => a.d - b.d);
  return Promise.all(list.map((c) => enqueue(dimension, c.cx, c.cz)));
}

function scanPlayers() {
  const abyss = getAbyss();
  if (!abyss) {
    return;
  }
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player)) {
        continue;
      }
      const p = player.location;
      ensureTerrainAround(abyss, p.x, p.z, SCAN_RADIUS_CHUNKS).catch((error) => {
        console.warn("[meridian] Strata scan failed: " + error);
      });
    } catch (error) {
      console.warn("[meridian] Strata scan skipped a player: " + error);
    }
  }
}

export function initStrata() {
  world.afterEvents.worldLoad.subscribe(() => {
    loadProtected();
    system.runInterval(scanPlayers, SCAN_INTERVAL_TICKS);
  });
}
