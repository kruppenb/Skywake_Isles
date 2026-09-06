import { weaponStats } from '../shared/weapons.js';

export const SCOPE_FOV = 18;
export const SCOPE_SENSITIVITY = .35;

// Reload timing belongs to the server. The render clock only interpolates the
// remaining time between snapshots; it never starts another reload timer.
export function weaponPresentation(state, player, {
  elapsed = state.elapsed, connected = false, controlsActive = false,
  menuOpen = false, aiming = false, pendingAction = null,
} = {}) {
  const active = !!player && connected && controlsActive && !menuOpen
    && ['voyage', 'finale'].includes(state.phase) && player.mode === 'ground'
    && player.online !== false && player.hp > 0 && !(player.knockedUntil > elapsed);
  const remaining = player && Number.isFinite(player.reloadUntil) ? Math.max(0, player.reloadUntil - elapsed) : 0;
  const reloading = active && remaining > 0 && pendingAction !== 'swap';
  const reloadProgress = reloading ? Math.max(0, Math.min(1, 1 - remaining / weaponStats(player.weapon, player.rarity).reload)) : 0;
  const scoped = active && aiming && player.weapon === 'longshot' && remaining === 0 && !pendingAction;
  return { active, scoped, reloading, reloadProgress, sensitivity: scoped ? SCOPE_SENSITIVITY : 1 };
}
