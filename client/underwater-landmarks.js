import * as THREE from 'three';

const TAU = Math.PI * 2;

function finishGeometry(geometry) {
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

// A closed, faceted loft. It is the shared primitive for coral trunks,
// timber masts and volcanic chimneys: broad continuous masses instead of
// vertically stacked stones with daylight between them.
function verticalLoft(rings, sides = 10) {
  const positions = [], indices = [];
  for (let ring = 0; ring < rings.length; ring++) {
    const section = rings[ring];
    for (let side = 0; side < sides; side++) {
      const a = side / sides * TAU + (section.phase || 0);
      const rough = 1 + Math.sin(side * 2.31 + ring * 1.73) * (section.roughness ?? .045);
      positions.push(section.x + Math.cos(a) * section.rx * rough, section.y, section.z + Math.sin(a) * section.rz * rough);
    }
  }
  for (let ring = 0; ring < rings.length - 1; ring++) for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides, a = ring * sides + side, b = ring * sides + next, c = (ring + 1) * sides + next, d = (ring + 1) * sides + side;
    indices.push(a, c, b, a, d, c);
  }
  const bottom = positions.length / 3; positions.push(rings[0].x, rings[0].y, rings[0].z);
  const topRing = rings.length - 1, top = positions.length / 3; positions.push(rings[topRing].x, rings[topRing].y, rings[topRing].z);
  for (let side = 0; side < sides; side++) { const next = (side + 1) % sides; indices.push(bottom, side, next); indices.push(top, topRing * sides + next, topRing * sides + side); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); return finishGeometry(geometry);
}

function beamLoftX(sections, flat = true) {
  const positions = [], indices = [], sides = 8;
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i], corners = [
      [-s.hy * .94, -s.hz], [-s.hy, -s.hz * .94], [-s.hy, s.hz * .94], [-s.hy * .94, s.hz],
      [s.hy * .94, s.hz], [s.hy, s.hz * .94], [s.hy, -s.hz * .94], [s.hy * .94, -s.hz],
    ];
    for (const [y, z] of corners) positions.push(s.x, s.y + y, s.z + z);
  }
  for (let i = 0; i < sections.length - 1; i++) for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides, a = i * sides + side, b = i * sides + next, c = (i + 1) * sides + next, d = (i + 1) * sides + side;
    indices.push(a, c, b, a, d, c);
  }
  const first = positions.length / 3; positions.push(sections[0].x, sections[0].y, sections[0].z);
  const lastSection = sections.length - 1, last = positions.length / 3; positions.push(sections[lastSection].x, sections[lastSection].y, sections[lastSection].z);
  for (let side = 0; side < sides; side++) { const next = (side + 1) % sides; indices.push(first, side, next); indices.push(last, lastSection * sides + next, lastSection * sides + side); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices);
  if (!flat) return geometry;
  const faceted = geometry.toNonIndexed(); geometry.dispose(); return finishGeometry(faceted);
}

function beamLoftZ(sections) {
  const geometry = beamLoftX(sections.map(section => ({ x: section.z, y: section.y, z: section.x, hy: section.hy, hz: section.hx })), false);
  const position = geometry.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), z = position.getZ(i); position.setX(i, z); position.setZ(i, x);
  }
  const index = geometry.index;
  for (let i = 0; i < index.count; i += 3) { const b = index.getX(i + 1); index.setX(i + 1, index.getX(i + 2)); index.setX(i + 2, b); }
  position.needsUpdate = true; index.needsUpdate = true; const faceted = geometry.toNonIndexed(); geometry.dispose(); return finishGeometry(faceted);
}

function shelfGeometry(radiusX, radiusZ, thickness, points = 14, seed = 0) {
  const positions = [], indices = [];
  for (let layer = 0; layer < 2; layer++) for (let i = 0; i < points; i++) {
    const a = i / points * TAU, ragged = 1 + Math.sin(i * 2.17 + seed) * .11 + Math.sin(i * 4.71 + seed * .7) * .035;
    positions.push(Math.cos(a) * radiusX * ragged, (layer ? thickness : -thickness) + Math.sin(i * 1.91 + seed) * thickness * .12, Math.sin(a) * radiusZ * ragged);
  }
  positions.push(0, -thickness * 1.05, 0, 0, thickness * 1.05, 0); const bottom = points * 2, top = bottom + 1;
  for (let i = 0; i < points; i++) { const next = (i + 1) % points; indices.push(i, points + next, next, i, points + i, points + next, bottom, i, next, top, points + next, points + i); }
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setIndex(indices); return finishGeometry(geometry);
}

