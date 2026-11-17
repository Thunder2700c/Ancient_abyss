// PHASE 23 — Harmonic Barter.
import { EntityComponentTypes, GameMode, ItemStack } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";
import { registerDwellerInteractHandler, getTrust, chime } from "./echo_dweller.js";

const ANY_WOOL = "minecraft:__any_wool__";
const TIERS = [
  {
    title:"Padded Treads",
    buttonTitle:"Tier I — Padded Treads",
    description:"4 Amethyst Shards + 2 Wool (any colour)",
    costs:[
      {id:"minecraft:amethyst_shard",amount:4,label:"Amethyst Shards"},
      {id:ANY_WOOL,amount:2,label:"Wool (any colour)"}
    ],
    createReward:()=>{
      const boots=new ItemStack("meridian:padded_treads",1);
      boots.nameTag="Padded Treads";
      boots.setLore([
        "Scripted passive enchantment.",
        "Grants Speed I while sneaking.",
        "Ancient Abyss creature-AI tag while worn.",
        "Does not suppress vanilla sculk vibrations."
      ]);
      return boots;
    }
  },
  {
    title:"Abyssal Anchor",
    buttonTitle:"Tier II — Abyssal Anchor",
    description:"1 Calibrated Sculk Sensor + 4 Echo Shards",
    costs:[
      {id:"minecraft:calibrated_sculk_sensor",amount:1,label:"Calibrated Sculk Sensor"},
      {id:"minecraft:echo_shard",amount:4,label:"Echo Shards"}
    ],
    createReward:()=>new ItemStack("meridian:abyssal_anchor",1)
  },
  {
    title:"Abyss Upgrade Smithing Template",
    buttonTitle:"Tier III — Abyss Upgrade Template",
    description:"1 Resonant Core + 16 Crying Obsidian",
    costs:[
      {id:"meridian:resonant_core",amount:1,label:"Resonant Core"},
      {id:"minecraft:crying_obsidian",amount:16,label:"Crying Obsidian"}
    ],
    createReward:()=>new ItemStack("meridian:abyss_upgrade_smithing_template",1)
  }
];

function getInventory(player) { return player.getComponent(EntityComponentTypes.Inventory)?.container; }
function isCreative(player) { return player.getGameMode()===GameMode.Creative; }
function isWool(typeId) { return typeId.startsWith("minecraft:") && typeId.endsWith("_wool"); }
function matchesCost(typeId,costId) { return costId===ANY_WOOL ? isWool(typeId) : typeId===costId; }

