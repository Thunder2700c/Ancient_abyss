// Selects a stable biome for each chunk using jittered Voronoi regions.
// hash01 is injected from the generator coordinator so all regions share the world seed.
export function biomeForChunk(chunkX, chunkZ, hash01) {
  // Seeded, jittered Voronoi regions: each site is assigned one of four biomes.
  // This gives broad irregular regions and a balanced mix without per-chunk patchwork.
  const regionSize = 384;
  const x = chunkX * 16 + 8;
  const z = chunkZ * 16 + 8;
  const cellX = Math.floor(x / regionSize);
  const cellZ = Math.floor(z / regionSize);
  const biomes = ["abyssal_garden", "shattered_shelf", "sulfuric_caldera", "petrified_necropolis"];
  let nearestDistance = Infinity;
  let selectedBiome = biomes[0];

  for (let dx = -2; dx <= 2; dx++) {
    for (let dz = -2; dz <= 2; dz++) {
      const gx = cellX + dx;
      const gz = cellZ + dz;
      const siteX = (gx + 0.5 + (hash01(gx, gz, 202) - 0.5) * 0.65) * regionSize;
      const siteZ = (gz + 0.5 + (hash01(gx, gz, 203) - 0.5) * 0.65) * regionSize;
      const offsetX = x - siteX;
      const offsetZ = z - siteZ;
      const distance = offsetX * offsetX + offsetZ * offsetZ;
      if (distance < nearestDistance) {
        nearestDistance = distance;
        const index = Math.min(3, Math.floor(hash01(gx, gz, 204) * 4));
        selectedBiome = biomes[index];
      }
    }
  }
  return selectedBiome;
}
