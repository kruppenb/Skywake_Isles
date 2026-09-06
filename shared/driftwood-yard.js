import { BUILDINGS, RESIDENTS, POINTS_OF_INTEREST, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, SPAWN, heightAt } from './world.js';
import { SIDE_EVENTS } from './side-events.js';
import { ENCOUNTER_GROUPS } from './encounters.js';

export const DRIFTWOOD_YARD = Object.freeze({ x: 31, z: 95, radius: 21 });
export const SUNWAKE_STRAND = Object.freeze({ x: 0, z: 101, radius: 25 });
export const DRIFTWOOD_BUILDING_IDS = Object.freeze(['timber-shed', 'shipwrights-cottage']);
export const DRIFTWOOD_BUILDINGS = Object.freeze(DRIFTWOOD_BUILDING_IDS.map(id => BUILDINGS.find(building => building.id === id)));
export const DRIFTWOOD_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'driftwood-yard').points;
const SALTWIND_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'saltwind-harbor').points;
// The original landing crates from world.buildScenery, with the same point of
// interest filter deciding which of them the authored kit replaces.
export const SUNWAKE_LANDING_CRATE_CANDIDATES = Object.freeze([[-13, 103, .9], [13, 101, 1], [-10, 113, .7]]);
export const SUNWAKE_LANDING_CRATES = Object.freeze(SUNWAKE_LANDING_CRATE_CANDIDATES
  .filter(([x, z]) => !POINTS_OF_INTEREST.some(place => Math.hypot(x - place.x, z - place.z) < place.radius))
  .map(([x, z, scale]) => Object.freeze({ x, z, scale })));
export const SUNWAKE_PIER = Object.freeze({ x: SPAWN.x, sections: 5, length: 2.4, firstZ: 116.2 });
export const SUNWAKE_BANNER = Object.freeze({ z: SPAWN.z + 7, poles: [-7, 7], lineHeight: 4.85 });
const YARD_SUPPLIES = SIDE_EVENTS.find(event => event.placeId === 'driftwood-yard');
const YARD_GUARDS = ENCOUNTER_GROUPS.find(group => group.id === 'driftwood-yard');
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function driftwoodSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, index) => driftwoodSegmentDistance(x, z, route[index], point)));
}

// The working yard plus a halo around both of its buildings. West of the yard
// the strand takes over, and the harbor keeps everything beyond x = -4.
export function driftwoodYardWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  let weight = smooth((DRIFTWOOD_YARD.radius - Math.hypot(x - DRIFTWOOD_YARD.x, z - DRIFTWOOD_YARD.z)) / 8);
  for (const building of DRIFTWOOD_BUILDINGS) weight = Math.max(weight, smooth((12 - Math.hypot(x - building.x, z - building.z)) / 6));
  return weight * smooth((x - 8) / 6) * smooth((z - 70) / 8);
}
// The landing beach around the spawn dock, crossfading into the harbor over
// x in [-9, -4] and into the yard over x in [8, 17].
export function sunwakeStrandWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  return smooth((SUNWAKE_STRAND.radius - Math.hypot(x - SUNWAKE_STRAND.x, z - SUNWAKE_STRAND.z)) / 8) * smooth((x + 9) / 5) * smooth((17 - x) / 6);
}
export function driftwoodWeight(x, z) {
  return Math.max(driftwoodYardWeight(x, z), sunwakeStrandWeight(x, z));
}

export function driftwoodYardPaths() {
  const approaches = DRIFTWOOD_BUILDINGS.flatMap(building => [1, -1].map(end =>
    [buildingWorldPoint(building, 0, end * (building.depth / 2 + 4)), buildingWorldPoint(building, 0, end * building.depth / 2)]));
  return [DRIFTWOOD_TRAIL, ...approaches];
}
// The pier walk, the beacon approach and the first leg of both coastal trails.
export function sunwakeStrandPaths() {
  return [[SPAWN, { x: 0, z: 127 }], [SPAWN, { x: 0, z: 70 }], SALTWIND_TRAIL.slice(0, 2), DRIFTWOOD_TRAIL.slice(0, 2)];
}
export function sunwakeStrandPathDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...sunwakeStrandPaths().map(route => routeDistance(x, z, route)));
}
export function driftwoodPathDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...[...driftwoodYardPaths(), ...sunwakeStrandPaths()].map(route => routeDistance(x, z, route)));
}

// Small plants and loose props stay cosmetic. Clear Ada's loop, all four door
// approaches, the existing work sites, loot, the drop point, the side event
// supplies and the guarded inland approach.
export function driftwoodPlantClearance(x, z, sites = [], padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || driftwoodWeight(x, z) < .05 || heightAt(x, z) < 1.7) return false;
  if (trailDistance(x, z) < 2.8 + padding || driftwoodPathDistance(x, z) < 2.1 + padding) return false;
  if (Math.hypot(x - SPAWN.x, z - SPAWN.z) < 9 + padding) return false;
  if (Math.hypot(x - YARD_SUPPLIES.x, z - YARD_SUPPLIES.z) < 5 + padding) return false;
  if (Math.hypot(x - YARD_GUARDS.x, z - YARD_GUARDS.z) < 8) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .35 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .5 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (driftwoodSegmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}

// The original work sites are identified by their authored radii, the same way
// the harbor finds its net frame; positions stay authoritative in the settlement.
export function driftwoodWorkSites(propSites = []) {
  const yard = propSites.filter(site => site.poiId === 'driftwood-yard');
  const find = (radius, name) => {
    const site = yard.find(candidate => Math.abs(candidate.radius - radius) < .01);
    if (!site) throw new Error('Driftwood Yard is missing its original ' + name + ' site');
    return site;
  };
  return { hull: find(3.5, 'hull'), timber: find(2.0, 'timber stack'), lantern: find(.55, 'lantern') };
}
