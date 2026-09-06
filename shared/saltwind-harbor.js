import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, heightAt } from './world.js';

export const SALTWIND_HARBOR = Object.freeze({ x: -22, z: 97, radius: 20 });
export const SALTWIND_BUILDING_IDS = Object.freeze(['net-house', 'saltwind-tavern', 'fishers-cottage']);
export const SALTWIND_BUILDINGS = Object.freeze(SALTWIND_BUILDING_IDS.map(id => BUILDINGS.find(building => building.id === id)));
export const SALTWIND_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'saltwind-harbor').points;
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function saltwindSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, index) => saltwindSegmentDistance(x, z, route[index], point)));
}

// The harbor square plus a halo around each of its three buildings. The landing
// beach east of the harbor and the water keep the island's baseline look; Sunwake
// Strand is a later milestone with its own identity.
export function saltwindHarborWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  let weight = smooth((SALTWIND_HARBOR.radius - Math.hypot(x - SALTWIND_HARBOR.x, z - SALTWIND_HARBOR.z)) / 8);
  for (const building of SALTWIND_BUILDINGS) weight = Math.max(weight, smooth((12 - Math.hypot(x - building.x, z - building.z)) / 6));
  return weight * smooth((-4 - x) / 5) * smooth((z - 70) / 8) * smooth((122 - z) / 6);
}

export function saltwindHarborPaths() {
  const approaches = SALTWIND_BUILDINGS.flatMap(building => [1, -1].map(end =>
    [buildingWorldPoint(building, 0, end * (building.depth / 2 + 4)), buildingWorldPoint(building, 0, end * building.depth / 2)]));
  return [SALTWIND_TRAIL, ...approaches];
}
export function saltwindHarborPathDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...saltwindHarborPaths().map(route => routeDistance(x, z, route)));
}

// Small plants and loose props remain cosmetic. Clear both fisher loops, all six
// door approaches, existing work sites, loot and every primary shrine route.
export function saltwindPlantClearance(x, z, sites = [], padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || saltwindHarborWeight(x, z) < .05 || heightAt(x, z) < 1.7) return false;
  if (trailDistance(x, z) < 2.8 + padding || saltwindHarborPathDistance(x, z) < 2.1 + padding) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .35 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .5 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (saltwindSegmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}

// The original work sites are identified by their authored radii, the same way
// the farm finds its crop field; positions stay authoritative in the settlement.
export function saltwindWorkSites(propSites = []) {
  const harbor = propSites.filter(site => site.poiId === 'saltwind-harbor');
  const find = (radius, name) => {
    const site = harbor.find(candidate => Math.abs(candidate.radius - radius) < .01);
    if (!site) throw new Error('Saltwind Harbor is missing its original ' + name + ' site');
    return site;
  };
  return { mending: find(1.9, 'mending table'), crates: find(1.3, 'barrel'), net: find(1.7, 'net frame'), lantern: find(.55, 'lantern') };
}