function hullSideGeometry(side) {
  const sections = [-18.7, -16, -11.5, -6.2, -1.3].map((z, i) => {
    const end = i === 0 || i === 4 ? .82 : 1;
    return { z, x: 8 + side * (11.34 + (i === 2 ? .28 : 0)), y: 3.55, hx: .62 * end, hy: 3.0 * end };
  });
  return beamLoftZ(sections);
}

function bellGeometry() {
  // Outer and inner profiles make a real open throat and a heavy rolled rim.
  const points = [
    new THREE.Vector2(.16, 1.0), new THREE.Vector2(.42, .86), new THREE.Vector2(.5, .55), new THREE.Vector2(.66, .12),
    new THREE.Vector2(.94, -.62), new THREE.Vector2(1.05, -.88), new THREE.Vector2(1.08, -1.02),
    new THREE.Vector2(.84, -.98), new THREE.Vector2(.76, -.78), new THREE.Vector2(.54, -.22),
    new THREE.Vector2(.38, .34), new THREE.Vector2(.28, .78), new THREE.Vector2(.16, 1.0),
  ];
  return finishGeometry(new THREE.LatheGeometry(points, 18));
}

function addBell(batch, position, scale = 1, color = '#b99655') {
  const geometry = bellGeometry(); batch.add(geometry, position, [scale, scale, scale], [0, 0, 0], color); geometry.dispose();
}

function addRuggedPier(batch, x, z, height, width, colorA, colorB) {
  const course = 1.08, rows = Math.ceil(height / course);
  for (let row = 0; row < rows; row++) {
    const h = Math.min(course - .045, height - row * course), y = h / 2 + row * course;
    if (h <= 0) continue;
    const geometry = beamLoftX([
      { x: -width / 2, y: 0, z: 0, hy: h / 2, hz: width * .41 },
      { x: width / 2, y: 0, z: 0, hy: h / 2 * .98, hz: width * .43 },
    ]);
    batch.add(geometry, [x, y, z], [1, 1, 1], [0, row % 2 ? .035 : -.025, 0], row % 3 ? colorA : colorB); geometry.dispose();
  }
}

