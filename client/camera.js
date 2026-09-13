import { REEF_BOUNDS, reefLineOfSight } from '../shared/underwater.js';

// Transport the camera with the rendered pirate, then ease only look/zoom and
// obstacle offsets. Easing world-space travel makes a stopped pirate appear
// to slide backwards while the camera catches up.
export function cameraTravel(previous, player, { menu = false, round = 0 } = {}) {
  if (menu || !player || !['ground', 'gliding', 'swimming'].includes(player.mode)) return { anchor: null, delta: null, reset: !!previous };
  const anchor = { id: player.id, mode: player.mode, realm: player.realm || 'island', round, x: player.x, y: player.y, z: player.z };
  const compatible = previous && previous.id === anchor.id && previous.mode === anchor.mode && previous.realm === anchor.realm && previous.round === round;
  const delta = compatible ? { x: anchor.x - previous.x, y: anchor.y - previous.y, z: anchor.z - previous.z } : null;
  if (!delta || Math.hypot(delta.x, delta.y, delta.z) > 5) return { anchor, delta: null, reset: true };
  return { anchor, delta, reset: false };
}

// The airship as a padded box, for camera clearance only. It is never consulted
// by movement, shots, the ship pose or the gate launch offsets: leaving through a
// gate puts a pirate a few metres off the hull, and a chase camera placed a full
// glide distance behind them can land back inside the deck they just left,
// looking out through the jump sign. Padding covers the rail, the gate signs and
// the rendered bow, and the vertical window releases the camera as they fall away.
export const SHIP_CAMERA_BOX = Object.freeze({ x: 8.4, minZ: -24.5, maxZ: 19.5, minY: -6, maxY: 4 });

const inside = (point, ship, box) => point.x > ship.x - box.x && point.x < ship.x + box.x &&
  point.z > ship.z + box.minZ && point.z < ship.z + box.maxZ &&
  point.y > ship.y + box.minY && point.y < ship.y + box.maxY;

// Pull the view in before the first ship intersection. Checking only the camera
// endpoint misses views that pass through a corner or emerge above the deck.
export function shipClearFraction(anchor, camera, ship, box = SHIP_CAMERA_BOX) {
  if (![anchor?.x, anchor?.y, anchor?.z, camera?.x, camera?.y, camera?.z, ship?.x, ship?.y, ship?.z].every(Number.isFinite)) return 1;
  if (inside(anchor, ship, box)) return 0;
  let enter = 0, leave = 1;
  for (const [axis, min, max] of [['x', ship.x - box.x, ship.x + box.x],
    ['y', ship.y + box.minY, ship.y + box.maxY], ['z', ship.z + box.minZ, ship.z + box.maxZ]]) {
    const delta = camera[axis] - anchor[axis];
    if (Math.abs(delta) < 1e-9) {
      if (anchor[axis] <= min || anchor[axis] >= max) return 1;
      continue;
    }
    const a = (min - anchor[axis]) / delta, b = (max - anchor[axis]) / delta;
    enter = Math.max(enter, Math.min(a, b));
    leave = Math.min(leave, Math.max(a, b));
    if (enter >= leave) return 1;
  }
  return enter < 1 && leave > 0 ? Math.max(0, enter - 1e-4) : 1;
}

// The reef uses its own canonical solids and 3D floor/ceiling.  Pull a chase
// camera in before it crosses a hull wall; keeping this analytic and renderer
// free makes the same clear arm easy to verify without a WebGL scene.
export function reefCameraFraction(anchor, camera, padding = .18) {
  if (![anchor?.x, anchor?.y, anchor?.z, camera?.x, camera?.y, camera?.z].every(Number.isFinite)) return 1;
  let ceiling = 1;
  for (const [axis, low, high] of [['x', REEF_BOUNDS.minX + padding, REEF_BOUNDS.maxX - padding], ['y', REEF_BOUNDS.minY + padding, REEF_BOUNDS.maxY - padding], ['z', REEF_BOUNDS.minZ + padding, REEF_BOUNDS.maxZ - padding]]) {
    const delta = camera[axis] - anchor[axis];
    if (delta > 0 && camera[axis] > high) ceiling = Math.min(ceiling, (high - anchor[axis]) / delta);
    if (delta < 0 && camera[axis] < low) ceiling = Math.min(ceiling, (low - anchor[axis]) / delta);
  }
  ceiling = Math.max(0, Math.min(1, ceiling));
  const clipped = axis => anchor[axis] + (camera[axis] - anchor[axis]) * ceiling;
  if (reefLineOfSight(anchor, { x: clipped('x'), y: clipped('y'), z: clipped('z') }, padding)) return ceiling;
  let safe = 0, blocked = ceiling;
  for (let pass = 0; pass < 9; pass++) {
    const middle = (safe + blocked) / 2;
    const probe = { x: anchor.x + (camera.x - anchor.x) * middle, y: anchor.y + (camera.y - anchor.y) * middle, z: anchor.z + (camera.z - anchor.z) * middle };
    if (reefLineOfSight(anchor, probe, padding)) safe = middle; else blocked = middle;
  }
  return Math.max(0, safe - .015);
}

// No shoulder offset or trailing camera inside the optic: its center ray is
// the player's view direction. Shooting still performs muzzle correction.
export function scopeCameraPose(player, yaw, pitch) {
  return {
    origin: { x: player.x, y: player.y + 1.65, z: player.z },
    direction: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
  };
}
