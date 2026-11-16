// PHASE 25 — Tri-Citadel: Earth duo.
import { BlockPermutation, world, system } from "@minecraft/server";

const MAGE_ID = "meridian:tectonic_weft_mage";
const COLOSSUS_ID = "meridian:tectonic_colossus_warden";
const PAIR_PREFIX = "meridian:earth_pair_";
const CHAIN_ID = "meridian:obsidian_chain";
const MAX_PAIR_DISTANCE = 32;
const PLAYER_SCAN_DISTANCE = 30;
const UPDATE_INTERVAL_TICKS = 10;
const TETHER_REFRESH_TICKS = 20;
const BARRIER_COOLDOWN_TICKS = 180;
const STALACTITE_COOLDOWN_TICKS = 180;
const RAM_COOLDOWN_TICKS = 220;

const DIMENSION_IDS = [
  "minecraft:overworld",
  "minecraft:nether",
  "minecraft:the_end",
  "meridian:ancient_abyss"
];

let tick = 0;
const mageAttackState = new Map();
const ramCooldowns = new Map();
const ramStates = new Map();
const tetherSegments = new Map();
const tetherRefresh = new Map();

function distanceSquared(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return dx * dx + dy * dy + dz * dz;
}

function getPairTag(entity) {
  try {
    return entity.getTags().find((tag) => tag.startsWith(PAIR_PREFIX));
  } catch (error) {
    return undefined;
  }
}

function createPairLinks(mages, colossi) {
  for (const mage of mages) {
    if (getPairTag(mage)) continue;

    let nearest;
    let nearestDistance = MAX_PAIR_DISTANCE * MAX_PAIR_DISTANCE;
    for (const colossus of colossi) {
      if (getPairTag(colossus) || colossus.dimension.id !== mage.dimension.id) continue;
      const distance = distanceSquared(mage.location, colossus.location);
      if (distance < nearestDistance) {
        nearest = colossus;
        nearestDistance = distance;
      }
    }

    if (!nearest) continue;
    const pairTag = PAIR_PREFIX + mage.id;
    try {
      mage.addTag(pairTag);
      nearest.addTag(pairTag);
      mage.dimension.playSound("block.chain.place", mage.location, { volume: 1.1, pitch: 0.65 });
    } catch (error) {
      console.warn("[Ancient Abyss] Earth duo pairing failed: " + error);
    }
  }
}

function getChainPermutation(axis) {
  return BlockPermutation.resolve(CHAIN_ID, { "meridian:axis": axis });
}

function clearTether(pairTag, dimension) {
  const previous = tetherSegments.get(pairTag);
  if (!previous) return;
  let oldDimension = dimension;
  if (previous.dimensionId !== dimension.id) {
    try {
      oldDimension = world.getDimension(previous.dimensionId);
    } catch (error) {
      tetherSegments.delete(pairTag);
      return;
    }
  }
  for (const point of previous.points) {
    try {
      const block = oldDimension.getBlock(point);
      if (block?.typeId === CHAIN_ID) block.setType("minecraft:air");
    } catch (error) {
      // Unloaded or changed sections are left untouched.
    }
  }
  tetherSegments.delete(pairTag);
}

function renderTether(mage, colossus, pairTag) {
  const dimension = mage.dimension;
  clearTether(pairTag, dimension);

  const start = {
    x: mage.location.x,
    y: mage.location.y + 1.35,
    z: mage.location.z
  };
  const end = {
    x: colossus.location.x,
    y: colossus.location.y + 1.7,
    z: colossus.location.z
  };
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dz = end.z - start.z;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (length < 2 || length > 36) return;

  const steps = Math.min(28, Math.ceil(length * 1.25));
  const placed = [];
  const visited = new Set();

  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const point = {
      x: Math.floor(start.x + dx * t),
      y: Math.floor(start.y + dy * t),
      z: Math.floor(start.z + dz * t)
    };
    const key = point.x + "," + point.y + "," + point.z;
    if (visited.has(key)) continue;
    visited.add(key);

    let axis = "y";
    const horizontal = Math.max(Math.abs(dx), Math.abs(dz));
    if (horizontal >= Math.abs(dy)) axis = Math.abs(dx) >= Math.abs(dz) ? "x" : "z";

    try {
      const block = dimension.getBlock(point);
      if (!block?.isAir) continue;
      block.setPermutation(getChainPermutation(axis));
      placed.push(point);
    } catch (error) {
      // A chain segment is skipped rather than replacing terrain.
    }
  }

  tetherSegments.set(pairTag, { dimensionId: dimension.id, points: placed });
  try {
    dimension.spawnParticle("minecraft:dragon_breath_trail", {
      x: start.x + dx * 0.5,
      y: start.y + dy * 0.5,
      z: start.z + dz * 0.5
    });
  } catch (error) {
    // The chain is the primary tether visual; the particle is optional.
  }
}

