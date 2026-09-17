import test from 'node:test';
import assert from 'node:assert/strict';
import { CAPTAINS_HOUSE, CAPTAINS_HOUSE_SOLIDS } from '../shared/captains-house.js';
import { heightAt } from '../shared/world.js';
import { movePlayer } from '../shared/movement.js';
import { hasWorldLineOfSight, resolveWorldCollision } from '../shared/collision.js';

const base = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
const player = (x = -69, z = 77) => ({ x, z, y: heightAt(x, z), yaw: 0, pitch: 0,
  vy: 0, mode: 'ground', realm: 'island', grounded: true, jumpHeld: false, launchVx: 0, launchVz: 0 });
function walk(p, x, z, dt = .025, sprint = false) {
  for (let i = 0; i < 400 && Math.hypot(x - p.x, z - p.z) > .17; i++) {
    const yaw = Math.atan2(-(x - p.x), -(z - p.z));
    movePlayer(p, { forward: 1, yaw, sprint }, dt);
  }
  assert.ok(Math.hypot(x - p.x, z - p.z) < .35, `reached ${x},${z}; actual ${p.x.toFixed(2)},${p.z.toFixed(2)}`);
}

test('real entrances, two stair runs, attic, balcony, and reverse route are walkable at sprint and short dt', () => {
  for (const [dt, sprint] of [[.05, true], [.025, false]]) {
    const p = player();
    for (const [x, z] of [[-69, 72], [-63, 71], [-63, 59], [-63, 57.7], [-69, 57.7]]) walk(p, x, z, dt, sprint);
    assert.ok(Math.abs(p.y - base - 4.6) < .04, 'reached upper floor');
    walk(p, -69, 73, dt, sprint); walk(p, -69, 76, dt, sprint);
    assert.ok(Math.abs(p.y - base - 4.6) < .04, 'walked out onto balcony');
    for (const [x, z] of [[-69, 72], [-69, 57.7], [-75, 57.7], [-75, 59], [-75, 71], [-72, 72]]) walk(p, x, z, dt, sprint);
    assert.ok(Math.abs(p.y - base - 9.2) < .04, 'reached attic lookout');
    for (const [x, z] of [[-75, 71], [-75, 59], [-75, 57.7], [-63, 57.7], [-63, 59], [-63, 71], [-69, 72], [-69, 77]]) walk(p, x, z, dt, sprint);
    assert.ok(Math.abs(p.y - base) < .1, 'descended both stairs to the terrain');
  }
});

test('walls and balcony rails block bodies and sight, while the central doorway is clear', () => {
  const wall = player(-65, 75);
  for (let i = 0; i < 30; i++) movePlayer(wall, { forward: 1, yaw: 0 }, .05);
  assert.ok(wall.z > 73.9, 'front wall blocks the off-centre approach');
  assert.equal(hasWorldLineOfSight({ x: -65, y: base + 1, z: 76 }, { x: -65, y: base + 1, z: 72 }), false);
  assert.equal(hasWorldLineOfSight({ x: -69, y: base + 1, z: 76 }, { x: -69, y: base + 1, z: 72 }), true);
  assert.equal(hasWorldLineOfSight({ x: -63, y: base + 2, z: 76 }, { x: -63, y: base + 2, z: 72 }), true, 'front window is a real sight opening');
  const rail = { x: -69, z: 78, y: base + 4.6, bodyHeight: 1.65 };
  resolveWorldCollision(rail);
  assert.ok(rail.z < 77.9 || rail.z > 78.1, 'balcony railing pushes body out');
  const atticGuard = { x: -69, z: 74, y: base + 9.2 };
  resolveWorldCollision(atticGuard);
  assert.ok(atticGuard.z < 73.7 || atticGuard.z > 74.3, 'attic front opening has a Juliet rail');
  assert.equal(hasWorldLineOfSight({ x: -69, y: base + 1, z: 65 }, { x: -69, y: base + 8, z: 65 }), false, 'upper floor occludes vertical shot');
});

test('jump hits a real floor underside; leaving an opening falls instead of snapping to a floor', () => {
  const p = player(-69, 65); p.vy = 14; p.grounded = false;
  let highest = p.y;
  for (let i = 0; i < 35; i++) { movePlayer(p, {}, .05); highest = Math.max(highest, p.y); }
  assert.ok(highest < base + 1.26 && highest > base + 1.2, '3.1m avatar head meets upper floor underside');
  assert.ok(Math.abs(p.y - base) < .02, 'lands on ground');
  const downstairs = player(-69, 65);
  walk(downstairs, -68, 64);
  assert.ok(Math.abs(downstairs.y - base) < .02, 'ground route never snaps through upstairs');
  const upper = player(-69, 65); upper.y = base + 4.6;
  movePlayer(upper, {}, .05);
  assert.ok(Math.abs(upper.y - base - 4.6) < .02, 'upper position remains supported');
  // The stair shaft is an actual hole: a player entering it at the upper
  // level must fall when there is no supporting tread beneath the feet.
  upper.x = -63; upper.z = 65; upper.y = base + 4.6; upper.grounded = true;
  for (let i = 0; i < 25; i++) movePlayer(upper, {}, .05);
  assert.ok(upper.y < base + 3.5, 'falls through the stair opening');
  assert.ok(CAPTAINS_HOUSE_SOLIDS.some(s => s.kind === 'floor' && s.level === 2));
});

test('stair flanks and floor edges are solid below each landing', () => {
  const p = player(-67, 65);
  for (let i = 0; i < 30; i++) movePlayer(p, { right: 1, yaw: 0 }, .05);
  assert.ok(p.x < -65.1, 'ground-level avatar cannot cross the first stair from the side');
  const upper = player(-68, 65); upper.y = base + 4.6;
  for (let i = 0; i < 30; i++) movePlayer(upper, { right: -1, yaw: 0 }, .05);
  assert.ok(upper.x > -72.9, 'upper-level avatar cannot cross the second stair from the side');
  const edge = player(-64.6, 65); edge.y = base + 3;
  resolveWorldCollision(edge);
  assert.ok(edge.x > -64.45, 'upper slab edge pushes out a body below its surface');
});

test('cedar roof supports a descending glider and stops an attic head jump', () => {
  const glider = player(-69, 65);
  Object.assign(glider, { y: base + 18, mode: 'gliding', grounded: false, vy: -6 });
  for (let i = 0; i < 70; i++) movePlayer(glider, {}, .05);
  assert.ok(Math.abs(glider.y - base - 16.2) < .02, 'glider lands on pitched ridge');
  assert.equal(glider.grounded, true);
  const attic = player(-69, 65);
  Object.assign(attic, { y: base + 9.2, grounded: false, vy: 18 });
  let highest = attic.y;
  for (let i = 0; i < 40; i++) { movePlayer(attic, {}, .05); highest = Math.max(highest, attic.y); }
  assert.ok(highest <= base + 16.2 - .22 - 3.1 + .001, 'avatar hat stays below pitched roof');
  assert.equal(hasWorldLineOfSight({ x: -69, y: base + 15, z: 65 },
    { x: -69, y: base + 18, z: 65 }), false, 'roof blocks a vertical shot');
});
