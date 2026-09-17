// Authoritative, renderer-free plan of the fully flooded manor. Coordinates
// are reef world coordinates; all boxes are centred, as in REEF_SOLIDS.
export const SUNKEN_MANOR = Object.freeze({
  id: 'sunken-manor', name: 'Sunken Manor', x: 42, z: -44,
  width: 28, depth: 24, height: 19.2,
  levels: Object.freeze([
    Object.freeze({ id: 'dining', name: 'Drowned Dining Hall', floorY: 0, swimY: 2.1 }),
    Object.freeze({ id: 'library', name: 'Library and Bedchambers', floorY: 6.4, swimY: 8.5 }),
    Object.freeze({ id: 'gallery', name: 'Broken Lookout Gallery', floorY: 12.8, swimY: 14.9 }),
  ]),
  entrance: Object.freeze({ x: 42, y: 2.1, z: -30.5 }),
  atrium: Object.freeze({ minX: 38, maxX: 46, minZ: -48, maxZ: -40 }),
});

const solids = [];
function box(id, x, y, z, width, height, depth, material = 'stone') {
  solids.push(Object.freeze({ id: `manor-${id}`, region: 'sunken-manor', x: SUNKEN_MANOR.x + x, y, z: SUNKEN_MANOR.z + z, width, height, depth, material }));
}

// Foundation and the two actual floors leave an eight metre square atrium.
// The broken gallery floor deliberately retains a second eastern breach.
box('foundation-north', 0, .25, -8, 28, .5, 8);
box('foundation-south', 0, .25, 8, 28, .5, 8);
box('foundation-west', -9, .25, 0, 10, .5, 8);
box('foundation-east', 9, .25, 0, 10, .5, 8);
for (const [level, y] of [[1, 6.4], [2, 12.8]]) {
  box(`floor-${level}-north`, 0, y, -8, 28, .5, 8);
  box(`floor-${level}-south`, 0, y, 8, 28, .5, 8);
  box(`floor-${level}-west`, -9, y, 0, 10, .5, 8);
  if (level === 1) box(`floor-${level}-east`, 9, y, 0, 10, .5, 8);
  else { box(`floor-${level}-east-north`, 9, y, -2.5, 10, .5, 3); box(`floor-${level}-east-south`, 9, y, 3, 10, .5, 2); }
}

// Three independent tiers of large openings. The outer shell has low sills
// at the windows, so the openings remain genuinely wide enough for a swimmer.
for (let level = 0; level < 3; level++) {
  const base = level * 6.4, tag = `l${level}`;
  for (const side of [-1, 1]) {
    const x = side * 14;
    box(`${tag}-${side < 0 ? 'west' : 'east'}-north`, x, base + 3.2, -8, .8, 6.4, 8);
    box(`${tag}-${side < 0 ? 'west' : 'east'}-south`, x, base + 3.2, 8, .8, 6.4, 8);
    box(`${tag}-${side < 0 ? 'west' : 'east'}-sill`, x, base + .35, 0, .8, .7, 8);
    box(`${tag}-${side < 0 ? 'west' : 'east'}-lintel`, x, base + 6.05, 0, .8, .7, 8);
  }
  for (const side of [-1, 1]) {
    const z = side * 12, face = side < 0 ? 'north' : 'south';
    box(`${tag}-${face}-west`, -9, base + 3.2, z, 10, 6.4, .8);
    box(`${tag}-${face}-east`, 9, base + 3.2, z, 10, 6.4, .8);
    if (level > 0 || side < 0) box(`${tag}-${face}-sill`, 0, base + .35, z, 8, .7, .8);
    box(`${tag}-${face}-lintel`, 0, base + 6.05, z, 8, .7, .8);
  }
  // Wing partitions provide real rooms, with 5m openings into the atrium.
  for (const side of [-1, 1]) {
    const x = side * 5.1, face = side < 0 ? 'west' : 'east';
    box(`${tag}-${face}-partition-north`, x, base + 3.1, -8, .55, 5.8, 8);
    box(`${tag}-${face}-partition-south`, x, base + 3.1, 8, .55, 5.8, 8);
    box(`${tag}-${face}-partition-head`, x, base + 5.8, 0, .55, .5, 8);
  }
}

// Broken roof: no sealed plane above the atrium or the eastern gallery breach.
box('roof-west', -9, 19.05, 0, 10, .55, 24, 'basalt');
box('roof-north', 0, 19.05, -8, 8, .55, 8, 'basalt');
box('roof-south', 0, 19.05, 8, 8, .55, 8, 'basalt');
box('roof-east-north', 9, 19.05, -8, 10, .55, 8, 'basalt');
box('roof-east-south', 9, 19.05, 8, 10, .55, 8, 'basalt');

// Substantial furnishings are as physical as the shell. Smaller chairs, books
// and coral are visual details kept off the known swim lanes.
box('dining-table', -9, 1.35, 3, 2.4, 1.2, 5.2, 'timber');
box('dining-sideboard', 8.8, 1.3, 8.8, 4.3, 2.2, 1.2, 'timber');
box('library-shelves-north', -9.5, 8.25, -9.8, 5.4, 3.1, 1.1, 'timber');
box('library-shelves-south', -10, 8.25, 9.5, 5.4, 3.1, 1.1, 'timber');
box('bedchamber-bed', 9, 7.3, -8.8, 4.2, 1.3, 3.2, 'timber');
box('bedchamber-wardrobe', 10.2, 8.35, 9.2, 3.2, 2.5, .65, 'timber');
box('gallery-cabinet', -10, 14.1, 8.9, 3.5, 2.3, 1.2, 'timber');
box('broken-stair-landing', 10.8, 12.05, 8.8, 3.1, .7, 2.8);
for (const level of [0, 1]) for (let step = 0; step < 4; step++) {
  box(`broken-stair-${level}-${step}`, 11.4, level * 6.4 + .45 + step * .75, 6.4 + step * .75, 2.7, .27, .85);
}

export const SUNKEN_MANOR_SOLIDS = Object.freeze(solids);

export const SUNKEN_MANOR_WAYPOINTS = Object.freeze([
  { x: 42, y: 2.1, z: -30.5 }, { x: 42, y: 2.1, z: -36 },
  { x: 42, y: 2.1, z: -44 }, { x: 42, y: 8.5, z: -44 },
  { x: 42, y: 14.9, z: -44 }, { x: 42, y: 22.4, z: -44 },
].map(Object.freeze));
