// behavior_pack/scripts/abyssalite.js
// PHASE 20 (scripts) - Abyssalite gear behaviour.
//
// 1. Void Tether passive: the Phase 5 rescue now REQUIRES the full Abyssalite armor set
//    (tetherConfig.requireFullSet = true, the PRD rule).
// 2. Pickaxe harvest: an Abyssalite Pickaxe can break Reinforced Deepslate once the Abyss is conquered.
// 3. Bonus damage against Sculk-mutated entities (wardens) with any Abyssalite tool or weapon.
// 4. Glitch Barrier pierce: attackerPierces() is exported for the Herobrine phases to import.
//
// NOTE: the Bedrock Wiki connector was not reachable while writing this phase, so the API calls below come from
// my own knowledge and are NOT re-verified this turn: EntityHitBlockAfterEvent (damagingEntity, hitBlock),
// EntityHurtAfterEvent (damage, damageSource, hurtEntity), Entity.applyDamage, Dimension.spawnItem,
// Player.onScreenDisplay.setActionBar. If the content log shows one of them failing, tell me which.
//
// LIMITATIONS
// - Reinforced Deepslate has hardness -1, so a survival player can never "finish" breaking it and no break event
//   exists. NOT POSSIBLE IN BEDROCK to give it a real mining speed. Workaround (APPROXIMATION): every punch with the
//   Abyssalite Pickaxe counts, 20 punches within 0.75 seconds of each other break the block. Break progress shows on
//   the action bar; the block drops itself and costs the pickaxe 1 durability.
// - "Once the dimension is conquered": stored as the world dynamic property meridian:abyss_conquered. The Herobrine
//   phase calls setAbyssConquered(true) when Herobrine falls. /meridian:toggle_conquered flips it for testing.
// - Bonus damage is applied as separate magic damage (50 percent of the hit) so it cannot trigger itself, which means
//   kill credit for the extra part is not attributed to the player.

import {
  world,
  system,
  ItemStack,
  EquipmentSlot,
  EntityComponentTypes,
  CommandPermissionLevel,
  CustomCommandStatus,
} from "@minecraft/server";
import { tetherConfig } from "./void_tether.js";

const PICKAXE_ID = "meridian:abyssalite_pickaxe";
const ABYSSALITE_TOOLS = new Set([
  "meridian:abyssalite_sword",
  "meridian:abyssalite_pickaxe",
  "meridian:abyssalite_axe",
  "meridian:abyssalite_shovel",
  "meridian:abyssalite_hoe",
]);
const SCULK_MUTATED = new Set([
  "minecraft:warden",
  "meridian:tectonic_colossus_warden",
  "meridian:frostbitten_warden",
  "meridian:singularity_warden",
]);

const HARVEST_BLOCK_ID = "minecraft:reinforced_deepslate";
const HITS_REQUIRED = 20;
const HIT_WINDOW_TICKS = 15;
const REFUSE_MESSAGE_GAP_TICKS = 60;
const BONUS_DAMAGE_RATIO = 0.5;
const CONQUERED_PROPERTY = "meridian:abyss_conquered";

const breakProgress = new Map();
const lastRefusal = new Map();

export function isAbyssConquered() {
  return world.getDynamicProperty(CONQUERED_PROPERTY) === true;
}

export function setAbyssConquered(value) {
  world.setDynamicProperty(CONQUERED_PROPERTY, value === true);
}

function mainhandItem(entity) {
  try {
    return entity.getComponent(EntityComponentTypes.Equippable)?.getEquipment(EquipmentSlot.Mainhand);
  } catch (error) {
    return undefined;
  }
}

// True when the entity attacks with an Abyssalite tool or weapon. The Herobrine phases use this for the Glitch Barrier.
export function attackerPierces(entity) {
  const item = mainhandItem(entity);
  return item !== undefined && ABYSSALITE_TOOLS.has(item.typeId);
}

