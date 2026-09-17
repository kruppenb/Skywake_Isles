import * as THREE from 'three';
import { heightAt } from '../shared/world.js';
import { CAPTAINS_HOUSE, CAPTAINS_HOUSE_ROOF, CAPTAINS_HOUSE_SOLIDS, CAPTAINS_HOUSE_STAIRS } from '../shared/captains-house.js';

// The architectural skin is generated from the authority's solid boxes. One
// instanced draw per finish keeps hundreds of individual siding and shake
// courses inexpensive, while every walkable opening stays aligned with physics.
const finishes = {
  foundation: ['#777d78', .98], navy: ['#526b78', .88], navyShade: ['#3f5665', .9],
  ivory: ['#ddd3b3', .86], ivoryShade: ['#b8aa8d', .92], cedar: ['#ae814c', .93],
  cedarAlt: ['#957142', .95], copper: ['#68817a', .72], iron: ['#3e4b4e', .72],
  amber: ['#d69a4c', .54], floor: ['#a77a4e', .9], floorDark: ['#806343', .92],
  beam: ['#594938', .89], plaster: ['#c9c5ab', .93], glass: ['#668c97', .23],
  cloth: ['#9f5749', .97], leather: ['#745846', .91], chart: ['#d0bc88', .98],
  brass: ['#c19a50', .48], hearth: ['#9f9c8c', .98], coal: ['#352f2b', .98],
  gravel: ['#b6a98a', 1],
};
const parts = new Map(Object.keys(finishes).map(key => [key, []]));
const dummy = new THREE.Object3D();
const weathered = new Set(['navy', 'navyShade', 'cedar', 'cedarAlt', 'floor', 'floorDark', 'beam', 'foundation', 'hearth', 'gravel']);

function grainTexture(kind) {
  const size = 64, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const n = Math.sin(x * .47 + Math.sin(y * .25) * 1.7) * .075 +
      Math.sin(x * 1.17 + y * .11) * .035 + Math.sin((x * 37 + y * 101 + kind.length * 19) * 1.37) * .025;
    const seam = kind === 'stone' ? Math.sin(x * .8 + y * .76) * .035 : Math.sin(y * .42 + Math.sin(x * .15)) * .025;
    const v = Math.round(232 + (n + seam) * 180);
    const offset = (y * size + x) * 4;
    pixels[offset] = Math.max(0, Math.min(255, v));
    pixels[offset + 1] = Math.max(0, Math.min(255, v - (kind === 'roof' ? 4 : 0)));
    pixels[offset + 2] = Math.max(0, Math.min(255, v - (kind === 'wood' ? 7 : 0)));
    pixels[offset + 3] = 255;
  }
  const texture = new THREE.DataTexture(pixels, size, size, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

function nameplateTexture() {
  const glyphs = {
    A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
    C: ['01111', '10000', '10000', '10000', '10000', '10000', '01111'],
    E: ['11111', '10000', '10000', '11110', '10000', '10000', '11111'],
    H: ['10001', '10001', '10001', '11111', '10001', '10001', '10001'],
    I: ['11111', '00100', '00100', '00100', '00100', '00100', '11111'],
    N: ['10001', '11001', '10101', '10101', '10011', '10001', '10001'],
    O: ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
    P: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    S: ['01111', '10000', '10000', '01110', '00001', '00001', '11110'],
    T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
    U: ['10001', '10001', '10001', '10001', '10001', '10001', '01110'],
    "'": ['00100', '00100', '00100', '00000', '00000', '00000', '00000'],
    ' ': ['00000', '00000', '00000', '00000', '00000', '00000', '00000'],
  };
  const width = 1024, height = 128, pixels = new Uint8Array(width * height * 4);
  const label = "CAPTAIN'S HOUSE", scale = 11, advance = 6 * scale;
  const startX = Math.floor((width - label.length * advance) / 2), startY = Math.floor((height - 7 * scale) / 2);
  for (let letter = 0; letter < label.length; letter++) {
    const rows = glyphs[label[letter]];
    for (let row = 0; row < 7; row++) for (let column = 0; column < 5; column++) {
      if (rows[row][column] !== '1') continue;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        const px = startX + letter * advance + column * scale + dx;
        const py = startY + (6 - row) * scale + dy;
        const offset = (py * width + px) * 4;
        pixels[offset] = 248; pixels[offset + 1] = 226; pixels[offset + 2] = 172; pixels[offset + 3] = 255;
      }
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height, THREE.RGBAFormat);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.NearestFilter; texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function piece(key, x, y, z, width, height, depth, rz = 0) {
  if (width <= 0 || height <= 0 || depth <= 0) return;
  parts.get(key).push({ x, y, z, width, height, depth, rz });
}

function beamBetween(key, ax, ay, az, bx, by, bz, width, depth = width) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const length = Math.hypot(dx, dy, dz);
  if (!length) return;
  // The pitched roof and stair rails only need inclination in the X/Y plane.
  if (Math.abs(dz) < .001) piece(key, (ax + bx) / 2, (ay + by) / 2, az, width, length, depth, -Math.atan2(dx, dy));
  else {
    const box = { x: (ax + bx) / 2, y: (ay + by) / 2, z: (az + bz) / 2, width, height: length, depth,
      quaternion: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(dx, dy, dz).normalize()) };
    parts.get(key).push(box);
  }
}

