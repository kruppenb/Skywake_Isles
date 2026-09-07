import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, SHRINES, BEACON, heightAt } from './world.js';
import { ENCOUNTER_GROUPS } from './encounters.js';

export const PALMHEART_CAMP = Object.freeze({ x: -90, z: 6, radius: 13 });
export const PALMHEART_TENT = BUILDINGS.find(building => building.id === 'trailkeepers-tent');
export const PALMHEART_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'palmheart-camp').points;
export const PALMHEART_SHRINE = SHRINES.find(shrine => shrine.id === 'palm');
const CAMP_GUARDS = ENCOUNTER_GROUPS.find(group => group.id === 'palmheart-camp');
const BRAM = RESIDENTS.find(person => person.poiId === 'palmheart-camp');
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function palmheartSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, index) => palmheartSegmentDistance(x, z, route[index], point)));
}

// The clearing plus the trail corridor that feeds it, cut back around the
// shrine so its dais, its active ring and the primary route junction keep the
// island's baseline lighting and stay unplanted.
export function palmheartWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const clearing = smooth((PALMHEART_CAMP.radius + 9 - Math.hypot(x - PALMHEART_CAMP.x, z - PALMHEART_CAMP.z)) / 9);
  const corridor = smooth((11 - routeDistance(x, z, PALMHEART_TRAIL)) / 6);
  return Math.max(clearing, corridor) * smooth((Math.hypot(x - PALMHEART_SHRINE.x, z - PALMHEART_SHRINE.z) - 11) / 6);
}

// The collidable jungle canopy inside the area keeps its shared radius and
// height; only its visuals are authored, so no obstacle or ID moves.
export const PALMHEART_CANOPY_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => obstacle.type === 'tree' && palmheartWeight(obstacle.x, obstacle.z) > 0));

// The trail, Bram's loop and the walked approach to the tent door.
export function palmheartCampPaths() {
  const front = [buildingWorldPoint(PALMHEART_TENT, 0, PALMHEART_TENT.radius + 3.5), buildingWorldPoint(PALMHEART_TENT, 0, PALMHEART_TENT.radius * .6)];
  return [PALMHEART_TRAIL, [...BRAM.route, BRAM.route[0]], front];
}
export function palmheartPathDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...palmheartCampPaths().map(route => routeDistance(x, z, route)));
}

// Plants and loose props stay cosmetic. Clear the trails, the primary shrine
// route, the shrine ring, the guarded approach, loot, the original work sites,
// every building and Bram's loop.
export function palmheartPlantClearance(x, z, sites = [], padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || palmheartWeight(x, z) < .05 || heightAt(x, z) < 1.7) return false;
  if (trailDistance(x, z) < 2.8 + padding) return false;
  if (palmheartSegmentDistance(x, z, BEACON, PALMHEART_SHRINE) < 6 + padding) return false;
  if (Math.hypot(x - PALMHEART_SHRINE.x, z - PALMHEART_SHRINE.z) < 12 + padding) return false;
  if (Math.hypot(x - CAMP_GUARDS.x, z - CAMP_GUARDS.z) < 8 + padding) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .35 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .6 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (palmheartSegmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}

// The original camp sites keep their authored positions and radii; the two
// equal-radius sites are told apart by the anchor the settlement searched from.
export function palmheartWorkSites(propSites = []) {
  const camp = propSites.filter(site => site.poiId === 'palmheart-camp');
  const anchor = { x: PALMHEART_CAMP.x - 6, z: PALMHEART_CAMP.z - 3 };
  const ring = camp.filter(site => Math.abs(site.radius - 1.7) < .01)
    .sort((a, b) => Math.hypot(a.x - anchor.x, a.z - anchor.z) - Math.hypot(b.x - anchor.x, b.z - anchor.z));
  const sites = { fire: ring[0], gear: ring[1], lantern: camp.find(site => Math.abs(site.radius - .55) < .01) };
  for (const [name, site] of Object.entries(sites)) if (!site) throw new Error('Palmheart Camp is missing its original ' + name + ' site');
  return sites;
}
