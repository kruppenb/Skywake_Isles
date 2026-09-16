// Authored exploration content for the Sunken Reach.  This stays independent
// from movement and rendering so both can consume the same plain data.
export const REEF_REGIONS = Object.freeze([
  { id: 'sunken-reach', name: 'Sunken Reach', x: 0, z: 8, radius: 42, color: '#277e91', accent: '#9be6da', description: 'Broken decks and bright currents around the first dive.' },
  { id: 'coral-gardens', name: 'Coral Gardens', x: -70, z: 72, radius: 43, color: '#d86f86', accent: '#ffd48a', description: 'Layered coral terraces bloom under clear blue water.' },
  { id: 'kelp-hollows', name: 'Kelp Hollows', x: -88, z: -20, radius: 42, color: '#3d8068', accent: '#b9e58a', description: 'Tall kelp and hollow stone arches hide quiet paths.' },
  { id: 'bell-sanctuary', name: 'Bell Sanctuary', x: 2, z: -95, radius: 40, color: '#536f99', accent: '#f5d277', description: 'Old sea bells hang in a cool, echoing sanctuary.' },
  { id: 'ember-vents', name: 'Ember Vents', x: 88, z: -65, radius: 43, color: '#9a573f', accent: '#ffb16d', description: 'Warm basalt chimneys and amber vents light the water.' },
  { id: 'crown-graveyard', name: 'Crown Graveyard', x: 84, z: 40, radius: 43, color: '#67577f', accent: '#c9b4ef', description: 'Crowned hulls and stone ribs rise from a violet graveyard.' },
].map(Object.freeze));

export const REEF_DISCOVERIES = Object.freeze([
  { id: 'reach-figurehead', region: 'sunken-reach', name: 'Lantern Figurehead', description: 'A lantern-bearing figurehead watches the entrance current.', x: -10, y: 13, z: 28, range: 7, pearls: 4 },
  { id: 'reach-watchtower', region: 'sunken-reach', name: 'Split Watchtower', description: 'A fractured lookout rises above the old wreck.', x: 25, y: 28, z: 13, range: 7, pearls: 4 },
  { id: 'garden-fan', region: 'coral-gardens', name: 'Great Fan Coral', description: 'A rose fan coral spreads across a low terrace.', x: -64, y: 7, z: 78, range: 7, pearls: 4 },
  { id: 'garden-spire', region: 'coral-gardens', name: 'Pearl Spire', description: 'A pale coral spire catches the light high above the gardens.', x: -82, y: 30, z: 62, range: 7, pearls: 4 },
  { id: 'kelp-anchor', region: 'kelp-hollows', name: 'Kelpbound Anchor', description: 'An anchor has become the root of a towering kelp grove.', x: -82, y: 8, z: -13, range: 7, pearls: 4 },
  { id: 'kelp-window', region: 'kelp-hollows', name: 'Hollow Window', description: 'A stone window opens through the kelp canopy.', x: -105, y: 25, z: -31, range: 7, pearls: 4 },
  { id: 'bell-plinth', region: 'bell-sanctuary', name: 'Bellkeeper Plinth', description: 'A weathered plinth marks the old bellkeeper’s post.', x: -10, y: 7, z: -89, range: 7, pearls: 4 },
  { id: 'bell-crown', region: 'bell-sanctuary', name: 'Suspended Crown', description: 'A crown of iron rings turns slowly in the upper water.', x: 13, y: 29, z: -105, range: 7, pearls: 4 },
  { id: 'ember-mouth', region: 'ember-vents', name: 'Amber Vent Mouth', description: 'A warm vent mouth glows beneath black basalt.', x: 78, y: 11, z: -72, range: 7, pearls: 4 },
  { id: 'ember-stack', region: 'ember-vents', name: 'Sootglass Stack', description: 'A glassy chimney reaches into the high current.', x: 101, y: 31, z: -55, range: 7, pearls: 4 },
  { id: 'crown-keel', region: 'crown-graveyard', name: 'Crowned Keel', description: 'A gilded keel lies tilted among the graveyard stones.', x: 80, y: 8, z: 31, range: 7, pearls: 4 },
  { id: 'crown-mast', region: 'crown-graveyard', name: 'Moon Mast', description: 'A snapped mast points into the violet upper water.', x: 100, y: 32, z: 49, range: 7, pearls: 4 },
].map(Object.freeze));

