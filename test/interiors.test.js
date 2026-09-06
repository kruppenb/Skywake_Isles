import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILDINGS, buildingAt, buildingLocalPoint, buildingWorldPoint, buildingWalls, buildingFurnishings } from '../shared/exploration.js';
import { CHESTS, heightAt, OBSTACLES } from '../shared/world.js';
import { movePlayer, makePlayerPosition } from '../shared/movement.js';
import { resolveWorldCollision, hasWorldLineOfSight } from '../shared/collision.js';
import { makePalette } from '../client/models.js';
import { buildSettlements } from '../client/settlement.js';

const rooms = BUILDINGS.filter(b => b.enterable);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const localPoint = (building, x, z, y = 1.2) => ({ ...buildingWorldPoint(building, x, z), y: heightAt(building.x, building.z) + y });
const ground = point => ({ ...makePlayerPosition(), ...point, y: heightAt(point.x, point.z), mode: 'ground', grounded: true });
function walk(player, target, label) {
  let steps = 0;
  while (distance(player, target) > .000001 && steps++ < 300) {
    const remaining = distance(player, target), step = Math.min(.4, remaining);
    const expected = { x: player.x + (target.x - player.x) * step / remaining, z: player.z + (target.z - player.z) * step / remaining };
    movePlayer(player, { forward: 1, yaw: Math.atan2(-(target.x - player.x), -(target.z - player.z)) }, step / 8, 30);
    assert.ok(distance(player, expected) < .000001, `${label}: unobstructed at ${JSON.stringify(expected)}`);
    assert.equal(player.mode, 'ground', `${label}: no jump or rescue`);
    assert.ok(Math.abs(player.y - heightAt(player.x, player.z)) < .000001);
  }
  assert.ok(steps < 300, `${label}: reached target`);
}

test('nine rooms preserve existing IDs and append one reachable chest each', () => {
  assert.equal(rooms.length, 9);
  assert.equal(BUILDINGS.at(-1).id, 'watch-barracks');
  assert.equal(CHESTS.length, 35);
  for (const building of rooms) {
    assert.ok(building.doorWidth >= 2.2);
    assert.equal(buildingAt(building.x, building.z), building);
    const chest = CHESTS.filter(c => c.buildingId === building.id);
    assert.equal(chest.length, 1);
    assert.equal(buildingAt(chest[0].x, chest[0].z), building);
    assert.ok(buildingFurnishings(building).length >= 2, `${building.id}: furnished perimeter`);
    for (const end of [-1, 1]) {
      const p = ground(buildingWorldPoint(building, 0, end * (building.depth / 2 + 3)));
      walk(p, chest[0], `${building.id} interior loot from ${end}`);
      assert.ok(hasWorldLineOfSight({ ...p, y: p.y + 1.25 }, { ...chest[0], y: p.y + .8 }));
    }
  }
});

test('all front and rear doors admit movement both ways across their usable width', () => {
  for (const building of rooms) for (const offset of [-.45, 0, .45]) {
    const front = buildingWorldPoint(building, offset, building.depth / 2 + 3);
    const rear = buildingWorldPoint(building, offset, -building.depth / 2 - 3);
    const player = ground(front);
    walk(player, rear, `${building.id} front to rear at ${offset}`);
    walk(player, front, `${building.id} rear to front at ${offset}`);
    const before = { ...player };
    for (let step = 0; step < 100; step++) movePlayer(player, { yaw: player.yaw }, .05, 30);
    assert.ok(distance(player, before) < .000001, `${building.id}: releasing movement holds position`);
  }
});

test('rotated solid walls stop players and shots while both open doors transmit shots', () => {
  for (const building of rooms) {
    const floor = heightAt(building.x, building.z);
    for (const side of [-1, 1]) {
      const player = ground(buildingWorldPoint(building, side * (building.width / 2 + 1.3), 0));
      const target = localPoint(building, 0, 0);
      for (let step = 0; step < 25; step++) movePlayer(player, { forward: 1, yaw: Math.atan2(-(target.x - player.x), -(target.z - player.z)) }, .05, 30);
      const local = buildingLocalPoint(building, player.x, player.z);
      assert.ok(side * local.x >= building.width / 2 + .5999, `${building.id}: side wall blocks`);
      assert.ok(!hasWorldLineOfSight(localPoint(building, side * (building.width / 2 + 1), 0), localPoint(building, 0, 0)), `${building.id}: no wall shots`);
    }
    const front = localPoint(building, 0, building.depth / 2 + 2), rear = localPoint(building, 0, -building.depth / 2 - 2);
    assert.ok(hasWorldLineOfSight(front, rear, .05), `${building.id}: through open doorways`);
    assert.ok(!hasWorldLineOfSight({ ...front, y: floor + 3 }, { ...rear, y: floor + 3 }), `${building.id}: lintel blocks high shots`);
    assert.ok(hasWorldLineOfSight({ ...front, y: floor + building.height + 1 }, { ...rear, y: floor + building.height + 1 }), `${building.id}: clearance above collider`);
    for (const wall of buildingWalls(building).filter(w => !w.bottom)) {
      const center = localPoint(building, wall.x, wall.z, .2);
      const player = { ...center }; resolveWorldCollision(player);
      assert.ok(distance(center, player) > .59, `${building.id}: solid wall never contains player`);
    }
  }
});

