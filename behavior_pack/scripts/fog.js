// behavior_pack/scripts/fog.js
// ATMOSPHERE - navy hadal fog and floating cyan "marine snow" for meridian:ancient_abyss.
//
// Needs two resource pack files:
//   resource_pack/fogs/abyss_fog.json                      (fog id meridian:abyss_fog)
//   resource_pack/particles/marine_snow.particle.json     (particle id meridian:marine_snow)
//
// A per-dimension skybox is not exposed by the Script API. The custom dimension's default biome is configured in
// behavior_pack/biomes/ancient_abyss.biome.json and resource_pack/biomes/ancient_abyss_biome.client_biome.json.
// This script additionally pushes the fog to each player while in the Abyss and removes it when they leave.
// The fog is deliberately short ranged (about 36 blocks) and near-black navy for the Genshin style abyss mood.

import { world, system } from "@minecraft/server";
import { isInAbyss } from "./dimension.js";

const FOG_ID = "meridian:abyss_fog";
const FOG_KEY = "meridian_abyss";
const FOG_TAG = "meridian:abyss_fog_on";
const SNOW_PARTICLE = "meridian:marine_snow";
const SYNC_INTERVAL_TICKS = 20;
const SNOW_INTERVAL_TICKS = 6;
const SNOW_PER_BURST = 6;
const SNOW_RADIUS = 12;
const SNOW_HEIGHT = 6;

let snowAvailable = true;

function pushFog(player) {
  try {
    player.runCommand("fog @s remove " + FOG_KEY);
  } catch (error) {
    // Nothing to remove yet.
  }
  try {
    player.runCommand("fog @s push " + FOG_ID + " " + FOG_KEY);
    player.addTag(FOG_TAG);
  } catch (error) {
    console.warn("[meridian] Could not push " + FOG_ID + ": " + error);
  }
}

function clearFog(player) {
  try {
    player.runCommand("fog @s remove " + FOG_KEY);
  } catch (error) {
    // The fog was already gone.
  }
  player.removeTag(FOG_TAG);
}

function syncFog() {
  for (const player of world.getAllPlayers()) {
    try {
      const inside = isInAbyss(player);
      const active = player.hasTag(FOG_TAG);
      if (inside && !active) {
        pushFog(player);
      } else if (!inside && active) {
        clearFog(player);
      }
    } catch (error) {
      console.warn("[meridian] Fog sync skipped a player: " + error);
    }
  }
}

function spawnSnow() {
  if (!snowAvailable) {
    return;
  }
  for (const player of world.getAllPlayers()) {
    try {
      if (!isInAbyss(player)) {
        continue;
      }
      const p = player.location;
      for (let i = 0; i < SNOW_PER_BURST; i++) {
        player.dimension.spawnParticle(SNOW_PARTICLE, {
          x: p.x + (Math.random() * 2 - 1) * SNOW_RADIUS,
          y: p.y + (Math.random() * 2 - 0.5) * SNOW_HEIGHT,
          z: p.z + (Math.random() * 2 - 1) * SNOW_RADIUS,
        });
      }
    } catch (error) {
      snowAvailable = false;
      console.warn("[meridian] Marine snow disabled, particle " + SNOW_PARTICLE + " failed: " + error);
      return;
    }
  }
}

export function initFog() {
  world.afterEvents.worldLoad.subscribe(() => {
    world.afterEvents.playerSpawn.subscribe((event) => {
      if (event.initialSpawn) {
        event.player.removeTag(FOG_TAG);
      }
    });
    system.runInterval(syncFog, SYNC_INTERVAL_TICKS);
    system.runInterval(spawnSnow, SNOW_INTERVAL_TICKS);
  });
}
