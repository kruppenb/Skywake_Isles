import test from 'node:test';
import assert from 'node:assert/strict';
import { POINTS_OF_INTEREST, BUILDINGS, EXPLORATION_TRAILS, RESIDENTS, EXPLORATION_CHESTS, pointOfInterestAt, trailDistance } from '../shared/exploration.js';
import { BEACON, SPAWN, SHRINES, CHESTS, OBSTACLES, heightAt } from '../shared/world.js';
import { makePlayerPosition, movePlayer } from '../shared/movement.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function ground(point) {
  return { ...makePlayerPosition(), x: point.x, z: point.z, y: heightAt(point.x, point.z), mode: 'ground', grounded: true };
}

// Exercise the authority/prediction movement implementation, not a second
// collision approximation. Exact short steps reveal any collision deflection
// or shoreline rescue even if steering could eventually reach the destination.
function walk(points, label) {
  const p = ground(points[0]);
  for (const target of points.slice(1)) {
    let steps = 0;
    while (distance(p, target) > 0.00001 && steps++ < 1600) {
      const before = { x: p.x, z: p.z }, remaining = distance(p, target);
      const step = Math.min(0.4, remaining), dt = step / 8;
      const wanted = { x: p.x + (target.x - p.x) * step / remaining, z: p.z + (target.z - p.z) * step / remaining };
      movePlayer(p, { forward: 1, yaw: Math.atan2(-(target.x - p.x), -(target.z - p.z)) }, dt, 30);
      assert.ok(distance(p, wanted) < 0.00001, `${label}: blocked or rescued near (${before.x.toFixed(2)}, ${before.z.toFixed(2)})`);
      assert.equal(p.mode, 'ground', `${label}: route stays on foot`);
      assert.ok(Math.abs(p.y - heightAt(p.x, p.z)) < 0.00001, `${label}: grounded on terrain`);
      assert.ok(p.y >= 0.3, `${label}: route never enters water`);
    }
    assert.ok(steps < 1600, `${label}: reaches (${target.x}, ${target.z})`);
  }
  return p;
}

function connectedRoute(trail, visited = new Set()) {
  assert.ok(!visited.has(trail.id), `No circular trail dependency at ${trail.id}`);
  visited.add(trail.id);
  const start = trail.points[0];
  if ([SPAWN, ...SHRINES].some(end => segmentDistance(start, BEACON, end) < 0.00001)) {
    return [BEACON, ...trail.points];
  }
  const parent = EXPLORATION_TRAILS.find(other => other.id !== trail.id && distance(other.points.at(-1), start) < 0.00001);
  assert.ok(parent, `${trail.id}: connects to an original route or another destination`);
  return [...connectedRoute(parent, visited), ...trail.points.slice(1)];
}

test('eight places and append-only loot/obstacle IDs preserve the original island', () => {
  assert.equal(POINTS_OF_INTEREST.length, 8);
  assert.ok(BUILDINGS.length >= 14);
  assert.equal(RESIDENTS.length, 10);
  assert.equal(new Set(POINTS_OF_INTEREST.map(p => p.id)).size, 8);
  assert.equal(new Set(BUILDINGS.map(p => p.id)).size, BUILDINGS.length);
  assert.equal(new Set(RESIDENTS.map(p => p.id)).size, RESIDENTS.length);
  const originalChests = [[0, 88], [-8, 97], [9, 100], [-16, 66], [18, 52], [-32, 36], [-56, 26], [-83, -1], [-93, 31], [-25, -26], [17, -38], [39, -52], [61, -83], [79, -49], [87, 18], [64, 50], [97, 53], [13, 15]];
  assert.deepEqual(CHESTS.slice(0, 18), originalChests.map(([x, z], i) => ({ id: `chest-${i + 1}`, x, z })));
  assert.deepEqual(CHESTS.slice(18), EXPLORATION_CHESTS);
  assert.deepEqual(EXPLORATION_CHESTS.map(c => c.id), Array.from({ length: 8 }, (_, i) => `chest-${19 + i}`));
  assert.deepEqual(OBSTACLES.slice(0, 34).map(o => o.id), Array.from({ length: 34 }, (_, i) => `prop-${i + 1}`));
  assert.equal(OBSTACLES[0].x, -24);
  assert.equal(OBSTACLES[33].type, 'landmark');
  assert.equal(OBSTACLES.length, 34 + BUILDINGS.length);
  for (const place of POINTS_OF_INTEREST) {
    assert.ok(BUILDINGS.some(b => b.poiId === place.id), `${place.id} has architecture`);
    assert.ok(RESIDENTS.some(r => r.poiId === place.id), `${place.id} has a resident`);
    assert.equal(EXPLORATION_CHESTS.filter(c => pointOfInterestAt(c.x, c.z)?.id === place.id).length, 1, `${place.id} has one new chest`);
  }
});

