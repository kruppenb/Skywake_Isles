import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, SHRINES, BEACON, heightAt } from './world.js';
import { ENCOUNTER_GROUPS } from './encounters.js';

export const CINDERWORKS = Object.freeze({ x: 77, z: -43, radius: 13 });
export const CINDER_FORGE = BUILDINGS.find(building => building.id === 'cinder-forge');
export const CINDERWORKS_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'cinderworks').points;
export const EMBERPEAK_SHRINE = SHRINES.find(shrine => shrine.id === 'ember');
const FORGE_GUARDS = ENCOUNTER_GROUPS.find(group => group.id === 'cinderworks');
const SULA = RESIDENTS.find(person => person.poiId === 'cinderworks');
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function cinderworksSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, index) => cinderworksSegmentDistance(x, z, route[index], point)));
}

// The forge yard plus a halo around the building itself, cut back well short of
// the ember shrine so its dais, the caldera crescent and the primary route
// junction keep the island's baseline lighting and stay unplanted.
export function cinderworksWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const yard = smooth((CINDERWORKS.radius + 9 - Math.hypot(x - CINDERWORKS.x, z - CINDERWORKS.z)) / 9);
  const around = smooth((12 - Math.hypot(x - CINDER_FORGE.x, z - CINDER_FORGE.z)) / 9);
  return Math.max(yard, around) * smooth((Math.hypot(x - EMBERPEAK_SHRINE.x, z - EMBERPEAK_SHRINE.z) - 14) / 9);
}

// The collidable rock inside the area keeps its shared radius and height; only
// its visuals are authored, so no obstacle or ID moves.
export const CINDERWORKS_ROCK_OBSTACLES = Object.freeze(OBSTACLES.filter(obstacle => obstacle.type === 'rock' && cinderworksWeight(obstacle.x, obstacle.z) > 0));

// The trail, Sula's loop and the walked approach to both forge doors.
export function cinderworksPaths() {
  const approaches = [1, -1].map(end =>
    [buildingWorldPoint(CINDER_FORGE, 0, end * (CINDER_FORGE.depth / 2 + 4)), buildingWorldPoint(CINDER_FORGE, 0, end * CINDER_FORGE.depth / 2)]);
  return [CINDERWORKS_TRAIL, [...SULA.route, SULA.route[0]], ...approaches];
}
export function cinderworksPathDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...cinderworksPaths().map(route => routeDistance(x, z, route)));
}

// Scorched ground cover and loose props stay cosmetic. Clear the trails, the
// primary shrine route, the shrine ring, the guarded approach, loot, the
// original work sites, every building and Sula's loop.
export function cinderworksPlantClearance(x, z, sites = [], padding = 0) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || cinderworksWeight(x, z) < .05 || heightAt(x, z) < 1.7) return false;
  if (trailDistance(x, z) < 2.8 + padding || cinderworksPathDistance(x, z) < 2.1 + padding) return false;
  if (cinderworksSegmentDistance(x, z, BEACON, EMBERPEAK_SHRINE) < 6 + padding) return false;
  if (Math.hypot(x - EMBERPEAK_SHRINE.x, z - EMBERPEAK_SHRINE.z) < 12 + padding) return false;
  if (Math.hypot(x - FORGE_GUARDS.x, z - FORGE_GUARDS.z) < 8 + padding) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .35 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .6 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (cinderworksSegmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}

// The original forge sites keep their authored positions and radii; all three
// differ, so the radius alone tells them apart.
export function cinderworksWorkSites(propSites = []) {
  const works = propSites.filter(site => site.poiId === 'cinderworks');
  const find = (radius, name) => {
    const site = works.find(candidate => Math.abs(candidate.radius - radius) < .01);
    if (!site) throw new Error('Cinderworks is missing its original ' + name + ' site');
    return site;
  };
  return { anvil: find(1.6, 'anvil'), ore: find(1.7, 'ore pile'), lantern: find(.55, 'lantern') };
}