export const REEF_ENCOUNTERS = Object.freeze([
  { id: 'garden-sentries', region: 'coral-gardens', name: 'Garden Sentries', guards: [{ x: -73, y: 13, z: 58 }, { x: -61, y: 18, z: 65 }] },
  { id: 'graveyard-watch', region: 'crown-graveyard', name: 'Graveyard Watch', guards: [{ x: 71, y: 13, z: 48 }, { x: 87, y: 17, z: 58 }, { x: 98, y: 23, z: 39 }] },
].map(encounter => Object.freeze({ ...encounter, guards: Object.freeze(encounter.guards.map(Object.freeze)) })));

export const REEF_CACHES = Object.freeze([
  { id: 'reach-chart-cache', region: 'sunken-reach', name: 'Chartmaker Cache', x: -23, y: 8, z: 10, pearls: 12 },
  { id: 'garden-shell-cache', region: 'coral-gardens', name: 'Shellwright Cache', x: -61, y: 12, z: 58, pearls: 12, encounterId: 'garden-sentries' },
  { id: 'garden-canopy-cache', region: 'coral-gardens', name: 'Canopy Cache', x: -89, y: 25, z: 74, pearls: 12 },
  { id: 'kelp-anchor-cache', region: 'kelp-hollows', name: 'Anchorhold Cache', x: -81, y: 9, z: -8, pearls: 12 },
  { id: 'kelp-loft-cache', region: 'kelp-hollows', name: 'Kelp Loft Cache', x: -107, y: 24, z: -29, pearls: 12 },
  { id: 'bell-keeper-cache', region: 'bell-sanctuary', name: 'Bellkeeper Cache', x: -3, y: 11, z: -101, pearls: 12 },
  { id: 'ember-vent-cache', region: 'ember-vents', name: 'Ventwalker Cache', x: 96, y: 12, z: -71, pearls: 12 },
  { id: 'crown-keel-cache', region: 'crown-graveyard', name: 'Keel Cache', x: 73, y: 13, z: 50, pearls: 12, encounterId: 'graveyard-watch' },
  { id: 'crown-mast-cache', region: 'crown-graveyard', name: 'Mast Cache', x: 106, y: 25, z: 47, pearls: 12 },
].map(Object.freeze));

export const REEF_EVENTS = Object.freeze([
  { id: 'sanctuary-chimes', region: 'bell-sanctuary', name: 'Wake the Sanctuary', description: 'Wake the three sea chimes.', kind: 'chimes', x: 2, y: 12, z: -95, range: 4, pearls: 24,
    nodes: [{ id: 'low-chime', name: 'Low Chime', x: -13, y: 8, z: -91, range: 4 }, { id: 'high-chime', name: 'High Chime', x: 9, y: 20, z: -99, range: 4 }, { id: 'far-chime', name: 'Far Chime', x: 6, y: 12, z: -108, range: 4 }] },
  { id: 'hollow-ray-rescue', region: 'kelp-hollows', name: 'Free the Rays', description: 'Open the three ray cages in the kelp hollows.', kind: 'rescue', x: -88, y: 11, z: -20, range: 4, pearls: 24,
    nodes: [{ id: 'ray-cage-a', name: 'Ray Cage', x: -80, y: 8, z: -18, range: 4 }, { id: 'ray-cage-b', name: 'Ray Cage', x: -94, y: 16, z: -28, range: 4 }, { id: 'ray-cage-c', name: 'Ray Cage', x: -101, y: 9, z: -12, range: 4 }] },
  { id: 'graveyard-defense', region: 'crown-graveyard', name: 'Hold the Crown', description: 'Defeat the guards that answer the crown’s call.', kind: 'defense', x: 84, y: 13, z: 40, range: 4, pearls: 24, nodes: [],
    guards: [{ x: 76, y: 13, z: 41 }, { x: 84, y: 18, z: 52 }, { x: 94, y: 12, z: 44 }, { x: 88, y: 24, z: 33 }] },
].map(event => Object.freeze({ ...event, nodes: Object.freeze(event.nodes.map(Object.freeze)), ...(event.guards ? { guards: Object.freeze(event.guards.map(Object.freeze)) } : {}) })));

