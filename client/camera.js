// Transport the camera with the rendered pirate, then ease only look/zoom and
// obstacle offsets. Easing world-space travel makes a stopped pirate appear
// to slide backwards while the camera catches up.
export function cameraTravel(previous, player, { menu = false, round = 0 } = {}) {
  if (menu || !player || !['ground', 'gliding'].includes(player.mode)) return { anchor: null, delta: null, reset: !!previous };
  const anchor = { id: player.id, mode: player.mode, round, x: player.x, y: player.y, z: player.z };
  const compatible = previous && previous.id === anchor.id && previous.mode === anchor.mode && previous.round === round;
  const delta = compatible ? { x: anchor.x - previous.x, y: anchor.y - previous.y, z: anchor.z - previous.z } : null;
  if (!delta || Math.hypot(delta.x, delta.y, delta.z) > 5) return { anchor, delta: null, reset: true };
  return { anchor, delta, reset: false };
}

// No shoulder offset or trailing camera inside the optic: its center ray is
// the player's view direction. Shooting still performs muzzle correction.
export function scopeCameraPose(player, yaw, pitch) {
  return {
    origin: { x: player.x, y: player.y + 1.65, z: player.z },
    direction: { x: -Math.sin(yaw) * Math.cos(pitch), y: Math.sin(pitch), z: -Math.cos(yaw) * Math.cos(pitch) },
  };
}
