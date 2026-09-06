import { BUILDINGS, RESIDENTS, EXPLORATION_TRAILS, buildingLocalPoint, buildingWorldPoint, trailDistance } from './exploration.js';
import { CHESTS, OBSTACLES, heightAt } from './world.js';

export const WINDWARD_FARM = Object.freeze({ x: -42, z: -53, radius: 24 });
// Keep the route itself authoritative: changes to the map move the dressing too.
export const WINDWARD_FARM_TRAIL = EXPLORATION_TRAILS.find(trail => trail.id === 'old-watch').points;
export const WINDWARD_FARM_APPROACH = EXPLORATION_TRAILS.find(trail => trail.id === 'windward-farm').points.slice(-2);
export const WINDWARD_FARM_FENCE_CANDIDATES = Object.freeze(Array.from({ length: 7 }, (_, i) => Object.freeze({ x: WINDWARD_FARM.x - 7 + i * 2.3, z: WINDWARD_FARM.z + 9.7, radius: 1.2 })));

const smooth = value => { const t = Math.max(0, Math.min(1, value)); return t * t * (3 - 2 * t); };
export function farmSegmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function routeDistance(x, z, route) {
  return Math.min(...route.slice(1).map((point, i) => farmSegmentDistance(x, z, route[i], point)));
}
export function windwardFarmAreaWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  return smooth((WINDWARD_FARM.radius - Math.hypot(x - WINDWARD_FARM.x, z - WINDWARD_FARM.z)) / 8);
}
export function windwardFarmTrailWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  // The last nine metres are already the approved Old Watch courtyard.
  const watch = WINDWARD_FARM_TRAIL.at(-1), watchClearance = smooth((Math.hypot(x - watch.x, z - watch.z) - 9) / 9);
  return smooth((7 - routeDistance(x, z, WINDWARD_FARM_TRAIL)) / 4) * watchClearance;
}
export function windwardFarmWeight(x, z) {
  return Math.max(windwardFarmAreaWeight(x, z), windwardFarmTrailWeight(x, z));
}
export function windwardFarmPaths() {
  const barn = BUILDINGS.find(building => building.id === 'harvest-barn');
  return [WINDWARD_FARM_TRAIL, WINDWARD_FARM_APPROACH,
    [WINDWARD_FARM, buildingWorldPoint(barn, 0, barn.depth / 2 + 1)],
    [buildingWorldPoint(barn, 0, -barn.depth / 2 - 3), buildingWorldPoint(barn, 0, -barn.depth / 2)]];
}
export function windwardFarmPathDistance(x, z) {
  return Math.min(...windwardFarmPaths().map(route => routeDistance(x, z, route)));
}

// Cosmetic planting never creates a second collision surface. Clearance includes
// the complete worker loop and both barn approaches, not only their endpoints.
export function farmPlantClearance(x, z, sites = [], padding = 0) {
  if (heightAt(x, z) < 1.7 || trailDistance(x, z) < 2.8 + padding || windwardFarmPathDistance(x, z) < 2.0 + padding) return false;
  if (CHESTS.some(point => Math.hypot(x - point.x, z - point.z) < 2.4 + padding)) return false;
  if (sites.some(point => Math.hypot(x - point.x, z - point.z) < point.radius + .25 + padding)) return false;
  for (const building of BUILDINGS) {
    if (!building.enterable) { if (Math.hypot(x - building.x, z - building.z) < building.radius + .5 + padding) return false; continue; }
    const local = buildingLocalPoint(building, x, z);
    if (Math.abs(local.x) < building.width / 2 + .7 + padding && Math.abs(local.z) < building.depth / 2 + .7 + padding) return false;
    if (Math.abs(local.x) < building.doorWidth / 2 + .85 + padding && Math.abs(local.z) < building.depth / 2 + 4 + padding) return false;
  }
  for (const person of RESIDENTS) for (let i = 0; i < person.route.length; i++) {
    if (farmSegmentDistance(x, z, person.route[i], person.route[(i + 1) % person.route.length]) < 1.25 + padding) return false;
  }
  return !OBSTACLES.some(point => point.type !== 'building' && Math.hypot(x - point.x, z - point.z) < point.radius + .3 + padding);
}

export function windwardFarmFields(propSites = []) {
  const original = propSites.find(site => site.poiId === 'windward-farm' && site.radius === 4);
  if (!original) throw new Error('Windward Farm is missing its original crop site');
  return [
    { id: 'original-field', x: original.x, z: original.z, rows: 5, columns: 13, rowSpacing: 1.05, spacing: .46, crop: 'crop_wheat' },
    { id: 'kitchen-field', x: original.x + 4.8, z: original.z + 2.8, rows: 3, columns: 8, rowSpacing: .9, spacing: .65, crop: 'crop_leafy' },
    { id: 'upper-field', x: original.x + 3.3, z: original.z - 6.8, rows: 4, columns: 11, rowSpacing: 1.0, spacing: .48, crop: 'crop_wheat' },
  ];
}

export function windwardFarmCrops(propSites = []) {
  const reserved = propSites.filter(site => !(site.poiId === 'windward-farm' && site.radius === 4));
  return windwardFarmFields(propSites).flatMap(field => {
    const points = [];
    for (let row = 0; row < field.rows; row++) for (let column = 0; column < field.columns; column++) {
      const x = field.x + (row - (field.rows - 1) / 2) * field.rowSpacing;
      const z = field.z + (column - (field.columns - 1) / 2) * field.spacing;
      if (farmPlantClearance(x, z, reserved, .15)) points.push({ id: `${field.id}-${row}-${column}`, field: field.id, crop: field.crop, row, column, x, z, yaw: Math.sin(row * 19 + column * 7) * .18, scale: .91 + .12 * (.5 + .5 * Math.sin(row * 7 + column * 19)) });
    }
    return points;
  });
}

export function windwardFarmFences(propSites = [], original = []) {
  const reserved = propSites.filter(site => !(site.poiId === 'windward-farm' && site.radius === 4));
  const field = windwardFarmFields(propSites)[0];
  const edge = [[7.2, 2, Math.PI / 2], [7.2, -.3, Math.PI / 2], [7.2, -2.6, Math.PI / 2],
    [6.5, -5.5, Math.PI / 2], [6.5, -7.8, Math.PI / 2], [2.3, -10.4, 0], [4.6, -10.4, 0]];
  const additions = edge.map(([dx, dz, yaw], index) => ({ id: 'farm-field-fence-' + index, x: field.x + dx, z: field.z + dz, yaw }));
  return [...original.map((site, index) => ({ ...site, id: 'farm-original-fence-' + index, yaw: 0 })),
    ...additions.filter(site => [-1, 0, 1].every(end => farmPlantClearance(site.x + Math.cos(site.yaw) * end, site.z - Math.sin(site.yaw) * end, reserved, .2)))];
}
