import { MAX_PLAYERS, BEACON, CHESTS, SHRINES, SPAWN, OBSTACLES, heightAt } from './world.js';
import { resolveWorldCollision } from './collision.js';

export const SAFE_LANDING_RADIUS = 20;
// Three finite guards per destination, plus one melee crab per extra pirate.
export const ENCOUNTER_GROUPS = Object.freeze([
  { id: 'saltwind-harbor', zone: 'beach', x: -27, z: 73 },
  { id: 'tideglass-market', zone: 'haven', x: -24, z: 28 },
  { id: 'windward-farm', zone: 'haven', x: -43, z: -43 },
  { id: 'old-watch', zone: 'haven', x: -60, z: -73 },
  { id: 'palmheart-camp', zone: 'jungle', x: -88, z: 12 },
  { id: 'cinderworks', zone: 'volcano', x: 80, z: -55 },
  { id: 'moonwatch', zone: 'moon', x: 97, z: 31 },
  { id: 'driftwood-yard', zone: 'beach', x: 36, z: 76 },
].map(group => Object.freeze(group)));

export function inSafeLanding(point) {
  return Math.hypot(point.x - SPAWN.x, point.z - SPAWN.z) < SAFE_LANDING_RADIUS;
}

export function encounterSpawns(playerCount = 1) {
  const crewCount = Number.isFinite(playerCount) ? Math.max(1, Math.min(MAX_PLAYERS, Math.floor(playerCount))) : 1;
  const result = [];
  for (let groupIndex = 0; groupIndex < ENCOUNTER_GROUPS.length; groupIndex++) {
    const group = ENCOUNTER_GROUPS[groupIndex];
    const count = 3 + crewCount - 1;
    for (let i = 0; i < count; i++) {
      const angle = i / count * Math.PI * 2 + groupIndex * 0.47;
      let point;
      // Deterministic clearance keeps guards off chests, shrine pads and walls.
      for (let attempt = 0; attempt < 32; attempt++) {
        const a = angle + attempt * 0.73, radius = 4 + Math.floor(attempt / 8) * 2;
        point = { x: group.x + Math.cos(a) * radius, z: group.z + Math.sin(a) * radius };
        point.y = heightAt(point.x, point.z);
        resolveWorldCollision(point, 0.8);
        point.y = heightAt(point.x, point.z);
        if (inSafeLanding(point) || point.y < 1) continue;
        if ([BEACON, ...CHESTS, ...SHRINES].some(item => Math.hypot(item.x - point.x, item.z - point.z) < 3.6)) continue;
        if (OBSTACLES.some(item => Math.hypot(item.x - point.x, item.z - point.z) < item.radius + 1.8)) continue;
        if (result.some(item => Math.hypot(item.x - point.x, item.z - point.z) < 2.8)) continue;
        break;
      }
      result.push({ ...point, type: i === count - 1 ? 'spitter' : 'crab', zone: group.zone, group: group.id });
    }
  }
  return result;
}
