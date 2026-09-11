// Deck coordinates are in metres after the original ship geometry is scaled.
export const SHIP_SCALE = { x: 1.5, y: 1.15, z: 1.5 };
export const SHIP_DECK = { minX: -6, maxX: 6, minZ: -12, maxZ: 12 };
export const SHIP_GUNS = [
  { id: 'gun-port-fore', name: 'Port bow gun', x: -5, z: -9, yaw: Math.PI / 2 },
  { id: 'gun-starboard-fore', name: 'Starboard bow gun', x: 5, z: -9, yaw: -Math.PI / 2 },
  { id: 'gun-port-aft', name: 'Port stern gun', x: -5, z: 0, yaw: Math.PI / 2 },
  { id: 'gun-starboard-aft', name: 'Starboard stern gun', x: 5, z: 0, yaw: -Math.PI / 2 },
];
export const GUN_COOLDOWN = 0.65;
export const GUN_RANGE = 120;
export const GUN_DAMAGE = 40;
export const GUN_INTERACTION_RANGE = 2.4;
export const GUN_PIVOT_HEIGHT = 1.85;
export const GUN_MUZZLE_LENGTH = 2.6;
export const AIRSHIP_RETURNS = [
  { id: 'airship-return-beach', name: 'Sunwake airship lift', x: 8, z: 92 },
  { id: 'airship-return-haven', name: 'Lighthouse airship lift', x: 8, z: 12 },
];
export const RETURN_RANGE = 3.2;
// Two marked gates are the only way off the deck. `yaw` uses the gun heading
// convention, so the outward direction is (-sin yaw, 0, -cos yaw). `launch` is
// the ship-relative pose a departing pirate is placed at: authored to clear the
// rail, the rendered hull, the bowsprit and the lanterns, never supplied by a
// client. The stern centre is the cabin, so the pair is bow plus starboard rail
// rather than fore-and-aft symmetry, and both stay outside every gun's E range.
export const SHIP_JUMP_POINTS = [
  { id: 'jump-gate-bow', name: 'Bow launch gate', x: 0, z: -11, yaw: 0, launch: { x: 0, y: -0.8, z: -25.8 } },
  { id: 'jump-gate-starboard', name: 'Starboard rail gate', x: 5.2, z: 5, yaw: -Math.PI / 2, launch: { x: 10.2, y: -0.6, z: 5 } },
];
export const JUMP_INTERACTION_RANGE = 2.2;
// Painted approach lanes are guidance, never a trigger. They route the walk
// around the fore-mast, which stands on the centreline between the opening
// spawn and the bow gate, so the sign is never the only cue a new pirate has.
export const SHIP_JUMP_APPROACHES = {
  'jump-gate-bow': [
    [{ x: -1.5, z: -1.4 }, { x: -1.9, z: -5.4 }, { x: -1.2, z: -8.4 }, { x: -0.4, z: -9.4 }],
    [{ x: 1.5, z: -1.4 }, { x: 1.9, z: -5.4 }, { x: 1.2, z: -8.4 }, { x: 0.4, z: -9.4 }],
  ],
  'jump-gate-starboard': [
    [{ x: 1.6, z: 1.5 }, { x: 3, z: 3.2 }, { x: 3.7, z: 4.2 }],
  ],
};

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const segmentDistance = (from, to, point) => {
  const dx = to.x - from.x, dz = to.z - from.z;
  const t = clamp(((point.x - from.x) * dx + (point.z - from.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(from.x + dx * t - point.x, from.z + dz * t - point.z);
};

// Deck obstacles are passed in rather than imported: shared/world.js already
// builds SHIP_OBSTACLES from this module, and importing it back would close a
// module cycle around SHIP_SCALE.
export function deckRouteClear(from, to, obstacles = []) {
  if (![from?.x, from?.z, to?.x, to?.z].every(Number.isFinite)) return false;
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  for (const obstacle of obstacles) {
    if (obstacle.type === 'circle') {
      if (segmentDistance(from, to, obstacle) < obstacle.radius) return false;
      continue;
    }
    // A gate stands metres clear of the cabin, so sampling this short deck-local
    // route resolves any crossing without a separate slab-clipping helper.
    const steps = Math.max(1, Math.ceil(length / 0.25));
    for (let step = 0; step <= steps; step++) {
      const x = from.x + (to.x - from.x) * step / steps, z = from.z + (to.z - from.z) * step / steps;
      if (x > obstacle.minX && x < obstacle.maxX && z > obstacle.minZ && z < obstacle.maxZ) return false;
    }
  }
  return true;
}

// Eligibility is deck-local: no replicated in-zone flag, and an explicit target
// only narrows the same range and clear-route test.
export function jumpPointFor(deck, obstacles = [], target = null) {
  if (!Number.isFinite(deck?.x) || !Number.isFinite(deck?.z)) return null;
  return SHIP_JUMP_POINTS
    .filter(point => (!target || point.id === target)
      && Math.hypot(deck.x - point.x, deck.z - point.z) <= JUMP_INTERACTION_RANGE
      && deckRouteClear(deck, point, obstacles))
    .sort((a, b) => Math.hypot(deck.x - a.x, deck.z - a.z) - Math.hypot(deck.x - b.x, deck.z - b.z))[0] || null;
}

export function jumpLaunchPose(point, ship) {
  return { x: ship.x + point.launch.x, y: ship.y + point.launch.y, z: ship.z + point.launch.z };
}

export function gunAim(gun, yaw = gun.yaw, pitch = 0.1) {
  const relative = Number.isFinite(yaw) ? Math.atan2(Math.sin(yaw - gun.yaw), Math.cos(yaw - gun.yaw)) : 0;
  const traverse = clamp(relative, -1.25, 1.25);
  // The broadside can depress farther than an oblique shot along the deck.
  const minimumPitch = -0.55 * Math.cos(traverse);
  return { yaw: gun.yaw + traverse, pitch: clamp(Number.isFinite(pitch) ? pitch : 0.1, minimumPitch, 0.8) };
}

export function gunOperator(gun) {
  return { x: gun.x - Math.sign(gun.x) * 1.25, z: gun.z };
}

export function gunMuzzle(gun, ship, yaw, pitch) {
  const aim = gunAim(gun, yaw, pitch), horizontal = Math.cos(aim.pitch);
  const direction = { x: -Math.sin(aim.yaw) * horizontal, y: Math.sin(aim.pitch), z: -Math.cos(aim.yaw) * horizontal };
  return { from: { x: ship.x + gun.x + direction.x * GUN_MUZZLE_LENGTH, y: ship.y + GUN_PIVOT_HEIGHT + direction.y * GUN_MUZZLE_LENGTH, z: ship.z + gun.z + direction.z * GUN_MUZZLE_LENGTH }, direction };
}

// How far along a unit ray the first surface of a target sphere lies, or null
// when the ray misses it entirely or the whole sphere sits behind the muzzle.
// A shot is aimed by the gunner and tested here: this never steers toward a
// target, so a barrel pointed away simply returns null. Authority (nearest hit,
// range and line of sight) stays with the server; the client may share this
// same test for its reticle so both agree on what a shot would strike.
export function raySphereSurface(from, direction, target) {
  const radius = Number(target?.radius) || 0;
  if (radius <= 0 || ![from?.x, from?.y, from?.z, direction?.x, direction?.y, direction?.z,
    target?.x, target?.y, target?.z].every(Number.isFinite)) return null;
  const x = target.x - from.x, y = target.y - from.y, z = target.z - from.z;
  const along = x * direction.x + y * direction.y + z * direction.z;
  const discriminant = radius * radius - (x * x + y * y + z * z - along * along);
  if (discriminant < 0) return null;
  const root = Math.sqrt(discriminant), enter = along - root, leave = along + root;
  const surface = enter >= 0 ? enter : leave;
  return surface < 0 ? null : surface;
}
