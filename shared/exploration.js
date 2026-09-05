// Shared island places and solid footprints. Keep this data independent of world.js
// so terrain, authority, scenery and the map can all consume the same layout.
export const POINTS_OF_INTEREST = [
  { id: 'saltwind-harbor', name: 'Saltwind Harbor', x: -15, z: 96, radius: 17, kind: 'harbor', color: '#e8ba72', description: 'Fishers mend their nets beneath the tavern chimney; a salt-stained chest waits beside the landing.' },
  { id: 'tideglass-market', name: 'Tideglass Market', x: -29, z: 39, radius: 16, kind: 'market', color: '#e6b088', description: 'Canvas stalls shelter the island’s harvest, and the merchants keep an old sea chest behind the square.' },
  { id: 'windward-farm', name: 'Windward Farm', x: -42, z: -53, radius: 16, kind: 'farm', color: '#b6cd76', description: 'A creaking windmill watches over the crop rows, where a farmhand has tucked away a weathered chest.' },
  { id: 'old-watch', name: 'The Old Watch', x: -66, z: -76, radius: 14, kind: 'ruins', color: '#b9bda6', description: 'A lone lookout still tends the ruined signal tower; treasure rests along its broken western wall.' },
  { id: 'palmheart-camp', name: 'Palmheart Camp', x: -90, z: 6, radius: 13, kind: 'camp', color: '#a4ca87', description: 'Trail keepers dry their gear in this palm-shaded clearing, with a forgotten chest near the tent.' },
  { id: 'cinderworks', name: 'The Cinderworks', x: 77, z: -43, radius: 13, kind: 'forge', color: '#e8a16e', description: 'The island smith shapes salvaged iron under an amber chimney, beside a chest dusted with caldera ash.' },
  { id: 'moonwatch', name: 'Moonwatch Observatory', x: 96, z: 42, radius: 14, kind: 'observatory', color: '#b7c6eb', description: 'A patient scholar charts the night sky above the glowing grove; an expedition chest rests below the dome.' },
  { id: 'driftwood-yard', name: 'Driftwood Yard', x: 30, z: 96, radius: 16, kind: 'boatyard', color: '#d9bd8c', description: 'Shipwrights fit fresh ribs into a rescued hull, with a tide-worn chest among the timber stacks.' },
];

const structure = (id, poiId, kind, x, z, radius, height, color, roofColor) => {
  const place = POINTS_OF_INTEREST.find(p => p.id === poiId);
  return { id, poiId, kind, x, z, radius, height,
    yaw: Math.atan2(place.x - x, place.z - z), color, roofColor };
};

// Radius encloses the solid body; heights include the roof and chimney/sails.
// Closed doors face the shared gathering space (local +Z after yaw).
export const BUILDINGS = [
  structure('saltwind-tavern', 'saltwind-harbor', 'tavern', -22, 88, 4, 7, '#e4ce9b', '#c86f59'),
  structure('net-house', 'saltwind-harbor', 'warehouse', -14, 109, 3.6, 6, '#94633f', '#399d9a'),
  structure('fishers-cottage', 'saltwind-harbor', 'cottage', -34, 98, 3, 5.5, '#dbcb9e', '#c86f59'),
  structure('fruit-stall', 'tideglass-market', 'stall', -37, 30, 2.5, 4, '#94633f', '#c86f59'),
  structure('sailcloth-stall', 'tideglass-market', 'stall', -24, 46, 2.4, 4, '#94633f', '#399d9a'),
  structure('market-cottage', 'tideglass-market', 'cottage', -41, 41, 3.2, 5.5, '#e6d4aa', '#399d9a'),
  structure('windward-mill', 'windward-farm', 'windmill', -39, -60, 3.4, 12, '#e4d6ad', '#c86f59'),
  structure('harvest-barn', 'windward-farm', 'barn', -53, -51, 3.5, 6, '#a87048', '#c86f59'),
  structure('signal-tower', 'old-watch', 'watchtower', -69, -84, 3.2, 10, '#a6a69a', '#697a73'),
  structure('trailkeepers-tent', 'palmheart-camp', 'tent', -92, -1, 3, 4.3, '#b6b88c', '#f5dca0'),
  structure('cinder-forge', 'cinderworks', 'forge', 83, -36, 3.4, 7, '#956c58', '#694f51'),
  structure('moonwatch-dome', 'moonwatch', 'observatory', 104, 46, 3.8, 9, '#d4cadc', '#729ea7'),
  structure('timber-shed', 'driftwood-yard', 'warehouse', 36, 102, 3.3, 6, '#94633f', '#399d9a'),
  structure('shipwrights-cottage', 'driftwood-yard', 'cottage', 33, 85, 3, 5.5, '#dccaa4', '#c86f59'),
];

