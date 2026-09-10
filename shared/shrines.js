import { heightAt } from './world.js';
import { hasWorldLineOfSight } from './collision.js';

export const SHRINE_RETURN_RANGE = 4;

// The prompt, model highlight and server action share the same landing/LOS gate.
export function canReturnAtShrine(state, player, shrine) {
  if (!player || !shrine || !['voyage', 'finale'].includes(state.phase) ||
    player.online === false || !(player.hp > 0) || player.knockedUntil ||
    player.mode !== 'ground' || !player.grounded ||
    state.shrines?.find(entry => entry.id === shrine.id)?.status !== 'cleared') return false;
  const ground = heightAt(shrine.x, shrine.z);
  return Math.hypot(player.x - shrine.x, player.y - ground, player.z - shrine.z) <= SHRINE_RETURN_RANGE &&
    hasWorldLineOfSight({ x: player.x, y: player.y + 1.25, z: player.z },
      { x: shrine.x, y: ground + .8, z: shrine.z });
}
