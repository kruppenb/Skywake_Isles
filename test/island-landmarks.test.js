import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { SHRINES, SPAWN, BEACON, heightAt, seededRandom, SEED } from '../shared/world.js';
import { POINTS_OF_INTEREST, trailDistance } from '../shared/exploration.js';
import { ISLAND_SHRINE_ANCHORS, ISLAND_LANDMARK_ANCHORS, ISLAND_LANDMARK_NOMINALS, ISLAND_LANDMARK_COUNTS,
  ISLAND_LANDMARK_TOTAL, MOON_GATE_APERTURE_RADIUS } from '../shared/island.js';
import { ISLAND_LANDMARK_PREFABS } from '../client/island.js';
import { disposeOwnedResources } from '../client/environment-assets.js';
import { makePalette } from '../client/models.js';

const TAU = Math.PI * 2;
// A standing pirate clears about two metres, so anything an approach has to stay
// walkable under is measured below this height above the terrain.
const HEAD_CLEARANCE = 2.2;
const palm = SHRINES.find(shrine => shrine.id === 'palm'), moon = SHRINES.find(shrine => shrine.id === 'moon');
const ember = SHRINES.find(shrine => shrine.id === 'ember');

async function scenery() {
  const { buildScenery } = await import('../client/world.js');
  const random = seededRandom(SEED); for (let i = 0; i < 800; i++) random(); // preceding ocean construction
  const palette = makePalette();
  return { palette, random, ...buildScenery(palette, random) };
}
function releaseScenery({ group, palette }) {
  disposeOwnedResources(group);
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
}
// buildScenery is the expensive part of this file, so one pass feeds every test.
let cachedScenery = null;
async function recorded() {
  if (!cachedScenery) {
    const built = await scenery();
    cachedScenery = {
      sites: built.landmarkSites, fallback: built.landmarkFallback,
      solid: built.landmarkLegacyScenery, glow: built.landmarkLegacyGlow,
      group: built.group, next: built.random(), volcano: built.volcano, moon: built.moon,
      originals: [built.landmarkLegacyScenery, built.landmarkLegacyGlow].map(mesh => mesh.geometry.attributes.position.clone()),
      built,
    };
  }
  return cachedScenery;
}
let cachedKit = null;
async function kit() {
  if (!cachedKit) {
    const bytes = await readFile(new URL('../client/assets/island/kit.glb', import.meta.url));
    const gltf = await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '');
    gltf.scene.updateMatrixWorld(true);
    const manifest = JSON.parse(await readFile(new URL('../client/assets/island/manifest.json', import.meta.url), 'utf8'));
    cachedKit = { scene: gltf.scene, manifest, locals: new Map() };
  }
  return cachedKit;
}
// Authored vertices of one root, in its own local frame with the source child
// matrices already applied.
async function localVertices(name) {
  const loaded = await kit();
  if (!loaded.locals.has(name)) {
    const points = [], root = loaded.scene.getObjectByName(name);
    assert.ok(root, name + ' is exported');
    root.traverse(object => {
      if (!object.isMesh) return;
      const positions = object.geometry.attributes.position;
      for (let i = 0; i < positions.count; i++) points.push(new THREE.Vector3().fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld));
    });
    loaded.locals.set(name, points);
  }
  return loaded.locals.get(name);
}
async function localTriangles(name, slot = null) {
  const loaded = await kit(), out = [];
  loaded.scene.getObjectByName(name).traverse(object => {
    if (!object.isMesh || (slot && object.material.name !== slot)) return;
    const positions = object.geometry.attributes.position, index = object.geometry.index;
    const count = index ? index.count : positions.count;
    for (let i = 0; i < count; i += 3) {
      out.push([0, 1, 2].map(k => new THREE.Vector3()
        .fromBufferAttribute(positions, index ? index.getX(i + k) : i + k).applyMatrix4(object.matrixWorld)));
    }
  });
  return out;
}
// The world-space vertices one recorded descriptor installs.
async function worldVertices(site) {
  const transform = new THREE.Object3D();
  transform.position.set(site.x, site.y, site.z);
  transform.rotation.set(site.rotation[0], site.rotation[1], site.rotation[2]);
  transform.scale.set(site.scale[0], site.scale[1], site.scale[2]);
  transform.updateMatrix();
  return (await localVertices(site.prefab)).map(point => point.clone().applyMatrix4(transform.matrix));
}
// The same route metric buildScenery filters with, rebuilt here from the shared
// trail and beacon spokes rather than imported from the module under test.
const WAYPOINTS = [SPAWN, ...SHRINES];
function segmentDistance(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}
const routeDistance = (x, z) => Math.min(trailDistance(x, z), ...WAYPOINTS.map(point => segmentDistance(x, z, BEACON, point)));
const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, label + ': ' + actual + ' vs ' + expected);
const triangleArea = ([a, b, c]) =>
  new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).length() / 2;
