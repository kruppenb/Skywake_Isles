import * as THREE from 'three';
import { SUNKEN_MANOR, SUNKEN_MANOR_SOLIDS } from '../shared/sunken-manor.js';

const X = SUNKEN_MANOR.x, Z = SUNKEN_MANOR.z;
const COLORS = Object.freeze({ limestone: '#c2c5b5', paleStone: '#dde0cf', plaster: '#4e6389', plasterWear: '#7083a0', roof: '#427f78', bronze: '#6a9c8e', darkBronze: '#55746e', timber: '#665a54', coral: '#e9a48f', barnacle: '#eee5c9', book: '#c79b79' });

function brokenBlock() {
  const vertices = [
    [-.5, -.5, -.5], [.5, -.5, -.5], [.5, -.5, .5], [-.5, -.5, .5],
    [-.5, .22, -.5], [.5, .5, -.5], [.5, .16, .5], [-.5, .68, .5],
  ];
  const faces = [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7];
  for (let i = 0; i < faces.length; i += 3) [faces[i + 1], faces[i + 2]] = [faces[i + 2], faces[i + 1]];
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(faces.flatMap(index => vertices[index]), 3));
  geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();
  return geometry;
}

// All authored detail is merged into the same eight borrowed reef materials.
// Only the resulting BufferGeometries belong to this group; shared textures,
// materials and source primitives remain owned by createReefResources.
export function createSunkenManor(resources) {
  if (!resources?.batch) throw new TypeError('createSunkenManor needs reef resources');
  const group = new THREE.Group(); group.name = 'sunken-manor-three-levels';
  const batches = Object.fromEntries(['stone', 'timber', 'bronze', 'basalt', 'coral', 'kelp', 'sand', 'rope'].map(kind => [kind, resources.batch(kind)]));
  const exterior = Object.fromEntries(['stone', 'bronze', 'basalt', 'coral'].map(kind => [kind, resources.batch(kind)]));
  const planarBox = new THREE.BoxGeometry(1, 1, 1);
  const ruinBlock = brokenBlock();
  const add = (kind, primitive, x, y, z, sx, sy, sz, color, rotation = [0, 0, 0]) => batches[kind].add(primitive === 'box' ? planarBox : primitive, [X + x, y, Z + z], [sx, sy, sz], rotation, color);
  const line = (kind, a, b, radius, color, taper = 1) => batches[kind].line([X + a[0], a[1], Z + a[2]], [X + b[0], b[1], Z + b[2]], radius, color, taper);
  const outer = (kind, primitive, x, y, z, sx, sy, sz, color, rotation = [0, 0, 0]) => exterior[kind].add(primitive === 'box' ? planarBox : primitive, [X + x, y, Z + z], [sx, sy, sz], rotation, color);
  const outerLine = (kind, a, b, radius, color, taper = 1) => exterior[kind].line([X + a[0], a[1], Z + a[2]], [X + b[0], b[1], Z + b[2]], radius, color, taper);

  // The actual collision shell is the rendered mass: no invisible walls or
  // floor planes. Broad indigo inset fields and carved ashlar coursing sit on
  // the shell, with worn and broken edges deliberately left exposed.
  for (const solid of SUNKEN_MANOR_SOLIDS) {
    const roof = solid.id.includes('roof'), furniture = solid.material === 'timber';
    const kind = roof ? 'basalt' : furniture ? 'timber' : 'stone';
    const tint = roof ? COLORS.roof : furniture ? COLORS.timber : solid.id.includes('floor') || solid.id.includes('foundation') ? '#a8b3ac' : COLORS.limestone;
    batches[kind].add(planarBox, [solid.x, solid.y, solid.z], [solid.width, solid.height, solid.depth], [0, 0, 0], tint);
  }

  // Exterior and interior plaster panels leave limestone quoins, lintels and
  // cracked corners visible. Different panels are tinted individually.
  for (const y of [2.8, 9.2, 15.6]) {
    for (const x of [-13.52, 13.52]) for (const z of [-8.2, 8.2]) {
      add('stone', 'box', x, y, z, .06, 4.5, 5.7, z < 0 ? COLORS.plaster : COLORS.plasterWear);
      add('stone', 'box', Math.sign(x) * 5.1, y, z, .06, 4.15, 5.2, COLORS.plaster);
    }
    for (const z of [-11.52, 11.52]) for (const x of [-9.1, 9.1]) add('stone', 'box', x, y, z, 7.2, 4.4, .06, x < 0 ? COLORS.plaster : COLORS.plasterWear);
  }
  for (const [x, z, y, turn] of [[-13.54, -8.2, 3.3, 1], [13.54, 8.2, 9.5, -1], [-9, -11.55, 15.3, 1], [9, 11.55, 4.1, -1]]) {
    line('stone', [x, y + .8, z], [x + turn * .05, y + .15, z + .36], .018, '#8293a3');
    line('stone', [x + turn * .05, y + .15, z + .36], [x, y - .65, z + .12], .018, '#8293a3');
    line('stone', [x, y - .1, z + .27], [x - turn * .04, y - .37, z + .7], .015, '#8293a3');
  }
  for (const x of [-13.62, 13.62]) for (const z of [-11.5, 11.5]) {
    add('stone', 'box', x, 9.5, z, 1.1, 18.8, 1.1, COLORS.paleStone);
    for (const y of [1.1, 6.3, 12.7, 18.7]) add('stone', 'box', x, y, z, 1.35, .3, 1.35, COLORS.limestone);
  }
  for (const y of [6.4, 12.8, 18.95]) {
    for (const x of [-13.6, 13.6]) add('bronze', 'box', x, y, 0, .12, .16, 23.5, COLORS.darkBronze);
    for (const z of [-11.6, 11.6]) add('bronze', 'box', 0, y, z, 27.5, .16, .12, COLORS.darkBronze);
  }
  // Outer shell dressing is deliberately outside the authoritative wall
  // planes (x=±14.4, z=±12.4). Earlier inset panels were hidden from a
  // swimmer approaching the manor, leaving one flat teal concrete volume.
  for (let level = 0; level < 3; level++) {
    const base = level * 6.4;
    for (const side of [-1, 1]) for (const wing of [-1, 1]) {
      const indigo = (level + wing + side) % 2 ? '#40587f' : '#536b93';
      const x = side * 14.47, z = wing * 8;
      outer('stone', 'box', x, base + 3.14, z, .075, 4.57, 6.28, indigo);
      outer('stone', 'box', side * 14.52, base + 3.08, z + wing * .34, .045, 3.76, 5.34, level === 1 ? '#4b638b' : '#62779a');
      outer('stone', 'box', x, base + .79, z, .18, .27, 7.35, COLORS.paleStone);
      outer('stone', 'box', x, base + 5.48, z, .18, .32, 7.35, COLORS.limestone);
      for (const margin of [-1, 1]) outer('stone', 'box', side * 14.49, base + 3.05, z + margin * 3.65, .24, 4.7, .42, COLORS.limestone);
      // Staggered ashlar strips expose the construction under flaking plaster.
      for (let row = 0; row < 5; row++) {
        const short = row % 2, cy = base + 1.22 + row * .9;
        for (const end of [-1, 1]) outer('stone', ruinBlock, side * 14.51, cy, z + end * (2.55 + short * .24), .18, .71, 1.27 - short * .18, row % 3 ? '#b7bdb0' : COLORS.paleStone);
      }
      const faceZ = side * 12.47, faceX = wing * 9;
      outer('stone', 'box', faceX, base + 3.14, faceZ, 8.38, 4.57, .075, indigo);
      outer('stone', 'box', faceX + wing * .38, base + 3.08, side * 12.52, 7.13, 3.76, .045, level === 2 ? '#4b638b' : '#62779a');
      outer('stone', 'box', faceX, base + .79, faceZ, 9.35, .27, .18, COLORS.paleStone);
      outer('stone', 'box', faceX, base + 5.48, faceZ, 9.35, .32, .18, COLORS.limestone);
      for (const margin of [-1, 1]) outer('stone', 'box', faceX + margin * 4.43, base + 3.05, side * 12.49, .42, 4.7, .24, COLORS.limestone);
      for (let row = 0; row < 5; row++) {
        const cy = base + 1.22 + row * .9;
        for (const end of [-1, 1]) outer('stone', ruinBlock, faceX + end * (3.45 + (row % 2) * .27), cy, side * 12.51, 1.44 - (row % 2) * .18, .71, .18, row % 3 ? '#b7bdb0' : COLORS.paleStone);
      }
    }
  }
  // Uneven limestone quoin blocks at all four corners break the large wall
  // planes and their vertical outline without narrowing any window.
  for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) for (let row = 0; row < 25; row++) {
    if ((row + (sideX + sideZ) * 2) % 11 === 5) continue;
    const y = .43 + row * .73, x = sideX * (14.43 + (row % 2) * .035), z = sideZ * (12.43 + ((row + 1) % 2) * .035);
    outer('stone', ruinBlock, x, y, z, .76, .64, .76, row % 4 ? '#c7cabc' : '#e0dfc8');
  }
  // Deep bronze cornices cross the limestone floor edges, with a bright lip
  // and dark corroded shadow band. They sit over, rather than in, the openings.
  for (const y of [6.38, 12.78, 19.05]) {
    for (const side of [-1, 1]) {
      outer('bronze', 'box', side * 14.52, y, 0, .25, .32, 24.8, COLORS.bronze);
      outer('bronze', 'box', side * 14.59, y - .23, 0, .1, .14, 24.8, COLORS.darkBronze);
      outer('bronze', 'box', 0, y, side * 12.52, 28.8, .32, .25, COLORS.bronze);
      outer('bronze', 'box', 0, y - .23, side * 12.59, 28.8, .14, .1, COLORS.darkBronze);
    }
  }
  // Stone voussoirs and bronze inlay outline each broad swim-through arch.
  // Keystones remain above y=5.5 within their level, clear of the body lane.
  for (const base of [0, 6.4, 12.8]) for (const side of [-1, 1]) {
    for (const edge of [-1, 1]) for (let row = 0; row < 6; row++) {
      const cy = base + 1.11 + row * .79, tint = row % 2 ? '#d3d5c4' : '#aebdb6';
      outer('stone', ruinBlock, side * 14.51, cy, edge * 4.72, .2, .64, .75, tint);
      outer('stone', ruinBlock, edge * 4.72, cy, side * 12.51, .75, .64, .2, tint);
    }
    outer('stone', ruinBlock, side * 14.52, base + 5.86, 0, .31, .65, 1.35, COLORS.paleStone);
    outer('stone', ruinBlock, 0, base + 5.86, side * 12.52, 1.35, .65, .31, COLORS.paleStone);
    for (let segment = 0; segment < 8; segment++) {
      const low = -4 + segment, high = low + 1;
      const h0 = base + 5.45 + .27 * Math.sin(Math.PI * segment / 8), h1 = base + 5.45 + .27 * Math.sin(Math.PI * (segment + 1) / 8);
      outerLine('bronze', [side * 14.62, h0, low], [side * 14.62, h1, high], .055, COLORS.darkBronze);
      outerLine('bronze', [low, h0, side * 12.62], [high, h1, side * 12.62], .055, COLORS.darkBronze);
    }
  }
  // The roof is a broken oxidized shell, not a continuous square cap. Ragged
  // gable fragments sit only over surviving roof slabs; raised shingle ribs
  // and small fallen plates catch light at the perimeter.
  for (const side of [-1, 1]) for (const wing of [-1, 1]) {
    for (let i = 0; i < 5; i++) {
      const x = wing * (6.2 + i * 1.45), z = side * 11.55;
      outer('basalt', ruinBlock, x, 19.57 + (i % 2) * .18, z, 1.35, 1.17 + (i % 3) * .35, .82, i % 2 ? '#4a8f83' : '#376f6d');
    }
    for (let i = 0; i < 4; i++) {
      const x = side * 13.28, z = wing * (5.2 + i * 1.75);
      outer('basalt', ruinBlock, x, 19.46 + (i % 2) * .21, z, .9, .82 + (i % 3) * .3, 1.55, '#4b827a');
    }
  }
  for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
    const z = -10.5 + i * 2.65;
    outer('basalt', 'box', side * 9.2, 19.39 + (i % 3) * .055, z, 8.2, .11, .15, i % 2 ? '#5a9a87' : '#335f65', [0, .025 * (i % 3 - 1), .015]);
  }
  // Growth is fixed to the outer window margins, where an approaching player
  // can read its warm colour without coral closing the eight-metre openings.
  for (const base of [0, 6.4, 12.8]) for (const side of [-1, 1]) for (const edge of [-1, 1]) {
    const y = base + 1.55 + ((base / 6.4 + edge + side + 4) % 3) * .86;
    const x = side * 14.65, z = edge * 4.85;
    for (let i = 0; i < 4; i++) outer('coral', 'sphere', x + side * .04, y + i * .24, z + edge * (i % 2) * .18, .18 + i * .025, .14 + i * .025, .18, i % 2 ? COLORS.coral : COLORS.barnacle);
    for (let i = 0; i < 5; i++) outerLine('coral', [x, y + .25, z], [x + side * .18, y + .65 + i * .15, z + edge * (.2 + i * .12)], .04, i % 2 ? '#f4b7a0' : COLORS.coral, .24);
    const faceX = edge * 4.85, faceZ = side * 12.65;
    for (let i = 0; i < 3; i++) outer('coral', 'sphere', faceX + edge * i * .16, y + i * .25, faceZ + side * .03, .18 + i * .035, .14, .19, i % 2 ? COLORS.coral : COLORS.barnacle);
  }
  // Corroded bronze jambs and scalloped arches frame the clear 8m shell gaps.
  for (const base of [0, 6.4, 12.8]) {
    for (const x of [-14, 14]) {
      for (const z of [-4.05, 4.05]) add('bronze', 'box', x, base + 3.13, z, .17, 5.25, .16, COLORS.bronze);
      for (let i = 0; i < 8; i++) {
        const z0 = -4 + i, z1 = z0 + 1, h0 = 5.42 + .26 * Math.sin(Math.PI * (i / 8)), h1 = 5.42 + .26 * Math.sin(Math.PI * ((i + 1) / 8));
        line('bronze', [x, base + h0, z0], [x, base + h1, z1], .075, COLORS.bronze);
      }
    }
    for (const z of [-12, 12]) {
      for (const x of [-4.05, 4.05]) add('bronze', 'box', x, base + 3.13, z, .16, 5.25, .17, COLORS.bronze);
      for (let i = 0; i < 8; i++) {
        const x0 = -4 + i, x1 = x0 + 1, h0 = 5.42 + .26 * Math.sin(Math.PI * (i / 8)), h1 = 5.42 + .26 * Math.sin(Math.PI * ((i + 1) / 8));
        line('bronze', [x0, base + h0, z], [x1, base + h1, z], .075, COLORS.bronze);
      }
    }
  }
  // A two-sided balcony rail stops before each wing doorway. It is a visual
  // remnant at the slab edge, low enough to swim over and thus not collidable.
  for (const base of [6.65, 13.05]) for (const z of [-4.15, 4.15]) for (const x of [-3.35, -1.65, 1.65, 3.35]) {
    add('bronze', 'cylinder', x, base + .38, z, .055, .76, .055, COLORS.bronze);
    if (x === -3.35 || x === 1.65) line('bronze', [x, base + .74, z], [x + 1.7, base + .74, z], .055, COLORS.darkBronze);
  }
  // The atrium sees the narrow ends of the partition walls, not their broad
  // plastered sides. Coursed end stones, indigo recesses and bronze floor
  // mouldings give these tall piers a finished interior face.
  for (const base of [0, 6.4, 12.8]) for (const sideX of [-1, 1]) for (const sideZ of [-1, 1]) {
    const x = sideX * 5.1, z = sideZ * 3.68;
    add('stone', 'box', x, base + 3.02, z, .44, 4.45, .07, COLORS.plaster);
    for (let row = 0; row < 7; row++) add('stone', ruinBlock, x, base + .54 + row * .76, z + sideZ * .075, .58, .59, .18, row % 3 ? '#bcc8ba' : COLORS.paleStone);
    add('bronze', 'box', x, base + 5.56, z + sideZ * .1, .77, .16, .24, COLORS.darkBronze);
  }
  for (const y of [6.38, 12.78]) {
    for (const side of [-1, 1]) {
      add('bronze', 'box', side * 4.03, y, 0, .14, .25, 8.2, COLORS.darkBronze);
      add('bronze', 'box', 0, y, side * 4.03, 8.2, .25, .14, COLORS.darkBronze);
    }
  }

  // Ground dining hall: a long carved table, six displaced chairs, sideboard,
  // plates and a fallen silver service. The table and sideboard use the
  // authoritative furniture boxes above; chairs sit well outside swim lanes.
  for (const z of [.6, 2.1, 3.9, 5.4]) for (const x of [-11.1, -6.9]) {
    add('timber', 'box', x, .75, z, .7, .18, .75, COLORS.timber);
    add('timber', 'box', x + (x < -9 ? -.29 : .29), 1.12, z, .13, .85, .75, COLORS.timber);
    for (const dx of [-.25, .25]) for (const dz of [-.25, .25]) add('timber', 'box', x + dx, .34, z + dz, .09, .55, .09, COLORS.timber);
  }
  for (const z of [1.3, 2.55, 3.8, 5]) {
    add('bronze', 'cylinder', -9, 2.03, z, .26, .045, .26, '#b0a98b');
    add('sand', 'sphere', -8.9, 2.1, z, .12, .035, .08, COLORS.barnacle);
  }
  for (const x of [7.2, 9, 10.8]) add('bronze', 'cylinder', x, 2.48, 8.8, .12, .38, .12, '#a28e69');

  // Mid-level library and bedchamber. Shelves are solid; patterned spines,
  // a canopied bed and a half-open wardrobe tell the drowned domestic story.
  for (const z of [-9.8, 9.5]) for (const x of [-11.5, -10.65, -9.8, -8.95, -8.1]) for (let row = 0; row < 3; row++) {
    const offset = (Math.floor(x * 10) + row) % 3;
    add('timber', 'box', x, 7.15 + row * .86, z + (z < 0 ? .58 : -.58), .52, .55 + .06 * offset, .14, ['#a37c67', '#788d9a', '#b3a078'][Math.abs(offset)]);
  }
  add('timber', 'box', 9, 7.72, -8.8, 4.25, .15, 3.3, '#81918d');
  for (const x of [7.1, 10.9]) for (const z of [-10.15, -7.45]) {
    add('timber', 'cylinder', x, 9.1, z, .11, 3.9, .11, COLORS.timber);
    add('bronze', 'sphere', x, 11.1, z, .15, .15, .15, COLORS.bronze);
  }
  for (const x of [7.1, 10.9]) line('rope', [x, 11.1, -10.15], [x, 10.5, -7.45], .035, '#8f9ca0');
  add('bronze', 'box', 10.2, 8.35, 9.56, 3.0, 2.3, .07, COLORS.darkBronze);

  // Upper ruined gallery: broken stair ends, display cases, fallen rafters
  // and a bronze chandelier suspended above the open atrium.
  for (const level of [0, 1]) for (let step = 0; step < 4; step++) {
    const y = level * 6.4 + .45 + step * .75, z = 6.4 + step * .75;
    if (step < 2) add('stone', 'box', 12.4, y / 2 + level * 3.2, z, .24, y - level * 6.4, .65, COLORS.limestone);
  }
  for (const x of [-12.1, -9.5, -7.3]) add('timber', 'box', x, 15.2, 8.8, .8, 2.2, .7, COLORS.timber);
  for (const [x, z, angle] of [[-10, -8, .18], [9.8, 9, -.24], [-7, 9, .35]]) add('basalt', 'box', x, 18.8, z, 3.4, .24, .6, COLORS.roof, [0, angle, .12]);
  // Its suspension returns to the intact western roof edge. The centre of
  // the roof hole remains open for a swimmer ascending through the atrium.
  add('bronze', 'box', -4.18, 19.09, 0, .82, .22, .45, COLORS.darkBronze);
  line('bronze', [-4.16, 19.06, 0], [0, 16.7, 0], .055, COLORS.darkBronze);
  add('bronze', 'ring', 0, 16.6, 0, 2.15, 2.15, 2.15, COLORS.bronze, [Math.PI / 2, 0, 0]);
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4, x = Math.cos(a) * 2.15, z = Math.sin(a) * 2.15;
    line('bronze', [0, 16.8, 0], [x, 16.55, z], .04, COLORS.bronze);
    add('sand', 'sphere', x, 16.5, z, .13, .16, .13, COLORS.barnacle);
  }

  // Ivory barnacle patches and peach fans creep through selected breaches.
  for (let i = 0; i < 56; i++) {
    const side = i % 4, level = Math.floor(i / 19), along = (i * 7 % 21) - 10;
    const x = side < 2 ? (side ? 13.55 : -13.55) : along, z = side < 2 ? along : (side === 2 ? -11.55 : 11.55);
    const y = .8 + level * 6.4 + (i * 11 % 43) / 10;
    add('coral', 'sphere', x, y, z, .15 + i % 3 * .055, .09 + i % 2 * .05, .16, i % 3 ? COLORS.barnacle : COLORS.coral);
  }
  for (const [x, y, z, side] of [[-13.7, 2.3, -2.7, -1], [13.7, 8.6, 2.8, 1], [-13.7, 14.5, 1.9, -1], [3.5, 19.1, -4.5, 1]]) {
    for (let i = 0; i < 7; i++) {
      const a = -1.1 + i * .37, reach = 1.1 + (i % 3) * .3;
      line('coral', [x, y, z], [x + side * .12, y + Math.cos(a) * reach, z + Math.sin(a) * reach], .047, i % 2 ? COLORS.coral : '#f0ba9d', .27);
    }
  }
  for (const [x, z] of [[-12, -3], [12, 3], [-11, 10], [11, -10]]) for (let i = 0; i < 3; i++) line('kelp', [x + i * .14, .3, z], [x + .3 + i * .15, 1.6 + i * .4, z + .25], .035, '#82aa87', .2);

  for (const [kind, batch] of Object.entries(batches)) {
    const mesh = batch.mesh({ shadow: kind !== 'kelp' && kind !== 'sand' });
    mesh.name = `sunken-manor-${kind}-batch`; group.add(mesh);
  }
  for (const [kind, batch] of Object.entries(exterior)) {
    const mesh = batch.mesh(); mesh.name = `sunken-manor-exterior-${kind}-batch`; group.add(mesh);
  }
  planarBox.dispose(); ruinBlock.dispose();
  const getStats = () => {
    let triangles = 0; for (const mesh of group.children) triangles += mesh.userData.triangles;
    return { levels: SUNKEN_MANOR.levels.length, solids: SUNKEN_MANOR_SOLIDS.length, drawCalls: group.children.length, triangles, flooded: true };
  };
  let disposed = false;
  return { group, getStats, dispose() { if (disposed) return; disposed = true; group.removeFromParent(); for (const mesh of group.children) mesh.geometry.dispose(); } };
}
