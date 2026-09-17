import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createCaptainsHouse } from '../client/captains-house.js';
import { CAPTAINS_HOUSE, CAPTAINS_HOUSE_SOLIDS } from '../shared/captains-house.js';

const raycaster = new THREE.Raycaster();
function passageClear(house, from, to, { glass = false } = {}) {
  const origin = new THREE.Vector3(...from).add(house.group.position);
  const target = new THREE.Vector3(...to).add(house.group.position);
  const direction = target.clone().sub(origin), length = direction.length();
  raycaster.set(origin, direction.normalize()); raycaster.far = length;
  return !raycaster.intersectObjects(house.group.children.filter(mesh => glass || !mesh.name.endsWith('-glass')), false)
    .some(hit => hit.distance > .03 && hit.distance < length - .03);
}

test('captain house renders contract-aligned doors, windows and upper openings', () => {
  const house = createCaptainsHouse();
  house.group.updateMatrixWorld(true);
  try {
    assert.equal(house.group.position.x, CAPTAINS_HOUSE.x);
    assert.equal(house.group.position.z, CAPTAINS_HOUSE.z);
    assert.ok(house.getStats().parts > 4000, 'individual siding, floor and roof courses are present');
    assert.ok(house.getStats().meshes <= 24, 'detail stays batched by finish');
    assert.ok(passageClear(house, [0, 1.8, 10], [0, 1.8, 8.4]), 'ground front door is visually clear');
    assert.ok(passageClear(house, [0, .2, 10], [0, .2, 8.4]), 'ground threshold has no stone curb');
    assert.ok(passageClear(house, [0, 6.2, 10], [0, 6.2, 8.4]), 'balcony doorway is visually clear');
    assert.ok(passageClear(house, [0, 10.9, 10], [0, 10.9, 8.4]), 'attic lookout doorway is visually clear');
    assert.ok(passageClear(house, [10.5, 1.67, -.6], [9.2, 1.67, -.6]), 'side window has a real wall opening');
    assert.ok(passageClear(house, [5.55, 2.4, 9.7], [5.55, 2.4, 8.3]), 'front bay window has a real wall opening');
    const frontDoor = CAPTAINS_HOUSE_SOLIDS.filter(solid => solid.id.startsWith('front-0-'));
    assert.ok(frontDoor.every(solid => Math.abs(solid.x) - solid.width / 2 >= 1.69 || solid.id.endsWith('lintel')));
  } finally { house.dispose(); }
});

test('roof closes above the attic and renderer releases its resources', () => {
  const house = createCaptainsHouse();
  house.group.updateMatrixWorld(true);
  try {
    assert.equal(passageClear(house, [4, 17, 0], [4, 12, 0]), false, 'pitched cedar roof covers lookout');
    assert.ok(house.group.getObjectByName('captains-house-cedar'));
    assert.ok(house.group.getObjectByName('captains-house-floor'));
    const sign = house.group.getObjectByName('captains-house-legible-sign');
    assert.ok(sign?.material?.map?.image?.data.some((value, index) => index % 4 === 3 && value > 0),
      'nameplate has actual authored lettering');
  } finally { house.dispose(); }
  assert.equal(house.group.parent, null);
});
