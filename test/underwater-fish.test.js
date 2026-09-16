import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createReefFishSchools } from '../client/underwater-fish.js';
import { REEF_BOUNDS, REEF_SOLIDS } from '../shared/underwater.js';

const school = system => system.getStats().schools[0];
const position = value => value.center;
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
function advance(system, start, seconds, player) {
  for (let frame = 1; frame <= seconds * 60; frame++) system.update(start + frame / 60, { player });
}
function translations(mesh) {
  const values = [];
  for (let i = 0; i < mesh.count; i++) values.push({ x: mesh.instanceMatrix.array[i * 16 + 12], y: mesh.instanceMatrix.array[i * 16 + 13], z: mesh.instanceMatrix.array[i * 16 + 14] });
  return values;
}
function clearOfSolid(point, solid) {
  return point.x < solid.x - solid.width / 2 || point.x > solid.x + solid.width / 2 || point.y < solid.y - solid.height / 2 || point.y > solid.y + solid.height / 2 || point.z < solid.z - solid.depth / 2 || point.z > solid.z + solid.depth / 2;
}

test('reef fish schools use full 3D swimmer proximity and flee along every axis', () => {
  for (const axis of ['x', 'y', 'z']) for (const sign of [-1, 1]) {
    const fish = createReefFishSchools(); fish.update(0);
    const before = position(school(fish)), player = { position: { ...before, [axis]: before[axis] + sign * 5 } };
    fish.update(.12, { player }); const after = school(fish), travelled = { x: after.center.x - before.x, y: after.center.y - before.y, z: after.center.z - before.z };
    const away = { x: before.x - player.position.x, y: before.y - player.position.y, z: before.z - player.position.z };
    assert.ok(travelled.x * away.x + travelled.y * away.y + travelled.z * away.z > .05, `${axis} proximity pushes the school away`);
    assert.ok(after.alarm > 0 && after.speed > 3, 'alarm has a visibly quicker flee speed');
    const matrix = fish.group.getObjectByName('sunken-reach-batched-fish').instanceMatrix.array, forward = new THREE.Vector3(matrix[8], matrix[9], matrix[10]).normalize();
    assert.ok(forward.dot(new THREE.Vector3(away.x, away.y, away.z).normalize()) > .8, `${axis} flee pitch faces the yawed travel direction`); fish.dispose();
  }
});

test('reef fish regroup calmly after a swimmer leaves', () => {
  const fish = createReefFishSchools(); fish.update(0); const origin = position(school(fish)), close = { x: origin.x + 4, y: origin.y, z: origin.z };
  advance(fish, 0, 1, close); const scattered = position(school(fish));
  advance(fish, 1, 5, { x: 130, y: 40, z: 130 }); const calm = school(fish);
  assert.equal(calm.alarm, 0); assert.ok(calm.speed < 2.5, 'school returns to its calm cruise');
  assert.ok(distance(calm.center, scattered) > 1, 'flee motion was visible before regrouping'); fish.dispose();
});

test('reef fish use fixed small steps and clamp pauses', () => {
  const a = createReefFishSchools(), b = createReefFishSchools(); a.update(0); b.update(0);
  for (let frame = 1; frame <= 8; frame++) a.update(frame / 60);
  b.update(8 / 60); const one = school(a).center, two = school(b).center;
  assert.ok(distance(one, two) < .03, 'equivalent normal frames do not create frame-rate drift');
  const beforePause = position(school(a)); a.update(120); const afterPause = position(school(a));
  assert.ok(distance(beforePause, afterPause) < 1.1, 'a resumed tab cannot teleport a school through its patrol'); a.dispose(); b.dispose();
});

test('reef fish preserve recognizable low-quality schools, freeze reduced motion, and stay in valid water', () => {
  const fish = createReefFishSchools(), mesh = fish.group.getObjectByName('sunken-reach-batched-fish'); assert.ok(mesh?.isInstancedMesh);
  const tint = new THREE.Color(); mesh.getColorAt(0, tint); assert.equal(mesh.material.vertexColors, false, 'instance tints do not require a missing vertex color attribute'); assert.ok(tint.r > .3 && tint.g > .15, 'the first fish keeps its warm visible instance tint');
  fish.update(0); fish.update(.1, { lowQuality: true }); const shown = Array.from({ length: mesh.count }, (_, index) => Math.hypot(mesh.instanceMatrix.array[index * 16], mesh.instanceMatrix.array[index * 16 + 1], mesh.instanceMatrix.array[index * 16 + 2])).filter(scale => scale > .01);
  assert.ok(shown.length < mesh.count && shown.length >= 6 * 5, 'low quality retains a small readable cluster in every region');
  fish.update(.2, { reducedMotion: true }); const frozen = mesh.instanceMatrix.array.slice(); fish.update(40, { reducedMotion: true, player: { x: -23, y: 7, z: 26 } });
  assert.deepEqual(Array.from(mesh.instanceMatrix.array), Array.from(frozen), 'reduced motion freezes fish matrices');
  fish.update(40.1);
  // Sustain a close escort toward the east boundary. The school must clamp
  // its own diagnostic center as well as every rendered member position.
  for (let frame = 1; frame <= 1500; frame++) { const center = school(fish).center; fish.update(40.1 + frame / 60, { player: { x: center.x - 4, y: center.y, z: center.z } }); }
  for (const center of fish.getStats().schools.map(entry => entry.center)) for (const solid of REEF_SOLIDS) assert.ok(clearOfSolid(center, solid), `school center remains outside ${solid.id}`);
  for (const point of translations(mesh)) {
    if (Math.hypot(point.x, point.y, point.z) < .01) continue;
    assert.ok(point.x >= REEF_BOUNDS.minX && point.x <= REEF_BOUNDS.maxX && point.y >= REEF_BOUNDS.minY && point.y <= REEF_BOUNDS.maxY && point.z >= REEF_BOUNDS.minZ && point.z <= REEF_BOUNDS.maxZ);
    for (const solid of REEF_SOLIDS) assert.ok(clearOfSolid(point, solid), `fish remains outside ${solid.id}`);
  }
  fish.dispose(); fish.dispose(); assert.equal(fish.getStats().status, 'disposed');
});