export function makeWreckLandmark(resources) {
  const group = new THREE.Group(); group.name = 'sunken-reach-wreck-solid-hull';
  const wood = resources.batch('timber'), fittings = resources.batch('bronze'), growth = resources.batch('coral');
  for (const side of [-1, 1]) {
    const shell = hullSideGeometry(side); wood.add(shell, [0, 0, 0], [1, 1, 1], [0, 0, 0], side < 0 ? '#4a392f' : '#5c4333'); shell.dispose();
    // Wide structural frames make the vessel read as a ship from the entrance.
    for (const z of [-17.1, -13.2, -8.9, -4.3]) {
      wood.line([8 + side * 11.78, .72, z], [8 + side * 12.02, 6.2, z], .28, '#7b5b42', .83);
      fittings.line([8 + side * 12.28, 1.15, z], [8 + side * 12.32, 5.72, z], .075, '#53766f', .92);
    }
    for (const y of [1.45, 3.0, 4.55]) wood.line([8 + side * 11.88, y, -18.1], [8 + side * 11.98, y + .12, -1.8], .12, y === 3 ? '#8d6848' : '#664936', .94);
  }
  const transom = beamLoftX([
    { x: -11.55, y: 3.45, z: 0, hy: 2.85, hz: .55 }, { x: -7, y: 3.7, z: .03, hy: 3.05, hz: .54 },
    { x: 0, y: 3.9, z: -.06, hy: 3.08, hz: .58 }, { x: 7, y: 3.68, z: .02, hy: 3.0, hz: .54 }, { x: 11.55, y: 3.4, z: 0, hy: 2.8, hz: .55 },
  ]); wood.add(transom, [8, 0, -18.95], [1, 1, 1], [0, 0, 0], '#49372e'); transom.dispose();
  // Narrow strakes and heavy braces remain legible in the first view into the
  // wreck; their shallow relief avoids the old brick-wall grid.
  for (let row = 0; row < 5; row++) {
    const y = 1.08 + row * 1.08, inset = row === 4 ? 1.4 : .45;
    const strake = beamLoftX([{ x: -11.4 + inset, y: 0, z: 0, hy: .43, hz: .13 }, { x: 0, y: Math.sin(row) * .06, z: 0, hy: .43, hz: .13 }, { x: 11.4 - inset, y: 0, z: 0, hy: .43, hz: .13 }]);
    wood.add(strake, [8, y, -18.27], [1, 1, 1], [0, 0, 0], row % 2 ? '#6e503b' : '#594132'); strake.dispose();
  }
  wood.line([-2.7, 1.1, -18.05], [6.2, 6.2, -18.05], .3, '#896447', .9); wood.line([18.7, 1.1, -18.03], [9.8, 6.22, -18.03], .3, '#896447', .9);
  for (const x of [-1.7, 17.7]) fittings.add('box', [x, 3.5, -17.98], [.13, 4.8, .13], [0, 0, 0], '#55786f');
  // Deck boards are tapered wedges and stop at the open stern passage.
  for (let x = -3.0; x <= 19; x += 1.7) {
    const board = beamLoftZ([
      { z: -18.4, x: 0, y: 0, hx: .72, hy: .09 }, { z: -10, x: Math.sin(x) * .07, y: .03, hx: .75, hy: .1 }, { z: -.65, x: 0, y: 0, hx: .69, hy: .08 },
    ]); wood.add(board, [x, 1.0, 0], [1, 1, 1], [0, 0, 0], Math.round(x) % 3 ? '#5a4232' : '#76543c'); board.dispose();
  }
  for (const z of [-16.4, -12.1, -7.8, -3.6]) {
    const rib = [[-3.8, 1.15, z], [-3.2, 5.35, z], [1.4, 6.45, z], [8, 6.72, z], [14.6, 6.43, z], [19.2, 5.35, z], [19.8, 1.15, z]];
    for (let i = 1; i < rib.length; i++) wood.line(rib[i - 1], rib[i], .25, i % 2 ? '#846146' : '#6b4c39', .92);
  }
  // Broken stern cheeks frame the authoritative fourteen metre entrance.
  for (const side of [-1, 1]) {
    wood.line([8 + side * 11.75, 1.0, -1.3], [8 + side * 10.3, 5.45, -.92], .3, '#7a5940', .85);
    wood.line([8 + side * 10.3, 5.45, -.92], [8 + side * 7.1, 6.3, -.72], .22, '#6a4b37', .86);
    fittings.add('cylinder', [8 + side * 11.95, 3.2, -1.42], [.13, 4.5, .13], [.03, 0, side * .04], '#557870');
  }
  for (const centerX of [-1.5, 17.5]) {
    const wing = beamLoftX([{ x: -2.5, y: 3.4, z: 0, hy: 2.72, hz: .48 }, { x: 0, y: 3.72, z: 0, hy: 3.0, hz: .5 }, { x: 2.5, y: 3.35, z: 0, hy: 2.68, hz: .46 }]);
    wood.add(wing, [centerX, 0, -1.0], [1, 1, 1], [0, 0, 0], '#513b30'); wing.dispose();
    for (let row = 0; row < 5; row++) wood.line([centerX - 2.28, 1.22 + row * 1.0, -.48], [centerX + 2.25, 1.34 + row * 1.0, -.48], .09, row % 2 ? '#8a6447' : '#6f503b', .95);
    wood.line([centerX - 2.1, 1.0, -.4], [centerX + 1.85, 5.85, -.4], .21, '#896347', .86);
  }
  for (const x of [5, 13]) {
    const ribBeam = beamLoftZ([{ z: -17.5, x: 0, y: 0, hx: .88, hy: .34 }, { z: -10, x: 0, y: .12, hx: .92, hy: .38 }, { z: -2.5, x: 0, y: 0, hx: .88, hy: .34 }]);
    wood.add(ribBeam, [x, 6.2, 0], [1, 1, 1], [0, 0, 0], '#7c5a40'); ribBeam.dispose();
  }
  wood.line([11.7, 1.15, -12.8], [15.0, 8.15, -15.2], .3, '#42332b', .85);
  wood.line([14.9, 8.05, -15.2], [18.4, 8.25, -16.1], .19, '#6c503c', .88);
  for (const [x, z] of [[-3.8, -15], [-3.8, -7], [19.8, -14], [19.8, -5], [2, -19.45], [15, -19.45]]) {
    const shelf = shelfGeometry(.42, .28, .12, 10, x + z); growth.add(shelf, [x, 2.25, z], [1, 1, 1], [0, 0, .25], '#9ca777'); shelf.dispose();
    growth.line([x, 1.35, z], [x + .18, 2.82, z + .15], .06, '#47785f', .66);
  }
  group.add(wood.mesh(), fittings.mesh(), growth.mesh({ shadow: false })); return group;
}