function temporaryBlock(dimension, location, blockOrPermutation, expectedTypeId, lifetimeTicks) {
  try {
    const block = dimension.getBlock(location);
    if (!block?.isAir) return false;

    if (typeof blockOrPermutation === "string") {
      block.setType(blockOrPermutation);
    } else {
      block.setPermutation(blockOrPermutation);
    }

    system.runTimeout(() => {
      try {
        const current = dimension.getBlock(location);
        if (current?.typeId === expectedTypeId) current.setType("minecraft:air");
      } catch (error) {
        // Never fail the encounter because an attack block was unloaded.
      }
    }, lifetimeTicks);
    return true;
  } catch (error) {
    return false;
  }
}

function playMageCast(dimension, location, pitch) {
  try {
    dimension.spawnParticle("minecraft:dragon_breath_trail", {
      x: location.x,
      y: location.y + 1.1,
      z: location.z
    });
    dimension.playSound("block.stone.hit", location, { volume: 1.8, pitch });
  } catch (error) {
    console.warn("[Ancient Abyss] Tectonic casting effect failed: " + error);
  }
}

function raiseBedrockBarrier(mage, target) {
  const origin = mage.location;
  const targetLocation = target.location;
  const dx = targetLocation.x - origin.x;
  const dz = targetLocation.z - origin.z;
  const horizontal = Math.hypot(dx, dz);
  if (horizontal < 0.1) return;

  const dirX = dx / horizontal;
  const dirZ = dz / horizontal;
  const centerX = targetLocation.x - dirX * 4.5;
  const centerZ = targetLocation.z - dirZ * 4.5;
  const tangentX = -dirZ;
  const tangentZ = dirX;
  const baseY = Math.floor(targetLocation.y);
  let placed = 0;

  for (let width = -2; width <= 2; width++) {
    const x = Math.floor(centerX + tangentX * width);
    const z = Math.floor(centerZ + tangentZ * width);
    for (let height = 0; height < 3; height++) {
      if (temporaryBlock(
        mage.dimension,
        { x, y: baseY + height, z },
        "minecraft:bedrock",
        "minecraft:bedrock",
        100
      )) {
        placed += 1;
      }
    }
  }

  if (placed > 0) {
    playMageCast(mage.dimension, { x: centerX, y: baseY, z: centerZ }, 0.75);
    target.onScreenDisplay.setActionBar("§6The Tectonic Mage raises a bedrock wall!");
  }
}

function pointedDripstone(thickness) {
  const base = BlockPermutation.resolve("minecraft:pointed_dripstone");
  const states = base.getAllStates();
  const wanted = {};
  const thicknessKey = Object.keys(states).find((key) =>
    key === "dripstone_thickness" || key.endsWith("dripstone_thickness")
  );
  const hangingKey = Object.keys(states).find((key) =>
    key === "hanging" || key.endsWith(":hanging") || key.endsWith("hanging")
  );
  const directionKey = Object.keys(states).find((key) =>
    key === "vertical_direction" || key.endsWith("vertical_direction")
  );
  if (thicknessKey) wanted[thicknessKey] = thickness;
  if (hangingKey) wanted[hangingKey] = true;
  if (directionKey) wanted[directionKey] = "down";
  return BlockPermutation.resolve("minecraft:pointed_dripstone", Object.assign({}, states, wanted));
}

