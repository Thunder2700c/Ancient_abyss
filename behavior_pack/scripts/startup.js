// behavior_pack/scripts/startup.js
// Entry point. Registers "meridian:ancient_abyss" and the transit test commands during the startup
// event (the only time registries accept new entries), then starts the environment and transit modules.
// Later phases add their imports below the echo dweller import.

import { system } from "@minecraft/server";
import { registerAbyssDimension, initAbyssEnvironment } from "./dimension.js";
import { registerTransitCommands, initTransit } from "./transit.js";
import { initVoidTether } from "./void_tether.js";
import { initRitual, registerRitualCommands } from "./ritual.js";
import { initAbyssalite, registerAbyssaliteCommands } from "./abyssalite.js";
import { initStrata } from "./strata.js";
import { initFog } from "./fog.js";
import { initEchoDweller, registerDwellerCommands } from "./echo_dweller.js";

system.beforeEvents.startup.subscribe((event) => {
  registerAbyssDimension(event.dimensionRegistry);
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