// Trail IDs match their destinations. First points sit on an original main
// route, except Old Watch, which continues from the farm's connected trail.
export const EXPLORATION_TRAILS = [
  { id: 'saltwind-harbor', points: [{ x: 0, z: 94 }, { x: -7, z: 92 }, { x: -15, z: 96 }] },
  { id: 'tideglass-market', points: [{ x: 0, z: 40 }, { x: -15, z: 37 }, { x: -29, z: 39 }] },
  { id: 'windward-farm', points: [{ x: 0, z: 4 }, { x: -10, z: -3 }, { x: -32, z: -12 }, { x: -38, z: -34 }, { x: -42, z: -53 }] },
  { id: 'old-watch', points: [{ x: -42, z: -53 }, { x: -55, z: -64 }, { x: -66, z: -76 }] },
  { id: 'palmheart-camp', points: [{ x: -68, z: 12 }, { x: -80, z: 14 }, { x: -90, z: 6 }] },
  { id: 'cinderworks', points: [{ x: 36, z: -47.75 }, { x: 51, z: -43 }, { x: 62, z: -45 }, { x: 72, z: -48 }, { x: 77, z: -43 }] },
  { id: 'moonwatch', points: [{ x: 76, z: 32 }, { x: 89, z: 36 }, { x: 96, z: 42 }] },
  // The original dock palm at (27,93) borders the square; enter from the south.
  { id: 'driftwood-yard', points: [{ x: 0, z: 94 }, { x: 12, z: 107 }, { x: 24, z: 106 }, { x: 30, z: 99 }] },
];

export const RESIDENTS = [
  { id: 'mara', name: 'Mara', role: 'fisher', color: '#399d9a', poiId: 'saltwind-harbor', phase: 0.1, route: [{ x: -12, z: 100 }, { x: -8, z: 104 }, { x: -6, z: 101 }] },
  { id: 'tavi', name: 'Tavi', role: 'fisher', color: '#c86f59', poiId: 'saltwind-harbor', phase: 0.65, route: [{ x: -23, z: 95 }, { x: -25, z: 92 }, { x: -28, z: 94 }] },
  { id: 'nessa', name: 'Nessa', role: 'merchant', color: '#c86f59', poiId: 'tideglass-market', phase: 0.3, route: [{ x: -27, z: 32 }, { x: -25, z: 36 }, { x: -22, z: 33 }] },
  { id: 'ollo', name: 'Ollo', role: 'merchant', color: '#e2bb67', poiId: 'tideglass-market', phase: 0.8, route: [{ x: -33, z: 48 }, { x: -37, z: 47 }, { x: -36, z: 51 }] },
  { id: 'fen', name: 'Fen', role: 'farmer', color: '#7a9a65', poiId: 'windward-farm', phase: 0.15, route: [{ x: -48, z: -45 }, { x: -44, z: -42 }, { x: -40, z: -46 }] },
  { id: 'ivo', name: 'Ivo', role: 'lookout', color: '#768c9b', poiId: 'old-watch', phase: 0.5, route: [{ x: -64, z: -83 }, { x: -60, z: -80 }, { x: -62, z: -75 }] },
  { id: 'bram', name: 'Bram', role: 'lookout', color: '#b79a63', poiId: 'palmheart-camp', phase: 0.4, route: [{ x: -86, z: 4 }, { x: -85, z: 8 }, { x: -88, z: 10 }] },
  { id: 'sula', name: 'Sula', role: 'smith', color: '#b77857', poiId: 'cinderworks', phase: 0.7, route: [{ x: 75, z: -40 }, { x: 72, z: -38 }, { x: 74, z: -35 }] },
  { id: 'lio', name: 'Lio', role: 'scholar', color: '#a093c1', poiId: 'moonwatch', phase: 0.2, route: [{ x: 93, z: 37 }, { x: 98, z: 36 }, { x: 99, z: 39 }] },
  { id: 'ada', name: 'Ada', role: 'shipwright', color: '#548d94', poiId: 'driftwood-yard', phase: 0.9, route: [{ x: 33, z: 92 }, { x: 36, z: 94 }, { x: 38, z: 92 }] },
];

// Append-only IDs keep saved/reconnecting voyages and the original loot stable.
export const EXPLORATION_CHESTS = [
  { id: 'chest-19', x: -18, z: 100 },
  { id: 'chest-20', x: -33, z: 43 },
  { id: 'chest-21', x: -46, z: -48 },
  { id: 'chest-22', x: -74, z: -74 },
  { id: 'chest-23', x: -94, z: 9 },
  { id: 'chest-24', x: 77, z: -38 },
  { id: 'chest-25', x: 92, z: 47 },
  { id: 'chest-26', x: 30, z: 104 },
];

export function pointOfInterestAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return null;
  let closest = null, normalizedDistance = 1;
  for (const place of POINTS_OF_INTEREST) {
    const distance = Math.hypot(x - place.x, z - place.z) / place.radius;
    if (distance <= normalizedDistance) { closest = place; normalizedDistance = distance; }
  }
  return closest;
}

export function trailDistance(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return Infinity;
  let closest = Infinity;
  for (const trail of EXPLORATION_TRAILS) for (let i = 1; i < trail.points.length; i++) {
    const a = trail.points[i - 1], b = trail.points[i];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
    closest = Math.min(closest, Math.hypot(x - a.x - t * dx, z - a.z - t * dz));
  }
  return closest;
}
