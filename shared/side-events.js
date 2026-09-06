export const SIDE_EVENT_WAVES = 2;
export const SIDE_EVENT_COLOR = '#79f5ff';

// Optional, once-per-voyage defenses; these never contribute compass shards.
export const SIDE_EVENTS = Object.freeze([
  { id: 'defense-market', placeId: 'tideglass-market', name: 'Defend Tideglass Market',
    description: 'Protect the market supplies from two waves of hungry crabs.', x: -29, z: 39, region: 'haven' },
  { id: 'defense-farm', placeId: 'windward-farm', name: 'Save the Windward harvest',
    description: 'Protect the harvest from two waves of hungry crabs.', x: -42, z: -53, region: 'haven' },
  { id: 'defense-yard', placeId: 'driftwood-yard', name: 'Protect Driftwood Yard',
    description: 'Protect the shipbuilding supplies from two waves of hungry crabs.', x: 30, z: 96, region: 'beach' },
].map(event => Object.freeze({ ...event, reward: 30, radius: 9, interactionRange: 4 })));