// How wide a strip is: its smallest altitude, twice the area over its longest
// edge. A facet painted whole is wide; an authored fissure is not.
function triangleWidth(triangle) {
  const [a, b, c] = triangle;
  const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
  return longest ? 2 * triangleArea(triangle) / longest : 0;
}
// Minimum distance from the ring's local-XY origin to a filled projected
// triangle; zero when the origin falls inside one, so a slab across the doorway
// can never pass on its vertex radii alone. A triangle that projects to no area
// is a sliver, never a cover, so the same-sign containment test only applies
// once there is an area to be inside of - otherwise a collinear sliver lying
// well outside the ring would read as a blocked doorway. A sliver that does
// cross the origin still measures zero on its own edges.
function projectedApertureRadius(triangles) {
  let minimum = Infinity;
  for (const triangle of triangles) {
    const [a, b, c] = triangle.map(point => ({ x: point.x, y: point.y }));
    const cross = (p, q) => (q.x - p.x) * -p.y - (q.y - p.y) * -p.x;
    const d1 = cross(a, b), d2 = cross(b, c), d3 = cross(c, a);
    const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
    if (Math.abs(area) > 1e-12 && !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0))) return 0;
    for (const [p, q] of [[a, b], [b, c], [c, a]]) {
      const dx = q.x - p.x, dy = q.y - p.y, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, -(p.x * dx + p.y * dy) / length)) : 0;
      minimum = Math.min(minimum, Math.hypot(p.x + t * dx, p.y + t * dy));
    }
  }
  return minimum;
}

test('the aperture measure reads filled triangles, not vertex radii or slivers', () => {
  const polar = (angle, radius) => new THREE.Vector3(Math.cos(angle) * radius, Math.sin(angle) * radius, 0);
  // An exactly collinear sliver lying wholly outside the ring projects to no
  // area, so every cross product is zero and only the projected-area guard keeps
  // it from reading as a cover over the doorway; it is measured by its edges.
  const sliver = [new THREE.Vector3(3.5, 0, 0), new THREE.Vector3(3.6, 0, 0), new THREE.Vector3(3.7, 0, 0)];
  assert.equal(projectedApertureRadius([sliver]).toFixed(4), '3.5000');
  // A real slab across the doorway reads as blocked however its vertices sit.
  assert.equal(projectedApertureRadius([[new THREE.Vector3(-5, -5, 0), new THREE.Vector3(5, -5, 0), new THREE.Vector3(0, 5, 0)]]), 0);
  // Every vertex of this chord sits at 3.6, but the filled edge cuts to 3.118,
  // which is exactly the case a vertex-radius check would wave through.
  const chord = projectedApertureRadius([[polar(0, 3.6), polar(Math.PI / 3, 3.6), polar(Math.PI / 6, 4.3)]]);
  assert.equal(chord.toFixed(4), (3.6 * Math.cos(Math.PI / 6)).toFixed(4));
  assert.ok(chord < MOON_GATE_APERTURE_RADIUS, 'a 60 degree chord at 3.6 m is not a safe aperture: ' + chord);
  // The authored 24-segment inner face clears the contract on the same measure.
  const face = projectedApertureRadius([[polar(0, 3.56), polar(Math.PI / 12, 3.56), polar(0, 4.28)]]);
  assert.equal(face.toFixed(4), (3.56 * Math.cos(Math.PI / 24)).toFixed(4));
  assert.ok(face >= MOON_GATE_APERTURE_RADIUS, 'the shipped inner face clears the aperture: ' + face);
});

test('buildScenery records one descriptor per original shrine draw and keeps both fallbacks together', async () => {
  const built = await recorded();
  assert.equal(built.sites.length, ISLAND_LANDMARK_TOTAL); assert.equal(built.sites.length, 50);
  assert.equal(new Set(built.sites.map(site => site.id)).size, 50, 'every descriptor has its own stable id');
  const counts = {};
  for (const site of built.sites) counts[site.kind] = (counts[site.kind] ?? 0) + 1;
  assert.deepEqual(counts, ISLAND_LANDMARK_COUNTS);
  for (const site of built.sites) {
    assert.ok(ISLAND_LANDMARK_PREFABS.includes(site.prefab), site.id + ' names an authored root');
    assert.ok(Object.hasOwn(ISLAND_LANDMARK_COUNTS, site.kind), site.id + ' names a counted kind');
    assert.equal(site.rotation.length, 3); assert.equal(site.scale.length, 3);
    for (const value of [site.x, site.y, site.z, ...site.rotation, ...site.scale]) assert.ok(Number.isFinite(value), site.id);
    for (const value of site.scale) assert.ok(value > 0, site.id + ' scale');
  }
  // The routing only moves draws between batches: the RNG stream is untouched.
  assert.equal(built.next, .017430383479222655);
  // One fallback group, one parent per mesh: the luminous batch moved whole
  // instead of being split or drawn twice.
  assert.equal(built.fallback.name, 'island-shrines-original-scenery');
  assert.deepEqual(built.fallback.children.map(child => child.name), ['island-shrines-original-solid', 'island-shrines-original-glow']);
  assert.equal(built.solid.parent, built.fallback); assert.equal(built.glow.parent, built.fallback);
  assert.equal(built.fallback.visible, true); assert.equal(built.solid.visible, true); assert.equal(built.glow.visible, true);
  assert.equal(built.glow.castShadow, false, 'the original glow draws never cast a shadow');
  assert.equal(built.solid.castShadow, true);
  assert.ok(built.solid.geometry.attributes.position.count > 0); assert.ok(built.glow.geometry.attributes.position.count > 0);
  assert.equal(built.group.getObjectByName('island-shrines-original-scenery'), built.fallback);
  assert.equal(built.group.userData.landmarkSites, built.sites);
  let parents = 0, lights = 0;
  built.group.traverse(object => {
    if (object === built.solid || object === built.glow) parents++;
    if (object.isLight) lights++;
  });
  assert.equal(parents, 2, 'neither original shrine mesh is drawn twice');
  assert.equal(lights, 0, 'the shrine slice adds no scene light');
  // Every recorded site has original shrine geometry standing over it, and the
  // fallback carries nothing else: a stray jungle or coast draw would land
  // further than the widest authored envelope from every descriptor.
  const nominals = ISLAND_LANDMARK_NOMINALS;
  const reach = built.sites.map(site => ({ site, radius: nominals[site.prefab].radius * Math.max(site.scale[0], site.scale[2]) + 1.5 }));
  const hits = new Map(built.sites.map(site => [site.id, 0]));
  let strays = 0;
  for (const positions of built.originals) {
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index), z = positions.getZ(index);
      let covered = false;
      for (const { site, radius } of reach) {
        if (Math.hypot(x - site.x, z - site.z) > radius) continue;
        covered = true; hits.set(site.id, hits.get(site.id) + 1);
      }
      if (!covered) strays++;
    }
  }
  for (const [id, count] of hits) assert.ok(count > 0, id + ' has original geometry standing on it');
  assert.equal(strays, 0, 'nothing but the recorded shrine draws is routed into the shrine fallback');
});

