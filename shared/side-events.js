export const SIDE_EVENT_WAVES = 3;
export const SIDE_EVENT_DURATION = 180;
export const SIDE_EVENT_COLOR = '#79f5ff';
// Attackers form ranks on the seaward side of the supplies, inside this arc
// around the bearing from the island's centre, starting `front` metres out.
export const SIDE_EVENT_ARC = Math.PI / 3;
export const SIDE_EVENT_RANK_SPACING = 3;

// Optional, once-per-voyage defenses; these never contribute compass shards.
export const SIDE_EVENTS = Object.freeze([
  { id: 'defense-market', placeId: 'tideglass-market', name: 'Defend Tideglass Market',
    description: 'Protect the market supplies from three waves of crabs surging in from the sea.', x: -29, z: 39, region: 'haven', front: 28 },
  { id: 'defense-farm', placeId: 'windward-farm', name: 'Save the Windward harvest',
    description: 'Protect the harvest from three waves of crabs surging in from the sea.', x: -42, z: -53, region: 'haven', front: 26 },
  { id: 'defense-yard', placeId: 'driftwood-yard', name: 'Protect Driftwood Yard',
    description: 'Protect the shipbuilding supplies from three waves of crabs surging out of the surf.', x: 30, z: 96, region: 'beach', front: 17 },
].map(event => Object.freeze({ ...event, reward: 45, radius: 9, interactionRange: 4 })));

export const seawardBearing = point => Math.atan2(point.z, point.x);

// Wave rosters grow with the crew that started the defense. The final wave
// brings one Tidebreaker mini boss for every two pirates.
export function sideEventWave(wave, playerCount) {
  if (!Number.isInteger(wave) || wave < 1 || wave > SIDE_EVENT_WAVES || !Number.isInteger(playerCount) || playerCount < 1) return null;
  const extra = playerCount - 1, pairs = Math.floor(extra / 2);
  if (wave === 1) return { crab: 5 + extra * 2, spitter: 0, tidebreaker: 0 };
  if (wave === 2) return { crab: 6 + extra * 2, spitter: 2 + pairs, tidebreaker: 0 };
  return { crab: 5 + extra * 2, spitter: 1 + pairs, tidebreaker: 1 + pairs };
}
