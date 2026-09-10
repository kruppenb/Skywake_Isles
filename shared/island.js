import { OBSTACLES, SHRINES, heightAt, regionAt } from './world.js';
import { cinderworksWeight } from './cinderworks.js';
import { moonwatchWeight } from './moonwatch.js';
import { palmheartWeight } from './palmheart-camp.js';

// The coast is the beach and the Haven shoreline: every original palm and surf
// rock outside the finished forge and observatory weights belongs to this kit.
export const COAST_REGIONS = Object.freeze(['beach', 'haven']);
export function isCoastRegion(region) { return COAST_REGIONS.includes(region); }

// The whole trunk of both palms stays inside this horizontal reach at scale 1,
// so a collidable palm scaled to 1.14 still fits its 2.0 m collider.
export const COAST_PALM_TRUNK_REACH = 1.6;
export function coastPalmScale(obstacle) {
  return Math.max(.7, Math.min(1.5, (obstacle?.height || 7) / 7));
}

// The collidable palms and surf rocks keep their shared radius and height; only
// their visuals are authored, so no obstacle or ID moves.
export const ISLAND_COAST_PALM_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => obstacle.type === 'tree' && isCoastRegion(regionAt(obstacle.x, obstacle.z)?.id)));
export const ISLAND_COAST_ROCK_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => obstacle.type === 'rock' && isCoastRegion(regionAt(obstacle.x, obstacle.z)?.id)
  && cinderworksWeight(obstacle.x, obstacle.z) <= 0 && moonwatchWeight(obstacle.x, obstacle.z) <= 0));

// Two boulders dress every coast collider: the tall one for the steep harbour
// and Haven rocks, the low round one for the wide, shallow ones.
export const COAST_ROCK_NOMINALS = Object.freeze({ coast_rock_a: { radius: 2.5, height: 5 }, coast_rock_b: { radius: 2.0, height: 3 } });
export function coastRockDressing(obstacle) {
  const radius = obstacle?.radius || 1.6, height = obstacle?.height || 2;
  const prefab = height / radius >= 1.75 ? 'coast_rock_a' : 'coast_rock_b';
  const nominal = COAST_ROCK_NOMINALS[prefab];
  return { prefab, scale: [radius / nominal.radius, height / nominal.height, radius / nominal.radius] };
}

// The three shrines the landmark slice dresses. buildScenery still reads its own
// SHRINES entries in place, so these anchors are an independent derivation of
// the very same points, never a second source of truth for the draw order.
const shrineAnchor = (id, fallback) => {
  const shrine = SHRINES.find(entry => entry.id === id) || fallback;
  return Object.freeze({ x: shrine.x, z: shrine.z });
};
export const ISLAND_SHRINE_ANCHORS = Object.freeze({
  palm: shrineAnchor('palm', { x: -68, z: 12 }),
  moon: shrineAnchor('moon', { x: 76, z: 32 }),
  ember: shrineAnchor('ember', { x: 48, z: -65 }),
});
// The four one-off landmarks stand on fixed offsets from their shrine, so their
// ground height is analytic. Everything else is placed inside buildScenery's own
// RNG loops and recorded there; nothing in this module recreates a draw.
export const ISLAND_LANDMARK_ANCHORS = Object.freeze({
  palmGate: Object.freeze({ x: ISLAND_SHRINE_ANCHORS.palm.x, z: ISLAND_SHRINE_ANCHORS.palm.z - 11,
    y: heightAt(ISLAND_SHRINE_ANCHORS.palm.x, ISLAND_SHRINE_ANCHORS.palm.z - 11) }),
  moonGate: Object.freeze({ x: ISLAND_SHRINE_ANCHORS.moon.x + 2, z: ISLAND_SHRINE_ANCHORS.moon.z - 13,
    y: heightAt(ISLAND_SHRINE_ANCHORS.moon.x + 2, ISLAND_SHRINE_ANCHORS.moon.z - 13) }),
  emberCore: Object.freeze({ x: ISLAND_SHRINE_ANCHORS.ember.x, z: ISLAND_SHRINE_ANCHORS.ember.z - 22,
    y: heightAt(ISLAND_SHRINE_ANCHORS.ember.x, ISLAND_SHRINE_ANCHORS.ember.z - 22) }),
});