function skinWall(solid) {
  const { id, x, y, z, width, height, depth } = solid;
  const outer = id.startsWith('side-') || id.startsWith('front-') || id.startsWith('rear-');
  piece(outer ? 'navyShade' : 'plaster', x, y, z, width, height, depth);
  if (!outer) {
    // Narrow boards at room divisions read as painted panelling at a walking scale.
    for (let bottom = y - height / 2 + .12; bottom < y + height / 2 - .05; bottom += .62)
      piece('ivoryShade', x, bottom, z, width, .025, depth + .035);
    return;
  }
  const side = id.startsWith('side-'), sign = side ? Math.sign(x) : Math.sign(z);
  // The interior face is lime plaster with a timber dado; exterior paint does
  // not darken the whole room when the camera turns toward a perimeter wall.
  piece('plaster', side ? x - sign * .205 : x, y, side ? z : z - sign * .205,
    side ? .065 : width, height, side ? depth : .065);
  piece('beam', side ? x - sign * .25 : x,
    y - height / 2 + Math.min(.9, height * .35), side ? z : z - sign * .25,
    side ? .07 : width, .12, side ? depth : .07);
  const span = side ? depth : width, start = (side ? z : x) - span / 2;
  const face = (side ? x : z) + sign * .205;
  let row = 0;
  for (let bottom = y - height / 2; bottom < y + height / 2 - .025; bottom += .205, row++) {
    const h = Math.min(.185, y + height / 2 - bottom);
    let cursor = start;
    while (cursor < start + span - .02) {
      const nominal = 1.8 + ((row * 5 + Math.floor((cursor - start) * 3)) % 5) * .43;
      const length = Math.min(nominal, start + span - cursor);
      const center = cursor + length / 2;
      piece((row + Math.floor(cursor * 3)) % 7 === 0 ? 'navyShade' : 'navy',
        side ? face : center, bottom + h / 2, side ? center : face,
        side ? .085 : length - .025, h, side ? length - .025 : .085);
      cursor += length;
    }
  }
}

function floor(solid) {
  const { x, y, z, width, height, depth, id } = solid;
  piece(id === 'ground-deck' ? 'beam' : 'plaster', x, y - height / 2 + .07, z, width, .14, depth);
  if (id !== 'ground-deck') for (let cursor = x - width / 2; cursor <= x + width / 2; cursor += 2.4)
    piece('beam', cursor, y - height / 2 - .025, z, .16, .13, depth);
  for (let cursor = x - width / 2, row = 0; cursor < x + width / 2 - .03; cursor += .36, row++) {
    const w = Math.min(.34, x + width / 2 - cursor);
    let end = z - depth / 2;
    while (end < z + depth / 2 - .03) {
      const len = Math.min(2.0 + (row % 4) * .38, z + depth / 2 - end);
      piece((row + Math.floor(end * 2)) % 6 === 0 ? 'floorDark' : 'floor', cursor + w / 2, y + height / 2 - .028, end + len / 2, w, .055, len - .025);
      end += len;
    }
  }
  if (id === 'balcony-deck') for (const sx of [-1, 1]) piece('beam', sx * 4.65, y - .16, z, .25, .32, depth);
}

