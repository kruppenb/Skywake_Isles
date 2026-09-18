import { REGIONS, OBSTACLES, SHRINES, SPAWN, BEACON, CHESTS, heightAt, regionAt, seededRandom } from './world.js';
import { POINTS_OF_INTEREST, BUILDINGS, RESIDENTS, buildingLocalPoint, trailDistance } from './exploration.js';
import { ENCOUNTER_GROUPS } from './encounters.js';
import { CAPTAINS_HOUSE } from './captains-house.js';
import { AIRSHIP_RETURNS, RETURN_RANGE } from './airship.js';
import { DIVE_ENTRANCE } from './underwater.js';
import { oldWatchWeight } from './old-watch.js';
import { windwardFarmWeight } from './windward-farm.js';
import { tideglassWeight } from './tideglass-market.js';
import { saltwindHarborWeight } from './saltwind-harbor.js';
import { driftwoodWeight } from './driftwood-yard.js';
import { palmheartWeight } from './palmheart-camp.js';
import { cinderworksWeight } from './cinderworks.js';
import { moonwatchWeight } from './moonwatch.js';
import { ISLAND_SHRINE_ANCHORS } from './island.js';

// The understory: the density pass planted between the finished areas. The
// original scenery, the eight area kits and the four island slices all keep
// their own placements and RNG streams; this layer draws from its own seed and
// only ever stands where every one of them has passed - outside every area
// weight, off every route, trail, loop, chest, landmark and collider. It adds
// no obstacle, no lighting and no gameplay data: every clump, tree and palm is
// walkable decoration, exactly like the decorative trees of the original batch.
export const ISLAND_UNDERSTORY_SEED = 418211;
const TAU = Math.PI * 2;

// One card per region: how many of each species the pass tries to plant. The
// size bands match the ones the area kits already install their own plants at.
export const ISLAND_UNDERSTORY_TARGETS = Object.freeze({
  haven:   Object.freeze({ palms: 8,  grass: 540, ferns: 60 }),
  beach:   Object.freeze({ palms: 10, grass: 190 }),
  jungle:  Object.freeze({ trees: 36, ferns: 260, grass: 280 }),
  moon:    Object.freeze({ trees: 14, mushrooms: 18, bells: 90, ferns: 110, grass: 150 }),
  volcano: Object.freeze({ pebbles: 20, crystals: 6, cinder: 130, grass: 70 }),
});
// Regions are Voronoi cells on a normalised distance, so a region reaches well
// beyond its nominal radius on some bearings; the sampler covers that reach and
// rejects whatever lands in a neighbour.
const SAMPLE_REACH = 1.7, ISLAND_REACH = 124;
const SIZES = Object.freeze({
  palm: [.7, .4], tree: [.8, .35], mushroom: [.7, .8], pebble: [.8, .45], crystal: [.8, .5],
  grass: [.5, .5], fern: [.7, .5], bell: [.7, .5], cinder: [.7, .5],
});
// Canopy spacing, in metres: a new trunk keeps this far from every other new
// trunk, from the recorded wild canopy the caller passes in, and from every
// collider's own radius plus the original decorative-tree margin.
const TREE_SPACING = 4.5, MUSHROOM_SPACING = 3.5, CRYSTAL_SPACING = 3, TREE_COLLIDER_MARGIN = 3, PLANT_COLLIDER_MARGIN = .3;
const GROUND_HEIGHT = 2.0, CANOPY_HEIGHT = 2.4;

const AREA_WEIGHTS = [oldWatchWeight, windwardFarmWeight, tideglassWeight, saltwindHarborWeight, driftwoodWeight,
  palmheartWeight, cinderworksWeight, moonwatchWeight];
const PRIMARY_ROUTES = [SPAWN, ...SHRINES].map(point => [BEACON, point]);
const LANDINGS = [SPAWN, BEACON, ...SHRINES];
const CLEARINGS = [...AIRSHIP_RETURNS.map(point => ({ x: point.x, z: point.z, radius: RETURN_RANGE + 2.5 })),
  { x: DIVE_ENTRANCE.x, z: DIVE_ENTRANCE.z, radius: DIVE_ENTRANCE.range + 2 }];
// The original grove caps: all four candidates are cleared, whether or not the
// original point-of-interest filter admitted them, which costs nothing.
const GROVE_CAPS = [[-14, -12, 2.1], [15, -9, 2.6], [18, 11, 1.8], [-9, 16, 1.6]];