function addCoralSpire(batch, w, h, d) {
  const rings = [];
  for (let i = 0; i <= 13; i++) { const t = i / 13, waist = .78 + Math.sin(t * Math.PI * 3.1) * .1; rings.push({ x: Math.sin(i * .83) * .22, y: -h / 2 - 2 + (h + 2) * t, z: Math.cos(i * .71) * .2, rx: w * (.5 - t * .21) * waist, rz: d * (.5 - t * .21) * waist, phase: i * .13, roughness: .075 }); }
  const trunk = verticalLoft(rings, 12); batch.add(trunk, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#d9857e'); trunk.dispose();
  for (const [i, scale, color] of [[2, 1, '#efb878'], [5, .82, '#e88d86'], [8, .68, '#e8ca8b'], [10, .52, '#b88ca8']]) {
    const ring = rings[i], shelf = shelfGeometry(w * scale * .76, d * scale * .69, .26 + scale * .1, 16, i);
    batch.add(shelf, [ring.x, ring.y + .15, ring.z], [1, 1, 1], [.08, i * .67, -.06], color); shelf.dispose();
    for (const side of [-1, 1]) {
      const root = [ring.x + side * ring.rx * .25, ring.y + .18, ring.z], fork = [ring.x + side * (1.3 + scale * .45), ring.y + 1.15, ring.z + side * .42];
      batch.line(root, fork, .22 * scale + .06, '#dd7e76', .62); batch.line(fork, [fork[0] + side * .55, fork[1] + 1.3, fork[2] - .35], .14 * scale + .035, color, .42); batch.line(fork, [fork[0] - side * .12, fork[1] + 1.05, fork[2] + .65], .13 * scale + .03, '#f1b56f', .42);
    }
  }
  for (const [i, side, dz, color] of [[3, -1, -.55, '#e78682'], [5, 1, .7, '#efad73'], [7, -1, .65, '#c9829a'], [9, 1, -.55, '#e9c17e']]) {
    const ring = rings[i], shoulder = [ring.x + side * ring.rx * .42, ring.y, ring.z], elbow = [ring.x + side * (2.0 + i * .08), ring.y + 1.15, ring.z + dz], tip = [elbow[0] + side * 1.1, elbow[1] + 2.2, elbow[2] + dz * .35];
    batch.line(shoulder, elbow, .48 - i * .018, color, .72); batch.line(elbow, tip, .3 - i * .01, color, .52);
    batch.line(elbow, [elbow[0] - side * .25, elbow[1] + 1.75, elbow[2] - dz * .8], .23, '#f2b975', .45);
    batch.line(tip, [tip[0] + side * .45, tip[1] + 1.0, tip[2] + .35], .16, color, .35); batch.line(tip, [tip[0] - side * .3, tip[1] + .9, tip[2] - .5], .15, '#efc98c', .35);
  }
}

function addKelpArch(batch, solid) {
  const { id, width: w, height: h, depth: d } = solid;
  if (id.endsWith('top')) {
    const beam = beamLoftX([
      { x: -w / 2, y: -.1, z: 0, hy: h * .48, hz: d * .47 }, { x: -w * .28, y: .12, z: .08, hy: h * .5, hz: d * .5 },
      { x: 0, y: -.02, z: -.06, hy: h * .48, hz: d * .49 }, { x: w * .28, y: .16, z: .05, hy: h * .5, hz: d * .47 }, { x: w / 2, y: -.08, z: 0, hy: h * .48, hz: d * .46 },
    ]); batch.add(beam, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#4e7265'); beam.dispose();
  } else {
    const rings = [];
    for (let i = 0; i <= 9; i++) { const t = i / 9; rings.push({ x: Math.sin(i * .72) * .1, y: -h / 2 - 2 + (h + 2) * t, z: Math.cos(i * .93) * .09, rx: w * (.48 - t * .06), rz: d * (.48 - t * .055), phase: i * .12, roughness: .07 }); }
    const pier = verticalLoft(rings, 9); batch.add(pier, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#486c60'); pier.dispose();
    for (let i = 0; i < 4; i++) batch.line([0, -h / 2 - 1 + i * 4.6, d * .42], [w * .34 * (i % 2 ? -1 : 1), -h / 2 + 2.2 + i * 4.6, d * .53], .09, '#80a474', .62);
  }
}

function addBellArch(batch, solid) {
  const { id, width: w, height: h, depth: d } = solid;
  if (id.endsWith('top')) {
    const beam = beamLoftX([{ x: -w / 2, y: 0, z: 0, hy: h * .48, hz: d * .48 }, { x: 0, y: .08, z: -.03, hy: h * .49, hz: d * .48 }, { x: w / 2, y: 0, z: 0, hy: h * .48, hz: d * .48 }]);
    batch.add(beam, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#aebdb8'); beam.dispose();
    for (let x = -w / 2 + 1.2; x < w / 2; x += 2.35) batch.line([x, -h * .49, -d * .46], [x, h * .49, -d * .47], .025, '#6d898a', 1);
  } else {
    const course = 1.03, rows = Math.ceil((h + 2) / course);
    for (let row = 0; row < rows; row++) {
      const y = -h / 2 - 2 + course * row + (course - .045) / 2;
      const block = beamLoftX([{ x: -w / 2, y: 0, z: 0, hy: (course - .045) / 2, hz: d * .48 }, { x: w / 2, y: 0, z: 0, hy: (course - .045) / 2, hz: d * .48 }]);
      batch.add(block, [row % 2 ? .035 : -.035, y, 0], [1, 1, 1], [0, row % 2 ? .015 : -.015, 0], row % 3 ? '#9eb0ae' : '#bdc8c1'); block.dispose();
    }
  }
}

function addBasalt(batch, solid) {
  const { id, width: w, height: h, depth: d } = solid;
  if (id.includes('bridge')) {
    const sections = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; sections.push({ x: -w / 2 + w * t, y: Math.sin(t * Math.PI) * .22 + Math.sin(i * 1.7) * .08, z: Math.cos(i * 1.13) * .08, hy: h * (.48 - Math.sin(t * Math.PI) * .08), hz: d * (.48 - Math.sin(t * Math.PI) * .05) }); }
    const ledge = beamLoftX(sections); batch.add(ledge, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#30393b'); ledge.dispose();
    for (let i = 1; i < 8; i += 2) batch.line([sections[i].x - .18, -h * .46, d * .44], [sections[i].x + .32, h * .3, d * .49], .055, i % 4 === 1 ? '#ad6546' : '#171f21', .7);
    return;
  }
  const rings = [];
  for (let i = 0; i <= 13; i++) { const t = i / 13, ledge = i === 0 ? 1.08 : i === 3 || i === 7 ? 1.13 : 1; rings.push({ x: Math.sin(i * .88) * .2, y: -h / 2 - 1.5 + (h + 1.5) * t, z: Math.cos(i * .69) * .18, rx: w * (.49 - t * .13) * ledge, rz: d * (.49 - t * .13) * ledge, phase: i * .17, roughness: .12 }); }
  const stack = verticalLoft(rings, 9); batch.add(stack, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#2b3538'); stack.dispose();
  const mouth = shelfGeometry(w * .34, d * .33, .13, 12, 8); batch.add(mouth, [rings.at(-1).x, h / 2 + .02, rings.at(-1).z], [1, 1, 1], [0, 0, 0], '#172124'); mouth.dispose();
  for (let i = 2; i < 12; i += 3) batch.line([rings[i].x + rings[i].rx * .72, rings[i].y - .7, rings[i].z], [rings[i].x + rings[i].rx * .86, rings[i].y + .75, rings[i].z + .16], .07, '#b76845', .68);
}

function addCrownWood(batch, solid) {
  const { id, width: w, height: h, depth: d } = solid;
  if (id === 'crown-keel') {
    // The upright collider becomes a capsized hull cross-section. Its closed
    // shell fills the envelope; external ribs explain the massive silhouette.
    const sections = [];
    for (let i = 0; i <= 9; i++) { const t = i / 9, end = .54 + Math.sin(t * Math.PI) * .46; sections.push({ z: -d / 2 + d * t, x: Math.sin(i * .83) * .08, y: -h / 2 - 2 + h * .48 + Math.sin(t * Math.PI) * h * .19, hx: w * .46 * end, hy: h * (.31 + Math.sin(t * Math.PI) * .18) * end }); }
    const hull = beamLoftZ(sections); batch.add(hull, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#4d392f'); hull.dispose();
    for (let i = 1; i < 9; i++) { const s = sections[i], color = i % 3 ? '#795740' : '#95694a'; batch.line([-s.hx * .95, s.y - s.hy * .72, s.z], [-s.hx * 1.02, s.y + s.hy * .78, s.z], .24, color, .86); batch.line([s.hx * .95, s.y - s.hy * .72, s.z], [s.hx * 1.02, s.y + s.hy * .78, s.z], .24, color, .86); }
    for (const side of [-1, 1]) for (let row = 0; row < 6; row++) {
      const y = -h * .3 + row * h * .105, plank = beamLoftZ([{ z: -d * .38, x: 0, y: 0, hx: .12, hy: .48 }, { z: 0, x: 0, y: Math.sin(row) * .12, hx: .13, hy: .5 }, { z: d * .38, x: 0, y: 0, hx: .12, hy: .46 }]);
      batch.add(plank, [side * w * .465, y, 0], [1, 1, 1], [0, 0, 0], row % 3 ? '#72513c' : '#8b6245'); plank.dispose();
    }
    for (const side of [-1, 1]) batch.line([side * w * .43, -h * .34, -d * .43], [side * w * .45, h * .16, d * .43], .2, '#9a6d49', .9);
    return;
  }
  if (id === 'crown-mast') {
    const rings = [];
    for (let i = 0; i <= 9; i++) { const t = i / 9; rings.push({ x: Math.sin(i * .62) * .1, y: -h / 2 - 2 + (h + 2) * t, z: Math.cos(i * .71) * .08, rx: w * (.45 - t * .16), rz: d * (.45 - t * .16), phase: i * .09, roughness: .04 }); }
    const mast = verticalLoft(rings, 10); batch.add(mast, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#5b4334'); mast.dispose();
    for (const y of [-7, 0, 7]) { const band = new THREE.TorusGeometry(w * (.39 - (y + 7) / 80), .075, 6, 14); batch.add(band, [0, y, 0], [1, 1, 1], [Math.PI / 2, 0, 0], '#7b735e'); band.dispose(); }
    batch.line([-w * .43, h * .16, 0], [w * .43, h * .13, 0], .24, '#7b5940', .88); batch.line([0, h * .15, 0], [w * .42, h * .02, d * .35], .06, '#88988a', .75);
    return;
  }
  const sections = [];
  for (let i = 0; i <= 12; i++) { const t = i / 12; sections.push({ x: -w / 2 + w * t, y: -h * .31 + Math.sin(t * Math.PI) * h * .78, z: Math.sin(i * 1.17) * .05, hy: h * .42, hz: d * .46 }); }
  const rib = beamLoftX(sections); batch.add(rib, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#684a38'); rib.dispose();
  batch.line([-w * .46, -h * .46, d * .38], [w * .46, -h * .4, d * .4], .16, '#967052', .92);
}

export function addLandmarkSolid(batch, solid) {
  const { id, width: w, height: h, depth: d, material } = solid;
  if (id === 'garden-spire') return addCoralSpire(batch, w, h, d);
  if (id.startsWith('kelp-window')) return addKelpArch(batch, solid);
  if (id.startsWith('bell-arch')) return addBellArch(batch, solid);
  if (material === 'basalt') return addBasalt(batch, solid);
  if (material === 'wood' && id.startsWith('crown-')) return addCrownWood(batch, solid);
  if (id === 'garden-fan-base') {
    for (const [y, sx, sz, color, seed] of [[-2.2, 1, 1, '#887f78', 2], [-.8, .82, 1.05, '#a59684', 5], [.65, .62, .83, '#b69286', 8]]) {
      const shelf = shelfGeometry(w * .5 * sx, d * .5 * sz, .7, 16, seed); batch.add(shelf, [0, y, 0], [1, 1, 1], [0, seed * .2, 0], color); shelf.dispose();
    }
    return;
  }
  if (id === 'reach-watch-crossbeam') {
    const beam = beamLoftX([{ x: -w / 2, y: 0, z: 0, hy: h * .47, hz: d * .46 }, { x: 0, y: .09, z: -.04, hy: h * .49, hz: d * .47 }, { x: w / 2, y: -.04, z: .03, hy: h * .45, hz: d * .44 }]); batch.add(beam, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#674b38'); beam.dispose();
    for (const x of [-w * .28, w * .28]) { const band = new THREE.TorusGeometry(Math.min(h, d) * .49, .055, 6, 12); batch.add(band, [x, 0, 0], [1, 1, 1], [0, 0, Math.PI / 2], '#596d65'); band.dispose(); }
    return;
  }
  const grounded = id === 'reach-watch-pillar' ? 4 : 0;
  const rings = [];
  for (let i = 0; i <= 9; i++) { const t = i / 9; rings.push({ x: Math.sin(i * .8) * .08, y: -h / 2 - grounded + (h + grounded) * t, z: Math.cos(i * .77) * .07, rx: w * (.47 - t * .08), rz: d * (.47 - t * .08), phase: i * .08, roughness: .045 }); }
  const pillar = verticalLoft(rings, 10); batch.add(pillar, [0, 0, 0], [1, 1, 1], [0, 0, 0], material === 'wood' ? '#6c4f3b' : '#829c99'); pillar.dispose();
}

export function makeLandmarkSupports(resources, supports) {
  const group = new THREE.Group(); group.name = 'sunken-reach-authored-landmark-supports'; const families = new Map();
  for (const support of supports) {
    if (!families.has(support.material)) { const family = new THREE.Group(); family.name = `sunken-reach-${support.material}-collision-supports`; families.set(support.material, family); group.add(family); }
    const art = new THREE.Group(); art.name = `sunken-reach-support-${support.id}`; art.position.set(support.x, support.y, support.z);
    const batch = resources.batch(support.material === 'wood' ? 'timber' : support.material), rings = [
      { x: 0, y: -support.height / 2, z: 0, rx: support.width * .5, rz: support.depth * .5, roughness: .08 },
      { x: .05, y: 0, z: -.04, rx: support.width * .46, rz: support.depth * .47, phase: .18, roughness: .08 },
      { x: 0, y: support.height / 2, z: 0, rx: support.width * .5, rz: support.depth * .5, phase: .31, roughness: .08 },
    ];
    const geometry = verticalLoft(rings, support.material === 'wood' ? 10 : 8); batch.add(geometry, [0, 0, 0], [1, 1, 1], [0, 0, 0], support.material === 'wood' ? '#6f503b' : '#303a3c'); geometry.dispose();
    if (support.material === 'wood') for (const y of [-support.height * .24, support.height * .22]) batch.line([-support.width * .42, y, support.depth * .42], [support.width * .42, y + .16, support.depth * .42], .08, '#95694a', .9);
    else batch.line([support.width * .38, -support.height * .32, support.depth * .34], [support.width * .43, support.height * .3, support.depth * .36], .045, '#a86042', .68);
    art.add(batch.mesh()); families.get(support.material).add(art);
  }
  group.userData.solidIds = supports.map(support => support.id); return group;
}

export function makeRegionalLandmarkCompositions(resources, regions) {
  const group = new THREE.Group(); group.name = 'sunken-reach-regional-landmark-compositions';
  const stone = resources.batch('stone'), bronze = resources.batch('bronze'), basalt = resources.batch('basalt'), timber = resources.batch('timber'), coral = resources.batch('coral'), rope = resources.batch('rope');
  const bells = regions['bell-sanctuary'];
  // Grounded belfries with salt-tight joints. Each tower has a real opening,
  // shaped bell and a cap that bears on both piers.
  for (let i = 0; i < 3; i++) {
    const a = i * TAU / 3 + .2, x = bells.x + Math.sin(a) * 12, z = bells.z + Math.cos(a) * 12, h = 9.5 + i * 2.4, width = 3.35;
    addRuggedPier(stone, x - width * .34, z, h, 1.15, '#9baca9', '#b9c5bf'); addRuggedPier(stone, x + width * .34, z, h, 1.15, '#9baca9', '#b9c5bf');
    const cap = beamLoftX([{ x: -width / 2, y: 0, z: 0, hy: .42, hz: .75 }, { x: width / 2, y: 0, z: 0, hy: .42, hz: .75 }]); stone.add(cap, [x, h + .38, z], [1, 1, 1], [0, a * .08, 0], '#b7c4be'); cap.dispose();
    addBell(bronze, [x, h - 1.55, z], .82 + i * .06, i % 2 ? '#ae8b50' : '#bd9d5b'); bronze.add('sphere', [x, h - 2.38, z], [.15, .22, .15], [0, 0, 0], '#59452f'); rope.line([x, h + .35, z], [bells.x, 13.6 + i * .7, bells.z], .055, '#547772', .78);
  }
  for (let plank = 0; plank < 4; plank++) timber.add('box', [25, 24.15, 11.95 + plank * .69], [6.4, .16, .62], [0, .015 * (plank - 1), 0], plank % 2 ? '#76563f' : '#5f4738');
  for (const x of [22.2, 27.8]) bronze.add('box', [x, 24.25, 13], [.12, .45, 2.75], [0, 0, 0], '#57736d');
  timber.line([21.8, 24.9, 13], [28.2, 24.9, 13], .13, '#856247', .9); rope.line([18.2, 25.1, 13], [25, 27.8, 13.4], .045, '#7d7259', .8); rope.line([31.8, 25.0, 13], [25, 27.8, 13.4], .045, '#7d7259', .8);
  const vents = regions['ember-vents'];
  // Secondary chimneys use the same contiguous volcanic loft language.
  for (let i = 0; i < 7; i++) {
    const a = i * .91, x = vents.x + Math.sin(a) * (6 + i % 3 * 3), z = vents.z + Math.cos(a) * (6 + i % 3 * 3), h = 4.4 + i % 4 * 2.15, rings = [];
    for (let layer = 0; layer <= 5; layer++) { const t = layer / 5; rings.push({ x: Math.sin(layer * 1.9) * .12, y: h * t, z: Math.cos(layer * 1.6) * .12, rx: 1.05 - t * .26, rz: .95 - t * .23, phase: layer * .2, roughness: .12 }); }
    const stack = verticalLoft(rings, 8); basalt.add(stack, [x, 0, z], [1, 1, 1], [0, 0, 0], i % 2 ? '#303b3d' : '#424b4b'); stack.dispose();
    const lip = shelfGeometry(.72, .65, .12, 10, i); basalt.add(lip, [x, h, z], [1, 1, 1], [0, 0, 0], '#1c2729'); lip.dispose();
  }
  const graves = regions['crown-graveyard'];
  timber.line([79, 23, 44.9], [77, 17.3, 44.4], .52, '#6e4d39', .82); timber.line([77, 17.3, 44.4], [75.8, 10.2, 43.8], .58, '#7d5940', .82); timber.line([77, 17.3, 44.4], [76.2, 15.9, 42.8], .35, '#91684a', .75);
  timber.line([98.9, 23.1, 46.2], [100, 23.2, 48.0], .45, '#674936', .88);
  // Low collapsed hull frames make the large keel belong to a field of wrecks.
  for (let i = 0; i < 6; i++) {
    const a = i * 1.03 + .3, x = graves.x + Math.sin(a) * (10 + i % 2 * 4), z = graves.z + Math.cos(a) * (10 + i % 2 * 4), span = 3.2 + i % 3;
    timber.line([x - span, .18, z], [x, 2.4 + i % 2, z + .32], .24, '#684c3a', .84); timber.line([x, 2.4 + i % 2, z + .32], [x + span, .2, z], .24, '#7a5841', .84);
    timber.line([x - span * .72, .35, z + .18], [x + span * .72, .38, z + .18], .16, '#4c3b32', .9);
  }
  group.add(stone.mesh(), bronze.mesh(), basalt.mesh(), timber.mesh(), coral.mesh({ shadow: false }), rope.mesh({ shadow: false })); return group;
}

export function addFanCoralDiscovery(batch) {
  const positions = [[0, -1.2, 0]], outer = [];
  for (let i = 0; i < 9; i++) { const a = -.95 + i / 8 * 1.9; outer.push(positions.length); positions.push([Math.sin(a) * 2.35, .72 + Math.cos(a) * .74, Math.sin(i * 1.7) * .08]); }
  const back = positions.map(([x, y, z]) => [x, y, z - .12]), all = [...positions, ...back], offset = positions.length, geometry = new THREE.BufferGeometry(), indices = []; geometry.setAttribute('position', new THREE.Float32BufferAttribute(all.flat(), 3));
  for (let i = 0; i < outer.length - 1; i++) { indices.push(0, outer[i], outer[i + 1], offset, offset + outer[i + 1], offset + outer[i]); indices.push(outer[i], offset + outer[i], offset + outer[i + 1], outer[i], offset + outer[i + 1], outer[i + 1]); }
  indices.push(0, offset + outer[0], outer[0], 0, offset, offset + outer[0]); const last = outer.at(-1); indices.push(0, last, offset + last, 0, offset + last, offset); geometry.setIndex(indices); finishGeometry(geometry);
  batch.add(geometry, [0, 0, 0], [1, 1, 1], [0, 0, 0], '#d77d8b'); geometry.dispose();
  batch.line([0, -2.75, 0], [0, -1.05, 0], .36, '#b96872', .72);
  for (let i = 0; i < outer.length; i++) { const point = positions[outer[i]]; batch.line([0, -1.2, .05], point, i % 2 ? .055 : .075, i % 2 ? '#f1ae70' : '#b55e79', .45); if (i < outer.length - 1) batch.line(point, positions[outer[i + 1]], .035, '#f0a17b', .7); }
}

export function addSpireDiscoveryCrown(batch) {
  batch.line([0, -2.0, 0], [0, -.35, 0], .6, '#df857d', .82);
  for (const [side, z, color] of [[-1, -.4, '#e9868d'], [1, .35, '#efb875'], [-1, .55, '#b985a1'], [1, -.5, '#e8c47f']]) {
    const elbow = [side * 1.1, .35, z], tip = [side * 1.8, 1.9, z * 1.35]; batch.line([0, -.2, 0], elbow, .34, color, .62); batch.line(elbow, tip, .22, color, .42); batch.line(elbow, [side * .65, 1.55, -z], .19, '#f0bd7b', .4);
  }
}
