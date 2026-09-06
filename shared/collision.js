import { OBSTACLES, heightAt } from './world.js';
import { BUILDINGS, buildingLocalPoint, buildingWorldPoint, buildingWalls, buildingFurnishings } from './exploration.js';

const enterableIds = new Set(BUILDINGS.filter(b => b.enterable).map(b => b.id));
const props = OBSTACLES.filter(o => !enterableIds.has(o.buildingId));
const rooms = BUILDINGS.filter(b => b.enterable).map(building => ({
  building, boxes: [...buildingWalls(building), ...buildingFurnishings(building)],
}));

function pushFromBox(point, box, radius) {
  const minX = box.x - box.width / 2, maxX = box.x + box.width / 2;
  const minZ = box.z - box.depth / 2, maxZ = box.z + box.depth / 2;
  const nearX = Math.max(minX, Math.min(maxX, point.x)), nearZ = Math.max(minZ, Math.min(maxZ, point.z));
  const dx = point.x - nearX, dz = point.z - nearZ, distance = Math.hypot(dx, dz);
  if (distance >= radius) return;
  if (distance > .000001) {
    point.x = nearX + dx / distance * radius; point.z = nearZ + dz / distance * radius;
  } else {
    const sides = [
      { distance: point.x - minX, axis: 'x', value: minX - radius },
      { distance: maxX - point.x, axis: 'x', value: maxX + radius },
      { distance: point.z - minZ, axis: 'z', value: minZ - radius },
      { distance: maxZ - point.z, axis: 'z', value: maxZ + radius },
    ].sort((a, b) => a.distance - b.distance);
    point[sides[0].axis] = sides[0].value;
  }
}

function overlapsBox(point, box, radius) {
  const dx = Math.max(Math.abs(point.x - box.x) - box.width / 2, 0);
  const dz = Math.max(Math.abs(point.z - box.z) - box.depth / 2, 0);
  return dx * dx + dz * dz < (radius - .000001) ** 2;
}

export function resolveWorldCollision(entity, radius = .6) {
  if (!Number.isFinite(entity.x) || !Number.isFinite(entity.z)) return entity;
  radius = Number.isFinite(radius) ? Math.max(0, radius) : .6;
  const y = Number.isFinite(entity.y) ? entity.y : heightAt(entity.x, entity.z);
  const bodyHeight = Number.isFinite(entity.bodyHeight) ? entity.bodyHeight : 1.65;
  for (const obstacle of props) {
    if (y >= heightAt(obstacle.x, obstacle.z) + obstacle.height + .4) continue;
    const dx = entity.x - obstacle.x, dz = entity.z - obstacle.z, distance = Math.hypot(dx, dz), reach = obstacle.radius + radius;
    if (distance < reach) {
      entity.x = obstacle.x + (distance > .000001 ? dx / distance : 1) * reach;
      entity.z = obstacle.z + (distance > .000001 ? dz / distance : 0) * reach;
    }
  }
  for (const { building, boxes } of rooms) {
    if (Math.abs(entity.x - building.x) > building.radius + radius || Math.abs(entity.z - building.z) > building.radius + radius) continue;
    const local = buildingLocalPoint(building, entity.x, entity.z), floor = heightAt(building.x, building.z);
    const original = { ...local }, active = boxes.filter(box => y < floor + box.top && y + bodyHeight > floor + box.bottom);
    // Repeating handles adjoining segments and furniture at a corner without
    // leaving the player embedded in the wall that was resolved first.
    for (let pass = 0; pass < 3; pass++) for (const box of active) pushFromBox(local, box, radius);
    if (active.some(box => overlapsBox(local, box, radius))) {
      // A descending glider can begin in the narrow gap between furniture and
      // a wall. Find the closest free spot instead of alternating penetrations.
      search: for (let reach = .12; reach <= 3; reach += .12) for (let direction = 0; direction < 32; direction++) {
        const angle = direction * Math.PI / 16;
        const candidate = { x: original.x + Math.cos(angle) * reach, z: original.z + Math.sin(angle) * reach };
        if (active.every(box => !overlapsBox(candidate, box, radius))) { local.x = candidate.x; local.z = candidate.z; break search; }
      }
    }
    const result = buildingWorldPoint(building, local.x, local.z);
    entity.x = result.x; entity.z = result.z;
  }
  return entity;
}

function segmentBox(a, b, box, padding, floor) {
  let enter = 0, exit = 1;
  const bounds = { x: [box.x - box.width / 2 - padding, box.x + box.width / 2 + padding],
    z: [box.z - box.depth / 2 - padding, box.z + box.depth / 2 + padding],
    y: [floor + box.bottom - padding, floor + box.top + padding] };
  for (const axis of ['x', 'y', 'z']) {
    const delta = b[axis] - a[axis], [min, max] = bounds[axis];
    if (Math.abs(delta) < .00000001) { if (a[axis] < min || a[axis] > max) return false; continue; }
    let first = (min - a[axis]) / delta, last = (max - a[axis]) / delta;
    if (first > last) [first, last] = [last, first];
    enter = Math.max(enter, first); exit = Math.min(exit, last);
    if (enter > exit) return false;
  }
  return exit >= 0 && enter <= 1;
}

export function hasWorldLineOfSight(from, to, padding = 0) {
  if (![from?.x, from?.z, to?.x, to?.z].every(Number.isFinite)) return false;
  padding = Number.isFinite(padding) ? Math.max(0, padding) : 0;
  const a = { ...from, y: Number.isFinite(from.y) ? from.y : heightAt(from.x, from.z) + 1 },
    b = { ...to, y: Number.isFinite(to.y) ? to.y : heightAt(to.x, to.z) + 1 };
  for (const obstacle of props) {
    const dx = b.x - a.x, dz = b.z - a.z, ox = a.x - obstacle.x, oz = a.z - obstacle.z;
    const radius = obstacle.radius + padding, length = dx * dx + dz * dz;
    let enter = 0, exit = 1;
    if (length < .00000001) { if (ox * ox + oz * oz > radius * radius) continue; }
    else {
      const dot = ox * dx + oz * dz, discriminant = dot * dot - length * (ox * ox + oz * oz - radius * radius);
      if (discriminant < 0) continue;
      const root = Math.sqrt(discriminant); enter = Math.max(0, (-dot - root) / length); exit = Math.min(1, (-dot + root) / length);
      if (enter > exit) continue;
    }
    const lowY = Math.min(a.y + (b.y - a.y) * enter, a.y + (b.y - a.y) * exit);
    const highY = Math.max(a.y + (b.y - a.y) * enter, a.y + (b.y - a.y) * exit);
    const floor = heightAt(obstacle.x, obstacle.z);
    if (highY >= floor - padding && lowY <= floor + obstacle.height + padding) return false;
  }
  for (const { building, boxes } of rooms) {
    const start = { ...buildingLocalPoint(building, a.x, a.z), y: a.y }, end = { ...buildingLocalPoint(building, b.x, b.z), y: b.y };
    const floor = heightAt(building.x, building.z);
    if (boxes.some(box => segmentBox(start, end, box, padding, floor))) return false;
  }
  return true;
}