test('the recorded shrine transforms follow the original placement expressions and filters', async () => {
  const built = await recorded();
  const byId = new Map(built.sites.map(site => [site.id, site]));
  assert.deepEqual([ISLAND_SHRINE_ANCHORS.palm, ISLAND_SHRINE_ANCHORS.moon, ISLAND_SHRINE_ANCHORS.ember]
    .map(anchor => [anchor.x, anchor.z]), [[palm.x, palm.z], [moon.x, moon.z], [ember.x, ember.z]]);
  // Crescent: one tower per original pebble-and-cone pair, alternating a/b, on
  // the recorded yaw with only the height carried into a non-uniform scale.
  for (let i = 0; i < 18; i++) {
    const site = byId.get('caldera-ridge-' + i); assert.ok(site, 'caldera-ridge-' + i);
    const a = -.45 * Math.PI + i / 17 * .9 * Math.PI;
    assert.equal(site.prefab, i % 2 ? 'caldera_ridge_b' : 'caldera_ridge_a', site.id + ' alternates the fracture silhouette');
    assert.equal(site.kind, 'ridges');
    assert.deepEqual(site.rotation, [0, a, 0], site.id + ' keeps the crescent yaw and authors its own lean');
    const radial = (site.x - ember.x) / Math.sin(a), depth = -(site.z - ember.z) / Math.cos(a);
    assert.ok(radial >= 15 && radial <= 18, site.id + ' stands 15-18 m out: ' + radial);
    assert.ok(depth >= 17 && depth <= 20, site.id + ' stands 17-20 m back: ' + depth);
    assert.equal(site.y, heightAt(site.x, site.z), site.id + ' keeps the analytic ground height');
    assert.ok(site.height >= 5 && site.height <= 11, site.id + ' height ' + site.height);
    assert.equal(site.scale[0], 1); assert.equal(site.scale[2], 1);
    near(site.scale[1], site.height / ISLAND_LANDMARK_NOMINALS.caldera_ridge_a.height, 1e-12, site.id + ' scales the nominal 10 m tower');
    const crystal = byId.get('caldera-amber-crystal-' + i);
    if (i % 3) { assert.equal(crystal, undefined, 'only every third tower carries a shard cluster'); continue; }
    assert.ok(crystal, 'caldera-amber-crystal-' + i);
    assert.equal(crystal.prefab, 'caldera_amber_crystal'); assert.equal(crystal.kind, 'amberCrystals');
    assert.deepEqual([crystal.x, crystal.y, crystal.z], [site.x + 1, site.y + .2, site.z + 1.8], crystal.id + ' keeps the original offset');
    assert.deepEqual(crystal.rotation, [0, a, 0]); assert.deepEqual(crystal.scale, [1.1, 1.1, 1.1]);
  }
  assert.equal(built.sites.filter(site => site.kind === 'amberCrystals').length, 6);
  // Core: the disc sits on the recorded cliff ground and the ten ring rocks on
  // the original pebble centres, keeping their [0, a, .2] tilt.
  const core = byId.get('ember-core');
  assert.equal(core.prefab, 'ember_core');
  assert.deepEqual([core.x, core.y, core.z], [ember.x, heightAt(ember.x, ember.z - 22), ember.z - 22]);
  assert.deepEqual([core.x, core.y, core.z], [ISLAND_LANDMARK_ANCHORS.emberCore.x, ISLAND_LANDMARK_ANCHORS.emberCore.y, ISLAND_LANDMARK_ANCHORS.emberCore.z]);
  assert.deepEqual(core.rotation, [0, 0, 0]); assert.deepEqual(core.scale, [1, 1, 1]);
  assert.deepEqual([built.volcano.x, built.volcano.y, built.volcano.z], [core.x, core.y + 3, core.z], 'the mote centre is unchanged');
  assert.equal(built.moon, moon, 'buildScenery still hands the grove centre back untouched');
  for (let i = 0; i < 10; i++) {
    const rock = byId.get('ember-core-rock-' + i), a = i / 10 * TAU;
    assert.ok(rock, 'ember-core-rock-' + i); assert.equal(rock.prefab, 'ember_core_rock');
    assert.deepEqual([rock.x, rock.y, rock.z], [core.x + Math.sin(a) * 5.2, core.y + 1.1, core.z + Math.cos(a) * 4.2], rock.id);
    assert.deepEqual(rock.rotation, [0, a, .2], rock.id + ' keeps the original tilt, not a ground yaw');
    assert.deepEqual(rock.scale, [1, 1, 1]);
    assert.notEqual(rock.y, heightAt(rock.x, rock.z), rock.id + ' is centred on the pebble, not the terrain');
  }
  // Moon caps: the point-of-interest filter runs before the yaw draw, so three
  // of the four candidates are admitted and the fourth never appears.
  const candidates = [[-14, -12, 2.1], [15, -9, 2.6], [18, 11, 1.8], [-9, 16, 1.6]];
  const admitted = candidates.map(([dx, dz, size], index) =>
    POINTS_OF_INTEREST.some(place => Math.hypot(moon.x + dx - place.x, moon.z + dz - place.z) < place.radius + size * 1.65) ? null : index)
    .filter(index => index !== null);
  assert.deepEqual(admitted, [0, 1, 3], 'the observatory keeps the third cap out');
  assert.deepEqual(built.sites.filter(site => site.kind === 'mushrooms').map(site => site.id), admitted.map(index => 'moon-mushroom-' + index));
  for (const index of admitted) {
    const [dx, dz, size] = candidates[index], site = byId.get('moon-mushroom-' + index);
    assert.equal(site.prefab, 'shrine_mushroom');
    assert.deepEqual([site.x, site.y, site.z], [moon.x + dx, heightAt(moon.x + dx, moon.z + dz), moon.z + dz], site.id);
    assert.deepEqual(site.scale, [size, size, size], site.id + ' keeps the original unit scale');
    assert.equal(site.size, size);
    assert.deepEqual([site.rotation[0], site.rotation[2]], [0, 0]);
    assert.ok(site.rotation[1] >= 0 && site.rotation[1] < TAU, site.id + ' yaw ' + site.rotation[1]);
  }
  assert.equal(byId.has('moon-mushroom-2'), false, 'the excluded candidate is never installed');
  // Moon crystals: the same eleven ring candidates, filtered on route distance
  // before the size draw, so seven are admitted.
  const admittedCrystals = [];
  for (let i = 0; i < 11; i++) {
    const a = i / 11 * TAU, x = moon.x + Math.sin(a) * 13.7, z = moon.z + Math.cos(a) * 13.7;
    if (routeDistance(x, z) > 6) admittedCrystals.push(i);
  }
  assert.deepEqual(admittedCrystals, [0, 1, 4, 5, 6, 9, 10]);
  assert.deepEqual(built.sites.filter(site => site.kind === 'moonCrystals').map(site => site.id), admittedCrystals.map(i => 'moon-crystal-' + i));
  for (const i of admittedCrystals) {
    const site = byId.get('moon-crystal-' + i), a = i / 11 * TAU;
    assert.equal(site.prefab, 'shrine_moon_crystal');
    near(site.x, moon.x + Math.sin(a) * 13.7, 1e-12, site.id + ' x'); near(site.z, moon.z + Math.cos(a) * 13.7, 1e-12, site.id + ' z');
    assert.equal(site.y, heightAt(site.x, site.z), site.id + ' keeps the analytic ground height');
    assert.deepEqual(site.rotation, [0, a, 0]);
    assert.ok(site.size >= .7 && site.size <= 1.3, site.id + ' size ' + site.size);
    assert.deepEqual(site.scale, [site.size, site.size, site.size]);
  }
  // Both gate pivots: the ring hangs on its own centre and the orb on the sphere
  // centre, so neither is a ground-origin placement.
  const anchor = ISLAND_LANDMARK_ANCHORS.moonGate;
  assert.deepEqual([anchor.x, anchor.z], [moon.x + 2, moon.z - 13]);
  const ring = byId.get('moon-gate-ring'), orb = byId.get('moon-gate-orb');
  assert.deepEqual([ring.x, ring.y, ring.z], [anchor.x, anchor.y + 4.7, anchor.z]);
  assert.deepEqual(ring.rotation, [0, -.45, -.18]); assert.deepEqual(ring.scale, [1, 1, 1]);
  assert.deepEqual([orb.x, orb.y, orb.z], [anchor.x + 2.4, anchor.y + 6.8, anchor.z]);
  assert.deepEqual(orb.rotation, [0, 0, 0]); assert.deepEqual(orb.scale, [1, 1, 1]);
  // The gateway: each pillar stands on its own footing, and the beam spans them
  // from its own centre.
  const gate = ISLAND_LANDMARK_ANCHORS.palmGate;
  assert.deepEqual([gate.x, gate.z], [palm.x, palm.z - 11]);
  for (const dx of [-4.8, 4.8]) {
    const site = byId.get('palm-gate-pillar-' + (dx < 0 ? 'west' : 'east'));
    assert.ok(site); assert.equal(site.prefab, 'palm_gate_pillar');
    assert.deepEqual([site.x, site.y, site.z], [palm.x + dx, heightAt(palm.x + dx, palm.z - 11), palm.z - 11], site.id);
    assert.deepEqual(site.rotation, [0, dx * .01, .04], site.id); assert.deepEqual(site.scale, [1, 1, 1]);
  }
  const lintel = byId.get('palm-gate-lintel');
  assert.deepEqual([lintel.x, lintel.y, lintel.z], [palm.x, gate.y + 6.35, palm.z - 11]);
  assert.deepEqual(lintel.rotation, [0, 0, -.035]); assert.deepEqual(lintel.scale, [1, 1, 1]);
  assert.notEqual(lintel.y, heightAt(lintel.x, lintel.z), 'the beam hangs on its own centre, not the ground');
});