function rail(solid) {
  const base = solid.y - solid.height / 2;
  const alongX = solid.width > solid.depth;
  const span = alongX ? solid.width : solid.depth;
  for (let i = 0; i <= Math.ceil(span / 1.15); i++) {
    const t = -span / 2 + span * i / Math.ceil(span / 1.15);
    const x = solid.x + (alongX ? t : 0), z = solid.z + (alongX ? 0 : t);
    piece('ivory', x, base + .52, z, .105, 1.04, .105);
    piece('brass', x, base + 1.075, z, .15, .055, .15);
  }
  piece('beam', solid.x, base + 1.08, solid.z, alongX ? span + .16 : .16, .12, alongX ? .16 : span + .16);
  piece('ivoryShade', solid.x, base + .32, solid.z, alongX ? span : .09, .055, alongX ? .09 : span);
}

function windows() {
  // Each opening is precisely the gap between the shared wall solids.
  for (let level = 0; level < 3; level++) {
    const base = level * 4.6;
    for (const side of [-1, 1]) {
      const x = side * 9.82;
      piece('glass', x, base + 2.025, -.6, .045, 1.75, 6.34);
      for (const z of [-3.8, 2.6]) piece('ivory', x + side * .24, base + 2.03, z, .18, 2.05, .19);
      for (const y of [base + 1.12, base + 2.94]) piece('ivory', x + side * .24, y, -.6, .21, .15, 6.62);
      for (const z of [-1.67, .47]) piece('ivory', x + side * .27, base + 2.025, z, .095, 1.74, .11);
      piece('ivory', x + side * .27, base + 2.03, -.6, .095, .09, 6.34);
      // A pair of open louvred shutters is deliberately proud of each window.
      for (const z of [-4.24, 3.04]) {
        piece('navyShade', x + side * .29, base + 2.03, z, .12, 1.93, .75);
        for (let i = 0; i < 6; i++) piece('ivoryShade', x + side * .37, base + 1.32 + i * .26, z, .05, .055, .68);
      }
    }
    piece('glass', 0, base + 2.025, -8.82, 3.94, 1.75, .045);
    for (const x of [-2.04, 2.04]) piece('ivory', x, base + 2.025, -9.04, .16, 2.02, .2);
    for (const y of [base + 1.12, base + 2.94]) piece('ivory', 0, y, -9.04, 4.2, .16, .2);
    piece('ivory', 0, base + 2.025, -9.07, .11, 1.75, .1);
    piece('ivory', 0, base + 2.025, -9.07, 3.94, .1, .1);
    for (const sign of [-1, 1]) {
      const x = sign * 6;
      piece('glass', x, base + 2.2, 8.82, 2.16, 1.86, .045);
      for (const edge of [-1, 1]) piece('ivory', x + edge * 1.12, base + 2.2, 9.055, .16, 2.08, .2);
      for (const y of [base + 1.22, base + 3.18]) piece('ivory', x, y, 9.055, 2.45, .14, .2);
      piece('ivory', x, base + 2.2, 9.09, .095, 1.86, .08);
      piece('ivory', x, base + 2.2, 9.09, 2.16, .08, .08);
      for (const edge of [-1, 1]) {
        const shutterX = x + edge * 1.62;
        piece('navyShade', shutterX, base + 2.2, 9.1, .84, 1.94, .11);
        for (let i = 0; i < 6; i++) piece('ivoryShade', shutterX, base + 1.52 + i * .26, 9.18, .76, .055, .03);
      }
      piece('ivory', x, base + 1.19, 9.14, 2.63, .17, .43);
    }
  }
}

function staircases() {
  for (const stair of CAPTAINS_HOUSE_STAIRS) {
    for (let i = 0; i < stair.steps; i++) {
      const t = (i + 1) / stair.steps, z = stair.zStart + (stair.zEnd - stair.zStart) * (i + .5) / stair.steps;
      piece('floor', stair.x, stair.bottom + (stair.top - stair.bottom) * t - .055, z,
        stair.width - .12, .11, Math.abs(stair.zEnd - stair.zStart) / stair.steps - .025);
      piece('floorDark', stair.x, stair.bottom + (stair.top - stair.bottom) * t - .15,
        z + Math.sign(stair.zStart - stair.zEnd) * .34,
        stair.width - .12, .19, .07);
    }
    for (const side of [-1, 1]) {
      const x = stair.x + side * stair.width / 2;
      for (let i = 0; i <= 7; i++) {
        const t = i / 7, z = stair.zStart + (stair.zEnd - stair.zStart) * t;
        piece('beam', x, stair.bottom + (stair.top - stair.bottom) * t + .52, z, .12, 1.04, .12);
      }
      beamBetween('beam', x, stair.bottom + 1.04, stair.zStart, x, stair.top + 1.04, stair.zEnd, .15);
    }
  }
}