// Authored envelopes for the eleven landmark roots: the widest horizontal reach
// and the local height band each root is exported inside, at unit scale. The
// ridge height is the only nominal the runtime divides by, so a crescent tower
// recorded at h metres installs at scale [1, h / 10, 1].
export const ISLAND_LANDMARK_NOMINALS = Object.freeze({
  palm_gate_pillar:      Object.freeze({ radius: 1.92, minY: -.45,  maxY: 6.12,  height: 6.12 }),
  palm_gate_lintel:      Object.freeze({ radius: 5.84, minY: -.55,  maxY: .55,   height: 1.10 }),
  moon_gate_ring:        Object.freeze({ radius: 4.32, minY: -4.29, maxY: 4.29,  height: 8.58 }),
  moon_gate_orb:         Object.freeze({ radius: .75,  minY: -.75,  maxY: .75,   height: 1.50 }),
  shrine_mushroom:       Object.freeze({ radius: 1.80, minY: -.25,  maxY: 3.40,  height: 3.40 }),
  shrine_moon_crystal:   Object.freeze({ radius: 1.00, minY: -.30,  maxY: 3.05,  height: 3.05 }),
  caldera_ridge_a:       Object.freeze({ radius: 4.70, minY: -2.60, maxY: 11.25, height: 10 }),
  caldera_ridge_b:       Object.freeze({ radius: 4.70, minY: -2.60, maxY: 11.25, height: 10 }),
  caldera_amber_crystal: Object.freeze({ radius: 1.00, minY: -.30,  maxY: 3.05,  height: 3.05 }),
  ember_core:            Object.freeze({ radius: 5.00, minY: -.20,  maxY: .80,   height: 1.00 }),
  ember_core_rock:       Object.freeze({ radius: 1.80, minY: -1.70, maxY: 1.70,  height: 3.40 }),
});
// The moon gate is a doorway: no authored triangle may reach inside this radius
// of the ring's local-XY origin, so the walk-through aperture stays open.
export const MOON_GATE_APERTURE_RADIUS = 3.48;
// Every original shrine draw the authored kit takes over, by kind. The runtime
// counts what it actually installed and the tests compare it against this card.
export const ISLAND_LANDMARK_COUNTS = Object.freeze({
  pillars: 2, lintels: 1, moonGates: 1, orbs: 1, mushrooms: 3, moonCrystals: 7,
  ridges: 18, amberCrystals: 6, cores: 1, coreRocks: 10,
});
export const ISLAND_LANDMARK_TOTAL = Object.values(ISLAND_LANDMARK_COUNTS).reduce((sum, count) => sum + count, 0);

// ---------------------------------------------------------------------------
// The wild canopy: every jungle, moon and volcanic scenery draw that still sits
// outside a finished settlement. The three published areas keep their own
// obstacles and scatter; this slice only dresses what the procedural batch was
// still drawing between them.
export const ISLAND_CANOPY_REGIONS = Object.freeze(['jungle', 'moon', 'volcano']);
export function isCanopyRegion(region) { return ISLAND_CANOPY_REGIONS.includes(region); }
// buildScenery skips the beacon landmark, every building footprint and the Old
// Watch pilot props before it draws anything, so the derivation starts there.
const sceneryObstacle = obstacle => obstacle.type !== 'landmark' && obstacle.type !== 'building' && obstacle.pilot !== 'old-watch';
const canopyObstacles = (type, region, outside) => Object.freeze(OBSTACLES.filter(obstacle => sceneryObstacle(obstacle)
  && obstacle.type === type && regionAt(obstacle.x, obstacle.z)?.id === region && outside(obstacle.x, obstacle.z)));