function countCost(container,cost) {
  let total=0;
  for(let slot=0;slot<container.size;slot++){
    const stack=container.getItem(slot);
    if(stack && matchesCost(stack.typeId,cost.id)) total+=stack.amount;
  }
  return total;
}
function getMissingCosts(container,costs) {
  const missing=[];
  for(const cost of costs){
    const amount=cost.amount-countCost(container,cost);
    if(amount>0) missing.push(amount+" "+cost.label);
  }
  return missing;
}
function snapshotInventory(container) {
  const snapshot=[];
  for(let slot=0;slot<container.size;slot++){
    const stack=container.getItem(slot);
    snapshot.push(stack ? stack.clone() : undefined);
  }
  return snapshot;
}
function restoreInventory(container,snapshot) {
  for(let slot=0;slot<snapshot.length;slot++) container.setItem(slot,snapshot[slot]);
}
function consumeCosts(container,costs) {
  const snapshot=snapshotInventory(container);
  try{
    for(const cost of costs){
      let remaining=cost.amount;
      for(let slot=0;slot<container.size && remaining>0;slot++){
        const stack=container.getItem(slot);
        if(!stack || !matchesCost(stack.typeId,cost.id)) continue;
        const take=Math.min(stack.amount,remaining);
        remaining-=take;
        if(take===stack.amount) container.setItem(slot,undefined);
        else {
          const updated=stack.clone();
          updated.amount-=take;
          container.setItem(slot,updated);
        }
      }
      if(remaining>0){restoreInventory(container,snapshot);return undefined;}
    }
    return snapshot;
  }catch(error){
    try{restoreInventory(container,snapshot);}
    catch(restoreError){console.error("[Ancient Abyss] Inventory rollback failed: "+restoreError);}
    throw error;
  }
}
function showTradeResult(player,message,success) {
  const prefix=success ? "§b[Harmonic Barter]§r " : "§c[Harmonic Barter]§r ";
  try{player.sendMessage(prefix+message);}
  catch(error){console.warn("[Ancient Abyss] Could not send barter result: "+error);}
}
function executeTrade(player,tierIndex) {
  const tier=TIERS[tierIndex];
  if(!tier) return;
  const container=getInventory(player);
  if(!container){showTradeResult(player,"Your inventory is unavailable.",false);return;}
  const creative=isCreative(player);
  const missing=creative ? [] : getMissingCosts(container,tier.costs);
  if(missing.length>0){showTradeResult(player,"Missing: "+missing.join(", ")+".",false);return;}

  let reward;
  try{reward=tier.createReward();}
  catch(error){
    console.error("[Ancient Abyss] Could not construct barter reward: "+error);
    showTradeResult(player,"This reward could not be created. No materials were consumed.",false);
    return;
  }
  let snapshot;
  if(!creative){
    try{snapshot=consumeCosts(container,tier.costs);}
    catch(error){
      console.error("[Ancient Abyss] Could not reserve barter materials: "+error);
      showTradeResult(player,"The trade could not reserve your materials. No trade was completed.",false);
      return;
    }
    if(!snapshot){showTradeResult(player,"Your inventory changed before the trade completed. No materials were consumed.",false);return;}
  }
  try{
    const remainder=container.addItem(reward);
    if(remainder){
      if(snapshot) restoreInventory(container,snapshot);
      showTradeResult(player,"There is no room for the reward. Your original inventory was restored.",false);
      return;
    }
  }catch(error){
    if(snapshot){
      try{restoreInventory(container,snapshot);}
      catch(restoreError){console.error("[Ancient Abyss] Inventory rollback failed: "+restoreError);}
    }
    console.error("[Ancient Abyss] Barter reward insertion failed: "+error);
    showTradeResult(player,"The trade failed. Your original inventory was restored where possible.",false);
    return;
  }
  try{chime(player.dimension,player.location,1.5);}
  catch(error){console.warn("[Ancient Abyss] Barter chime failed: "+error);}
  showTradeResult(player,"Trade complete: "+tier.title+".",true);
}
function openTradeMenu(player) {
  const container=getInventory(player);
  const creative=isCreative(player);
  const trust=getTrust(player);
  const form=new ActionFormData()
    .title("§bHarmonic Barter")
    .body(
      "§7Echo Dweller trust: §b"+trust+"§7 / 100\n"+
      "§8Trust is earned through sculk clearing, pylon offerings and future Warden healing.\n"+
      "§7Padded Treads grant Speed I while sneaking; they do not mute vanilla sculk sensors."
    );
  for(const tier of TIERS){
    let status="§cInventory unavailable";
    if(creative) status="§aCreative — materials not consumed";
    else if(container){
      const missing=getMissingCosts(container,tier.costs);
      status=missing.length===0 ? "§aReady" : "§cMissing "+missing.join(", ");
    }
    form.button(tier.buttonTitle+"\n§7"+tier.description+"\n"+status);
  }
  form.show(player).then((response)=>{
    if(response.canceled || response.selection===undefined) return;
    executeTrade(player,response.selection);
  }).catch((error)=>{
    console.warn("[Ancient Abyss] Could not open harmonic barter UI: "+error);
    showTradeResult(player,"The trade screen could not open. Close other forms and try again.",false);
  });
}
registerDwellerInteractHandler((player,dweller,item)=>{
  const donation=item?.typeId==="minecraft:amethyst_shard" ||
    item?.typeId==="minecraft:echo_shard" || isWool(item?.typeId ?? "");
  if(donation && !player.isSneaking) return false;
  openTradeMenu(player);
  return true;
});