test('place and trail lookups handle boundaries, segments and invalid input', () => {
  for (const place of POINTS_OF_INTEREST) {
    assert.equal(pointOfInterestAt(place.x, place.z), place);
    assert.equal(pointOfInterestAt(place.x + place.radius, place.z), place);
  }
  for (const trail of EXPLORATION_TRAILS) for (let i = 1; i < trail.points.length; i++) {
    const a = trail.points[i - 1], b = trail.points[i];
    assert.ok(trailDistance((a.x + b.x) / 2, (a.z + b.z) / 2) < 0.00001);
  }
  assert.equal(pointOfInterestAt(0, 4), null);
  assert.ok(trailDistance(130, -110) > 30);
  for (const invalid of [NaN, Infinity, -Infinity, undefined, '5']) {
    assert.equal(pointOfInterestAt(invalid, 0), null);
    assert.equal(pointOfInterestAt(0, invalid), null);
    assert.equal(trailDistance(invalid, 0), Infinity);
    assert.equal(trailDistance(0, invalid), Infinity);
  }
});

test('every place and its chest can be walked to from the beacon and back', () => {
  for (const trail of EXPLORATION_TRAILS) {
    const place = POINTS_OF_INTEREST.find(p => p.id === trail.id);
    const route = connectedRoute(trail);
    walk([...route, place], `${place.name} approach`);
    walk([place, ...route.toReversed()], `${place.name} return`);
    const chest = EXPLORATION_CHESTS.find(c => pointOfInterestAt(c.x, c.z)?.id === place.id);
    walk([...route, chest], `${chest.id} approach`);
    walk([chest, ...route.toReversed()], `${chest.id} return`);
  }
});

test('trails have room to walk abreast and all building footprints clear the paths', () => {
  for (const trail of EXPLORATION_TRAILS) for (let i = 1; i < trail.points.length; i++) {
    const a = trail.points[i - 1], b = trail.points[i], length = distance(a, b);
    const normal = { x: -(b.z - a.z) / length, z: (b.x - a.x) / length };
    for (const side of [-2.5, 2.5]) {
      const edge = [a, b].map(p => ({ x: p.x + normal.x * side, z: p.z + normal.z * side }));
      walk(edge, `${trail.id} edge ${side}`);
      walk(edge.toReversed(), `${trail.id} reverse edge ${side}`);
    }
    for (const building of BUILDINGS) {
      assert.ok(segmentDistance(building, a, b) >= building.radius + 3.1, `${building.id} leaves a broad ${trail.id} trail`);
    }
  }
});

test('resident work loops use real movement without clipping buildings, loot or objectives', () => {
  for (const resident of RESIDENTS) {
    const place = POINTS_OF_INTEREST.find(p => p.id === resident.poiId);
    assert.ok(place, `${resident.id} belongs to a place`);
    assert.ok(resident.route.length >= 3);
    assert.ok(resident.phase >= 0 && resident.phase < 1);
    const loop = [...resident.route, resident.route[0]];
    walk(loop, `${resident.name} work loop`);
    walk(loop.toReversed(), `${resident.name} reverse work loop`);
    for (let i = 1; i < loop.length; i++) {
      assert.ok(distance(loop[i], place) <= place.radius + 2, `${resident.name} stays at their work site`);
      for (const target of [...CHESTS, ...SHRINES, BEACON]) {
        assert.ok(segmentDistance(target, loop[i - 1], loop[i]) >= 2, `${resident.name} leaves ${target.id} clear`);
      }
    }
  }
});

test('new buildings collide in authority movement and preserve loot/objective clearances', () => {
  for (const building of BUILDINGS) {
    const obstacle = OBSTACLES.find(o => o.buildingId === building.id);
    assert.deepEqual(obstacle, { id: `building-${building.id}`, type: 'building', x: building.x, z: building.z, radius: building.radius, height: building.height, buildingId: building.id });
    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
      const boundary = { x: building.x + Math.cos(angle) * building.radius, z: building.z + Math.sin(angle) * building.radius };
      assert.ok(heightAt(boundary.x, boundary.z) >= 0.3, `${building.id} footprint stays on land`);
    }
    for (const target of CHESTS) assert.ok(distance(building, target) >= building.radius + 1.5, `${building.id} leaves ${target.id} accessible`);
    for (const target of [BEACON, SPAWN, ...SHRINES]) assert.ok(distance(building, target) >= building.radius + 12, `${building.id} preserves ${target.id ?? 'spawn'} gathering/arena space`);
    for (const other of OBSTACLES.filter(o => o.id !== obstacle.id)) {
      assert.ok(distance(building, other) >= building.radius + other.radius + 1, `${building.id} does not overlap ${other.id}`);
    }
    for (const axis of [{ x: 1, z: 0 }, { x: -1, z: 0 }, { x: 0, z: 1 }, { x: 0, z: -1 }]) {
      const p = ground({ x: building.x + axis.x * (building.radius + 1.2), z: building.z + axis.z * (building.radius + 1.2) });
      for (let step = 0; step < 30; step++) {
        movePlayer(p, { forward: 1, yaw: Math.atan2(axis.x, axis.z) }, 0.05, 30);
        assert.ok(distance(p, building) >= building.radius + 0.59999, `${building.id} blocks entry`);
      }
      assert.ok(distance(p, building) <= building.radius + 0.60001, `${building.id} has a reachable wall`);
    }
  }
});