test('the authored shrine roots keep their carved envelopes, pivots, low reach and gate aperture', async () => {
  const loaded = await kit(), contracts = loaded.manifest.landmarkContracts;
  for (const name of ISLAND_LANDMARK_PREFABS) {
    const root = loaded.scene.getObjectByName(name);
    assert.ok(root.position.length() < 1e-6, name + ' exports at the origin');
    assert.ok(root.quaternion.angleTo(new THREE.Quaternion()) < 1e-6, name + ' exports unrotated');
    assert.ok(root.scale.distanceTo(new THREE.Vector3(1, 1, 1)) < 1e-6, name + ' exports at unit scale');
    assert.ok((await localVertices(name)).length > 60, name + ' is actually modelled');
  }
  // The gateway beam is pivoted on its own centre and stays inside the 2 m
  // corridor the original box occupied.
  const lintel = await localVertices('palm_gate_lintel');
  for (const point of lintel) {
    assert.ok(Math.abs(point.x) <= 5.75 + 1e-4, 'the beam spans exactly 11.5 m: ' + point.x);
    assert.ok(Math.abs(point.y) <= .55 + 1e-4, 'the beam stays 1.1 m deep: ' + point.y);
    assert.ok(Math.abs(point.z) <= 1 + 1e-4, 'the beam carries no hanging detail: ' + point.z);
  }
  near(Math.min(...lintel.map(point => point.x)), -Math.max(...lintel.map(point => point.x)), 1e-4, 'the beam is pivoted on its centre');
  assert.equal(contracts.palm_gate_lintel.origin, 'beam centre');
  const pillar = await localVertices('palm_gate_pillar');
  assert.equal(contracts.palm_gate_pillar.origin, 'ground');
  near(Math.min(...pillar.map(point => point.y)), -.45, .01, 'the pillar buries a shallow footing');
  near(Math.max(...pillar.map(point => point.y)), 6.12, .01, 'the pillar reaches its authored capital');
  // The whole visible body has to fit the original 2.1 m box under a capital no
  // wider than 2.7 m. Both are a prefab-local X span with the authored course
  // yaws already baked into the vertices: the site's own yaw and roll belong to
  // the runtime and are checked against the install transforms instead.
  assert.equal(contracts.palm_gate_pillar.bodyWidth, 2.1);
  assert.equal(contracts.palm_gate_pillar.capitalWidth, 2.7);
  assert.equal(contracts.palm_gate_pillar.capitalY, 5.12);
  const bodyWidth = 2 * Math.max(...pillar.filter(point => point.y < contracts.palm_gate_pillar.capitalY).map(point => Math.abs(point.x)));
  const capitalWidth = 2 * Math.max(...pillar.map(point => Math.abs(point.x)));
  assert.ok(bodyWidth <= contracts.palm_gate_pillar.bodyWidth + 1e-4,
    'every body course fits the original ' + contracts.palm_gate_pillar.bodyWidth + ' m box: ' + bodyWidth);
  assert.ok(capitalWidth <= contracts.palm_gate_pillar.capitalWidth + 1e-4,
    'the capital stays inside ' + contracts.palm_gate_pillar.capitalWidth + ' m: ' + capitalWidth);
  assert.ok(capitalWidth > bodyWidth, 'the pillar carries a wider capital than its body');
  // The moon gate is a doorway: no filled triangle, inlay included, may reach
  // inside the aperture, and the inner vertices sit far enough out that no chord
  // cuts the circle either.
  const ringContract = contracts.moon_gate_ring;
  assert.equal(ringContract.apertureRadius, MOON_GATE_APERTURE_RADIUS);
  assert.equal(ringContract.plane, 'local XY'); assert.equal(ringContract.origin, 'ring centre');
  const aperture = projectedApertureRadius(await localTriangles('moon_gate_ring'));
  assert.ok(aperture >= MOON_GATE_APERTURE_RADIUS, 'the projected triangle aperture is ' + aperture);
  near(aperture, ringContract.measuredApertureRadius, .001, 'the manifest records the measured aperture');
  const inlay = projectedApertureRadius(await localTriangles('moon_gate_ring', 'lunar_glow'));
  assert.ok(inlay >= MOON_GATE_APERTURE_RADIUS, 'the cyan inlay is ' + inlay + ' from the doorway centre');
  const ring = await localVertices('moon_gate_ring');
  const innerVertex = Math.min(...ring.map(point => Math.hypot(point.x, point.y)));
  assert.ok(innerVertex >= MOON_GATE_APERTURE_RADIUS / Math.cos(Math.PI / ringContract.segments) - 1e-6,
    'the inner vertices sit at ' + innerVertex + ', so a ' + ringContract.segments + '-segment chord still clears the aperture');
  near(innerVertex, ringContract.innerRadius, .01, 'the manifest records the inner radius');
  for (const point of ring) {
    assert.ok(Math.hypot(point.x, point.y) <= 4.29 + 1e-4, 'the stone band stays inside 4.29 m: ' + Math.hypot(point.x, point.y));
    assert.ok(Math.abs(point.z) <= .48 + 1e-4, 'the ring stays a thin band: ' + point.z);
  }
  const ringBox = new THREE.Box3().setFromPoints(ring);
  assert.ok(ringBox.getCenter(new THREE.Vector3()).length() < .05, 'the ring hangs on its own centre, not the ground');
  // The orb is a real sphere around its pivot, not a box that happens to fit.
  const orb = await localVertices('moon_gate_orb');
  for (const point of orb) assert.ok(point.length() <= .75 + 1e-4, 'the orb stays inside its 0.75 m sphere: ' + point.length());
  assert.ok(Math.max(...orb.map(point => point.length())) > .6, 'the orb fills its sphere');
  assert.ok(new THREE.Box3().setFromPoints(orb).getCenter(new THREE.Vector3()).length() < .05, 'the orb is centred on its pivot');
  // A leaning mushroom on a slim stem: nothing broad below a metre, so the caps
  // never block a walker.
  const mushroom = await localVertices('shrine_mushroom');
  const stem = Math.max(...mushroom.filter(point => point.y < contracts.shrine_mushroom.lowReachHeight).map(point => Math.hypot(point.x, point.z)));
  assert.ok(stem <= contracts.shrine_mushroom.lowReachRadius + 1e-4, 'the stem reaches ' + stem + ' m below 1 m');
  assert.ok(stem <= .46 + 1e-4);
  assert.ok(Math.max(...mushroom.map(point => point.y)) > 3, 'the cap still stands over three metres');
  // Both crystal kinds keep the deepened skirt instead of a rock base.
  for (const name of ['shrine_moon_crystal', 'caldera_amber_crystal']) {
    const points = await localVertices(name);
    near(Math.min(...points.map(point => point.y)), contracts[name].skirtDepth, .01, name + ' skirt');
    assert.ok(Math.max(...points.map(point => Math.hypot(point.x, point.z))) <= 1 + 1e-4, name + ' carries no wide base');
  }
  // Both towers bury a foot, taper to a narrow spire and read as different rock.
  for (const name of ['caldera_ridge_a', 'caldera_ridge_b']) {
    const points = await localVertices(name);
    near(Math.min(...points.map(point => point.y)), contracts[name].buriedFoot, .01, name + ' buries its foot');
    const base = Math.max(...points.filter(point => point.y < 1).map(point => Math.hypot(point.x, point.z)));
    const spire = Math.max(...points.filter(point => point.y > 9).map(point => Math.hypot(point.x, point.z)));
    assert.ok(base > 2.4 && base <= 4.7, name + ' keeps the original footprint: ' + base);
    assert.ok(spire < base * .6, name + ' narrows to a spire: ' + spire + ' against ' + base);
    assert.equal(contracts[name].nominalHeight, ISLAND_LANDMARK_NOMINALS[name].height);
  }
  assert.notEqual(JSON.stringify((await localVertices('caldera_ridge_a')).map(point => point.toArray())),
    JSON.stringify((await localVertices('caldera_ridge_b')).map(point => point.toArray())), 'both ridges are separately modelled');
  // The magma disc is a shallow pool on the recorded ground, never a light.
  const core = await localVertices('ember_core');
  for (const point of core) {
    assert.ok(Math.abs(point.x) <= 5 + 1e-4 && Math.abs(point.z) <= 4 + 1e-4, 'the core stays inside its 10x8 m pool');
    assert.ok(point.y >= -.2 - 1e-4 && point.y <= .8 + 1e-4, 'the core stays shallow: ' + point.y);
  }
  assert.equal(contracts.ember_core.origin, 'core groundY');
  // The ring rocks are centred on the original pebble, so they reach below their
  // own pivot.
  const rock = await localVertices('ember_core_rock');
  assert.equal(contracts.ember_core_rock.origin, 'pebble centre');
  assert.ok(Math.min(...rock.map(point => point.y)) < -.5, 'the ring rock hangs below its pivot');
  assert.ok(Math.max(...rock.map(point => Math.hypot(point.x, point.z))) <= 1.8 + 1e-4);
  assert.ok(Math.max(...rock.map(point => Math.abs(point.y))) <= 1.7 + 1e-4);
});

