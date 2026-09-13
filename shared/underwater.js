// Sunken Reach is a separate, bounded 3D realm.  This module is deliberately
// renderer-free: the client builds its wreck from these same boxes while the
// server uses them for movement and sight checks.
export const DIVE_ENTRANCE = Object.freeze({ id: 'sunken-reach-dive', name: 'Sunken Reach', x: 14, z: 106, range: 4 });
export const REEF_SPAWN = Object.freeze({ x: -18, y: 6, z: 20 });
export const REEF_EXIT = Object.freeze({ id: 'sunken-reach-return', name: 'Return to shore', ...REEF_SPAWN, range: 4 });
export const REEF_CHEST = Object.freeze({ id: 'sunken-reach-chest', x: 8, y: 2, z: -15 });
export const REEF_BOUNDS = Object.freeze({ minX: -32, maxX: 32, minZ: -36, maxZ: 32, minY: 1, maxY: 18 });
// Player coordinates are at the avatar origin. The visible swimmer spans
// y-0.4 through y+2.8, so this five-sphere capsule protects the full model.
export const REEF_SWIMMER_BODY = Object.freeze({ radius: .6, centerOffsetY: 1.2, minOffsetY: -.4, maxOffsetY: 2.8 });

// The hull is a 24 by 18 wreck centred around (8, -10).  Its south face has
// a wide, low entrance, while the open top lets swimmers enter above the deck.
// Boxes are centred AABBs, all in reef-local world coordinates.
export const REEF_SOLIDS = Object.freeze([
  { id: 'wreck-deck', x: 8, y: .5, z: -10, width: 24, height: 1, depth: 18 },
  { id: 'wreck-west-wall', x: -4, y: 4, z: -10, width: 1, height: 6, depth: 18 },
  { id: 'wreck-east-wall', x: 20, y: 4, z: -10, width: 1, height: 6, depth: 18 },
  { id: 'wreck-north-wall', x: 8, y: 4, z: -19, width: 24, height: 6, depth: 1 },
  { id: 'wreck-south-port', x: -1.5, y: 4, z: -1, width: 5, height: 6, depth: 1 },
  { id: 'wreck-south-starboard', x: 17.5, y: 4, z: -1, width: 5, height: 6, depth: 1 },
  // Broken ribs remain suspended under the open roof, so routes exist over and
  // under them instead of treating the wreck as a flat, ground-only obstacle.
  { id: 'wreck-rib-a', x: 5, y: 6.2, z: -10, width: 2, height: .8, depth: 15 },
  { id: 'wreck-rib-b', x: 13, y: 6.2, z: -10, width: 2, height: .8, depth: 15 },
].map(Object.freeze));

const finitePoint = point => !!point && ['x', 'y', 'z'].every(axis => Number.isFinite(point[axis]));
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const boundsFor = (box, padding = 0) => ({
  minX: box.x - box.width / 2 - padding, maxX: box.x + box.width / 2 + padding,
  minY: box.y - box.height / 2 - padding, maxY: box.y + box.height / 2 + padding,
  minZ: box.z - box.depth / 2 - padding, maxZ: box.z + box.depth / 2 + padding,
});

export const reefFloorAt = () => 0;

// Resolve a swimmer's spherical body against every hull box. Repeating passes
// handles a corner without retaining an overlap from the preceding box.
export function resolveReefCollision(point, radius = .6) {
  if (!finitePoint(point)) return point;
  radius = Number.isFinite(radius) ? clamp(radius, 0, 4) : .6;
  point.x = clamp(point.x, REEF_BOUNDS.minX + radius, REEF_BOUNDS.maxX - radius);
  point.y = clamp(point.y, REEF_BOUNDS.minY + radius, REEF_BOUNDS.maxY - radius);
  point.z = clamp(point.z, REEF_BOUNDS.minZ + radius, REEF_BOUNDS.maxZ - radius);
  for (let pass = 0; pass < 3; pass++) for (const box of REEF_SOLIDS) {
    const b = boundsFor(box), nearX = clamp(point.x, b.minX, b.maxX), nearY = clamp(point.y, b.minY, b.maxY), nearZ = clamp(point.z, b.minZ, b.maxZ);
    let dx = point.x - nearX, dy = point.y - nearY, dz = point.z - nearZ, distance = Math.hypot(dx, dy, dz);
    if (distance >= radius) continue;
    if (distance > .000001) {
      point.x = nearX + dx / distance * radius; point.y = nearY + dy / distance * radius; point.z = nearZ + dz / distance * radius;
      continue;
    }
    const sides = [
      { distance: point.x - b.minX, axis: 'x', value: b.minX - radius }, { distance: b.maxX - point.x, axis: 'x', value: b.maxX + radius },
      { distance: point.y - b.minY, axis: 'y', value: b.minY - radius }, { distance: b.maxY - point.y, axis: 'y', value: b.maxY + radius },
      { distance: point.z - b.minZ, axis: 'z', value: b.minZ - radius }, { distance: b.maxZ - point.z, axis: 'z', value: b.maxZ + radius },
    ].sort((a, b) => a.distance - b.distance);
    point[sides[0].axis] = sides[0].value;
  }
  point.x = clamp(point.x, REEF_BOUNDS.minX + radius, REEF_BOUNDS.maxX - radius);
  point.y = clamp(point.y, REEF_BOUNDS.minY + radius, REEF_BOUNDS.maxY - radius);
  point.z = clamp(point.z, REEF_BOUNDS.minZ + radius, REEF_BOUNDS.maxZ - radius);
  return point;
}

