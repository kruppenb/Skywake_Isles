// Local metres, relative to the level foundation at the house centre. The
// renderer and authority consume the same boxes and stair endpoints.
export const CAPTAINS_HOUSE = Object.freeze({
  id: 'captains-house', name: "Captain's House", x: -69, z: 65, yaw: 0,
  width: 20, depth: 18, radius: 15, height: 16.5,
  levels: [0, 4.6, 9.2], balcony: { x: 0, z: 10.8, width: 10, depth: 3.6, level: 4.6 },
});

const box = (id, kind, x, bottom, z, width, top, depth, level) => ({
  id, kind, x, y: (bottom + top) / 2, z, width, height: top - bottom, depth, level,
});

// Stair treads are visible geometry; the continuous slope between their top
// endpoints is the walking surface, so sprinting never catches on a riser.
export const CAPTAINS_HOUSE_STAIRS = Object.freeze([
  { id: 'ground-to-upper', x: 6, width: 3.2, zStart: 6, zEnd: -5.2, bottom: 0, top: 4.6, steps: 14 },
  { id: 'upper-to-attic', x: -6, width: 3.2, zStart: -5.2, zEnd: 6, bottom: 4.6, top: 9.2, steps: 14 },
]);

export const CAPTAINS_HOUSE_ROOF = Object.freeze({
  ridgeAxis: 'z', halfWidth: 10.35, halfDepth: 9.25,
  eave: 13.5, ridge: 16.2, thickness: .22,
});

export function captainsHouseRoofHeight(localX) {
  const roof = CAPTAINS_HOUSE_ROOF;
  return roof.eave + (roof.ridge - roof.eave) *
    Math.max(0, 1 - Math.abs(localX) / roof.halfWidth);
}

const solids = [];
const add = (...args) => solids.push(box(...args));
// A floor is cut around the full stair run, rather than a painted hatch.
add('upper-west', 'floor', -3, 4.35, 0, 14, 4.6, 18, 1);
add('upper-east-back', 'floor', 6.5, 4.35, -7.1, 7, 4.6, 3.8, 1);
add('upper-east-front', 'floor', 6.5, 4.35, 7.6, 7, 4.6, 2.8, 1);
add('attic-east', 'floor', 3, 8.95, 0, 14, 9.2, 18, 2);
add('attic-west-back', 'floor', -6.5, 8.95, -7.1, 7, 9.2, 3.8, 2);
add('attic-west-front', 'floor', -6.5, 8.95, 7.5, 7, 9.2, 3, 2);
add('balcony-deck', 'floor', 0, 4.35, 10.8, 10, 4.6, 3.6, 1);

// Three 4.6m storeys. Front (+Z) door opens into the living room; the upper
// front door reaches the seaward balcony. Windows have real vertical gaps.
for (let level = 0; level < 3; level++) {
  const base = level * 4.6, top = base + 4.4;
  for (const side of [-1, 1]) {
    const x = side * 9.82;
    add(`side-${level}-${side}-rear`, 'wall', x, base, -6.4, .36, top, 5.2, level);
    add(`side-${level}-${side}-front`, 'wall', x, base, 5.8, .36, top, 6.4, level);
    add(`side-${level}-${side}-sill`, 'wall', x, base, -.6, .36, base + 1.15, 6.4, level);
    add(`side-${level}-${side}-header`, 'wall', x, base + 2.9, -.6, .36, top, 6.4, level);
  }
  add(`rear-${level}-left`, 'wall', -6, base, -8.82, 8, top, .36, level);
  add(`rear-${level}-right`, 'wall', 6, base, -8.82, 8, top, .36, level);
  add(`rear-${level}-sill`, 'wall', 0, base, -8.82, 4, base + 1.15, .36, level);
  add(`rear-${level}-header`, 'wall', 0, base + 2.9, -8.82, 4, top, .36, level);
  const door = level === 2 ? 3.2 : 3.4;
  for (const side of [-1, 1]) {
    const span = (part, a, b, low = base, high = top) =>
      add(`front-${level}-${side}-${part}`, 'wall', side * (a + b) / 2, low, 8.82, b - a, high, .36, level);
    span('outer', 7.1, 10);
    span('inner', door / 2, 4.9);
    span('sill', 4.9, 7.1, base, base + 1.25);
    span('header', 4.9, 7.1, base + 3.15, top);
  }
  if (level !== 1) add(`front-${level}-lintel`, 'wall', 0, base + 3.3, 8.82, door, top, .36, level);
}

// Room divisions stop short of a generous central passage. Their two-sided
// doorways let the player visit every furnished space.
for (const level of [0, 1]) {
  const base = level * 4.6;
  add(`room-${level}-left`, 'wall', -8.35, base, -.4, 3.3, base + 3.8, .28, level);
  add(`room-${level}-right`, 'wall', 8.35, base, -.4, 3.3, base + 3.8, .28, level);
}
// Opening guards leave the approach and landing ends unblocked.
for (const [id, x, z, width, depth, level] of [
  ['upper-stair-left', 3.95, .4, .2, 8.3, 1],
  ['upper-stair-right', 8.05, .4, .2, 8.3, 1],
  ['attic-stair-left', -8.05, .4, .2, 8.3, 2],
  ['attic-stair-right', -3.95, .4, .2, 8.3, 2],
  ['balcony-front', 0, 12.5, 10, .2, 1],
  ['balcony-left', -4.9, 10.8, .2, 3.6, 1],
  ['balcony-right', 4.9, 10.8, .2, 3.6, 1],
  ['attic-front-guard', 0, 8.8, 3.2, .2, 2],
]) add(id, 'rail', x, level * 4.6, z, width, level * 4.6 + 1.15, depth, level);

for (const [id, x, z, width, depth, top, level] of [
  ['kitchen-counter', -7.4, -5.7, 3.8, 1.2, 1.1, 0],
  ['kitchen-table', -4, -3.6, 2.2, 1.5, .85, 0],
  ['living-table', -2.8, 4.1, 2.2, 1.2, .65, 0],
  ['living-settee', -7.5, 5.9, 3.5, 1.1, 1, 0],
  ['chart-table', 2.1, -5.6, 2.6, 1.5, .9, 1],
  ['chart-shelf', 8.7, -5.5, .85, 3, 2, 1],
  ['captain-bed', -7.1, 5.7, 3, 2, .7, 1],
  ['bedroom-chest', -8.5, -6, 1.4, 1.1, 1.1, 1],
  ['lookout-desk', 6.9, -5.7, 2.2, 1.1, .85, 2],
]) add(id, 'furniture', x, level * 4.6, z, width, level * 4.6 + top, depth, level);

for (const stair of CAPTAINS_HOUSE_STAIRS) {
  for (let i = 0; i < stair.steps; i++) {
    const a = i / stair.steps, b = (i + 1) / stair.steps;
    const z1 = stair.zStart + (stair.zEnd - stair.zStart) * a;
    const z2 = stair.zStart + (stair.zEnd - stair.zStart) * b;
    add(`${stair.id}-tread-${i + 1}`, 'stair', stair.x, stair.bottom,
      (z1 + z2) / 2, stair.width, stair.bottom + (stair.top - stair.bottom) * b,
      Math.abs(z2 - z1), stair.bottom / 4.6);
  }
}

export const CAPTAINS_HOUSE_SOLIDS = Object.freeze(solids);