test('the caldera core is a broad shallow pool and the ridge seams are narrow fissures', async () => {
  // Both of these passed every envelope and budget check while looking wrong in
  // engine, because an upper bound cannot notice geometry that shrank or a slot
  // that spread. They are pinned against the original draws instead.
  //
  // The core was SphereGeometry(1) lifted +.30 and scaled [5, .50, 4]: a 10 x 8 m
  // shallow ellipsoid crowned at +.80. An authored root that came back 5.1 x 4.1
  // with its glow flattened to +.055 still fit the 10 x 8 x [-.20, .80] envelope.
  const core = await localVertices('ember_core');
  const spanX = Math.max(...core.map(point => point.x)) - Math.min(...core.map(point => point.x));
  const spanZ = Math.max(...core.map(point => point.z)) - Math.min(...core.map(point => point.z));
  assert.ok(spanX >= 8, 'the magma pool still spans the caldera floor across X: ' + spanX);
  assert.ok(spanZ >= 6, 'the magma pool still spans the caldera floor across Z: ' + spanZ);
  const glow = (await localTriangles('ember_core', 'caldera_glow')).flat();
  assert.ok(glow.length > 100, 'the pool has a real glowing surface: ' + glow.length);
  const crest = Math.max(...glow.map(point => point.y));
  assert.ok(crest > .70, 'the lava still domes to a crest rather than lying flat: ' + crest);
  assert.ok(crest <= .8 + 1e-4, 'and stays under the authored .80 m ceiling: ' + crest);
  // Every glowing vertex follows the original crown, y = .30 + .50 * sqrt(1 -
  // (x/5)^2 - (z/4)^2). No rim or crack point needs excluding: the whole slot
  // sits inside the footprint and the worst deviation measures .036 m.
  let worst = 0;
  for (const point of glow) {
    const dome = 1 - (point.x / 5) ** 2 - (point.z / 4) ** 2;
    assert.ok(dome > 0, 'every glowing point sits inside the original 10 x 8 m footprint: ' + point.x + ', ' + point.z);
    worst = Math.max(worst, Math.abs(point.y - (.30 + .50 * Math.sqrt(dome))));
  }
  assert.ok(worst <= .06, 'the glowing surface follows the original crown within .06 m: ' + worst);
  // The seams were briefly painted across whole shell facets, which read as
  // roughly one square metre orange panels. They are narrow fissures: every
  // glowing triangle is a thin strip, and the seams together are a fraction of
  // the tower's surface, so subdividing a painted facet would not pass either.
  for (const name of ['caldera_ridge_a', 'caldera_ridge_b']) {
    const seams = await localTriangles(name, 'caldera_glow');
    assert.ok(seams.length > 10, name + ' carries authored seams: ' + seams.length);
    const areas = seams.map(triangleArea), widths = seams.map(triangleWidth);
    assert.ok(Math.max(...areas) < .05, name + ' paints no whole facet: largest seam triangle ' + Math.max(...areas) + ' m2');
    assert.ok(Math.max(...widths) <= .15, name + ' seams stay narrow: widest strip ' + Math.max(...widths) + ' m');
    assert.ok(Math.min(...widths) > .02, name + ' seams are real strips, not hairlines: narrowest ' + Math.min(...widths) + ' m');
    const seamArea = areas.reduce((sum, area) => sum + area, 0);
    const shell = (await localTriangles(name)).map(triangleArea).reduce((sum, area) => sum + area, 0);
    assert.ok(seamArea > 0 && seamArea / shell < .05,
      name + ' seams stay a fissure rather than a coat: ' + (100 * seamArea / shell).toFixed(3) + '% of the shell');
  }
});

