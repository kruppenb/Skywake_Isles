import * as THREE from 'three';
import { GeoBatch } from './models.js';
import { heightAt, OBSTACLES, CHESTS, SHRINES, SPAWN, BEACON } from '../shared/world.js';
import { POINTS_OF_INTEREST, BUILDINGS, RESIDENTS, trailDistance, buildingLocalPoint, buildingWalls, buildingFurnishings } from '../shared/exploration.js';

const TAU = Math.PI * 2;
const C = { wood: '#94633f', paleWood: '#c49864', dark: '#4a5556', cream: '#f5dca0', teal: '#399d9a', coral: '#c86f59', stone: '#b2ad97', metal: '#52646a', gold: '#dfbb6b' };

// All static pieces are baked into one mesh per place. Local frames make the
// architecture follow the same yaw and footprint used by authority and the map.
function frame(batch, x, y, z, yaw = 0) {
  const parent = new THREE.Matrix4().makeRotationY(yaw);
  parent.setPosition(x, y, z);
  const matrix = new THREE.Matrix4(), quaternion = new THREE.Quaternion(), position = new THREE.Vector3(), scale = new THREE.Vector3(), euler = new THREE.Euler();
  return {
    add(shape, p, s, r = [0, 0, 0], color = C.wood) {
      matrix.compose(position.set(...p), quaternion.setFromEuler(euler.set(...r)), scale.set(...s)).premultiply(parent);
      batch.addMatrix(typeof shape === 'string' ? batch.palette.geometry[shape] : shape, matrix, color);
    },
    line(a, b, radius, color = C.wood) {
      const start = new THREE.Vector3(...a).applyMatrix4(parent), end = new THREE.Vector3(...b).applyMatrix4(parent);
      batch.line(start.toArray(), end.toArray(), radius, color);
    },
    point(a, b, c) { return new THREE.Vector3(a, b, c).applyMatrix4(parent); },
  };
}

function roofGeometry(width, depth, bottom, top) {
  const w = width / 2, d = depth / 2, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([-w, bottom, -d, w, bottom, -d, 0, top, -d, -w, bottom, d, w, bottom, d, 0, top, d], 3));
  g.setIndex([0, 2, 1, 3, 4, 5, 0, 3, 5, 0, 5, 2, 1, 2, 5, 1, 5, 4, 0, 1, 4, 0, 4, 3]);
  const flat = g.toNonIndexed(); g.dispose(); flat.computeVertexNormals();
  return flat;
}

function gabledRoof(f, width, depth, eave, ridge, color) {
  const roof = roofGeometry(width, depth, eave, ridge);
  f.add(roof, [0, 0, 0], [1, 1, 1], [0, 0, 0], color); roof.dispose();
  f.line([0, ridge + .035, -depth / 2], [0, ridge + .035, depth / 2], .085, C.paleWood);
  for (const side of [-1, 1]) {
    f.line([side * width / 2, eave, -depth / 2], [side * width / 2, eave, depth / 2], .075, C.paleWood);
    for (let row = 1; row < 5; row++) {
      const t = row / 5, x = side * width / 2 * t, y = ridge + (eave - ridge) * t + .025;
      f.line([x, y, -depth / 2], [x, y, depth / 2], .035, color === C.coral ? '#ae5949' : '#447f7f');
    }
    for (const end of [-1, 1]) f.line([side * width / 2, eave, end * depth / 2], [0, ridge, end * depth / 2], .09, C.paleWood);
  }
}

function closedDoor(f, x, y, z, width, height, color = C.dark) {
  f.add('box', [x, y + height / 2, z], [width, height, .08], [0, 0, 0], color);
  for (const side of [-1, 1]) f.add('box', [x + side * (width / 2 + .065), y + height / 2, z + .02], [.13, height + .1, .12], [0, 0, 0], C.paleWood);
  f.add('box', [x, y + height + .06, z + .02], [width + .25, .16, .13], [0, 0, 0], C.paleWood);
  f.add('sphere', [x + width * .31, y + height * .48, z + .09], [.065, .065, .045], [0, 0, 0], C.gold);
  for (let i = 1; i < 4; i++) f.add('box', [x - width / 2 + i * width / 4, y + height / 2, z + .048], [.018, height - .08, .012], [0, 0, 0], '#6c6b5d');
}

function windowPanel(f, x, y, z, size = .8, yaw = 0) {
  // Side windows use a nested frame, so their shutters sit against the wall.
  const s = Math.sin(yaw), c = Math.cos(yaw);
  const part = (dx, dy, dz, sx, sy, sz, color) => f.add('box', [x + c * dx + s * dz, y + dy, z - s * dx + c * dz], [sx, sy, sz], [0, yaw, 0], color);
  part(0, 0, 0, size + .18, size * 1.13 + .16, .10, C.paleWood);
  part(0, 0, .07, size, size * 1.13, .08, '#5b8190');
  part(0, 0, .13, .055, size * 1.13, .04, C.cream);
  part(0, 0, .13, size, .055, .04, C.cream);
  for (const side of [-1, 1]) part(side * size * .77, 0, .04, size * .38, size * 1.18, .10, C.teal);
  part(0, -size * .65, .15, size * 1.3, .13, .3, C.paleWood);
}

function barrel(f, x, z, size = 1, y = 0) {
  f.add('cylinder', [x, y + .52 * size, z], [.43 * size, 1.04 * size, .43 * size], [0, 0, 0], C.wood);
  for (const h of [.15, .83]) f.add('cylinder', [x, y + h * size, z], [.45 * size, .075 * size, .45 * size], [0, 0, 0], C.metal);
  f.add('cylinder', [x, y + 1.055 * size, z], [.37 * size, .035, .37 * size], [0, 0, 0], C.paleWood);
}

function crate(f, x, z, size = 1, y = 0) {
  f.add('box', [x, y + .42 * size, z], [.9 * size, .84 * size, .8 * size], [0, 0, 0], C.paleWood);
  for (const h of [.1, .75]) f.add('box', [x, y + h * size, z], [.94 * size, .1 * size, .84 * size], [0, 0, 0], C.wood);
  f.line([x - .4 * size, y + .1 * size, z + .415 * size], [x + .4 * size, y + .73 * size, z + .415 * size], .055 * size, C.wood);
}

function distanceToSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}

