import { OBSTACLES, SHRINES, heightAt, regionAt } from './world.js';
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

// The three shrines the landmark slice dresses. buildScenery still reads its own
// SHRINES entries in place, so these anchors are an independent derivation of
// the very same points, never a second source of truth for the draw order.
const shrineAnchor = (id, fallback) => {
  const shrine = SHRINES.find(entry => entry.id === id) || fallback;
  return Object.freeze({ x: shrine.x, z: shrine.z });
};
export const ISLAND_SHRINE_ANCHORS = Object.freeze({
  palm: shrineAnchor('palm', { x: -68, z: 12 }),
  moon: shrineAnchor('moon', { x: 76, z: 32 }),
  ember: shrineAnchor('ember', { x: 48, z: -65 }),
});
// The four one-off landmarks stand on fixed offsets from their shrine, so their
// ground height is analytic. Everything else is placed inside buildScenery's own
// RNG loops and recorded there; nothing in this module recreates a draw.
export const ISLAND_LANDMARK_ANCHORS = Object.freeze({
  palmGate: Object.freeze({ x: ISLAND_SHRINE_ANCHORS.palm.x, z: ISLAND_SHRINE_ANCHORS.palm.z - 11,
    y: heightAt(ISLAND_SHRINE_ANCHORS.palm.x, ISLAND_SHRINE_ANCHORS.palm.z - 11) }),
  moonGate: Object.freeze({ x: ISLAND_SHRINE_ANCHORS.moon.x + 2, z: ISLAND_SHRINE_ANCHORS.moon.z - 13,
    y: heightAt(ISLAND_SHRINE_ANCHORS.moon.x + 2, ISLAND_SHRINE_ANCHORS.moon.z - 13) }),
  emberCore: Object.freeze({ x: ISLAND_SHRINE_ANCHORS.ember.x, z: ISLAND_SHRINE_ANCHORS.ember.z - 22,
    y: heightAt(ISLAND_SHRINE_ANCHORS.ember.x, ISLAND_SHRINE_ANCHORS.ember.z - 22) }),
});

// Authored envelopes for the eleven landmark roots: the widest horizontal reach
// and the local height band each root is exported inside, at unit scale. The
// ridge height is the only nominal the runtime divides by, so a crescent tower
// recorded at h metres installs at scale [1, h / 10, 1].
export const ISLAND_LANDMARK_NOMINALS = Object.freeze({
  palm_gate_pillar:      Object.freeze({ radius: 1.92, minY: -.45,  maxY: 6.12,  height: 6.12 }),
  palm_gate_lintel:      Object.freeze({ radius: 5.84, minY: -.55,  maxY: .55,   height: 1.10 }),
  moon_gate_ring:        Object.freeze({ radius: 4.32, minY: -4.29, maxY: 4.29,  height: 8.58 }),
  moon_gate_orb:         Object.freeze({ radius: .75,  minY: -.75,  maxY: .75,   height: 1.50 }),
  shrine_mushroom:       Object.freeze({ radius: 1.80, minY: -.25,  maxY: 3.40,  height: 3.40 }),
  shrine_moon_crystal:   Object.freeze({ radius: 1.00, minY: -.30,  maxY: 3.05,  height: 3.05 }),
  caldera_ridge_a:       Object.freeze({ radius: 4.70, minY: -2.60, maxY: 11.25, height: 10 }),
  caldera_ridge_b:       Object.freeze({ radius: 4.70, minY: -2.60, maxY: 11.25, height: 10 }),
  caldera_amber_crystal: Object.freeze({ radius: 1.00, minY: -.30,  maxY: 3.05,  height: 3.05 }),
  ember_core:            Object.freeze({ radius: 5.00, minY: -.20,  maxY: .80,   height: 1.00 }),
  ember_core_rock:       Object.freeze({ radius: 1.80, minY: -1.70, maxY: 1.70,  height: 3.40 }),
});
// The moon gate is a doorway: no authored triangle may reach inside this radius
// of the ring's local-XY origin, so the walk-through aperture stays open.
export const MOON_GATE_APERTURE_RADIUS = 3.48;
// Every original shrine draw the authored kit takes over, by kind. The runtime
// counts what it actually installed and the tests compare it against this card.
export const ISLAND_LANDMARK_COUNTS = Object.freeze({
  pillars: 2, lintels: 1, moonGates: 1, orbs: 1, mushrooms: 3, moonCrystals: 7,
  ridges: 18, amberCrystals: 6, cores: 1, coreRocks: 10,
});
export const ISLAND_LANDMARK_TOTAL = Object.values(ISLAND_LANDMARK_COUNTS).reduce((sum, count) => sum + count, 0);
