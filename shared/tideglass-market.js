import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, BEACON, SPAWN, SHRINES, heightAt } from './world.js';

export const TIDEGLASS_MARKET = Object.freeze({ x: -29, z: 39, radius: 24 });
export const TIDEGLASS_HAVEN = Object.freeze({ x: 0, z: 16, radius: 34 });
export const TIDEGLASS_HUTS = Object.freeze(OBSTACLES.filter(site => site.id === 'prop-16' || site.id === 'prop-17'));
const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };

export function tideglassSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, index) => tideglassSegmentDistance(x, z, route[index], point)));
}

export function tideglassWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const market = smooth((TIDEGLASS_MARKET.radius - Math.hypot(x - TIDEGLASS_MARKET.x, z - TIDEGLASS_MARKET.z)) / 8) * smooth((x + 53) / 8);
  const haven = smooth((TIDEGLASS_HAVEN.radius - Math.hypot(x, z - TIDEGLASS_HAVEN.z)) / 8) * smooth((x + 43) / 8);
  // Coast and jungle keep their own later material language beyond this square.
  return Math.max(market, haven) * smooth((63 - z) / 8);
}

export function tideglassPaths(hutSites = TIDEGLASS_HUTS) {
  const cottage = BUILDINGS.find(building => building.id === 'market-cottage');
  return [EXPLORATION_TRAILS.find(trail => trail.id === 'tideglass-market').points,
    [BEACON, { x: 0, z: 40 }],
    [TIDEGLASS_MARKET, buildingWorldPoint(cottage, 0, cottage.depth / 2)],
    [buildingWorldPoint(cottage, 0, -cottage.depth / 2 - 4), buildingWorldPoint(cottage, 0, -cottage.depth / 2)],
    ...hutSites.map(hut => {
      const front = { x: hut.x + Math.sin(hut.yaw ?? .25) * (hut.radius + 1), z: hut.z + Math.cos(hut.yaw ?? .25) * (hut.radius + 1) };
      return [{ x: 0, z: front.z + 2 }, { x: front.x, z: front.z + 2 }, front];
    })];
}
export function tideglassPathDistance(x, z, hutSites) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  return Math.min(...tideglassPaths(hutSites).map(route => routeDistance(x, z, route)));
}

// Small plants remain cosmetic. Clear the whole resident loop, existing work
// sites, both door approaches, objective ring and every primary shrine route.
export function tideglassPlantClearance(x, z, sites = [], padding = 0, hutSites) {
  if (!Number.isFinite(x) || !Number.isFinite(z) || tideglassWeight(x, z) < .03 || heightAt(x, z) < 1.7) return false;
  if (trailDistance(x, z) < 2.8 + padding || tideglassPathDistance(x, z, hutSites) < 2.1 + padding) return false;
  if ([SPAWN, ...SHRINES].some(point => tideglassSegmentDistance(x, z, BEACON, point) < 3.8 + padding)) return false;
  if ([BEACON, SPAWN, ...SHRINES].some(point => Math.hypot(x - point.x, z - point.z) < 11 + padding)) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .35 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .5 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let index = 0; index < person.route.length; index++) {
    if (tideglassSegmentDistance(x, z, person.route[index], person.route[(index + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}