export function buildSettlements(palette) {
  const group = new THREE.Group(); group.name = 'island-settlements';
  const rotors = [], pennants = [], chimneys = [], boats = [], occupied = [], propSites = [], buildingBounds = [], interiors = [];
  const batches = new Map(POINTS_OF_INTEREST.map(p => [p.id, new GeoBatch(palette)]));
  const oldWatchFallback = new THREE.Group(); oldWatchFallback.name = 'old-watch-original-exterior'; group.add(oldWatchFallback);
  const oldWatchTower = new GeoBatch(palette);
  const stats = { places: POINTS_OF_INTEREST.length, buildings: BUILDINGS.length, enterableBuildings: BUILDINGS.filter(b => b.enterable).length, residents: RESIDENTS.length, boats: 0, propClusters: 0 };
  const hemisphere = new THREE.SphereGeometry(1, 20, 9, 0, TAU, 0, Math.PI / 2);

  function hangingFlag(f, x, y, z, color, size = 1, parent = group) {
    const pivot = new THREE.Group(), b = new GeoBatch(palette);
    b.add('box', [.49 * size, -.25 * size, 0], [.97 * size, .49 * size, .035], [0, 0, -.06], color);
    b.add('box', [.5 * size, -.25 * size, .025], [.13 * size, .39 * size, .025], [0, 0, -.06], C.cream);
    pivot.add(b.mesh({ shadow: false }));
    const point = f.point(x, y, z); pivot.position.copy(point);
    parent.add(pivot); pennants.push({ pivot, phase: pennants.length * 1.8 });
  }

  function furnishedBuilding(building) {
    const { x, z, yaw, width, depth, wallHeight, height, color, roofColor, kind } = building;
    const pilot = building.id === 'watch-barracks';
    const floorY = heightAt(x, z), source = pilot ? new GeoBatch(palette) : batches.get(building.poiId), firstVertex = source.positions.length;
    const upper = Array.from({ length: 4 }, () => new GeoBatch(palette)), roof = new GeoBatch(palette);
    const faces = upper.map(batch => frame(batch, x, floorY, z, yaw));
    let floor = frame(source, x, floorY, z, yaw);
    const cover = frame(roof, x, floorY, z, yaw);
    const wall = { add(shape, position, ...args) {
      const face = Math.abs(position[0]) / width >= Math.abs(position[2]) / depth
        ? (position[0] >= 0 ? 0 : 1) : (position[2] >= 0 ? 2 : 3);
      faces[face].add(shape, position, ...args);
    } };
    // The shared terrain is level under the whole room and both thresholds.
    // A shallow inset plank floor needs no step or invisible collision platform.
    floor.add('box', [0, -.06, 0], [width, .15, depth], [0, 0, 0], C.paleWood);
    for (let i = 1; i < 10; i++) floor.add('box', [-width / 2 + i * width / 10, .022, 0], [.015, .007, depth], [0, 0, 0], '#ad8154');
    for (const segment of buildingWalls(building)) {
      const lowTop = Math.min(.48, segment.top);
      if (segment.bottom < lowTop) floor.add('box', [segment.x, (segment.bottom + lowTop) / 2, segment.z], [segment.width, lowTop - segment.bottom, segment.depth], [0, 0, 0], color);
      const bottom = Math.max(.48, segment.bottom);
      wall.add('box', [segment.x, (bottom + segment.top) / 2, segment.z], [segment.width, segment.top - bottom, segment.depth], [0, 0, 0], color);
    }
    for (const side of [-1, 1]) for (const end of [-1, 1]) {
      wall.add('box', [side * (width / 2 - .09), wallHeight / 2, end * (depth / 2 - .09)], [.14, wallHeight, .14], [0, 0, 0], C.wood);
      // Trim belongs to the solid jamb, leaving the full shared doorway clear.
      wall.add('box', [side * (building.doorWidth / 2 + .06), building.doorHeight / 2, end * (depth / 2 + .025)], [.12, building.doorHeight, .07], [0, 0, 0], C.paleWood);
    }
    for (const end of [-1, 1]) wall.add('box', [0, building.doorHeight + .08, end * (depth / 2 + .025)], [building.doorWidth + .24, .16, .07], [0, 0, 0], C.paleWood);
    for (const side of [-1, 1]) windowPanel(wall, side * (width / 2 + .035), wallHeight * .6, 0, .68, side * Math.PI / 2);
    if (kind === 'warehouse' || kind === 'barn' || kind === 'forge') {
      for (const side of [-1, 1]) for (let i = 1; i < 7; i++) wall.add('box', [side * (width / 2 + .018), wallHeight / 2, -depth / 2 + i * depth / 7], [.035, wallHeight, .035], [0, 0, 0], '#bd905f');
    }
    gabledRoof(cover, width + .14, depth + .14, wallHeight + .1, height * .91, roofColor);
    if (kind === 'tavern' || kind === 'forge') {
      const chimneyX = -width * .29, chimneyZ = -depth * .22;
      cover.add('box', [chimneyX, height * .79, chimneyZ], [.69, height * .39, .66], [0, 0, 0], kind === 'forge' ? '#665c58' : '#a89b89');
      cover.add('box', [chimneyX, height * .98, chimneyZ], [.85, .15, .81], [0, 0, 0], C.stone);
      chimneys.push(cover.point(chimneyX, height + .1, chimneyZ));
    }
    if (kind === 'tavern') {
      wall.add('box', [width * .33, wallHeight * .82, depth / 2 + .16], [.74, .51, .15], [0, 0, 0], C.teal);
      wall.add('ring', [width * .33, wallHeight * .82, depth / 2 + .25], [.16, .16, .16], [0, 0, 0], C.cream);
    }
    // Furnishings remain visible when the authored shell replaces the fallback.
    if (pilot) floor = frame(batches.get(building.poiId), x, floorY, z, yaw);
    for (const item of buildingFurnishings(building)) {
      const { x: fx, z: fz, width: fw, depth: fd, top } = item;
      const add = (shape, p, s, color, rotation = [0, 0, 0]) => floor.add(shape, [fx + p[0], p[1], fz + p[2]], s, rotation, color);
      if (item.kind === 'bed') {
        add('box', [0, .22, 0], [fw, .36, fd], C.wood);
        add('box', [0, .46, 0], [fw - .05, .14, fd - .08], C.cream);
        add('box', [0, .56, -.2], [fw - .045, .13, fd * .61], roofColor);
        add('box', [0, .6, fd * .32], [fw * .75, .12, .35], '#f3e5bd');
        add('box', [0, .43, -fd / 2 + .045], [fw, .46, .09], C.paleWood);
      } else if (item.kind === 'shelf') {
        for (const end of [-1, 1]) add('box', [0, top / 2, end * (fd / 2 - .035)], [fw, top, .07], C.wood);
        for (const level of [.12, .52, 1]) add('box', [0, top * level - .04, 0], [fw, .08, fd], C.paleWood);
        for (let i = 0; i < 4; i++) add('box', [0, top * .52 + .14, (i - 1.5) * fd / 5], [fw * .8, .24 + i % 2 * .08, fd / 6], i % 2 ? C.cream : C.teal);
        for (const end of [-1, 1]) add('cylinder', [0, .30, end * fd * .23], [fw * .33, .35, fw * .33], C.coral);
      } else if (item.kind === 'casks') {
        for (const end of [-1, 1]) barrel(floor, fx, fz + end * fd * .25, Math.min(fw / .9, top / 1.08));
      } else if (item.kind === 'crates') {
        for (const end of [-1, 1]) crate(floor, fx, fz + end * fd * .25, Math.min(fw / .94, fd / 1.7));
        crate(floor, fx, fz, fw * .65, .64);
      } else {
        add('box', [0, top - .085, 0], [fw, .17, fd], C.paleWood);
        for (const end of [-1, 1]) add('box', [0, (top - .17) / 2, end * fd * .37], [fw * .75, top - .17, .15], C.wood);
        if (item.kind === 'bar') {
          add('box', [fw / 2 - .04, top / 2, 0], [.08, top, fd], C.wood);
          for (const end of [-1, 1]) add('cylinder', [0, top + .12, end * fd * .28], [.10, .24, .10], C.cream);
        } else {
          add('box', [0, top + .055, 0], [fw * .72, .11, .42], C.metal);
          add('box', [0, top + .14, fd * .31], [.13, .1, .32], C.gold, [0, -.3, 0]);
        }
      }
    }
    const wallsMesh = new THREE.Group(), roofMesh = roof.mesh();
    const normals = [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }];
    upper.forEach((batch, index) => {
      const face = batch.mesh(); face.name = building.id + '-wall-face-' + index;
      face.userData.normal = normals[index]; wallsMesh.add(face);
    });
    wallsMesh.name = building.id + '-cutaway-walls'; roofMesh.name = building.id + '-cutaway-roof';
    (pilot ? oldWatchFallback : group).add(wallsMesh, roofMesh);
    if (pilot) { const base = source.mesh(); base.name = 'watch-barracks-original-base'; oldWatchFallback.add(base); }
    interiors.push({ building, walls: wallsMesh, roof: roofMesh, originalWalls: wallsMesh, originalRoof: roofMesh });
    let visualRadius = 0, visualHeight = 0;
    for (const [batch, first] of [[source, firstVertex], ...upper.map(batch => [batch, 0]), [roof, 0]]) for (let index = first; index < batch.positions.length; index += 3) {
      visualRadius = Math.max(visualRadius, Math.hypot(batch.positions[index] - x, batch.positions[index + 2] - z));
      visualHeight = Math.max(visualHeight, batch.positions[index + 1] - floorY);
    }
    buildingBounds.push({ id: building.id, radius: visualRadius, height: visualHeight });
  }

  for (const building of BUILDINGS) {
    if (building.enterable) { furnishedBuilding(building); continue; }
    const { x, z, radius: r, height, yaw, kind, color, roofColor } = building;
    const sourceBatch = building.id === 'signal-tower' ? oldWatchTower : batches.get(building.poiId), firstVertex = sourceBatch.positions.length;
    const ground = heightAt(x, z);
    let high = ground, low = ground;
    for (let i = 0; i < 12; i++) {
      const y = heightAt(x + Math.sin(i / 12 * TAU) * r * .83, z + Math.cos(i / 12 * TAU) * r * .83);
      high = Math.max(high, y); low = Math.min(low, y);
    }
    const y = high + .10, h = height - (y - ground), f = frame(sourceBatch, x, y, z, yaw);
    // Deep, compact masonry foundations reach the terrain on the downhill side.
    const foundationDepth = y - low + .32;
    f.add('cylinder', [0, -.5 * foundationDepth + .08, 0], [r * .86, foundationDepth, r * .86], [0, 0, 0], C.stone);
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * TAU;
      f.add('box', [Math.sin(a) * r * .82, -.06, Math.cos(a) * r * .82], [.4, .25, .22], [0, a, 0], i % 2 ? '#c3bca2' : '#929890');
    }

    if (kind === 'windmill') {
      const tower = new THREE.CylinderGeometry(r * .44, r * .74, h * .76, 12);
      f.add(tower, [0, h * .38, 0], [1, 1, 1], [0, 0, 0], color); tower.dispose();
      for (const t of [.15, .43, .68]) f.add('cylinder', [0, h * t, 0], [r * (.74 - t * .38) + .025, .17, r * (.74 - t * .38) + .025], [0, 0, 0], C.paleWood);
      f.add('cone', [0, h * .85, 0], [r * .61, h * .23, r * .61], [0, 0, 0], roofColor);
      closedDoor(f, 0, .05, r * .735, 1, 2.15);
      windowPanel(f, 0, h * .44, r * .59, .63);
      const rotor = new THREE.Group(), sails = new GeoBatch(palette), length = r * .73; rotor.name = 'windward-mill-rotating-sails';
      for (let i = 0; i < 4; i++) {
        const angle = i * Math.PI / 2;
        const sailFrame = frame(sails, 0, 0, 0);
        const sin = Math.sin(angle), cos = Math.cos(angle);
        sails.line([0, 0, 0], [sin * length, cos * length, 0], .075, C.wood);
        sails.add('box', [sin * length * .65 + cos * length * .12, cos * length * .65 - sin * length * .12, .025], [length * .29, length * .70, .055], [0, 0, -angle], C.cream);
        for (let j = 0; j < 4; j++) {
          const along = length * (.33 + j * .19);
          sailFrame.line([sin * along, cos * along, .063], [sin * along + cos * length * .27, cos * along - sin * length * .27, .063], .028, C.paleWood);
        }
      }
      sails.add('cylinder', [0, 0, .08], [.22, .3, .22], [Math.PI / 2, 0, 0], C.wood);
      rotor.add(sails.mesh());
      const mount = new THREE.Group(); mount.name = 'windward-mill-rotor-mount'; mount.position.copy(f.point(0, h * .66, r * .62)); mount.rotation.y = yaw; mount.add(rotor); group.add(mount);
      rotors.push(rotor);
    } else if (kind === 'watchtower') {
      f.add('cylinder', [0, h * .37, 0], [r * .74, h * .74, r * .74], [0, 0, 0], color);
      for (let level = 1; level < 8; level++) {
        const levelY = level * h * .09;
        f.add('cylinder', [0, levelY, 0], [r * .747, .055, r * .747], [0, 0, 0], '#8e948a');
        for (let i = 0; i < 10; i++) {
          const a = i / 10 * TAU + level % 2 * .31;
          f.line([Math.sin(a) * r * .75, levelY, Math.cos(a) * r * .75], [Math.sin(a) * r * .75, levelY + h * .08, Math.cos(a) * r * .75], .025, '#8e948a');
        }
      }
      f.add('cylinder', [0, h * .755, 0], [r * .86, .35, r * .86], [0, 0, 0], C.stone);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        f.add('box', [Math.sin(a) * r * .74, h * .80, Math.cos(a) * r * .74], [.62, h * .095, .48], [0, a, 0], i % 2 ? C.stone : '#919e93');
      }
      closedDoor(f, 0, .06, r * .745, 1.05, 2.05);
      for (const t of [.36, .59]) f.add('box', [0, h * t, r * .75], [.30, .92, .08], [0, 0, 0], C.dark);
      f.line([0, h * .77, 0], [0, h * .99, 0], .065, C.wood);
      hangingFlag(f, 0, h * .965, 0, C.coral, .95, building.id === 'signal-tower' ? oldWatchFallback : group);
    } else if (kind === 'observatory') {
      f.add('cylinder', [0, h * .245, 0], [r * .77, h * .49, r * .77], [0, 0, 0], color);
      f.add('cylinder', [0, h * .48, 0], [r * .86, .23, r * .86], [0, 0, 0], C.paleWood);
      f.add(hemisphere, [0, h * .49, 0], [r * .84, h * .39, r * .84], [0, 0, 0], roofColor);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        for (let j = 0; j < 7; j++) {
          const t1 = j / 7 * Math.PI / 2, t2 = (j + 1) / 7 * Math.PI / 2;
          f.line([Math.sin(a) * Math.sin(t1) * r * .845, h * (.49 + .39 * Math.cos(t1)), Math.cos(a) * Math.sin(t1) * r * .845], [Math.sin(a) * Math.sin(t2) * r * .845, h * (.49 + .39 * Math.cos(t2)), Math.cos(a) * Math.sin(t2) * r * .845], .04, C.gold);
        }
      }
      f.add('box', [0, h * .79, r * .30], [.36, h * .22, r * .57], [-.7, 0, 0], '#375866');
      f.add('sphere', [0, h * .915, 0], [.19, .19, .19], [0, 0, 0], C.gold);
      f.line([0, h * .9, 0], [0, h * .985, 0], .035, C.gold);
      closedDoor(f, 0, .04, r * .775, 1.06, 2.25, '#615b76');
      for (const side of [-1, 1]) windowPanel(f, side * r * .57, h * .31, r * .53, .67, side * .8);
    } else if (kind === 'tent') {
      gabledRoof(f, r * 1.47, r * 1.19, .24, h * .87, roofColor);
      for (const side of [-1, 1]) {
        f.line([side * r * .7, .05, r * .58], [0, h * .89, r * .58], .075, C.wood);
        f.line([side * r * .7, .05, -r * .58], [0, h * .89, -r * .58], .075, C.wood);
      }
      closedDoor(f, 0, .05, r * .603, 1.0, h * .51, '#8c9475');
      f.add('box', [0, h * .57, r * .613], [.14, h * .51, .035], [0, 0, 0], C.cream);
    } else if (kind === 'stall') {
      const width = r * 1.43, depth = r * 1.13;
      // A closed stock cabinet fills the collider; customers gather in front.
      f.add('box', [0, h * .28, 0], [width * .85, h * .56, depth * .85], [0, 0, 0], color);
      for (const side of [-1, 1]) for (const end of [-1, 1]) f.line([side * width * .46, 0, end * depth * .44], [side * width * .46, h * .84, end * depth * .44], .09, C.wood);
      for (let i = 0; i < 6; i++) f.add('box', [(i - 2.5) * width / 6, h * .81, 0], [width / 6 + .008, .11, depth], [.11, 0, 0], i % 2 ? C.cream : roofColor);
      for (let i = 0; i < 6; i++) f.add('box', [(i - 2.5) * width / 6, h * .735, depth * .49], [width / 6 + .008, .35, .07], [0, 0, 0], i % 2 ? C.cream : roofColor);
      f.add('box', [0, h * .55, depth * .30], [width * .90, .12, depth * .45], [0, 0, 0], C.paleWood);
      for (let i = 0; i < 12; i++) {
        const xx = (i % 6 - 2.5) * width * .13, zz = depth * (.24 + Math.floor(i / 6) * .14);
        f.add('sphere', [xx, h * .615, zz], [.16, .17, .16], [0, 0, 0], building.id === 'fruit-stall' ? ['#e89a53', '#b6c86e', '#e7ce78'][i % 3] : ['#cbdce1', '#f1d797', '#8abeba'][i % 3]);
      }
      f.add('box', [0, h * .30, depth * .43], [width * .65, .48, .05], [0, 0, 0], roofColor);
    }
    let visualRadius = 0, visualHeight = 0;
    for (let index = firstVertex; index < sourceBatch.positions.length; index += 3) {
      visualRadius = Math.max(visualRadius, Math.hypot(sourceBatch.positions[index] - x, sourceBatch.positions[index + 2] - z));
      visualHeight = Math.max(visualHeight, sourceBatch.positions[index + 1] - ground);
    }
    buildingBounds.push({ id: building.id, radius: visualRadius, height: visualHeight });
  }
  hemisphere.dispose();

  function clearForProp(x, z, radius) {
    if (heightAt(x, z) < 1.7 || trailDistance(x, z) < 2.8 + radius) return false;
    if ([SPAWN, BEACON, ...SHRINES].some(p => Math.hypot(x - p.x, z - p.z) < 11 + radius)) return false;
    if (OBSTACLES.some(o => Math.hypot(x - o.x, z - o.z) < o.radius + radius + .35)) return false;
    if (CHESTS.some(p => Math.hypot(x - p.x, z - p.z) < 2.3 + radius)) return false;
    for (const building of BUILDINGS.filter(b => b.enterable)) {
      const local = buildingLocalPoint(building, x, z);
      if (Math.abs(local.x) < building.doorWidth / 2 + radius + .5 && Math.abs(local.z) < building.depth / 2 + radius + 3) return false;
    }
    if (occupied.some(p => Math.hypot(x - p.x, z - p.z) < p.radius + radius + .45)) return false;
    for (const person of RESIDENTS) for (let i = 0; i < person.route.length; i++) {
      if (distanceToSegment(x, z, person.route[i], person.route[(i + 1) % person.route.length]) < radius + .95) return false;
    }
    return true;
  }

  function site(place, dx, dz, radius, build, yaw = 0, prefab = null) {
    for (let attempt = 0; attempt < 90; attempt++) {
      const angle = attempt * 2.39996, search = attempt ? .7 * Math.sqrt(attempt) : 0;
      const x = place.x + dx + Math.sin(angle) * search, z = place.z + dz + Math.cos(angle) * search;
      if (Math.hypot(x - place.x, z - place.z) > place.radius + 2 - radius || Math.hypot(x - place.x, z - place.z) < 3.0 + radius || !clearForProp(x, z, radius)) continue;
      const y = heightAt(x, z);
      const slope = Math.max(...[0, 1, 2, 3].map(i => Math.abs(heightAt(x + Math.sin(i * Math.PI / 2) * radius, z + Math.cos(i * Math.PI / 2) * radius) - y)));
      if (slope > .7) continue;
      const source = prefab ? new GeoBatch(palette) : batches.get(place.id);
      build(frame(source, x, y, z, yaw), x, y, z);
      if (prefab) { const mesh = source.mesh(); mesh.name = 'old-watch-original-' + prefab; oldWatchFallback.add(mesh); }
      occupied.push({ x, z, radius }); propSites.push({ poiId: place.id, x, z, radius, ...(prefab ? { prefab, yaw } : {}) }); stats.propClusters++;
      return true;
    }
    return false;
  }

  function table(f) {
    f.add('cylinder', [0, .93, 0], [1.03, .15, 1.03], [0, 0, 0], C.paleWood);
    f.add('cylinder', [0, .43, 0], [.18, .86, .18], [0, 0, 0], C.wood);
    for (const side of [-1, 1]) {
      f.add('box', [side * 1.26, .50, 0], [.40, .12, 1.44], [0, 0, 0], C.wood);
      for (const end of [-1, 1]) f.add('box', [side * 1.26, .24, end * .5], [.13, .48, .13], [0, 0, 0], C.paleWood);
      f.add('cylinder', [side * .4, 1.13, 0], [.13, .25, .13], [0, 0, 0], C.cream);
    }
  }

  function telescope(f) {
    for (let i = 0; i < 3; i++) {
      const a = i / 3 * TAU;
      f.line([Math.sin(a) * .75, 0, Math.cos(a) * .75], [0, 1.42, 0], .065, C.wood);
    }
    f.line([0, 1.47, .33], [0, 2.04, -1.05], .17, C.gold);
    f.add('cylinder', [0, 2.02, -1.01], [.23, .16, .23], [1.18, 0, 0], C.dark);
    f.add('cylinder', [0, 2.065, -1.095], [.17, .018, .17], [1.18, 0, 0], '#8cbec6');
  }

  for (const place of POINTS_OF_INTEREST) {
    if (place.kind === 'harbor') {
      site(place, -12, 6, 1.9, table, .25);
      site(place, -1, 9, 1.3, f => { barrel(f, -.55, .1); barrel(f, .45, -.2, .85); crate(f, .40, .7, .65); });
      site(place, 1, -9, 1.7, f => {
        for (const side of [-1, 1]) f.line([side * 1.4, 0, 0], [side * 1.4, 2.7, 0], .07, C.wood);
        for (let i = 0; i < 9; i++) f.line([-1.32 + i * .33, .45, .06], [-1.32 + i * .33, 2.3, 0], .018, C.cream);
        for (let i = 0; i < 7; i++) f.line([-1.4, .45 + i * .30, .03], [1.4, .45 + i * .30, .03], .018, C.cream);
        barrel(f, 0, .5, .7);
      });
    } else if (place.kind === 'market') {
      site(place, -4, -11, 1.8, f => {
        f.add('box', [0, .67, 0], [2.5, .18, 1.16], [0, 0, 0], C.paleWood);
        for (const side of [-1, 1]) for (const end of [-1, 1]) f.add('box', [side, .31, end * .43], [.12, .62, .12], [0, 0, 0], C.wood);
        for (let i = 0; i < 9; i++) f.add('sphere', [(i % 3 - 1) * .58, .93, (Math.floor(i / 3) - 1) * .29], [.23, .25, .23], [0, 0, 0], ['#edba5e', '#dc8660', '#91ab6f'][i % 3]);
        crate(f, 1.25, .42, .63);
      });
      site(place, -13, 8, 1.25, f => { barrel(f, -.5, 0, .8); crate(f, .4, 0); crate(f, .4, 0, .65, .84); });
      site(place, 2, -12, 1.2, f => { f.line([0, 0, 0], [0, 3.4, 0], .08, C.wood); f.line([0, 3.4, 0], [1.04, 3.4, 0], .055, C.wood); hangingFlag(f, 0, 3.3, 0, C.teal, 1); });
    } else if (place.kind === 'farm') {
      site(place, 8, 1, 4.0, (f, x, y, z) => {
        for (let row = 0; row < 4; row++) for (let i = 0; i < 7; i++) {
          const xx = x + (row - 1.5) * 1.25, zz = z + (i - 3) * .85, yy = heightAt(xx, zz);
          const plant = frame(batches.get(place.id), xx, yy, zz);
          plant.add('sphere', [0, .025, 0], [.40, .08, .4], [0, 0, 0], '#9a7751');
          plant.line([0, .04, 0], [0, .70 + row % 2 * .14, 0], .035, '#839f5a');
          for (const side of [-1, 1]) plant.add('sphere', [side * .14, .39, 0], [.26, .08, .10], [0, 0, side * .5], '#76ac68');
          plant.add('sphere', [0, .73 + row % 2 * .14, 0], [.12, .20, .13], [0, 0, 0], '#dfc872');
        }
      });
      site(place, -7, -10, 1.9, f => {
        for (const side of [-1, 1]) f.add('cylinder', [side * .67, .55, 0], [.55, 1.2, .55], [Math.PI / 2, 0, 0], '#d1bc77');
        f.add('cylinder', [0, 1.42, 0], [.52, 1.2, .52], [Math.PI / 2, 0, 0], '#ddc780');
        for (const z of [-.4, .4]) f.add('box', [0, .86, z], [2.3, .065, .065], [0, 0, 0], '#a8965c');
      });
      // Short terrain-following sections suggest a field boundary, with generous
      // gaps wherever a trail, worker route, building or chest passes through it.
      for (let i = 0; i < 7; i++) {
        const x = place.x - 7 + i * 2.3, z = place.z + 9.7;
        if (!clearForProp(x, z, 1.2)) continue;
        const aY = heightAt(x - 1, z), bY = heightAt(x + 1, z), b = batches.get(place.id);
        for (const [px, py] of [[x - 1, aY], [x + 1, bY]]) b.line([px, py, z], [px, py + 1.05, z], .065, C.wood);
        for (const h of [.43, .86]) b.line([x - 1, aY + h, z], [x + 1, bY + h, z], .055, C.paleWood);
      }
    } else if (place.kind === 'ruins') {
      site(place, -8, -1, 2.5, f => {
        for (let i = 0; i < 5; i++) {
          const h = [1.2, 1.7, 1.55, .85, .45][i];
          f.add('box', [(i - 2) * .83, h / 2, 0], [.79, h, .64], [0, 0, i * .012], i % 2 ? '#a7ad9a' : '#909b8e');
          f.add('sphere', [(i - 2) * .83, h + .02, 0], [.40, .08, .34], [0, 0, 0], '#7b9b6d');
        }
        for (let i = 0; i < 4; i++) f.add('pebble', [-1 + i * .64, .23, .8 + i % 2 * .3], [.38, .31, .32], [.1, i, .2], C.stone);
      }, 0, place.id === 'old-watch' ? 'ruin_wall' : null);
      site(place, 5, -10, 1.25, telescope, -.4);
    } else if (place.kind === 'camp') {
      site(place, -6, -3, 1.7, f => {
        for (let i = 0; i < 8; i++) { const a = i / 8 * TAU; f.add('pebble', [Math.sin(a) * .67, .18, Math.cos(a) * .67], [.26, .22, .25], [0, a, 0], C.stone); }
        for (const side of [-1, 1]) f.line([side * .45, .13, -.4], [-side * .45, .13, .4], .11, '#685343');
        f.add('cone', [0, .38, 0], [.3, .53, .3], [0, 0, 0], '#dfaa65');
        for (const side of [-1, 1]) f.line([side * 1.1, .3, -1.2], [side * 1.1, .3, 1.2], .22, C.wood);
      });
      site(place, -5, 7, 1.7, f => { crate(f, -.6, 0); barrel(f, .6, .1, .8); f.line([-1.2, 0, -.6], [-1.2, 3.0, -.6], .07, C.wood); hangingFlag(f, -1.2, 2.85, -.6, C.coral, 1.0); });
    } else if (place.kind === 'forge') {
      site(place, -1, 3, 1.6, f => {
        f.add('cylinder', [0, .31, 0], [.63, .62, .63], [0, 0, 0], C.wood);
        f.add('box', [0, .70, 0], [.48, .40, .45], [0, 0, 0], C.metal);
        f.add('box', [0, .94, 0], [1.08, .20, .58], [0, 0, 0], '#718087');
        f.add('cone', [.66, .95, 0], [.22, .68, .22], [0, 0, -Math.PI / 2], '#718087');
        f.line([-.56, 1.07, -.08], [.16, 1.09, .13], .047, C.wood);
        f.add('box', [-.53, 1.13, -.08], [.18, .19, .37], [0, -.15, 0], C.metal);
        barrel(f, -.90, .77, .75);
      });
      site(place, 7, -1, 1.7, f => {
        for (let i = 0; i < 8; i++) f.add('pebble', [(i % 3 - 1) * .55, .25 + Math.floor(i / 3) * .2, (Math.floor(i / 3) - 1) * .47], [.43, .34, .4], [.2, i, 0], i % 3 ? '#625e5c' : '#b57e57');
        crate(f, 1.0, .45, .6);
      });
    } else if (place.kind === 'observatory') {
      site(place, -3, -8, 1.4, telescope, -.75);
      site(place, 0, 9, 2.0, f => {
        f.add('cylinder', [0, .34, 0], [1.65, .68, 1.65], [0, 0, 0], '#aaaabd');
        f.add('cylinder', [0, .71, 0], [1.62, .10, 1.62], [0, 0, 0], '#527b89');
        f.add('ring', [0, .78, 0], [1.32, 1.32, 1.32], [Math.PI / 2, 0, 0], C.gold);
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * TAU;
          f.line([Math.sin(a) * .43, .79, Math.cos(a) * .43], [Math.sin(a) * 1.40, .79, Math.cos(a) * 1.40], .027, C.cream);
        }
        f.add('cone', [0, 1.04, 0], [.17, .56, .17], [0, 0, -.22], C.gold);
      });
      site(place, -8, 3, 1.1, f => { crate(f, 0, 0, .9); f.add('box', [0, .88, 0], [.65, .1, .49], [0, .16, 0], '#ab99c1'); f.add('box', [.12, 1.0, .08], [.55, .09, .42], [0, -.12, 0], C.cream); });
    } else if (place.kind === 'boatyard') {
      site(place, 10, 2, 3.5, f => {
        // Open ribs, keel and a few fitted strakes make a visibly unfinished hull.
        f.line([0, .55, -3], [0, .55, 3], .14, C.wood);
        for (let i = 0; i < 7; i++) {
          const z = (i - 3) * .8, width = 1.35 * Math.sqrt(1 - (z / 3.3) ** 2);
          for (const side of [-1, 1]) {
            f.line([0, .58, z], [side * width * .75, .88, z], .075, C.paleWood);
            f.line([side * width * .75, .88, z], [side * width, 1.65, z], .075, C.paleWood);
          }
        }
        for (const side of [-1, 1]) {
          for (let i = 0; i < 6; i++) {
            const z1 = (i - 3) * .8, z2 = (i - 2) * .8;
            const w1 = Math.sqrt(1 - (z1 / 3.3) ** 2), w2 = Math.sqrt(1 - (z2 / 3.3) ** 2);
            f.line([side * w1 * 1.35, 1.65, z1], [side * w2 * 1.35, 1.65, z2], .09, C.wood);
            f.line([side * w1, .92, z1], [side * w2, .92, z2], .12, C.paleWood);
          }
        }
        for (const z of [-1.6, 1.6]) { f.add('box', [0, .3, z], [2.7, .17, .24], [0, 0, 0], C.wood); for (const side of [-1, 1]) f.add('box', [side * 1.15, .16, z], [.18, .32, .28], [0, 0, 0], C.wood); }
      }, .3);
      site(place, 2, -10, 2.0, f => {
        for (let i = 0; i < 9; i++) f.add('box', [(i % 3 - 1) * .37, .13 + Math.floor(i / 3) * .22, 0], [.32, .19, 3.5], [0, i % 2 * .025, 0], i % 2 ? C.wood : C.paleWood);
        for (const z of [-1.2, 1.2]) f.add('box', [0, .74, z], [1.15, .07, .10], [0, 0, 0], C.dark);
      });
    }
    // Every destination has a modest lantern marker visible from its approach.
    site(place, 5, 5, .55, f => {
      f.line([0, 0, 0], [0, 2.7, 0], .065, C.wood);
      f.add('box', [0, 2.33, 0], [.40, .53, .4], [0, .3, 0], C.cream);
      f.add('cone', [0, 2.67, 0], [.35, .25, .35], [0, 0, 0], C.teal);
      for (const y of [2.06, 2.60]) f.add('box', [0, y, 0], [.44, .07, .44], [0, .3, 0], C.wood);
    }, 0, place.id === 'old-watch' ? 'lantern' : null);
  }

  for (const place of POINTS_OF_INTEREST) {
    const mesh = batches.get(place.id).mesh(); mesh.name = place.id + '-architecture-and-work-sites'; group.add(mesh);
  }
  const towerFallbackMesh = oldWatchTower.mesh(); towerFallbackMesh.name = 'signal-tower-original'; oldWatchFallback.add(towerFallbackMesh);

  // Fishing skiffs lie beyond the actual scalloped shoreline, at sea level.
  for (let i = 0; i < 2; i++) {
    const b = new GeoBatch(palette), boat = new THREE.Group(); boat.name = 'saltwind-fishing-skiff-' + i;
    for (let j = 0; j < 7; j++) {
      const z = (j - 3) * .60, width = .88 * Math.sqrt(Math.max(.08, 1 - (z / 2.0) ** 2));
      b.add('box', [0, .17, z], [width * 2, .16, .63], [0, 0, 0], C.wood);
      for (const side of [-1, 1]) b.add('box', [side * width, .4, z], [.10, .48, .67], [0, 0, side * -.20], i ? C.coral : C.teal);
    }
    for (const z of [-.9, .5]) b.add('box', [0, .50, z], [1.55, .10, .27], [0, 0, 0], C.paleWood);
    b.line([0, .3, -.45], [0, 3.4, -.45], .06, C.wood);
    const sail = new THREE.BufferGeometry(); sail.setAttribute('position', new THREE.Float32BufferAttribute([.06, 3.2, -.45, .06, 1.2, -.45, 1.20, 1.2, -.45], 3)); sail.computeVertexNormals();
    b.add(sail, [0, 0, 0], [1, 1, 1], [0, 0, 0], C.cream); sail.dispose();
    b.line([-1.1, .55, -.8], [1.1, .55, 1.05], .045, C.paleWood);
    boat.add(b.mesh());
    const x = -17 - i * 9; let z = 117;
    while (heightAt(x, z) > -.25 && z < 155) z += .5;
    boat.position.set(x, 0, z + 2 + i); boat.rotation.y = -.5 + i * .8; group.add(boat);
    boats.push({ group: boat, x, z: boat.position.z, yaw: boat.rotation.y, phase: i * 2.8 });
  }
  stats.boats = boats.length;

  const smokeGeometry = new THREE.IcosahedronGeometry(1, 0);
  const smokeMaterial = new THREE.MeshBasicMaterial({ color: '#e2d8c5', transparent: true, opacity: .25, depthWrite: false });
  const smoke = new THREE.InstancedMesh(smokeGeometry, smokeMaterial, chimneys.length * 4); smoke.name = 'settlement-chimney-smoke'; smoke.frustumCulled = false; group.add(smoke);
  const residents = buildResidents(palette, group);
  const transform = new THREE.Object3D();
  let lastAmbientTick = -Infinity, lastLowQuality = false, lastReducedMotion = false;
  function animate(time, { lowQuality = false, reducedMotion = false, player = null, camera = null } = {}) {
    const t = Number.isFinite(time) ? time : 0, decorativeTime = reducedMotion ? 0 : t;
    for (const interior of interiors) {
      const local = player && buildingLocalPoint(interior.building, player.x, player.z);
      const cutawayHeight = player?.mode === 'gliding' ? interior.building.height + 2 : interior.building.wallHeight;
      const inside = local && Math.abs(local.x) < interior.building.width / 2 + .15 && Math.abs(local.z) < interior.building.depth / 2 + .8 && player.y < heightAt(interior.building.x, interior.building.z) + cutawayHeight;
      // Keep the opposite walls and windows as a room backdrop while opening
      // only the camera-facing walls. Low perimeter walls always show cover.
      interior.roof.visible = !inside;
      const cameraPosition = camera?.position ?? camera;
      const view = inside && buildingLocalPoint(interior.building,
        Number.isFinite(cameraPosition?.x) ? cameraPosition.x : player.x + Math.sin(player.yaw || 0) * 6,
        Number.isFinite(cameraPosition?.z) ? cameraPosition.z : player.z + Math.cos(player.yaw || 0) * 6);
      for (const face of interior.walls.children) {
        const normal = face.userData.normal;
        face.visible = !inside || normal.x * view.x + normal.z * view.z <= .05;
      }
    }
    // Work pauses and walks are sampled from absolute time, independent of FPS.
    const tick = Math.floor(t * (lowQuality ? 15 : 30));
    if (tick === lastAmbientTick && lowQuality === lastLowQuality && reducedMotion === lastReducedMotion) return;
    lastAmbientTick = tick; lastLowQuality = lowQuality; lastReducedMotion = reducedMotion;
    for (const rotor of rotors) rotor.rotation.z = .31 + decorativeTime * .21;
    for (const flag of pennants) { flag.pivot.rotation.y = -.35 + Math.sin(decorativeTime * 1.4 + flag.phase) * .13; flag.pivot.rotation.x = Math.sin(decorativeTime * 1.9 + flag.phase) * .045; }
    for (const boat of boats) {
      boat.group.position.y = Math.sin(boat.x * .028 + decorativeTime * .6) * .12 + Math.cos(boat.z * .031 - decorativeTime * .48) * .08;
      boat.group.rotation.set(Math.sin(decorativeTime * .7 + boat.phase) * .025, boat.yaw, Math.sin(decorativeTime * .85 + boat.phase) * .045);
    }
    for (let i = 0; i < chimneys.length; i++) for (let j = 0; j < 4; j++) {
      const u = (decorativeTime * .14 + j / 4 + i * .21) % 1, source = chimneys[i];
      transform.position.set(source.x + u * 1.25, source.y + u * 3, source.z + Math.sin(u * 5 + i) * .18);
      transform.rotation.set(u, u * 2, 0); transform.scale.setScalar((.23 + u * .6) * Math.sin(u * Math.PI)); transform.updateMatrix();
      smoke.setMatrixAt(i * 4 + j, transform.matrix);
    }
    smoke.instanceMatrix.needsUpdate = true; smoke.visible = !lowQuality;
    residents.animate(reducedMotion ? 0 : t);
  }
  group.userData.propSites = propSites; group.userData.buildingBounds = buildingBounds;
  animate(0);
  return { group, animate, stats, setOldWatchKit(kit = null) {
    const interior = interiors.find(item => item.building.id === 'watch-barracks');
    interior.walls = kit?.walls ?? interior.originalWalls;
    interior.roof = kit?.roof ?? interior.originalRoof;
    oldWatchFallback.visible = !kit;
  } };
}

