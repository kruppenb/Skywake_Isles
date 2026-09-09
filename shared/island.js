import { OBSTACLES, regionAt } from './world.js';
import { cinderworksWeight } from './cinderworks.js';
import { moonwatchWeight } from './moonwatch.js';

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
