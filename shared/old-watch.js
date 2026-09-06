import { POINTS_OF_INTEREST } from './exploration.js';

// Authored pilot layout. Append these IDs after the original island obstacles;
// authority, shots and the camera consume the very same trunks and boulders.
export const OLD_WATCH = Object.freeze({ x: -66, z: -76, radius: 27 });
const farm = POINTS_OF_INTEREST.find(place => place.id === 'windward-farm');
export const OLD_WATCH_PROPS = [
  [-84, -73, .36, 8.8, 'pine_a', .5], [-84, -90, .40, 10, 'pine_b', 2.1],
  [-75, -97, .35, 8, 'pine_a', 1.4], [-63, -95, .40, 10.4, 'pine_b', .8],
  [-52, -87, .37, 8.6, 'pine_a', 2.8], [-48, -76, .40, 9.5, 'pine_b', 1.9],
  [-61, -60, .35, 8.2, 'pine_a', 3.5], [-75, -61, .39, 9.6, 'pine_b', .1],
  [-81, -79, 1.2, 1.25, 'rock_a', .8], [-77, -67, 1.45, 1.8, 'rock_b', 2],
  [-69, -63, 1.0, 1.1, 'rock_a', 2.8], [-58, -91, 1.5, 1.6, 'rock_b', .4],
  [-52, -81, 1.0, 1.1, 'rock_a', 1.8], [-50, -70, 1.3, 1.6, 'rock_b', 3.1],
  [-70, -95, 1.4, 1.6, 'rock_a', 2.3], [-86, -84, 1.1, 1.5, 'rock_b', .7],
].map(([x, z, radius, height, prefab, yaw], i) => Object.freeze({
  id: `old-watch-prop-${i + 1}`, x, z, radius, height, prefab, yaw,
  type: prefab.startsWith('pine') ? 'tree' : 'rock', pilot: 'old-watch',
}));

export function oldWatchWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  return oldWatchRadialWeight(x, z) * oldWatchFarmClearance(x, z);
}

export function oldWatchRadialWeight(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const t = Math.max(0, Math.min(1, (OLD_WATCH.radius - Math.hypot(x - OLD_WATCH.x, z - OLD_WATCH.z)) / 10));
  return t * t * (3 - 2 * t);
}

export function oldWatchFarmClearance(x, z) {
  const t = Math.max(0, Math.min(1, (Math.hypot(x - farm.x, z - farm.z) - farm.radius) / 4));
  return t * t * (3 - 2 * t);
}