test('the six coast roots are unchanged by the shrine slice', async () => {
  const loaded = await kit();
  // Recorded from the shipped slice-1 kit at e8fc3c9: attribute arrays, indices
  // and material names per root, so re-exporting the kit for a later area can
  // never quietly re-cut the strand.
  const BASELINE = {
    coast_palm_a: 'f0a4695fc0b5bc9c7b10f9f93ec8b3c55628b3405d14a992c08534dfa7ab74c9',
    coast_palm_b: '1136a43e043510c2b21776c2fcabb992100eb8a2202fc1f80ea7e695e223614c',
    coast_rock_a: '1dd6080faa88f8ec505f08aa3b70b4bdf127ac2e47f57e85088a319b2a7b8970',
    coast_rock_b: 'e39c853b478cfe79531039ac35bb66853a613f84ead9849422bf03a0b751dd84',
    fishing_skiff_a: 'b80a5860bc776a10f27a04dbb3e4beef6734615d62fffbc54171e7a96e6a215e',
    fishing_skiff_b: 'a5e3abf51d3ebbe972577a5cd3309c4839f670d40526a9acb4320390718ee50a',
  };
  for (const [name, expected] of Object.entries(BASELINE)) {
    const parts = [];
    loaded.scene.getObjectByName(name).traverse(object => {
      if (!object.isMesh) return;
      const hash = createHash('sha256'); hash.update(object.material.name + '|');
      for (const key of ['position', 'normal', 'uv', 'color']) {
        const attribute = object.geometry.attributes[key];
        hash.update(key + ':' + (attribute ? attribute.count + ':' + attribute.itemSize : 'none') + '|');
        if (attribute) hash.update(Buffer.from(attribute.array.buffer, attribute.array.byteOffset, attribute.array.byteLength));
      }
      const index = object.geometry.index;
      hash.update('index:' + (index ? index.count : 'none') + '|');
      if (index) hash.update(Buffer.from(index.array.buffer, index.array.byteOffset, index.array.byteLength));
      parts.push(hash.digest('hex'));
    });
    assert.ok(parts.length, name + ' still ships');
    assert.equal(createHash('sha256').update(parts.sort().join('')).digest('hex'), expected, name + ' geometry is unchanged');
  }
});

