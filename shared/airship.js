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

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
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