// Membership is the original routing read backwards, weight for weight: a tree
// is the canopy's when its own region's camp or observatory has passed on it, a
// rock when the forge and the observatory have - the rock branch never consulted
// the Palmheart weight, so the jungle boulder inside the camp's reach is still
// drawn by the procedural batch and still belongs here. prop-9 (Palmheart),
// prop-28 and prop-33 (Moonwatch) and prop-23 (Cinderworks) therefore stay with
// the areas that already dress them.
export const ISLAND_JUNGLE_TREE_OBSTACLES = canopyObstacles('tree', 'jungle', (x, z) => palmheartWeight(x, z) <= 0);
export const ISLAND_JUNGLE_ROCK_OBSTACLES = canopyObstacles('rock', 'jungle', (x, z) => cinderworksWeight(x, z) <= 0 && moonwatchWeight(x, z) <= 0);
export const ISLAND_MOON_TREE_OBSTACLES = canopyObstacles('tree', 'moon', (x, z) => moonwatchWeight(x, z) <= 0);
export const ISLAND_VOLCANO_ROCK_OBSTACLES = canopyObstacles('rock', 'volcano', (x, z) => cinderworksWeight(x, z) <= 0 && moonwatchWeight(x, z) <= 0);
export const ISLAND_CANOPY_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => ISLAND_JUNGLE_TREE_OBSTACLES.includes(obstacle)
  || ISLAND_JUNGLE_ROCK_OBSTACLES.includes(obstacle) || ISLAND_MOON_TREE_OBSTACLES.includes(obstacle) || ISLAND_VOLCANO_ROCK_OBSTACLES.includes(obstacle)));

// Measured from the resident kits at unit scale - the maximum horizontal reach
// over the actual vertices and the top of the root above its own origin:
//   jungle_tree_a 3.3024 / 7.9111   jungle_tree_b 3.4670 / 10.3180
//   jungle_palm   3.0515 / 9.2741   coast_rock_b  1.8308 / 2.8095
//   silver_tree_a 3.3285 / 8.5743   silver_tree_b 3.7800 / 10.6549
//   moon_mushroom 1.7552 / 3.2859   basalt_outcrop 2.7087 / 7.9743
//   basalt_boulder_a .8158 / 1.0400 basalt_boulder_b .9857 / 1.3500
//   ember_crystal .3197 / .9200
// Every nominal rounds those measurements up, so a body dressed at radius / r
// and height / h always stays inside its collider and never overshoots the
// height the original silhouette reached. The three collider nominals are the
// ones Palmheart, Moonwatch and Cinderworks already divide by, so a wild tree
// and a camp tree of the same size install at the same scale.
export const ISLAND_CANOPY_NOMINALS = Object.freeze({
  jungle_tree_a:    Object.freeze({ radius: 3.4,  height: 8 }),
  jungle_tree_b:    Object.freeze({ radius: 3.8,  height: 11 }),
  jungle_palm:      Object.freeze({ radius: 3.1,  height: 9.3 }),
  jungle_rock:      Object.freeze({ radius: 2.0,  height: 3 }),
  silver_tree_a:    Object.freeze({ radius: 3.4,  height: 8.6 }),
  silver_tree_b:    Object.freeze({ radius: 3.8,  height: 11 }),
  moon_mushroom:    Object.freeze({ radius: 1.8,  height: 3.3 }),
  basalt_outcrop:   Object.freeze({ radius: 3,    height: 8 }),
  basalt_boulder_a: Object.freeze({ radius: .85,  height: 1.05 }),
  basalt_boulder_b: Object.freeze({ radius: 1.0,  height: 1.35 }),
  ember_crystal:    Object.freeze({ radius: .32,  height: .95 }),
});
// The original volcanic lump is a dodecahedron scaled [1.3, 1.2, 1.0] about a
// centre .8 above the ground, and the original crystal's tallest shard is 3
// high. A boulder is fitted to the lump's mean horizontal reach and a shard to
// the crystal's height; both dress uniformly, because only a collider carries a
// non-uniform scale.
export const CANOPY_PEBBLE_REACH = 1.15, CANOPY_CRYSTAL_HEIGHT = 3;
const CANOPY_PLANT_IDS = Object.freeze({
  jungleTrees: 'canopy-jungle-tree-', junglePalms: 'canopy-jungle-palm-', moonTrees: 'canopy-moon-tree-',
  moonMushrooms: 'canopy-moon-mushroom-', volcanoPebbles: 'canopy-volcano-pebble-', volcanoCrystals: 'canopy-volcano-crystal-',
});
const uniform = scale => [scale, scale, scale];
const fitted = (obstacle, prefab, fallbackRadius, fallbackHeight) => {
  const nominal = ISLAND_CANOPY_NOMINALS[prefab];
  const radius = obstacle?.radius || fallbackRadius, height = obstacle?.height || fallbackHeight;
  return [radius / nominal.radius, height / nominal.height, radius / nominal.radius];
};

