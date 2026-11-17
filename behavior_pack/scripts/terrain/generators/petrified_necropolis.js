// Dedicated terrain generator: PetrifiedNecropolis.
// All world/noise/block operations are injected by strata.js to keep behavior deterministic.
export function* generatePetrifiedNecropolisFloor(dimension, chunkX, chunkZ, ctx) {
  const { beginFloorChunk, TILE_SIZE, TILES_PER_CHUNK, floorTopAtForBiome, put, HADAL_MIN_Y, hash01, isProtected } = ctx;
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