function furnishings() {
  for (const solid of CAPTAINS_HOUSE_SOLIDS.filter(item => item.kind === 'furniture')) {
    const { id, x, z, width, depth, level } = solid, base = level * 4.6, top = base + solid.height;
    if (id.includes('bed')) {
      piece('beam', x, base + .27, z, width, .33, depth);
      piece('cloth', x, base + .53, z, width - .22, .18, depth - .2);
      piece('ivory', x, base + .64, z - depth * .3, width * .72, .16, depth * .25);
      piece('beam', x, base + .77, z + depth / 2 - .08, width, .46, .16);
    } else if (id.includes('settee')) {
      piece('leather', x, base + .44, z, width, .38, depth);
      piece('beam', x, base + .8, z - depth / 2 + .12, width, .4, .25);
      for (const side of [-1, 1]) piece('beam', x + side * (width / 2 - .13), base + .64, z, .25, .6, depth);
    } else if (id.includes('counter') || id.includes('shelf')) {
      for (const y of id.includes('shelf') ? [base + .12, base + .92, base + 1.75] : [base + .12, top - .09])
        piece('floor', x, y, z, width, .16, depth);
      for (const side of [-1, 1]) piece('beam', x + side * (width / 2 - .075), base + solid.height / 2, z, .15, solid.height, depth);
      if (id.includes('counter')) {
        for (let i = 0; i < 3; i++) piece('iron', x - width * .3 + i * width * .3, top + .05, z, .38, .04, .38);
        piece('brass', x + 1.18, top + .17, z - .14, .035, .34, .035);
      }
    } else {
      piece('floor', x, top - .08, z, width, .16, depth);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) piece('beam', x + sx * (width / 2 - .12), base + (solid.height - .16) / 2, z + sz * (depth / 2 - .12), .16, solid.height - .16, .16);
      if (id.includes('chart') || id.includes('lookout')) {
        piece('chart', x, top + .018, z, width * .73, .025, depth * .7);
        for (let i = 0; i < 4; i++) piece('iron', x - width * .27 + i * .39, top + .037, z - depth * .19, .014, .02, .3);
      }
      if (id.includes('chest')) {
        piece('beam', x, base + .58, z, width, .16, depth);
        for (const sx of [-1, 1]) piece('brass', x + sx * (width / 2 - .14), base + .6, z, .06, .9, depth + .025);
      }
    }
  }
  // Hearth and chimney sit on the rear wall outside the kitchen route.
  piece('hearth', -7.1, .66, -8.05, 2.25, 1.32, 1.35);
  piece('coal', -7.1, .58, -7.31, 1.66, .87, .08);
  piece('amber', -7.1, .32, -7.16, .84, .32, .065);
  for (let y = 1.5; y < 15.1; y += .62) piece('hearth', -7.1, y, -8.72, 1.38, .57, .88);
  // Hanging lamps are small emissive forms, never a new global light profile.
  for (const [x, y, z] of [[-2, 3.45, 3], [3, 7.95, -2], [0, 12.45, 0]]) {
    piece('iron', x, y + .32, z, .08, .7, .08);
    piece('amber', x, y, z, .36, .54, .36);
    piece('brass', x, y + .31, z, .46, .09, .46);
  }
  // Chart table tools and lookout telescope, fitted to the chart room and attic.
  piece('brass', 2.1, 5.65, -5.6, .12, .16, .12);
  piece('brass', 7.0, 10.33, -5.66, .13, .96, .13);
  piece('brass', 7.0, 10.92, -5.42, .29, .22, .9);
}

