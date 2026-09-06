// Collection belongs to the viewing pirate, not the shared drop or loadout.
// Snapshots carry this history so reconnecting does not bring picked-up art back.
export function isLootVisible(drop, player) {
  if (typeof drop?.id !== 'string' || !drop.id) return false;
  return !Array.isArray(player?.collectedDropIds) || !player.collectedDropIds.includes(drop.id);
}
