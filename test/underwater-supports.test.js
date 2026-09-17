import test from 'node:test';
import assert from 'node:assert/strict';
import { REEF_LANDMARK_SUPPORTS, REEF_LANDMARK_SOLIDS } from '../shared/underwater-content.js';
import { REEF_SOLIDS, resolveReefSwimmerCollision, reefLineOfSight } from '../shared/underwater.js';
import { SUNKEN_MANOR_SOLIDS } from '../shared/sunken-manor.js';

test('reef landmark supports are frozen and included as physical solids', () => {
  assert.equal(REEF_LANDMARK_SUPPORTS.length, 6);
  assert.ok(Object.isFrozen(REEF_LANDMARK_SUPPORTS));
  for (const support of REEF_LANDMARK_SUPPORTS) {
    assert.ok(Object.isFrozen(support));
    assert.ok(REEF_SOLIDS.includes(support));
    assert.equal(support.region, support.id.startsWith('ember-') ? 'ember-vents' : 'crown-graveyard');
  }
  assert.equal(REEF_SOLIDS.length, 8 + REEF_LANDMARK_SOLIDS.length + REEF_LANDMARK_SUPPORTS.length + SUNKEN_MANOR_SOLIDS.length);
});

test('support columns block swimmer collision and line of sight at their authored centres', () => {
  for (const support of REEF_LANDMARK_SUPPORTS) {
    const resolved = resolveReefSwimmerCollision({ x: support.x, y: support.y - 1.2, z: support.z });
    assert.ok(Math.hypot(resolved.x - support.x, resolved.y - (support.y - 1.2), resolved.z - support.z) >= .59, support.id);
    const from = { x: support.x - support.width, y: support.y, z: support.z - support.depth * 2 };
    const to = { x: support.x, y: support.y, z: support.z };
    assert.equal(reefLineOfSight(from, to), false, support.id);
  }
});

test('central under-bridge corridor remains open between new ember supports', () => {
  const swimmer = { x: 82, y: 3, z: -70 };
  assert.deepEqual(resolveReefSwimmerCollision({ ...swimmer }), swimmer);
  assert.equal(reefLineOfSight({ x: 82, y: 3, z: -78 }, { x: 82, y: 3, z: -62 }), true);
  const highBridgeCorridor = { x: 94, y: 5, z: -66 };
  assert.deepEqual(resolveReefSwimmerCollision({ ...highBridgeCorridor }), highBridgeCorridor);
  assert.equal(reefLineOfSight({ x: 94, y: 5, z: -74 }, { x: 94, y: 5, z: -58 }), true);
});

test('nearby interaction approaches remain clear of support geometry', () => {
  const approaches = [
    [{ x: 72, y: 11, z: -72 }, { x: 78, y: 11, z: -72 }],
    [{ x: 96, y: 12, z: -78 }, { x: 96, y: 12, z: -71 }],
    [{ x: 80, y: 8, z: 22 }, { x: 80, y: 8, z: 31 }],
    [{ x: 106, y: 25, z: 39 }, { x: 106, y: 25, z: 47 }],
  ];
  for (const [from, target] of approaches) {
    assert.deepEqual(resolveReefSwimmerCollision({ ...from }), from);
    assert.equal(reefLineOfSight(from, target), true);
  }
});