function roofAndExterior() {
  // The three full storeys meet a genuinely pitched cedar roof.
  const { halfWidth, halfDepth, eave, ridge } = CAPTAINS_HOUSE_ROOF;
  for (const side of [-1, 1]) {
    for (let row = 0; row < 14; row++) {
      const a = row / 14, b = (row + 1.16) / 14;
      const x = side * (halfWidth - (a + b) / 2 * halfWidth);
      const y = eave + .02 + (a + b) / 2 * (ridge - eave - .02);
      for (let z = -9.25 - (row % 2) * .42; z < 9.4; z += .91) {
        const len = Math.min(.88, 9.4 - z);
        piece((row + Math.floor(z * 7)) % 6 === 0 ? 'cedarAlt' : 'cedar', x, y, z + len / 2,
          halfWidth / 14 * 1.17, .12, len - .025, -side * Math.atan2(ridge - eave, halfWidth));
      }
    }
    beamBetween('ivory', side * (halfWidth + .07), eave, halfDepth, 0, ridge, halfDepth, .18);
    beamBetween('ivory', side * (halfWidth + .07), eave, -halfDepth, 0, ridge, -halfDepth, .18);
    piece('ivory', side * (halfWidth - .21), eave - .02, 0, .19, .18, halfDepth * 2 + .2);
  }
  piece('copper', 0, ridge, 0, .28, .14, halfDepth * 2 + .2);
  for (const z of [-8.85, 8.85]) for (let i = 0; i < 13; i++) {
    const x = -9.4 + i * 1.57, roofY = ridge - Math.abs(x) / halfWidth * (ridge - eave);
    piece('navy', x, 13.64 + (roofY - 13.64) / 2, z, 1.58, roofY - 13.64, .21);
  }
  // Eight-point compass relief sits in the front gable over the lookout.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    piece(i % 2 ? 'ivory' : 'brass', Math.sin(angle) * .58, 14.62 + Math.cos(angle) * .58,
      9.055, .085, i % 2 ? .43 : .68, .07, -angle);
  }
  piece('brass', 0, 14.62, 9.1, .23, .23, .1);
  // Continuous base and trim disclose the scale from outside.
  for (const z of [-8.99, 8.99]) {
    if (z < 0) piece('foundation', 0, .24, z, 20.3, .48, .42);
    else for (const side of [-1, 1]) piece('foundation', side * 5.92, .24, z, 8.46, .48, .42);
    for (const level of [0, 1, 2]) piece('ivory', 0, level * 4.6 + 4.39, z, 20.3, .15, .23);
    for (const x of [-9.95, 9.95]) piece('ivory', x, 6.85, z, .23, 13.7, .25);
  }
  for (const x of [-9.99, 9.99]) {
    piece('foundation', x, .24, 0, .43, .48, 18.3);
    for (const level of [0, 1, 2]) piece('ivory', x, level * 4.6 + 4.39, 0, .21, .15, 18.3);
  }
  // Open door frames are aligned to the lower entrance and balcony opening.
  for (const level of [0, 1, 2]) {
    const base = level * 4.6, half = level === 2 ? 1.6 : 1.7;
    for (const sx of [-1, 1]) piece('ivory', sx * (half + .095), base + 1.68, 9.03, .19, level === 1 ? 4.31 : 3.36, .26);
    piece('ivory', 0, base + (level === 1 ? 4.34 : 3.38), 9.03, half * 2 + .39, .2, .27);
  }
  for (const sx of [-1, 1]) {
    piece('beam', sx * 4.72, 2.1, 11.15, .27, 4.2, .27);
    piece('brass', sx * 4.72, 4.24, 11.15, .32, .09, .32);
    for (let i = 0; i < 8; i++) piece('ivoryShade', sx * 4.72, .53 + i * .13, 11.15, .315, .027, .315);
  }
  piece('beam', 0, 4.17, 11.15, 10, .22, 2.86);
  // Porch beneath the balcony and a hand-built wayfinding fingerboard.
  for (let i = 0; i < 8; i++) piece('floor', -4.5 + i * 1.28, .045, 10.8, 1.18, .09, 3.4);
  // Individual uneven pavers pick up the trail just beyond the porch.
  for (let row = 0; row < 9; row++) for (let column = -1; column <= 1; column++) {
    const x = column * 1.28 + Math.sin(row * 2.6 + column) * .08;
    const z = 12.8 + row * .82;
    const groundY = heightAt(CAPTAINS_HOUSE.x + x, CAPTAINS_HOUSE.z + z) - heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
    piece('gravel', x, groundY + .025, z, 1.19, .06, .67);
  }
  piece('beam', -6.4, 1.37, 16.5, .15, 2.74, .15);
  piece('ivory', -5.65, 2.45, 16.5, 1.85, .45, .13);
  piece('navy', -5.65, 2.45, 16.58, 1.68, .32, .035);
}

