// behavior_pack/scripts/trade_handler.js
// PHASE 23 - Harmonic barter UI and inventory-safe tier trades.
//
// Padded Treads limitation:
// Bedrock does not expose a supported custom-enchantment registration API that can
// create the PRD's bespoke "total acoustic silence" enchantment. Tier 1 therefore
// awards named leather boots as a wearable placeholder. They do NOT silence footsteps
// or suppress sculk vibrations. Do not describe this reward as the finished enchantment.

import { EntityComponentTypes, GameMode, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import {
  registerDwellerInteractHandler,
  getTrust,
  chime,
} from "./echo_dweller.js";

const TIERS = [
  {
    trust: 0,
    title: "Padded Treads",
    description: "4 Amethyst Shards + 2 Wool",
    costs: [
      { id: "minecraft:amethyst_shard", amount: 4 },
      { id: "minecraft:__any_wool__", amount: 2 },
    ],
    reward: () => {
      const boots = new ItemStack("minecraft:leather_boots", 1);
      boots.nameTag = "Padded Treads";
      return boots;
    },
  },
  {
    trust: 10,
    title: "Abyssal Anchor",
    description: "1 Calibrated Sculk Sensor + 4 Echo Shards",
    costs: [
      { id: "minecraft:calibrated_sculk_sensor", amount: 1 },
      { id: "minecraft:echo_shard", amount: 4 },
    ],
    reward: () => new ItemStack("meridian:abyssal_anchor", 1),
  },
  {
    trust: 25,
    title: "Abyss Upgrade Smithing Template",
    description: "1 Resonant Core + 16 Crying Obsidian",
    costs: [
      { id: "meridian:resonant_core", amount: 1 },
      { id: "minecraft:crying_obsidian", amount: 16 },
    ],
    reward: () => new ItemStack("meridian:abyss_upgrade_smithing_template", 1),
  },
];

function isCreative(player) {
  return player.matches({ gameMode: GameMode.Creative });
}

function isWool(typeId) {
  return typeId.startsWith("minecraft:") && typeId.endsWith("_wool");
}

function matchesCost(typeId, costId) {
  return costId === "minecraft:__any_wool__" ? isWool(typeId) : typeId === costId;
}

function getInventory(player) {
  return player.getComponent(EntityComponentTypes.Inventory)?.container;
}

function countCost(container, cost) {
  let total = 0;
  for (let slot = 0; slot < container.size; slot++) {
    const stack = container.getItem(slot);
    if (stack && matchesCost(stack.typeId, cost.id)) {
      total += stack.amount;
    }
  }
  return total;
}

function hasCosts(container, costs) {
  return costs.every((cost) => countCost(container, cost) >= cost.amount);
}

function removeCosts(container, costs) {
  const removed = [];
  for (const cost of costs) {
    let remaining = cost.amount;
    for (let slot = 0; slot < container.size && remaining > 0; slot++) {
      const stack = container.getItem(slot);
      if (!stack || !matchesCost(stack.typeId, cost.id)) {
        continue;
      }
      const take = Math.min(stack.amount, remaining);
      removed.push({ typeId: stack.typeId, amount: take });
      remaining -= take;
      if (take === stack.amount) {
        container.setItem(slot, undefined);
      } else {
        stack.amount -= take;
        container.setItem(slot, stack);
      }
    }
    if (remaining > 0) {
      return undefined;
    }
  }
  return removed;
}

function refundCosts(container, removed) {
  for (const entry of removed) {
    const remainder = container.addItem(new ItemStack(entry.typeId, entry.amount));
    if (remainder) {
      console.warn("[Ancient Abyss] Could not fully refund a failed barter transaction.");
    }
  }
}

function hasEmptySlot(container) {
  for (let slot = 0; slot < container.size; slot++) {
    if (!container.getItem(slot)) {
      return true;
    }
  }
  return false;
}

function showTradeResult(player, message, success) {
  try {
    player.sendMessage((success ? "§b[Harmonic Barter]§r " : "§c[Harmonic Barter]§r ") + message);
  } catch (error) {
    console.warn("[Ancient Abyss] Could not send barter result: " + error);
  }
}

function executeTrade(player, tierIndex) {
  const tier = TIERS[tierIndex];
  if (!tier) {
    return;
  }

  if (getTrust(player) < tier.trust) {
    showTradeResult(player, "Your trust is too low for this tier. Required trust: " + tier.trust + ".", false);
    return;
  }

  const container = getInventory(player);
  if (!container) {
    showTradeResult(player, "Your inventory is unavailable.", false);
    return;
  }

  if (!hasCosts(container, tier.costs)) {
    showTradeResult(player, "You do not have the required materials: " + tier.description + ".", false);
    return;
  }

  // Reserve a destination before consuming anything. This avoids losing ingredients
  // when the player's inventory is completely full.
  if (!hasEmptySlot(container)) {
    showTradeResult(player, "Free at least one inventory slot before trading.", false);
    return;
  }

  let removed = [];
  if (!isCreative(player)) {
    removed = removeCosts(container, tier.costs);
    if (!removed) {
      showTradeResult(player, "The trade could not be completed; no materials were consumed.", false);
      return;
    }
  }

  let reward;
  try {
    reward = tier.reward();
    const remainder = container.addItem(reward);
    if (remainder) {
      if (!isCreative(player)) {
        refundCosts(container, removed);
      }
      showTradeResult(player, "There was no room for the reward. Your materials were returned where possible.", false);
      return;
    }
  } catch (error) {
    if (!isCreative(player) && removed.length > 0) {
      refundCosts(container, removed);
    }
    console.warn("[Ancient Abyss] Barter transaction failed: " + error);
    showTradeResult(player, "The barter failed. Check the content log.", false);
    return;
  }

  chime(player.dimension, player.location, 1.5);
  showTradeResult(player, "Trade complete: " + tier.title + ".", true);
}

function openTradeMenu(player) {
  const trust = getTrust(player);
  const form = new ActionFormData()
    .title("§bHarmonic Barter")
    .body(
      "§7The Echo Dweller's trust: §b" + trust + "§7 / 100\n" +
      "§8Tier II requires 10 trust. Tier III requires 25 trust.\n" +
      "§7Tier I Padded Treads are currently a named leather-boots placeholder; they do not silence footsteps."
    )
    .button("Tier I — Padded Treads\n4 Amethyst Shards + 2 Wool")
    .button("Tier II — Abyssal Anchor\n1 Calibrated Sculk Sensor + 4 Echo Shards")
    .button("Tier III — Abyss Upgrade Template\n1 Resonant Core + 16 Crying Obsidian");

  form.show(player).then((response) => {
    if (response.canceled || response.selection === undefined) {
      return;
    }
    executeTrade(player, response.selection);
  }).catch((error) => {
    console.warn("[Ancient Abyss] Could not open harmonic barter UI: " + error);
    showTradeResult(player, "The trade screen could not open. Close other forms and try again.", false);
  });
}

// Normal interaction with a donation item still donates it for trust.
// Sneak-interaction opens the trade screen even when holding wool or shards.
registerDwellerInteractHandler((player, dweller, item) => {
  const isDonation =
    item?.typeId === "minecraft:amethyst_shard" ||
    item?.typeId === "minecraft:echo_shard" ||
    isWool(item?.typeId ?? "");

  if (isDonation && !player.isSneaking) {
    return false;
  }

  openTradeMenu(player);
  return true;
});