function damagePickaxe(player, item) {
  const durability = item.getComponent("minecraft:durability");
  if (!durability) {
    return;
  }
  const equippable = player.getComponent(EntityComponentTypes.Equippable);
  durability.damage += 1;
  if (durability.damage >= durability.maxDurability) {
    equippable.setEquipment(EquipmentSlot.Mainhand, undefined);
    player.playSound("random.break");
  } else {
    equippable.setEquipment(EquipmentSlot.Mainhand, item);
  }
}

function onHitBlock(event) {
  const player = event.damagingEntity;
  if (player.typeId !== "minecraft:player") {
    return;
  }
  const block = event.hitBlock;
  if (block.typeId !== HARVEST_BLOCK_ID) {
    return;
  }
  const item = mainhandItem(player);
  if (item?.typeId !== PICKAXE_ID) {
    return;
  }

  const tick = system.currentTick;
  if (!isAbyssConquered()) {
    if (tick - (lastRefusal.get(player.id) ?? -REFUSE_MESSAGE_GAP_TICKS) >= REFUSE_MESSAGE_GAP_TICKS) {
      lastRefusal.set(player.id, tick);
      player.sendMessage("§8The Reinforced Deepslate refuses to yield. The Abyss is not yet conquered.");
    }
    return;
  }

  const loc = block.location;
  const key = block.dimension.id + "|" + loc.x + "|" + loc.y + "|" + loc.z;
  let progress = breakProgress.get(player.id);
  if (!progress || progress.key !== key || tick - progress.tick > HIT_WINDOW_TICKS) {
    progress = { key: key, hits: 0, tick: tick };
  }
  progress.hits += 1;
  progress.tick = tick;
  breakProgress.set(player.id, progress);

  player.onScreenDisplay.setActionBar("§5Harvesting... " + progress.hits + "/" + HITS_REQUIRED);
  if (progress.hits < HITS_REQUIRED) {
    return;
  }

  breakProgress.delete(player.id);
  const dimension = block.dimension;
  const center = { x: loc.x + 0.5, y: loc.y + 0.5, z: loc.z + 0.5 };
  block.setType("minecraft:air");
  dimension.spawnItem(new ItemStack(HARVEST_BLOCK_ID, 1), center);
  dimension.playSound("dig.deepslate", center);
  damagePickaxe(player, item);
}

function onEntityHurt(event) {
  const attacker = event.damageSource.damagingEntity;
  if (!attacker || attacker.typeId !== "minecraft:player") {
    return;
  }
  if (!SCULK_MUTATED.has(event.hurtEntity.typeId) || !attackerPierces(attacker)) {
    return;
  }
  const extra = event.damage * BONUS_DAMAGE_RATIO;
  if (extra > 0) {
    event.hurtEntity.applyDamage(extra, { cause: "magic" });
  }
}

export function registerAbyssaliteCommands(customCommandRegistry) {
  customCommandRegistry.registerCommand(
    {
      name: "meridian:toggle_conquered",
      description: "Test: flip the 'Abyss conquered' flag that lets Abyssalite Pickaxes harvest Reinforced Deepslate.",
      permissionLevel: CommandPermissionLevel.GameDirectors,
      cheatsRequired: true,
    },
    () => {
      const next = !isAbyssConquered();
      system.run(() => setAbyssConquered(next));
      return { status: CustomCommandStatus.Success, message: "Abyss conquered flag is now " + next + "." };
    }
  );
}

export function initAbyssalite() {
  world.afterEvents.worldLoad.subscribe(() => {
    tetherConfig.requireFullSet = true;
    world.afterEvents.entityHitBlock.subscribe(onHitBlock);
    world.afterEvents.entityHurt.subscribe(onEntityHurt);
    world.afterEvents.playerLeave.subscribe((event) => {
      breakProgress.delete(event.playerId);
      lastRefusal.delete(event.playerId);
    });
  });
}
