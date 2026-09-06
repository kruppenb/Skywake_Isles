import { MAX_PLAYERS, BEACON, SHRINES } from './world.js';

// The final battle at Tideglass Lighthouse runs in stages. A stage ends when
// every enemy it brought is defeated; the next stage forms up after this pause,
// and the voyage is won when the last stage is cleared. Stage order is the
// array order: to add a stage, append an entry here and teach finaleStageRoster
// what it brings (a fourth stage is planned).
export const FINALE_STAGE_DELAY = 4;
// Stage-one crabs form up this far from the lighthouse, inside this half-arc
// around the bearing toward each shard's shrine; slow Tidebreakers start closer.
export const FINALE_FRONT = 38;
export const FINALE_ELITE_FRONT = 32;
export const FINALE_ARC = Math.PI / 7;
export const FINALE_RANK_SIZE = 3;
// Each shrine direction surges this much later than the previous one.
export const FINALE_DIRECTION_DELAY = 1.5;

export const FINALE_STAGES = Object.freeze([
  { id: 'crabs', kind: 'wave', name: 'Shrine crabs', unit: 'crab', objective: 'Defend the lighthouse',
    banner: 'Crabs charge from the three shrines!', notice: 'Crabs are charging the lighthouse from all three shrines! Hold the dais together.' },
  { id: 'elites', kind: 'wave', name: 'Tidebreakers', unit: 'Tidebreaker', objective: 'Defend the lighthouse',
    banner: 'Tidebreakers march on the lighthouse!', notice: 'Tidebreakers are marching on the lighthouse! Aim for the big shells.' },
  { id: 'boss', kind: 'boss', name: 'Tempest Crab', unit: 'Tempest Crab', objective: 'Free the compass',
    banner: 'The Tempest Crab has the final compass!', notice: 'The Tempest Crab has the final compass! Watch the splash circles.' },
].map(stage => Object.freeze(stage)));

export const shardBearing = shrine => Math.atan2(shrine.z - BEACON.z, shrine.x - BEACON.x);

// What a stage brings, grouped by the shrine direction it comes from. Rosters
// latch to the crew that lit the beacon: stage one brings three crabs per
// shrine plus one per extra pirate, stage two brings Tidebreakers dealt
// round-robin across the shrines, and the boss stage brings the Tempest Crab.
export function finaleStageRoster(stage, playerCount) {
  if (!Number.isInteger(stage) || stage < 1 || stage > FINALE_STAGES.length ||
    !Number.isInteger(playerCount) || playerCount < 1 || playerCount > MAX_PLAYERS) return null;
  const definition = FINALE_STAGES[stage - 1], extra = playerCount - 1;
  if (definition.kind === 'boss') return { tempest: 1, groups: [] };
  const groups = SHRINES.map(shrine => ({ from: shrine.id, crab: 0, spitter: 0, tidebreaker: 0 }));
  if (definition.id === 'crabs') for (const group of groups) group.crab = 3 + extra;
  if (definition.id === 'elites') {
    const total = 2 + Math.floor(playerCount / 2);
    for (let index = 0; index < total; index++) groups[index % groups.length].tidebreaker++;
  }
  return { tempest: 0, groups };
}