// The guards remain spherical, but a pirate is a tall upright capsule. Sampling
// its centreline every .5m with overlapping .6m spheres is conservative for
// the 3.2m rendered envelope and avoids a head or tail crossing a wreck rib.
export function resolveReefSwimmerCollision(point) {
  if (!finitePoint(point)) return point;
  const { radius, minOffsetY, maxOffsetY } = REEF_SWIMMER_BODY;
  point.x = clamp(point.x, REEF_BOUNDS.minX + radius, REEF_BOUNDS.maxX - radius);
  point.y = clamp(point.y, REEF_BOUNDS.minY - minOffsetY, REEF_BOUNDS.maxY - maxOffsetY);
  point.z = clamp(point.z, REEF_BOUNDS.minZ + radius, REEF_BOUNDS.maxZ - radius);
  const samples = [.2, .7, 1.2, 1.7, 2.2];
  for (let pass = 0; pass < 4; pass++) for (const box of REEF_SOLIDS) for (const offset of samples) {
    const b = boundsFor(box), centerY = point.y + offset;
    const nearX = clamp(point.x, b.minX, b.maxX), nearY = clamp(centerY, b.minY, b.maxY), nearZ = clamp(point.z, b.minZ, b.maxZ);
    const dx = point.x - nearX, dy = centerY - nearY, dz = point.z - nearZ, distance = Math.hypot(dx, dy, dz);
    if (distance >= radius) continue;
    if (distance > .000001) {
      point.x = nearX + dx / distance * radius; point.y = nearY + dy / distance * radius - offset; point.z = nearZ + dz / distance * radius;
      continue;
    }
    const sides = [
      { distance: point.x - b.minX, axis: 'x', value: b.minX - radius }, { distance: b.maxX - point.x, axis: 'x', value: b.maxX + radius },
      { distance: centerY - b.minY, axis: 'y', value: b.minY - radius - offset }, { distance: b.maxY - centerY, axis: 'y', value: b.maxY + radius - offset },
      { distance: point.z - b.minZ, axis: 'z', value: b.minZ - radius }, { distance: b.maxZ - point.z, axis: 'z', value: b.maxZ + radius },
    ].sort((a, b) => a.distance - b.distance);
    point[sides[0].axis] = sides[0].value;
  }
  point.x = clamp(point.x, REEF_BOUNDS.minX + radius, REEF_BOUNDS.maxX - radius);
  point.y = clamp(point.y, REEF_BOUNDS.minY - minOffsetY, REEF_BOUNDS.maxY - maxOffsetY);
  point.z = clamp(point.z, REEF_BOUNDS.minZ + radius, REEF_BOUNDS.maxZ - radius);
  return point;
}

// Slab intersection against the expanded solid volumes. Keeping this here
// prevents island buildings from blocking a ray in the separate realm.
export function reefLineOfSight(from, to, padding = 0) {
  if (!finitePoint(from) || !finitePoint(to)) return false;
  padding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  for (const box of REEF_SOLIDS) {
    const b = boundsFor(box, padding); let enter = 0, exit = 1;
    for (const axis of ['x', 'y', 'z']) {
      const delta = to[axis] - from[axis], low = b[`min${axis.toUpperCase()}`], high = b[`max${axis.toUpperCase()}`];
      if (Math.abs(delta) < 1e-9) { if (from[axis] < low || from[axis] > high) { enter = 2; break; } continue; }
      let a = (low - from[axis]) / delta, c = (high - from[axis]) / delta;
      if (a > c) [a, c] = [c, a]; enter = Math.max(enter, a); exit = Math.min(exit, c);
      if (enter > exit) break;
    }
    if (enter <= exit && exit >= 0 && enter <= 1) return false;
  }
  return true;
}

export const realmOf = entity => entity?.realm === 'reef' ? 'reef' : 'island';
export const sameRealm = (a, b) => realmOf(a) === realmOf(b);