test('floors, thresholds, and their rendered 2m grid remain flat with smooth approaches', () => {
  for (const building of rooms) {
    const floor = heightAt(building.x, building.z);
    for (let x = -building.width / 2; x <= building.width / 2; x += .4) for (let z = -building.depth / 2; z <= building.depth / 2; z += .4) {
      const point = buildingWorldPoint(building, x, z);
      assert.ok(Math.abs(heightAt(point.x, point.z) - floor) < .000001, `${building.id}: flat floor`);
      // All terrain vertices of the containing quad must be level, so the
      // rendered triangles cannot protrude through the interior floor.
      for (const gridX of [Math.floor(point.x / 2) * 2, Math.ceil(point.x / 2) * 2]) for (const gridZ of [Math.floor(point.z / 2) * 2, Math.ceil(point.z / 2) * 2]) {
        assert.ok(Math.abs(heightAt(gridX, gridZ) - floor) < .000001, `${building.id}: rendered floor is clear`);
      }
    }
    for (const end of [-1, 1]) for (let z = building.depth / 2; z < building.depth / 2 + 6; z += .04) {
      const a = buildingWorldPoint(building, 0, end * z), b = buildingWorldPoint(building, 0, end * (z + .04));
      assert.ok(Math.abs(heightAt(a.x, a.z) - heightAt(b.x, b.z)) < .05, `${building.id}: smooth threshold approach`);
    }
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 16) for (let r = 0; r < building.radius + 8; r += .05) {
      const a = { x: building.x + Math.sin(angle) * r, z: building.z + Math.cos(angle) * r };
      assert.ok(Math.abs(heightAt(a.x + .01, a.z) - heightAt(a.x, a.z)) < .04, `${building.id}: no rotated apron discontinuity`);
    }
  }
});

test('gliders land inside rooms and collision still respects tall original props', () => {
  for (const building of rooms) {
    const player = { ...ground(building), y: heightAt(building.x, building.z) + building.height + 3, mode: 'gliding', grounded: false };
    for (let step = 0; step < 100; step++) movePlayer(player, {}, .05, 30);
    assert.equal(player.mode, 'ground'); assert.equal(buildingAt(player.x, player.z), building);
    assert.ok(distance(player, building) < .000001, `${building.id}: no circular interior keepout`);
  }
  const prop = OBSTACLES[0], floor = heightAt(prop.x, prop.z);
  const a = { x: prop.x - prop.radius - 1, z: prop.z, y: floor + 1 }, b = { x: prop.x + prop.radius + 1, z: prop.z, y: floor + 1 };
  assert.equal(hasWorldLineOfSight(a, b), false);
  assert.equal(hasWorldLineOfSight({ ...a, y: floor + prop.height + 1 }, { ...b, y: floor + prop.height + 1 }), true);
  assert.equal(buildingAt(NaN, 2), null);
  assert.equal(hasWorldLineOfSight({ x: NaN, z: 0 }, b), false);
});

test('cutaway keeps furnished floors visible, restores exteriors, and clears doorway props', () => {
  const settlement = buildSettlements(makePalette());
  assert.equal(settlement.stats.enterableBuildings, 9);
  for (const building of rooms) {
    const roof = settlement.group.getObjectByName(building.id + '-cutaway-roof');
    const walls = settlement.group.getObjectByName(building.id + '-cutaway-walls');
    assert.ok(roof && walls, `${building.id}: separate cover meshes`);
    assert.equal(walls.children.length, 4);
    const camera = buildingWorldPoint(building, 7, 6);
    settlement.animate(1, { player: ground(building), camera, reducedMotion: true });
    assert.equal(roof.visible, false); assert.equal(walls.visible, true);
    assert.equal(walls.children.filter(face => face.visible).length, 2, 'two opposite room walls stay visible');
    for (const face of walls.children) {
      const normal = face.userData.normal;
      assert.equal(face.visible, normal.x < 0 || normal.z < 0, 'only camera-facing walls cut away');
    }
    assert.equal(settlement.group.getObjectByName(building.poiId + '-architecture-and-work-sites').visible, true);
    settlement.animate(1, { player: null, reducedMotion: true });
    assert.equal(roof.visible, true); assert.equal(walls.visible, true);
    assert.ok(walls.children.every(face => face.visible), 'all four faces restore outside');
    settlement.animate(1, { player: ground(building), camera: buildingWorldPoint(building, 0, -7) });
    assert.equal(walls.children.filter(face => face.visible).length, 3, 'a centered camera removes only the nearest wall');
    settlement.animate(1, { player: ground(building) });
    assert.ok(walls.children.filter(face => face.visible).length >= 2, 'yaw fallback preserves the room backdrop');
    settlement.animate(1, { player: { ...ground(building), y: heightAt(building.x, building.z) + building.height + 1, mode: 'gliding' } });
    assert.equal(roof.visible, false, 'landing clears the roof before passing through it');
    assert.ok(walls.children.filter(face => face.visible).length >= 2, 'gliders retain room walls');
    for (const site of settlement.group.userData.propSites) {
      const local = buildingLocalPoint(building, site.x, site.z);
      assert.ok(Math.abs(local.x) >= building.doorWidth / 2 + site.radius + .5 || Math.abs(local.z) >= building.depth / 2 + site.radius + 3, `${building.id}: ${JSON.stringify(site)} clears both doorway approaches`);
    }
  }
});