function callStalactites(mage, target) {
  const targetLocation = target.location;
  const dimension = mage.dimension;
  const baseY = Math.floor(targetLocation.y);
  const offsets = [[0, 0], [-2, 0], [2, 0]];
  const strikePoints = [];

  for (const [offsetX, offsetZ] of offsets) {
    const x = Math.floor(targetLocation.x) + offsetX;
    const z = Math.floor(targetLocation.z) + offsetZ;
    const anchor = { x, y: baseY + 6, z };
    const top = { x, y: baseY + 5, z };
    const middle = { x, y: baseY + 4, z };
    const tip = { x, y: baseY + 3, z };

    temporaryBlock(dimension, anchor, "minecraft:dripstone_block", "minecraft:dripstone_block", 90);
    try {
      const base = pointedDripstone("base");
      const mid = pointedDripstone("middle");
      const end = pointedDripstone("tip");
      temporaryBlock(dimension, top, base, "minecraft:pointed_dripstone", 90);
      temporaryBlock(dimension, middle, mid, "minecraft:pointed_dripstone", 90);
      temporaryBlock(dimension, tip, end, "minecraft:pointed_dripstone", 90);
    } catch (error) {
      // The vanilla dripstone block still provides a short-lived falling-spike warning if states differ.
      temporaryBlock(dimension, top, "minecraft:dripstone_block", "minecraft:dripstone_block", 90);
      temporaryBlock(dimension, middle, "minecraft:dripstone_block", "minecraft:dripstone_block", 90);
      temporaryBlock(dimension, tip, "minecraft:dripstone_block", "minecraft:dripstone_block", 90);
    }
    strikePoints.push({ x: x + 0.5, y: baseY + 1, z: z + 0.5 });
  }

  playMageCast(dimension, targetLocation, 1.35);
  target.onScreenDisplay.setActionBar("§6The Tectonic Mage calls down stone stalactites!");

  system.runTimeout(() => {
    if (!target.isValid || target.dimension.id !== dimension.id) return;
    const p = target.location;
    const hit = strikePoints.some((point) =>
      Math.hypot(p.x - point.x, p.z - point.z) <= 1.25 &&
      Math.abs(p.y - point.y) <= 2.25
    );
    if (!hit) return;

    try {
      target.applyDamage(6);
      target.applyKnockback({ x: 0, z: 0 }, 0.35);
      dimension.playSound("block.anvil.land", p, { volume: 1.2, pitch: 0.8 });
    } catch (error) {
      console.warn("[Ancient Abyss] Stalactite impact failed: " + error);
    }
  }, 30);
}

function updateMage(mage) {
  let state = mageAttackState.get(mage.id);
  if (!state) {
    state = { nextAttack: tick + 50, nextType: 0 };
    mageAttackState.set(mage.id, state);
  }
  if (tick < state.nextAttack) return;

  const target = nearestPlayer(mage.dimension, mage.location, PLAYER_SCAN_DISTANCE);
  if (!target) {
    state.nextAttack = tick + 20;
    return;
  }

  if (state.nextType === 0) {
    raiseBedrockBarrier(mage, target);
    state.nextType = 1;
    state.nextAttack = tick + BARRIER_COOLDOWN_TICKS;
  } else {
    callStalactites(mage, target);
    state.nextType = 0;
    state.nextAttack = tick + STALACTITE_COOLDOWN_TICKS;
  }
}

function nearestPlayer(dimension, location, maxDistance) {
  let players;
  try {
    players = dimension.getPlayers({ location, maxDistance });
  } catch (error) {
    return undefined;
  }

  let nearest;
  let nearestDistance = maxDistance * maxDistance;
  for (const player of players) {
    const distance = distanceSquared(location, player.location);
    if (distance < nearestDistance) {
      nearest = player;
      nearestDistance = distance;
    }
  }
  return nearest;
}

function startRam(colossus, target) {
  const origin = colossus.location;
  const destination = target.location;
  const dx = destination.x - origin.x;
  const dz = destination.z - origin.z;
  const distance = Math.hypot(dx, dz);
  if (distance < 3) return false;

  try {
    colossus.clearVelocity();
    colossus.applyImpulse({
      x: (dx / distance) * 1.75,
      y: 0.22,
      z: (dz / distance) * 1.75
    });
    colossus.dimension.spawnParticle("minecraft:dragon_breath_trail", {
      x: origin.x,
      y: origin.y + 1.6,
      z: origin.z
    });
    colossus.dimension.playSound("mob.ravager.roar", origin, { volume: 2.2, pitch: 0.75 });
    target.onScreenDisplay.setActionBar("§6The Tectonic Colossus charges like a battering ram!");
    ramStates.set(colossus.id, {
      targetId: target.id,
      untilTick: tick + 40,
      hit: false
    });
    return true;
  } catch (error) {
    console.warn("[Ancient Abyss] Colossus ram launch failed: " + error);
    return false;
  }
}

