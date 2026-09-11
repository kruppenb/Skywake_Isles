import test from 'node:test';
import assert from 'node:assert/strict';
import { shipClearFraction, SHIP_CAMERA_BOX } from '../client/camera.js';
import { SHIP_JUMP_POINTS, jumpLaunchPose } from '../shared/airship.js';
import { shipAt } from '../shared/world.js';

const inside = (point, ship) => point.x > ship.x - SHIP_CAMERA_BOX.x && point.x < ship.x + SHIP_CAMERA_BOX.x
  && point.y > ship.y + SHIP_CAMERA_BOX.minY && point.y < ship.y + SHIP_CAMERA_BOX.maxY
  && point.z > ship.z + SHIP_CAMERA_BOX.minZ && point.z < ship.z + SHIP_CAMERA_BOX.maxZ;
const along = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t });

test('a camera outside the ship still retracts when its view crosses a bow corner', () => {
  const ship = shipAt(100);
  const anchor = { x: 0, y: ship.y + 2, z: ship.z - 25.8 };
  const camera = { x: -10, y: ship.y + 2, z: ship.z - 21 };
  assert.equal(inside(anchor, ship), false);
  assert.equal(inside(camera, ship), false);
  assert.equal(inside(along(anchor, camera, .5), ship), true);
  const fraction = shipClearFraction(anchor, camera, ship);
  assert.ok(fraction > .26 && fraction < .28);
  assert.equal(inside(along(anchor, camera, fraction), ship), false);
});

test('a camera above the deck does not look through a gate on the way to the pirate', () => {
  const ship = shipAt(100);
  const anchor = { x: ship.x + 10.2, y: ship.y + 2, z: ship.z + 5 };
  const camera = { x: ship.x, y: ship.y + 8, z: ship.z + 5 };
  assert.equal(inside(camera, ship), false);
  const fraction = shipClearFraction(anchor, camera, ship);
  assert.ok(fraction > 0 && fraction < .2);
  assert.equal(inside(along(anchor, camera, fraction), ship), false);
  assert.equal(shipClearFraction(anchor, { ...camera, x: ship.x + 18 }, ship), 1, 'an unobstructed view keeps its full distance');
});

test('every authored departure keeps the whole camera segment clear across view directions', () => {
  let retracted = 0, full = 0;
  for (const elapsed of [0, 7, 14, 21, 28]) for (const gate of SHIP_JUMP_POINTS) {
    const ship = shipAt(elapsed), launch = jumpLaunchPose(gate, ship);
    const anchor = { ...launch, y: launch.y + 2.7 };
    for (let index = 0; index < 24; index++) for (const pitch of [-.6, -.1, .3, .8]) {
      const yaw = index * Math.PI / 12, horizontal = Math.cos(pitch);
      const camera = {
        x: anchor.x + Math.sin(yaw) * horizontal * 10.2 + Math.cos(yaw) * .92,
        y: anchor.y - Math.sin(pitch) * 10.2,
        z: anchor.z + Math.cos(yaw) * horizontal * 10.2 - Math.sin(yaw) * .92,
      };
      const fraction = shipClearFraction(anchor, camera, ship);
      assert.ok(fraction >= 0 && fraction <= 1);
      if (fraction < 1) retracted++; else full++;
      for (let sample = 0; sample <= 16; sample++) {
        assert.equal(inside(along(anchor, camera, fraction * sample / 16), ship), false,
          `${gate.id} at ${elapsed}s, yaw ${yaw}, pitch ${pitch}, sample ${sample}`);
      }
    }
  }
  assert.ok(retracted > 0 && full > 0, 'only obstructed views retract');
});
