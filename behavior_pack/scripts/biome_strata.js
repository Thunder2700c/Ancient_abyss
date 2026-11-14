import { world, system } from "@minecraft/server";

const DIMENSION_ID = "meridian:ancient_abyss";
const FLAG_PROP = "meridian:strata_generated";
const REGION_RADIUS = 64;
const Y_MIN = -64;
const Y_MAX = 320;

const HADAL_MAX_Y = 30;
const FISSURE_MAX_Y = 120;

const HADAL_BLOCKS = [
	"meridian:abyssal_silt",
	"meridian:abyssal_silt",
	"meridian:abyssal_silt",
	"meridian:glow_polyps",
	"meridian:tendril_coral"
];

const FISSURE_BLOCKS = [
	"meridian:sulfuric_basalt",
	"meridian:sulfuric_basalt",
	"meridian:gloomstone",
	"meridian:sulfuric_basalt",
	"meridian:raw_abyssal_silt_ore"
];

const NECROPOLIS_BLOCKS = [
	"meridian:fractured_slate",
	"meridian:fractured_slate",
	"meridian:polished_slate",
	"meridian:petrified_gloom_roots",
	"meridian:fractured_slate"
];

function hashPick(x, y, z, table) {
	let h = (x * 374761393 + y * 668265263 + z * 2246822519) >>> 0;
	h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
	return table[h % table.length];
}

function pickBlockForY(x, y, z) {
	if (y <= HADAL_MAX_Y) {
		return hashPick(x, y, z, HADAL_BLOCKS);
	}
	if (y <= FISSURE_MAX_Y) {
		return hashPick(x, y, z, FISSURE_BLOCKS);
	}
	return hashPick(x, y, z, NECROPOLIS_BLOCKS);
}

function* generateStrataJob(dimension) {
	for (let x = -REGION_RADIUS; x <= REGION_RADIUS; x++) {
		for (let z = -REGION_RADIUS; z <= REGION_RADIUS; z++) {
			const edgeDistSq = x * x + z * z;
			if (edgeDistSq > REGION_RADIUS * REGION_RADIUS) {
				continue;
			}
			for (let y = Y_MIN; y <= Y_MAX; y++) {
				const isShell =
					x === -REGION_RADIUS || x === REGION_RADIUS ||
					z === -REGION_RADIUS || z === REGION_RADIUS ||
					y === Y_MIN || y === Y_MAX;
				if (isShell) {
					yield;
					continue;
				}
				const blockId = pickBlockForY(x, y, z);
				try {
					dimension.getBlock({ x: x, y: y, z: z })?.setType(blockId);
				} catch (e) {
					// Column outside loaded/generatable range for this dimension type; skip.
				}
				yield;
			}
		}
	}

	world.setDynamicProperty(FLAG_PROP, true);
	world.sendMessage("message.meridian.strata_complete");
}

function tryRunStrataGeneration() {
	const alreadyGenerated = world.getDynamicProperty(FLAG_PROP);
	if (alreadyGenerated === true) {
		return;
	}

	let dimension;
	try {
		dimension = world.getDimension(DIMENSION_ID);
	} catch (e) {
		return;
	}
	if (!dimension) {
		return;
	}

	world.setDynamicProperty(FLAG_PROP, "running");
	system.runJob(generateStrataJob(dimension));
}

world.afterEvents.playerDimensionChange.subscribe((event) => {
	if (event.toDimension?.id !== DIMENSION_ID) {
		return;
	}
	const state = world.getDynamicProperty(FLAG_PROP);
	if (state === undefined) {
		tryRunStrataGeneration();
	}
});

// NOT POSSIBLE IN BEDROCK: true infinite, chunk-streamed custom terrain generation
// via script (Bedrock custom dimensions only support fixed built-in generator types,
// no per-chunk scripted noise generator hook). Workaround used above: a single bounded
// cylindrical region (radius 64, Y -64 to 320) is filled once via system.runJob on first
// dimension entry, guarded by a world dynamic property so it only runs once. This is an
// approximation of the three strata bands, not a true infinite generator.