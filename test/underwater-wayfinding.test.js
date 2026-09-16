import assert from 'node:assert/strict';
import test from 'node:test';
import { createReefResources } from '../client/underwater-materials.js';
import { createReefWayfinding, REEF_WAYFINDING_ROUTES } from '../client/underwater-wayfinding.js';
import { REEF_EXIT, resolveReefSwimmerCollision } from '../shared/underwater.js';
import { REEF_DISCOVERIES, REEF_EVENTS, REEF_REGIONS } from '../shared/underwater-content.js';

const key = point => `${point.x}:${point.y}:${point.z}`;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);

test('reef wayfinding keeps all six regions connected from the return current and clear for the full swimmer body', () => {
  const main = REEF_WAYFINDING_ROUTES.filter(route => route.kind === 'main'), graph = new Map();
  for (const route of main) {
    const a = key(route.nodes[0]), b = key(route.nodes.at(-1));
    if (!graph.has(a)) graph.set(a, new Set()); if (!graph.has(b)) graph.set(b, new Set()); graph.get(a).add(b); graph.get(b).add(a);
  }
  const visited = new Set([key(REEF_EXIT)]), pending = [key(REEF_EXIT)];
  while (pending.length) for (const next of graph.get(pending.shift()) || []) if (!visited.has(next)) { visited.add(next); pending.push(next); }
  for (const region of REEF_REGIONS) {
    if (region.id === 'sunken-reach') continue;
    assert.ok(main.some(route => [route.nodes[0], route.nodes.at(-1)].some(point => visited.has(key(point)) && Math.hypot(point.x - region.x, point.z - region.z) < region.radius)), `${region.name} has a connected central approach`);
  }
  for (const route of REEF_WAYFINDING_ROUTES) for (let index = 1; index < route.nodes.length; index++) {
    const from = route.nodes[index - 1], to = route.nodes[index], steps = Math.ceil(distance(from, to) / .5);
    for (let step = 0; step <= steps; step++) {
      const t = step / steps, point = { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t, z: from.z + (to.z - from.z) * t }, resolved = { ...point };
      resolveReefSwimmerCollision(resolved);
      assert.ok(distance(point, resolved) < 1e-6, `${route.id} segment ${index} stays capsule-clear at ${step}/${steps}`);
    }
  }
});

test('wayfinding branches finish inside discovery and event interaction ranges', () => {
  const approaches = REEF_WAYFINDING_ROUTES.flatMap(route => route.nodes);
  const nearest = point => Math.min(...approaches.map(approach => distance(approach, point)));
  for (const discovery of REEF_DISCOVERIES) assert.ok(nearest(discovery) <= discovery.range, `${discovery.id} has an actionable route approach`);
  for (const event of REEF_EVENTS) {
    assert.ok(nearest(event) <= event.range, `${event.id} prompt has an actionable route approach`);
    for (const node of event.nodes) assert.ok(nearest(node) <= node.range, `${node.id} has an actionable route approach`);
  }
});

test('wayfinding uses bounded, sparse cues and finite depth-tested landmark fades', () => {
  const resources = createReefResources(), wayfinding = createReefWayfinding(resources), pearls = wayfinding.group.getObjectByName('sunken-reach-wayfinding-pearl-trails');
  const samples = pearls.userData.samples = pearls.userData.samples || [];
  assert.equal(pearls.material.vertexColors, false, 'instance colors do not depend on absent geometry colors');
  assert.ok(samples.length > 0 && samples.length < 180, 'short-gap cues stay within the geometry budget');
  for (const route of REEF_WAYFINDING_ROUTES) for (let index = 1; index < route.nodes.length; index++) {
    const a = route.nodes[index - 1], b = route.nodes[index], vector = { x: b.x - a.x, y: b.y - a.y, z: b.z - a.z }, lengthSquared = vector.x ** 2 + vector.y ** 2 + vector.z ** 2;
    const marks = [0, 1];
    for (const sample of samples) {
      const offset = { x: sample.x - a.x, y: sample.y - a.y, z: sample.z - a.z }, t = (offset.x * vector.x + offset.y * vector.y + offset.z * vector.z) / lengthSquared;
      if (t > 1e-5 && t < 1 - 1e-5 && distance(sample, { x: a.x + vector.x * t, y: a.y + vector.y * t, z: a.z + vector.z * t }) < 1e-4) marks.push(t);
    }
    marks.sort((left, right) => left - right);
    for (let mark = 1; mark < marks.length; mark++) assert.ok((marks[mark] - marks[mark - 1]) * Math.sqrt(lengthSquared) <= 9.401, `${route.id} pearl gap stays within the 9.4m authored interval`);
  }
  wayfinding.update(3, { player: { x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z } });
  const exitBeacon = wayfinding.group.getObjectByName('sunken-reach-wayfinding-sunken-reach-beacon'), halo = exitBeacon.getObjectByName('landmark-bearing-halo');
  assert.deepEqual(exitBeacon.position.toArray(), [REEF_EXIT.x, REEF_EXIT.y, REEF_EXIT.z]); assert.equal(halo.material.depthTest, true); assert.equal(halo.material.fog, false);
  wayfinding.update(3, { lowQuality: true, reducedMotion: true, player: { x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z } });
  const stillOpacity = pearls.material.opacity, stillRotation = exitBeacon.rotation.y;
  assert.equal(wayfinding.group.getObjectByName('sunken-reach-wayfinding-seaweed-clusters').visible, false, 'low graphics retains shell and pearl direction while hiding seaweed');
  wayfinding.update(9, { lowQuality: true, reducedMotion: true, player: { x: REEF_EXIT.x, y: REEF_EXIT.y, z: REEF_EXIT.z } });
  assert.equal(pearls.material.opacity, stillOpacity); assert.equal(exitBeacon.rotation.y, stillRotation, 'reduced motion freezes cue animation');
  wayfinding.update(4, { player: { x: 200, y: 12, z: 200 } });
  assert.equal(exitBeacon.visible, false, 'beacons stop at their authored finite fade distance');
  assert.deepEqual(wayfinding.getStats().beaconFade, { start: 48, end: 92 }); assert.ok(wayfinding.getStats().drawCalls < 36, 'batched paths, pearls, and six halo beacons stay bounded');
  let textureDisposals = 0, disposeTexture = halo.material.map.dispose.bind(halo.material.map); halo.material.map.dispose = () => { textureDisposals++; disposeTexture(); };
  wayfinding.dispose(); wayfinding.dispose(); assert.equal(textureDisposals, 1, 'the owned halo texture is released once');
  wayfinding.group.traverse(node => node.geometry?.dispose()); resources.dispose();
});
