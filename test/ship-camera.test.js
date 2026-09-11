import test from 'node:test';
import assert from 'node:assert/strict';
import { shipClearFraction, SHIP_CAMERA_BOX } from '../client/camera.js';
import { SHIP_JUMP_POINTS, jumpLaunchPose } from '../shared/airship.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';
import { SHIP_DURATION, shipAt } from '../shared/world.js';

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

test('a departing pirate outruns the ship under way, so the chase camera is never pinned to the pirate', () => {
  // The bow gate faces the direction of flight. A pirate merely dropped ahead
  // of the bow was overtaken by the hull within a second of the opening voyage,
  // with the camera box holding the anchor and the view collapsing onto the
  // pirate's head. The launch shove has to beat 5.8 m/s of ship even while the
  // pirate backs toward it or steers sideways, from either gate, at any time.
  // Steering back toward the ship is the pirate's own doing: the shove still
  // wins long enough for the camera to open up, but the padded box may then
  // legitimately pull it in again for a moment as they fly back under the bow.
  const BACK = 10.2;
  for (const gate of SHIP_JUMP_POINTS) for (const start of [0, 3, 14, 27, SHIP_DURATION + 60]) {
    for (const input of [{}, { forward: 1 }, { right: 1 }, { right: -1 }, { forward: -1 }, { forward: -1, sprint: true }]) {
      const backing = input.forward < 0;
      const label = `${gate.id} at ${start}s with ${JSON.stringify(input)}`;
      const p = { ...makePlayerPosition(), ...jumpLaunchPose(gate, shipAt(start)), mode: 'gliding', grounded: false, vy: -6 };
      let elapsed = start, released = null, closest = 1, pinned = 0;
      for (let step = 0; step < 80 && p.mode === 'gliding'; step++) {
        const ship = shipAt(elapsed);
        const anchor = { x: p.x, y: p.y + 2.7, z: p.z };
        if (!backing) assert.equal(inside(anchor, ship), false, `${label}: the pirate is clear of the hull at step ${step}`);
        // Looking outward along the gate puts the camera between the pirate
        // and the ship: the worst case for the chase distance.
        const yaw = gate.yaw, pitch = -.16, horizontal = Math.cos(pitch);
        const camera = {
          x: anchor.x + Math.sin(yaw) * horizontal * BACK + Math.cos(yaw) * .92,
          y: anchor.y - Math.sin(pitch) * BACK,
          z: anchor.z + Math.cos(yaw) * horizontal * BACK - Math.sin(yaw) * .92,
        };
        const fraction = shipClearFraction(anchor, camera, ship);
        closest = Math.min(closest, fraction);
        if (fraction === 0) pinned += .05;
        if (fraction === 1 && released === null) released = step * .05;
        movePlayer(p, { yaw, ...input }, .05, elapsed += .05);
      }
      if (!backing) assert.ok(closest * BACK >= 1.5, `${label}: the camera stays at least 1.5 m back (${(closest * BACK).toFixed(1)} m)`);
      else assert.ok(pinned <= 1, `${label}: flying back under the hull pins the camera only briefly (${pinned.toFixed(2)} s)`);
      assert.ok(released !== null && released <= 2, `${label}: the full chase distance returns within 2 s (${released})`);
    }
  }
});
