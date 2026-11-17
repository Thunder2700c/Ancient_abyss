// Dedicated terrain generator: AbyssalGarden.
// All world/noise/block operations are injected by strata.js to keep behavior deterministic.
export function* generateAbyssalGardenFloor(dimension, chunkX, chunkZ, ctx) {
  const { beginFloorChunk, TILE_SIZE, TILES_PER_CHUNK, floorTopAtForBiome, ridgeNoise, hash01, put, HADAL_MIN_Y, isProtected, fractalNoise } = ctx;
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