test('the authored shrines leave the nine metre rings, gate crossing and routes open', async () => {
  const built = await recorded();
  const nearest = Object.fromEntries(SHRINES.map(shrine => [shrine.id, { distance: Infinity, id: null }]));
  let route = { distance: Infinity, id: null }, low = 0;
  const gateSlab = [];
  const ring = built.sites.find(site => site.id === 'moon-gate-ring');
  const ringTransform = new THREE.Object3D();
  ringTransform.position.set(ring.x, ring.y, ring.z); ringTransform.rotation.set(...ring.rotation); ringTransform.updateMatrix();
  const intoRing = new THREE.Matrix4().copy(ringTransform.matrix).invert();
  for (const site of built.sites) {
    for (const point of await worldVertices(site)) {
      const ground = heightAt(point.x, point.z);
      // Anything a walker could meet inside the shrine ring or on an approach.
      if (point.y <= ground + HEAD_CLEARANCE) {
        low++;
        for (const shrine of SHRINES) {
          const distance = Math.hypot(point.x - shrine.x, point.z - shrine.z);
          if (distance < nearest[shrine.id].distance) nearest[shrine.id] = { distance, id: site.id };
        }
        const distance = routeDistance(point.x, point.z);
        if (distance < route.distance) route = { distance, id: site.id };
        // The doorway itself has to be walkable, so nothing authored may stand
        // inside the aperture below head height either.
        const local = point.clone().applyMatrix4(intoRing);
        if (Math.abs(local.z) <= .48) gateSlab.push({ radius: Math.hypot(local.x, local.y), id: site.id });
      }
    }
  }
  assert.ok(low > 1000, 'the sweep actually reached the authored geometry: ' + low);
  // Measured 10.55 m (palm), 12.20 m (ember) and 12.17 m (moon); the crew has to
  // be able to stand inside the nine metre charge ring of every shrine.
  for (const shrine of SHRINES) {
    assert.ok(nearest[shrine.id].distance >= 9,
      'the ' + shrine.id + ' charge ring is clear: ' + nearest[shrine.id].id + ' at ' + nearest[shrine.id].distance.toFixed(3) + ' m');
  }
  // Measured 5.76 m, where the original batch measured 5.98 m: the re-modelled
  // mushroom stems are a few centimetres fatter than the original cylinders and
  // nothing else moved, so every primary route stays walkable.
  assert.ok(route.distance >= 4, 'the primary routes stay open: ' + route.id + ' at ' + route.distance.toFixed(3) + ' m');
  const original = { distance: Infinity };
  for (const positions of built.originals) {
    for (let index = 0; index < positions.count; index++) {
      const x = positions.getX(index), y = positions.getY(index), z = positions.getZ(index);
      if (y > heightAt(x, z) + HEAD_CLEARANCE) continue;
      original.distance = Math.min(original.distance, routeDistance(x, z));
    }
  }
  assert.ok(route.distance >= original.distance - .5,
    'the authored shrines do not crowd a route the original draws left open: ' + route.distance.toFixed(3) + ' against ' + original.distance.toFixed(3));
  assert.ok(gateSlab.length > 100, 'the gate legs themselves are in the sweep: ' + gateSlab.length);
  const blocking = gateSlab.filter(entry => entry.radius < MOON_GATE_APERTURE_RADIUS);
  assert.deepEqual(blocking, [], 'nothing authored stands in the walk-through aperture below head height');
  // The gateway: a wide opening between the footings and a beam well overhead.
  const pillars = built.sites.filter(site => site.kind === 'pillars');
  const sides = await Promise.all(pillars.map(async site => (await worldVertices(site)).filter(point => point.y <= heightAt(point.x, point.z) + HEAD_CLEARANCE)));
  const west = sides[pillars.findIndex(site => site.x < palm.x)], east = sides[pillars.findIndex(site => site.x > palm.x)];
  const opening = Math.min(...east.map(point => point.x)) - Math.max(...west.map(point => point.x));
  assert.ok(opening >= 5, 'the gateway stays a crossing, not a wall: ' + opening.toFixed(3) + ' m');
  const beam = await worldVertices(built.sites.find(site => site.id === 'palm-gate-lintel'));
  const clearance = Math.min(...beam.map(point => point.y - heightAt(point.x, point.z)));
  assert.ok(clearance > HEAD_CLEARANCE + 2, 'the carved beam passes above the crossing over uneven footings: ' + clearance.toFixed(3) + ' m');
  // Emberpeak keeps its south approach: every authored caldera piece stands
  // north of the shrine, so the lane in from the south is untouched.
  let south = -Infinity, southId = null;
  for (const site of built.sites.filter(entry => ['ridges', 'amberCrystals', 'cores', 'coreRocks'].includes(entry.kind))) {
    for (const point of await worldVertices(site)) {
      if (point.y > heightAt(point.x, point.z) + HEAD_CLEARANCE || Math.abs(point.x - ember.x) > 12) continue;
      if (point.z > south) { south = point.z; southId = site.id; }
    }
  }
  assert.ok(south < ember.z, 'the south approach to the Emberpeak shrine stays open: ' + southId + ' at z ' + south.toFixed(3));
});

after(() => { if (cachedScenery) releaseScenery(cachedScenery.built); });