function buildResidents(palette, parent) {
  const actors = [], limb = new GeoBatch(palette), arm = new GeoBatch(palette);
  limb.add('box', [0, -.29, 0], [.19, .58, .22], [0, 0, 0], '#596a71');
  limb.add('box', [0, -.60, .06], [.22, .17, .36], [0, 0, 0], '#675442');
  arm.add('cylinder', [0, -.18, 0], [.12, .38, .12], [0, 0, 0], '#e8d7b7');
  arm.add('sphere', [0, -.44, 0], [.10, .18, .11], [0, 0, 0], '#cc996e');
  const legs = new THREE.InstancedMesh(limb.mesh().geometry, palette.solid, RESIDENTS.length * 2);
  const arms = new THREE.InstancedMesh(arm.mesh().geometry, palette.solid, RESIDENTS.length * 2);
  legs.name = 'residents-walking-legs'; arms.name = 'residents-working-arms';
  legs.castShadow = arms.castShadow = true; legs.frustumCulled = arms.frustumCulled = false; parent.add(legs, arms);
  for (let i = 0; i < RESIDENTS.length; i++) {
    const person = RESIDENTS[i], b = new GeoBatch(palette), body = new THREE.Group(); body.name = 'resident-' + person.id;
    const skin = ['#c89166', '#d7a378', '#ab7857'][i % 3];
    b.add('sphere', [0, 1.02, 0], [.31, .42, .23], [0, 0, 0], person.color);
    b.add('box', [0, 1.04, .22], [.31, .5, .03], [0, 0, 0], person.role === 'smith' || person.role === 'shipwright' ? '#725744' : '#f0dfba');
    b.add('cylinder', [0, .77, 0], [.27, .11, .22], [0, 0, 0], C.wood);
    b.add('sphere', [0, 1.60, 0], [.25, .30, .235], [0, 0, 0], skin);
    b.add('sphere', [0, 1.77, -.035], [.255, .15, .22], [0, 0, 0], '#665242');
    b.add('sphere', [0, 1.59, .235], [.064, .074, .064], [0, 0, 0], skin);
    for (const side of [-1, 1]) b.add('sphere', [side * .08, 1.65, .214], [.025, .036, .025], [0, 0, 0], '#394c4d');
    const broadHat = person.role === 'farmer' || person.role === 'fisher';
    b.add('cylinder', [0, 1.86, 0], [broadHat ? .40 : .28, .075, broadHat ? .34 : .25], [0, 0, 0], broadHat ? '#d6bd7c' : person.color);
    b.add('cylinder', [0, 1.96, 0], [.23, .18, .215], [0, 0, 0], broadHat ? '#c5a569' : person.color);
    b.add('cylinder', [0, 1.91, 0], [.24, .035, .225], [0, 0, 0], C.wood);
    if (person.role === 'fisher' || person.role === 'merchant') {
      b.add('cylinder', [.40, .80, .18], [.20, .34, .20], [0, 0, 0], C.paleWood);
      b.add('ring', [.40, 1.01, .18], [.19, .22, .19], [0, 0, 0], C.wood);
    } else if (person.role === 'scholar') {
      b.add('box', [0, 1.11, .33], [.46, .07, .36], [.12, 0, 0], '#a99ac4');
      b.add('box', [0, 1.16, .33], [.41, .025, .31], [.12, 0, 0], C.cream);
    } else if (person.role === 'farmer') {
      b.line([-.39, .1, -.10], [-.39, 1.60, -.10], .03, C.wood);
      b.add('box', [-.39, .10, -.05], [.37, .09, .11], [0, 0, 0], C.metal);
    } else if (person.role === 'shipwright' || person.role === 'smith') {
      b.add('box', [.41, .96, .12], [.07, .51, .08], [0, 0, -.22], C.paleWood);
      b.add('box', [.46, 1.18, .12], [.31, .16, .16], [0, 0, 0], person.role === 'smith' ? C.metal : C.wood);
    } else if (person.role === 'lookout') {
      b.add('cylinder', [.35, 1.13, .18], [.07, .39, .07], [1.35, 0, -.25], C.gold);
    }
    body.add(b.mesh()); parent.add(body);
    const segments = person.route.map((a, index) => {
      const b = person.route[(index + 1) % person.route.length];
      return { a, b, travel: Math.hypot(b.x - a.x, b.z - a.z) / .78, pause: 2.8 + index * .35 };
    });
    actors.push({ person, body, segments, duration: segments.reduce((total, s) => total + s.travel + s.pause, 0) });
  }
  const local = new THREE.Object3D(), matrix = new THREE.Matrix4();
  return { animate(time) {
    for (let i = 0; i < actors.length; i++) {
      const actor = actors[i]; let clock = (time + actor.person.phase * actor.duration) % actor.duration, segment = actor.segments[0];
      for (const part of actor.segments) { segment = part; if (clock < part.travel + part.pause) break; clock -= part.travel + part.pause; }
      const moving = clock > segment.pause, t = moving ? Math.min(1, (clock - segment.pause) / segment.travel) : 0;
      const x = segment.a.x + (segment.b.x - segment.a.x) * t, z = segment.a.z + (segment.b.z - segment.a.z) * t;
      const gait = moving ? Math.sin((clock - segment.pause) * 5.5) * .36 : 0;
      actor.body.position.set(x, heightAt(x, z) + (moving ? Math.abs(gait) * .06 : 0), z);
      actor.body.rotation.y = Math.atan2(segment.b.x - segment.a.x, segment.b.z - segment.a.z); actor.body.updateMatrix();
      for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
        const side = sideIndex ? 1 : -1, index = i * 2 + sideIndex;
        local.position.set(side * .15, .68, 0); local.rotation.set(side * gait, 0, 0); local.updateMatrix(); matrix.multiplyMatrices(actor.body.matrix, local.matrix); legs.setMatrixAt(index, matrix);
        local.position.set(side * .31, 1.24, 0);
        local.rotation.set(moving ? -side * gait * .7 : -.28 + Math.sin(clock * 2.2 + i) * .08, 0, side * .08);
        local.updateMatrix(); matrix.multiplyMatrices(actor.body.matrix, local.matrix); arms.setMatrixAt(index, matrix);
      }
    }
    legs.instanceMatrix.needsUpdate = true; arms.instanceMatrix.needsUpdate = true;
  } };
}