function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
// Every finished area owns its own ground: the pass stands only where all eight
// weights are exactly zero, so no area's feathered edge is planted twice.
export function islandAreaWeight(x, z) {
  let weight = 0;
  for (const area of AREA_WEIGHTS) weight = Math.max(weight, area(x, z));
  return weight;
}
// The authored shrine landmarks, cleared analytically from the same anchors the
// landmark slice records: the palm gate and its lintel, the moon gate, the
// grove caps and the crystal ring, the caldera crescent with its ember core,
// and the beacon's perimeter ring.
export function islandLandmarkClearance(x, z, padding = 0) {
  const palm = ISLAND_SHRINE_ANCHORS.palm, moon = ISLAND_SHRINE_ANCHORS.moon, ember = ISLAND_SHRINE_ANCHORS.ember;
  if (Math.abs(x - palm.x) < 7.8 + padding && Math.abs(z - (palm.z - 11)) < 3.2 + padding) return false;
  if (Math.hypot(x - (moon.x + 2), z - (moon.z - 13)) < 6 + padding) return false;
  if (Math.abs(Math.hypot(x - moon.x, z - moon.z) - 13.7) < 2.4 + padding) return false;
  for (const [dx, dz, size] of GROVE_CAPS) if (Math.hypot(x - moon.x - dx, z - moon.z - dz) < 1.8 * size + 1 + padding) return false;
  const ex = x - ember.x, ez = z - ember.z, crescent = Math.hypot(ex / 16.5, ez / 18.5);
  if (ez < 4 + padding && crescent > .6 - padding / 16.5 && crescent < 1.4 + padding / 16.5) return false;
  if (Math.hypot(ex, ez + 22) < 8.5 + padding) return false;
  return Math.hypot(x - BEACON.x, z - BEACON.z) >= 13.2 + padding;
}
// Walkable planting clearance for a clump (or, with `canopy`, a trunk): the
// union of every rule the original scenery and the eight area kits apply, so
// nothing the pass plants can stand where a player, a resident, a guard, a
// chest, a door, a lift, the dive, a landmark or a collider already does.
export function islandUnderstoryClearance(x, z, padding = 0, { canopy = false } = {}) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) > ISLAND_REACH) return false;
  if (heightAt(x, z) < (canopy ? CANOPY_HEIGHT : GROUND_HEIGHT) || islandAreaWeight(x, z) > 0) return false;
  if (PRIMARY_ROUTES.some(([a, b]) => segmentDistance(x, z, a, b) < 6 + padding)) return false;
  if (trailDistance(x, z) < 3 + padding) return false;
  if (LANDINGS.some(point => Math.hypot(x - point.x, z - point.z) < 11 + padding)) return false;
  if (POINTS_OF_INTEREST.some(place => Math.hypot(x - place.x, z - place.z) < place.radius + padding)) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 3.2 + padding)) return false;
  if (ENCOUNTER_GROUPS.some(group => Math.hypot(x - group.x, z - group.z) < 8 + padding)) return false;
  if (CLEARINGS.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + padding)) return false;
  if (Math.abs(x - CAPTAINS_HOUSE.x) < CAPTAINS_HOUSE.width / 2 + 3 + padding && Math.abs(z - CAPTAINS_HOUSE.z) < CAPTAINS_HOUSE.depth / 2 + 5 + padding) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + 2 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (segmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  const margin = canopy ? TREE_COLLIDER_MARGIN : PLANT_COLLIDER_MARGIN;
  if (OBSTACLES.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + margin + padding)) return false;
  return islandLandmarkClearance(x, z, padding);
}

const uniform = size => [size, size, size];
const site = (region, kind, index, prefab, x, z, yaw, size) => ({ id: 'understory-' + region + '-' + kind + '-' + index, kind, region, prefab,
  x, y: heightAt(x, z), z, rotation: [0, yaw, 0], scale: uniform(size), size });