// A collidable wild tree takes the taller hardwood or silver crown, exactly as
// the two camps dress their own collidable trees, and carries the recorded
// radius and height as a non-uniform scale.
export function canopyTreeDressing(obstacle, region) {
  const prefab = region === 'moon' ? 'silver_tree_b' : 'jungle_tree_b';
  return { id: obstacle?.id, kind: region === 'moon' ? 'moonTrees' : 'jungleTrees', prefab, scale: fitted(obstacle, prefab, 2.5, 7) };
}
// The volcanic colliders take Cinderworks' basalt column. The single jungle
// collider takes the runtime-only jungle_rock alias: coast_rock_b's geometry in
// an olive-jade jungle_gate_stone clone, never pale surf limestone.
export function canopyRockDressing(obstacle, region) {
  const prefab = region === 'volcano' ? 'basalt_outcrop' : 'jungle_rock';
  return { id: obstacle?.id, kind: region === 'volcano' ? 'volcanoRocks' : 'jungleRocks', prefab, scale: fitted(obstacle, prefab, 1.6, 2) };
}
// One decorative draw of the original 245-plant loop. The kind and the variant
// follow the very same region and index arithmetic the loop already branches
// on, so nothing here is a new random decision.
export function canopyPlantDressing(region, index, size) {
  const dressing = (kind, prefab, scale) => ({ id: CANOPY_PLANT_IDS[kind] + index, kind, prefab, scale });
  if (region === 'moon') {
    if (index % 3 === 0) return dressing('moonTrees', index % 2 ? 'silver_tree_b' : 'silver_tree_a', uniform(size));
    return dressing('moonMushrooms', 'moon_mushroom', uniform(size));
  }
  if (region === 'volcano') {
    if (index % 3 === 0) return dressing('volcanoCrystals', 'ember_crystal', uniform(CANOPY_CRYSTAL_HEIGHT * size / ISLAND_CANOPY_NOMINALS.ember_crystal.height));
    // The boulder variant follows the original lump's own two-tone split, so the
    // darker rock still lands where the darker vertex colour did.
    const prefab = index % 2 ? 'basalt_boulder_b' : 'basalt_boulder_a';
    return dressing('volcanoPebbles', prefab, uniform(CANOPY_PEBBLE_REACH * size / ISLAND_CANOPY_NOMINALS[prefab].radius));
  }
  if (index % 3 !== 0) return dressing('jungleTrees', index % 2 ? 'jungle_tree_b' : 'jungle_tree_a', uniform(size));
  return dressing('junglePalms', 'jungle_palm', uniform(size));
}

// Every original wild canopy draw the authored kit takes over, by kind. The
// runtime counts what it actually installed and the tests compare it against
// this card. Confirmed against the shipped seed: 18 collidables - 6 jungle
// trees, 1 jungle rock, 5 moon trees and 6 volcanic columns - and 100
// decorative plants, of which the jungle keeps 17 trees and 11 palms, the grove
// 6 trees and 21 caps, and the volcanic slope 34 lumps and 11 shards. The three
// jungle-region trees and two jungle-region palms that fall inside the Old
// Watch weight, and the one tree and one palm inside Palmheart's, stay with the
// areas that already dress them.
export const ISLAND_CANOPY_COUNTS = Object.freeze({
  jungleTrees: 23, junglePalms: 11, jungleRocks: 1,
  moonTrees: 11, moonMushrooms: 21,
  volcanoRocks: 6, volcanoPebbles: 34, volcanoCrystals: 11,
});
export const ISLAND_CANOPY_TOTAL = Object.values(ISLAND_CANOPY_COUNTS).reduce((sum, count) => sum + count, 0);
