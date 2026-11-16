// behavior_pack/scripts/sanctuary.js
import { registerVoidLantern } from "./void_lantern.js";
// PHASE 22 - Soundproof Sanctuary: an inverted bell-shaped dome hanging from the Abyss ceiling.
//
// Built by script (a hand written structure file is not practical), called from strata.js for rare chunks.
// Layout (all inside one 16x16 chunk, centre at chunk origin + 8):
//   - a dark prismarine rod from the ceiling down to the cap of the bell
//   - a bell 14 layers tall, radius 7 at the open rim narrowing to 3 at the cap
//   - shell: dark prismarine outside, black wool lining inside, hollow interior
//   - a solid floor at the rim level, a 3 wide doorway on the south side, a central Resonant Pylon,
//     glow-polyps and a void lantern inside
//   - three Echo Dwellers spawned inside
// Missing meridian blocks are skipped or replaced by vanilla stand-ins through the ctx helpers that strata.js passes in.

const BELL_HEIGHT = 14;
const RIM_RADIUS = 7;
const CAP_RADIUS = 3;
const SHELL_BLOCK = "minecraft:dark_prismarine";
const LINING_BLOCK = "minecraft:black_wool";

function radiusAt(layer) {
  const t = layer / (BELL_HEIGHT - 1);
  return Math.max(CAP_RADIUS, Math.round(RIM_RADIUS - (RIM_RADIUS - CAP_RADIUS) * Math.pow(t, 1.4)));
}

function disc(ctx, cx, y, cz, radius, id) {
  if (radius < 0) {
    return;
  }
  for (let dz = -radius; dz <= radius; dz++) {
    const half = Math.floor(Math.sqrt(radius * radius - dz * dz));
    ctx.put(cx - half, y, cz + dz, cx + half, y, cz + dz, id);
  }
}

// Generator: yields once per layer so the job stays time sliced. Use with yield* inside a runJob generator.
export function* sanctuarySteps(dimension, chunkX, chunkZ, ceilBottom, ctx) {
  const cx = chunkX * 16 + 8;
  const cz = chunkZ * 16 + 8;
  const yTop = ceilBottom - 26;
  const yBottom = yTop - (BELL_HEIGHT - 1);
  if (yBottom < 130) {
    return;
  }

  ctx.put(cx, yTop + 1, cz, cx, ceilBottom - 1, cz, SHELL_BLOCK);

  for (let k = 0; k < BELL_HEIGHT; k++) {
    const y = yBottom + k;
    const r = radiusAt(k);
    disc(ctx, cx, y, cz, r, SHELL_BLOCK);
    if (k > 0 && k < BELL_HEIGHT - 1) {
      disc(ctx, cx, y, cz, r - 1, LINING_BLOCK);
      disc(ctx, cx, y, cz, r - 2, "minecraft:air");
    }
    yield;
  }

  ctx.put(cx - 1, yBottom + 1, cz + RIM_RADIUS - 3, cx + 1, yBottom + 3, cz + RIM_RADIUS + 1, "minecraft:air");

  // Each generated sanctuary receives a usable donation/trade pylon at its centre.
  // The central tile is clear floor space and does not overlap the Dweller spawn pads.
  const pylon = ctx.block("meridian:harmonic_pylon");
  if (pylon) {
    ctx.put(cx, yBottom + 1, cz, cx, yBottom + 1, cz, pylon);
  }

  const polyps = ctx.block("meridian:glow_polyps");
  if (polyps) {
    for (const [dx, dz] of [[-3, -2], [3, -2], [-2, 3], [2, 3], [0, -4], [4, 0]]) {
      ctx.put(cx + dx, yBottom + 1, cz + dz, cx + dx, yBottom + 1, cz + dz, polyps);
    }
  }
  const lantern = ctx.block("meridian:void_lantern");
  if (lantern) {
    const lanternY = yBottom + BELL_HEIGHT - 3;
    ctx.put(cx, lanternY, cz, cx, lanternY, cz, lantern);
    registerVoidLantern(dimension.id, { x: cx, y: lanternY, z: cz });
  }

  for (const [dx, dz] of [[-2, 0], [2, 1], [0, -2]]) {
    try {
      dimension.spawnEntity("meridian:echo_dweller", { x: cx + dx + 0.5, y: yBottom + 1, z: cz + dz + 0.5 });
    } catch (error) {
      console.warn("[meridian] Could not spawn an Echo Dweller in the sanctuary: " + error);
    }
  }
}