// Every descriptor the pass plants, in the shape the island kit already
// installs: a coast palm carries the site fields the strand batches read, a
// canopy root the full transform the wild canopy takes whole, and a ground
// alias the transform the ground cover reseats on the rendered triangle. The
// order of the loops is the RNG order, so a target changed in one region never
// reshuffles the regions before it. `avoid` lists the positions a new trunk
// keeps clear of - the recorded wild canopy and the coast palms - so no tree
// grows through one.
export function islandUnderstorySites({ targets = ISLAND_UNDERSTORY_TARGETS, seed = ISLAND_UNDERSTORY_SEED, avoid = [] } = {}) {
  const random = seededRandom(seed), sites = [], trunks = avoid.map(point => ({ x: point.x, z: point.z })), caps = [], shards = [];
  const sample = region => {
    const a = random() * TAU, r = Math.sqrt(random()) * region.radius * SAMPLE_REACH;
    return [region.x + Math.sin(a) * r, region.z + Math.cos(a) * r];
  };
  const plant = (region, target, attempts, padding, options, place) => {
    let planted = 0;
    for (let index = 0; index < attempts && planted < target; index++) {
      const [x, z] = sample(region);
      if (regionAt(x, z)?.id !== region.id || !islandUnderstoryClearance(x, z, padding, options)) continue;
      const placed = place(x, z, planted);
      if (placed) { sites.push(placed); planted++; }
    }
  };
  const spaced = (list, x, z, spacing) => !list.some(point => Math.hypot(x - point.x, z - point.z) < spacing);
  const size = ([base, spread]) => base + random() * spread;
  for (const region of REGIONS) {
    const card = targets[region.id] ?? {};
    // Canopy first - trunks claim their spacing before anything small is drawn.
    if (card.palms) plant(region, card.palms, card.palms * 150, 1.2, { canopy: true }, (x, z, index) => {
      if (!spaced(trunks, x, z, TREE_SPACING)) return null;
      const yaw = random() * TAU, scale = size(SIZES.palm); trunks.push({ x, z });
      return { id: 'understory-' + region.id + '-' + region.id + 'Palms-' + index, kind: region.id + 'Palms', region: region.id,
        prefab: index % 2 ? 'coast_palm_b' : 'coast_palm_a', x, z, yaw, size: scale };
    });
    if (card.trees) {
      let hardwoods = 0;
      plant(region, card.trees, card.trees * 150, 1.2, { canopy: true }, (x, z, index) => {
        if (!spaced(trunks, x, z, TREE_SPACING)) return null;
        const yaw = random() * TAU, scale = size(SIZES.tree); trunks.push({ x, z });
        if (region.id === 'moon') return site(region.id, 'moonTrees', index, index % 2 ? 'silver_tree_b' : 'silver_tree_a', x, z, yaw, scale);
        if (index % 3 === 0) return site(region.id, 'junglePalms', index, 'jungle_palm', x, z, yaw, scale);
        return site(region.id, 'jungleTrees', index, hardwoods++ % 2 ? 'jungle_tree_b' : 'jungle_tree_a', x, z, yaw, scale);
      });
    }
    if (card.mushrooms) plant(region, card.mushrooms, card.mushrooms * 120, .6, {}, (x, z, index) => {
      if (!spaced(caps, x, z, MUSHROOM_SPACING) || !spaced(trunks, x, z, 2.5)) return null;
      caps.push({ x, z });
      return site(region.id, 'moonMushrooms', index, 'moon_mushroom', x, z, random() * TAU, size(SIZES.mushroom));
    });
    if (card.pebbles) plant(region, card.pebbles, card.pebbles * 120, 1.2, {}, (x, z, index) => {
      if (!spaced(shards, x, z, CRYSTAL_SPACING)) return null;
      shards.push({ x, z });
      return site(region.id, 'volcanoPebbles', index, index % 2 ? 'basalt_boulder_b' : 'basalt_boulder_a', x, z, random() * TAU, size(SIZES.pebble));
    });
    if (card.crystals) plant(region, card.crystals, card.crystals * 120, .3, {}, (x, z, index) => {
      if (!spaced(shards, x, z, CRYSTAL_SPACING)) return null;
      shards.push({ x, z });
      return site(region.id, 'volcanoCrystals', index, 'ember_crystal', x, z, random() * TAU, size(SIZES.crystal));
    });
    // Then the ground cover, in the region's own palette.
    const ground = (kind, prefab, band, target) => plant(region, target, target * 60, .15, {},
      (x, z, index) => site(region.id, kind, index, prefab, x, z, random() * TAU, size(band)));
    if (card.bells) ground('moonBells', 'moon_bell', SIZES.bell, card.bells);
    if (card.cinder) ground('volcanoCinder', 'volcano_cinder', SIZES.cinder, card.cinder);
    if (card.ferns) ground(region.id + 'Ferns', region.id + '_fern', SIZES.fern, card.ferns);
    if (card.grass) ground(region.id + 'Grass', region.id + '_grass', SIZES.grass, card.grass);
  }
  return sites;
}

// The shipped inventory of the pass, by kind, confirmed against the seed with
// the recorded wild canopy and coast palms passed in as `avoid`. The runtime
// counts what it actually installed and the tests compare it against this card.
export const ISLAND_UNDERSTORY_COUNTS = Object.freeze({
  beachPalms: 10, beachGrass: 190,
  jungleTrees: 24, junglePalms: 12, jungleFerns: 260, jungleGrass: 280,
  volcanoPebbles: 20, volcanoCrystals: 6, volcanoCinder: 130, volcanoGrass: 70,
  moonTrees: 14, moonMushrooms: 18, moonBells: 90, moonFerns: 110, moonGrass: 150,
  havenPalms: 8, havenFerns: 60, havenGrass: 540,
});
export const ISLAND_UNDERSTORY_TOTAL = Object.values(ISLAND_UNDERSTORY_COUNTS).reduce((sum, count) => sum + count, 0);