// Each landmark is deliberately narrow or broken: every area has routes above,
// beneath, or through the silhouette instead of a flat wall across the sea.
export const REEF_LANDMARK_SOLIDS = Object.freeze([
  { id: 'reach-watch-pillar', region: 'sunken-reach', x: 25, y: 15, z: 13, width: 4, height: 22, depth: 4, material: 'wood' },
  { id: 'reach-watch-crossbeam', region: 'sunken-reach', x: 25, y: 25, z: 13, width: 14, height: 2, depth: 3, material: 'wood' },
  { id: 'garden-fan-base', region: 'coral-gardens', x: -64, y: 3, z: 78, width: 12, height: 5, depth: 5, material: 'stone' },
  { id: 'garden-spire', region: 'coral-gardens', x: -82, y: 15, z: 62, width: 5, height: 26, depth: 5, material: 'stone' },
  { id: 'kelp-window-left', region: 'kelp-hollows', x: -105, y: 12, z: -31, width: 3, height: 20, depth: 3, material: 'stone' },
  { id: 'kelp-window-right', region: 'kelp-hollows', x: -91, y: 12, z: -31, width: 3, height: 20, depth: 3, material: 'stone' },
  { id: 'kelp-window-top', region: 'kelp-hollows', x: -98, y: 22, z: -31, width: 17, height: 3, depth: 3, material: 'stone' },
  { id: 'bell-arch-left', region: 'bell-sanctuary', x: -8, y: 11, z: -95, width: 3, height: 18, depth: 4, material: 'stone' },
  { id: 'bell-arch-right', region: 'bell-sanctuary', x: 12, y: 11, z: -95, width: 3, height: 18, depth: 4, material: 'stone' },
  { id: 'bell-arch-top', region: 'bell-sanctuary', x: 2, y: 20, z: -95, width: 23, height: 3, depth: 4, material: 'stone' },
  { id: 'ember-stack', region: 'ember-vents', x: 101, y: 15, z: -55, width: 6, height: 27, depth: 6, material: 'basalt' },
  { id: 'ember-bridge-a', region: 'ember-vents', x: 82, y: 8, z: -70, width: 13, height: 3, depth: 4, material: 'basalt' },
  { id: 'ember-bridge-b', region: 'ember-vents', x: 94, y: 18, z: -66, width: 14, height: 3, depth: 4, material: 'basalt' },
  { id: 'crown-keel', region: 'crown-graveyard', x: 75, y: 10, z: 31, width: 5, height: 16, depth: 28, material: 'wood' },
  { id: 'crown-mast', region: 'crown-graveyard', x: 100, y: 16, z: 49, width: 4, height: 27, depth: 4, material: 'wood' },
  { id: 'crown-rib', region: 'crown-graveyard', x: 89, y: 24, z: 45, width: 20, height: 3, depth: 3, material: 'wood' },
].map(Object.freeze));

// Narrow art/physical alignment supports. These are separate from the primary
// landmark envelopes so gameplay and interaction coordinates remain stable.
export const REEF_LANDMARK_SUPPORTS = Object.freeze([
  { id: 'ember-bridge-a-west', region: 'ember-vents', x: 77, y: 3.25, z: -70, width: 1.6, height: 6.5, depth: 3, material: 'basalt' },
  { id: 'ember-bridge-a-east', region: 'ember-vents', x: 87, y: 3.25, z: -70, width: 1.6, height: 6.5, depth: 3, material: 'basalt' },
  { id: 'ember-bridge-b-west', region: 'ember-vents', x: 89.5, y: 8.25, z: -66, width: 1.8, height: 16.5, depth: 3, material: 'basalt' },
  { id: 'ember-bridge-b-east', region: 'ember-vents', x: 98.5, y: 8.25, z: -66, width: 1.8, height: 16.5, depth: 3, material: 'basalt' },
  { id: 'crown-rib-buttress', region: 'crown-graveyard', x: 78, y: 20.5, z: 44.5, width: 3, height: 7, depth: 2, material: 'wood' },
  { id: 'crown-rib-mast-joint', region: 'crown-graveyard', x: 99.5, y: 23.5, z: 46.75, width: 1.5, height: 3, depth: 1.5, material: 'wood' },
].map(Object.freeze));

export function reefRegionAt(x, z) {
  let closest = REEF_REGIONS[0], distance = Infinity;
  for (const region of REEF_REGIONS) {
    const normalized = Math.hypot(x - region.x, z - region.z) / region.radius;
    if (normalized < distance) { closest = region; distance = normalized; }
  }
  return closest;
}