function compile(group) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const meshes = [], materials = [], textures = { wood: grainTexture('wood'), roof: grainTexture('roof'), stone: grainTexture('stone') };
  for (const [key, transforms] of parts) {
    if (!transforms.length) continue;
    const [color, roughness] = finishes[key];
    const texture = weathered.has(key) ? (key === 'foundation' || key === 'hearth' || key === 'gravel' ? textures.stone : key.startsWith('cedar') ? textures.roof : textures.wood) : null;
    const material = new THREE.MeshStandardMaterial({ color, roughness, map: texture,
      metalness: ['brass', 'copper', 'iron'].includes(key) ? .38 : 0,
      emissive: key === 'amber' ? '#81511b' : '#000000', emissiveIntensity: key === 'amber' ? .55 : 0,
      transparent: key === 'glass', opacity: key === 'glass' ? .55 : 1, depthWrite: key !== 'glass' });
    const mesh = new THREE.InstancedMesh(geometry, material, transforms.length);
    mesh.name = `captains-house-${key}`;
    mesh.castShadow = key !== 'glass' && key !== 'amber'; mesh.receiveShadow = key !== 'glass';
    mesh.frustumCulled = false;
    transforms.forEach((part, index) => {
      dummy.position.set(part.x, part.y, part.z);
      dummy.scale.set(part.width, part.height, part.depth);
      dummy.quaternion.copy(part.quaternion || new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, part.rz || 0)));
      dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
      if (weathered.has(key)) {
        const variation = .94 + ((index * 97 + key.length * 31) % 17) / 100;
        mesh.setColorAt(index, new THREE.Color().setRGB(variation, variation * .992, variation * .978));
      }
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    group.add(mesh); meshes.push(mesh); materials.push(material);
  }
  return { geometry, meshes, materials, textures };
}

export function createCaptainsHouse({ scene } = {}) {
  for (const list of parts.values()) list.length = 0;
  const group = new THREE.Group(); group.name = 'captains-house';
  group.position.set(CAPTAINS_HOUSE.x, heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z), CAPTAINS_HOUSE.z);
  group.rotation.y = CAPTAINS_HOUSE.yaw;
  // A level foundation covers the natural slope without raising the doorway.
  piece('foundation', 0, -.27, 0, 20.2, .54, 18.2);
  floor({ id: 'ground-deck', x: 0, y: 0, z: 0, width: 20, height: .17, depth: 18 });
  for (const solid of CAPTAINS_HOUSE_SOLIDS) {
    if (solid.kind === 'wall') skinWall(solid);
    else if (solid.kind === 'floor') floor(solid);
    else if (solid.kind === 'rail') rail(solid);
  }
  windows(); staircases(); furnishings(); roofAndExterior();
  const { geometry, meshes, materials, textures } = compile(group);
  const signTexture = nameplateTexture();
  const signMaterial = new THREE.MeshBasicMaterial({ map: signTexture, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const signGeometry = new THREE.PlaneGeometry(1.72, .33);
  const signText = new THREE.Mesh(signGeometry, signMaterial);
  signText.name = 'captains-house-legible-sign'; signText.position.set(-5.65, 2.45, 16.64); group.add(signText);
  if (scene) scene.add(group);
  return {
    group,
    getStats() { return { meshes: meshes.length, parts: meshes.reduce((n, mesh) => n + mesh.count, 0), triangles: meshes.reduce((n, mesh) => n + mesh.count * 12, 0) }; },
    dispose() { group.removeFromParent(); geometry.dispose(); materials.forEach(material => material.dispose()); Object.values(textures).forEach(texture => texture.dispose()); signGeometry.dispose(); signMaterial.dispose(); signTexture.dispose(); },
  };
}
