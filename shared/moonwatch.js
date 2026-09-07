import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, SHRINES, BEACON, heightAt } from './world.js';
import { ENCOUNTER_GROUPS } from './encounters.js';

export const MOONWATCH = Object.freeze({ x: 96, z: 42, radius: 14 });
export const MOONWATCH_DOME = BUILDINGS.find(building => building.id === 'moonwatch-dome');
export const MOONWATCH_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'moonwatch').points;
export const MOONBLOOM_SHRINE = SHRINES.find(shrine => shrine.id === 'moon');
const DOME_GUARDS = ENCOUNTER_GROUPS.find(group => group.id === 'moonwatch');
const LIO = RESIDENTS.find(person => person.poiId === 'moonwatch');
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function moonwatchSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, index) => moonwatchSegmentDistance(x, z, route[index], point)));
}

// The observatory grounds plus a halo around the dome itself, cut back well
// short of the moon shrine so its crystal ring, its gateway and the primary
// route junction keep the island's baseline lighting and stay unplanted. All
// three ramps are 9 m wide, which holds the ambient step under .01 per .1 m.
export function moonwatchWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const grounds = smooth((MOONWATCH.radius + 9 - Math.hypot(x - MOONWATCH.x, z - MOONWATCH.z)) / 9);
  const around = smooth((12 - Math.hypot(x - MOONWATCH_DOME.x, z - MOONWATCH_DOME.z)) / 9);
  return Math.max(grounds, around) * smooth((Math.hypot(x - MOONBLOOM_SHRINE.x, z - MOONBLOOM_SHRINE.z) - 14) / 9);
}

// The collidable silver tree and moon boulder inside the area keep their shared
// radius and height; only their visuals are authored, so no obstacle or ID moves.
export const MOONWATCH_CANOPY_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => obstacle.type === 'tree' && moonwatchWeight(obstacle.x, obstacle.z) > 0));
export const MOONWATCH_ROCK_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => obstacle.type === 'rock' && moonwatchWeight(obstacle.x, obstacle.z) > 0));

// The trail, Lio's loop and the walked approach to the dome's closed door.
export function moonwatchPaths() {
  const approach = [buildingWorldPoint(MOONWATCH_DOME, 0, MOONWATCH_DOME.radius + 3.5), buildingWorldPoint(MOONWATCH_DOME, 0, MOONWATCH_DOME.radius * .6)];
  return [MOONWATCH_TRAIL, [...LIO.route, LIO.route[0]], approach];
}
export function moonwatchPathDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...moonwatchPaths().map(route => routeDistance(x, z, route)));
}

// Grove planting and loose props stay cosmetic. Clear the trails, the primary
// shrine route, the shrine ring, the guarded approach, loot, the original work
// sites, every building and Lio's loop.
export function moonwatchPlantClearance(x, z, sites = [], padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || moonwatchWeight(x, z) < .05 || heightAt(x, z) < 1.7) return false;
  if (trailDistance(x, z) < 2.8 + padding || moonwatchPathDistance(x, z) < 2.1 + padding) return false;
  if (moonwatchSegmentDistance(x, z, BEACON, MOONBLOOM_SHRINE) < 6 + padding) return false;
  if (Math.hypot(x - MOONBLOOM_SHRINE.x, z - MOONBLOOM_SHRINE.z) < 12 + padding) return false;
  if (Math.hypot(x - DOME_GUARDS.x, z - DOME_GUARDS.z) < 8 + padding) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .35 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .6 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (moonwatchSegmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}

// The original observatory sites keep their authored positions and radii; all
// four differ, so the radius alone tells them apart.
export function moonwatchWorkSites(propSites = []) {
  const works = propSites.filter(site => site.poiId === 'moonwatch');
  const find = (radius, name) => {
    const site = works.find(candidate => Math.abs(candidate.radius - radius) < .01);
    if (!site) throw new Error('Moonwatch is missing its original ' + name + ' site');
    return site;
  };
  return { telescope: find(1.4, 'telescope'), table: find(2.0, 'star table'), crate: find(1.1, 'chart crate'), lantern: find(.55, 'lantern') };
}
