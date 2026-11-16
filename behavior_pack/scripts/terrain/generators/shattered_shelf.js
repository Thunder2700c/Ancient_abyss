// Dedicated terrain generator: ShatteredShelf.
// All world/noise/block operations are injected by strata.js to keep behavior deterministic.
export function* generateShatteredShelfFloor(dimension, chunkX, chunkZ, ctx) {
  const { beginFloorChunk, TILE_SIZE, TILES_PER_CHUNK, floorTopAtForBiome, put, HADAL_MIN_Y, hash01, ridgeNoise, isProtected } = ctx;
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
