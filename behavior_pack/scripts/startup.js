// behavior_pack/scripts/startup.js
// Entry point. The dimension is defined by dimensions/ancient_abyss.json.
// Register custom commands during startup, then initialize the environment and gameplay modules.

import { system } from "@minecraft/server";
import { initAbyssEnvironment } from "./dimension.js";
import { registerTransitCommands, initTransit } from "./transit.js";
import { initVoidTether } from "./void_tether.js";
import { initRitual, registerRitualCommands } from "./ritual.js";
import { initAbyssalite, registerAbyssaliteCommands } from "./abyssalite.js";
import { initStrata } from "./strata.js";
import { initFog } from "./fog.js";
import { initEchoDweller, registerDwellerCommands } from "./echo_dweller.js";
import "./trade_handler.js";
import "./harmonic_pylon.js";
import { initPaddedTreads } from "./padded_treads.js";

// These modules register block/item event handlers or scheduled gameplay systems on import.
import "./abyssal_silt.js";
import "./sulfuric_basalt.js";
import "./gloomstone.js";
import "./resonance_cocoon.js";
import "./resonance_ward.js";
import "./void_lantern.js";
import "./hollow_receptacle.js";

system.beforeEvents.startup.subscribe((event) => {
  registerTransitCommands(event.customCommandRegistry);
  registerRitualCommands(event.customCommandRegistry);
  registerAbyssaliteCommands(event.customCommandRegistry);
  registerDwellerCommands(event.customCommandRegistry);
});

initAbyssEnvironment();
initTransit();
initVoidTether();
initRitual();
initAbyssalite();
initStrata();
initFog();
initEchoDweller();
initPaddedTreads();