function updateRamImpact(colossus, players) {
  const state = ramStates.get(colossus.id);
  if (!state) return false;

  const target = players.find((player) => player.id === state.targetId);
  if (!target || !target.isValid || target.dimension.id !== colossus.dimension.id || tick >= state.untilTick) {
    ramStates.delete(colossus.id);
    try { colossus.clearVelocity(); } catch (error) {}
    return false;
  }

  if (state.hit) return true;
  const a = colossus.location;
  const b = target.location;
  const horizontal = Math.hypot(a.x - b.x, a.z - b.z);
  const vertical = Math.abs(a.y - b.y);

  if (horizontal <= 2.9 && vertical <= 3.5) {
    state.hit = true;
    try {
      target.applyDamage(12);
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const distance = Math.hypot(dx, dz) || 1;
      target.applyKnockback({ x: (dx / distance) * 1.8, z: (dz / distance) * 1.8 }, 0.75);
      target.addEffect("slowness", 35, { amplifier: 0, showParticles: false });
      colossus.dimension.playSound("entity.iron_golem.attack", a, { volume: 1.8, pitch: 0.7 });
    } catch (error) {
      console.warn("[Ancient Abyss] Colossus ram impact failed: " + error);
    }
    ramStates.delete(colossus.id);
    try { colossus.clearVelocity(); } catch (error) {}
    return true;
  }

  return true;
}

function updateColossus(colossus, players) {
  if (updateRamImpact(colossus, players)) return;

  const cooldown = ramCooldowns.get(colossus.id) ?? 0;
  if (tick < cooldown) return;

  const target = nearestPlayer(colossus.dimension, colossus.location, PLAYER_SCAN_DISTANCE);
  if (!target) return;

  if (startRam(colossus, target)) {
    ramCooldowns.set(colossus.id, tick + RAM_COOLDOWN_TICKS);
  }
}

function updateEarthDuo() {
  tick += UPDATE_INTERVAL_TICKS;
  const activeMages = new Set();
  const activeColossi = new Set();
  const liveTethers = new Set();

  for (const dimensionId of DIMENSION_IDS) {
    let dimension;
    try {
      dimension = world.getDimension(dimensionId);
    } catch (error) {
      continue;
    }

    let mages = [];
    let colossi = [];
    let players = [];
    try {
      mages = dimension.getEntities({ type: MAGE_ID });
      colossi = dimension.getEntities({ type: COLOSSUS_ID });
      players = dimension.getPlayers();
    } catch (error) {
      continue;
    }

    createPairLinks(mages, colossi);

    for (const mage of mages) {
      activeMages.add(mage.id);
      updateMage(mage);

      const pairTag = getPairTag(mage);
      if (!pairTag) continue;
      const colossus = colossi.find((entry) => entry.hasTag(pairTag));
      if (!colossus) continue;

      liveTethers.add(pairTag);
      const refreshedAt = tetherRefresh.get(pairTag) ?? -TETHER_REFRESH_TICKS;
      if (tick - refreshedAt >= TETHER_REFRESH_TICKS) {
        renderTether(mage, colossus, pairTag);
        tetherRefresh.set(pairTag, tick);
      }
    }

    for (const colossus of colossi) {
      activeColossi.add(colossus.id);
      updateColossus(colossus, players);
    }
  }

  for (const pairTag of tetherSegments.keys()) {
    if (liveTethers.has(pairTag)) continue;
    const previous = tetherSegments.get(pairTag);
    if (previous) {
      try {
        const oldDimension = world.getDimension(previous.dimensionId);
        for (const point of previous.points) {
          try {
            const block = oldDimension.getBlock(point);
            if (block?.typeId === CHAIN_ID) block.setType("minecraft:air");
          } catch (error) {
            // Unloaded or changed links are left untouched.
          }
        }
      } catch (error) {
        // The old dimension may no longer be available.
      }
    }
    tetherSegments.delete(pairTag);
    tetherRefresh.delete(pairTag);
  }

  for (const id of mageAttackState.keys()) {
    if (!activeMages.has(id)) mageAttackState.delete(id);
  }
  for (const id of ramCooldowns.keys()) {
    if (!activeColossi.has(id)) ramCooldowns.delete(id);
  }
  for (const id of ramStates.keys()) {
    if (!activeColossi.has(id)) ramStates.delete(id);
  }
}

export function initTectonicDuo() {
  system.runInterval(updateEarthDuo, UPDATE_INTERVAL_TICKS);
}
