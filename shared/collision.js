import { OBSTACLES, heightAt } from './world.js';
import { BUILDINGS, buildingLocalPoint, buildingWorldPoint, buildingWalls, buildingFurnishings } from './exploration.js';
import { CAPTAINS_HOUSE, CAPTAINS_HOUSE_SOLIDS, CAPTAINS_HOUSE_STAIRS,
  CAPTAINS_HOUSE_ROOF, captainsHouseRoofHeight } from './captains-house.js';

const enterableIds = new Set(BUILDINGS.filter(b => b.enterable).map(b => b.id));
const props = OBSTACLES.filter(o => !enterableIds.has(o.buildingId));
const rooms = BUILDINGS.filter(b => b.enterable).map(building => ({
  building, boxes: [...buildingWalls(building), ...buildingFurnishings(building)],
})).concat([{ building: CAPTAINS_HOUSE, boxes: CAPTAINS_HOUSE_SOLIDS
  .filter(solid => solid.kind !== 'floor' && solid.kind !== 'stair')
  .map(solid => ({ ...solid, bottom: solid.y - solid.height / 2, top: solid.y + solid.height / 2 })) }]);
const houseSightBoxes = CAPTAINS_HOUSE_SOLIDS.map(solid => ({ ...solid,
  bottom: solid.y - solid.height / 2, top: solid.y + solid.height / 2 }));

export function houseSupportAt(x, z, footY, maxRise = .65) {
  if (!Number.isFinite(x) || !Number.isFinite(z) ||
      Math.abs(x - CAPTAINS_HOUSE.x) > 14 || Math.abs(z - CAPTAINS_HOUSE.z) > 14) return null;
  const local = buildingLocalPoint(CAPTAINS_HOUSE, x, z);
  const base = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
  let support = null;
  for (const solid of CAPTAINS_HOUSE_SOLIDS) {
    if (solid.kind !== 'floor' || Math.abs(local.x - solid.x) > solid.width / 2 - .05 ||
        Math.abs(local.z - solid.z) > solid.depth / 2 - .05) continue;
    const top = base + solid.y + solid.height / 2;
    if (top <= footY + maxRise && (support === null || top > support)) support = top;
  }
  for (const stair of CAPTAINS_HOUSE_STAIRS) {
    const run = stair.zEnd - stair.zStart;
    const t = (local.z - stair.zStart) / run;
    if (Math.abs(local.x - stair.x) > stair.width / 2 - .1 || t < 0 || t > 1) continue;
    const top = base + stair.bottom + t * (stair.top - stair.bottom);
    if (top <= footY + maxRise && (support === null || top > support)) support = top;
  }
  const roof = CAPTAINS_HOUSE_ROOF;
  if (Math.abs(local.x) <= roof.halfWidth && Math.abs(local.z) <= roof.halfDepth) {
    const top = base + captainsHouseRoofHeight(local.x);
    if (top <= footY + maxRise && (support === null || top > support)) support = top;
  }
  return support;
}

// Ceiling/floor underside along the player's vertical motion. A jumping
// pirate reaches the slab only if the target footprint is actually floored.
export function houseCeilingAt(x, z, footY, bodyHeight = 3.1) {
  const local = buildingLocalPoint(CAPTAINS_HOUSE, x, z);
  const base = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
  let ceiling = Infinity;
  for (const solid of CAPTAINS_HOUSE_SOLIDS) {
    if (solid.kind !== 'floor' || Math.abs(local.x - solid.x) > solid.width / 2 ||
        Math.abs(local.z - solid.z) > solid.depth / 2) continue;
    const underside = base + solid.y - solid.height / 2;
    if (underside >= footY + bodyHeight - .001) ceiling = Math.min(ceiling, underside);
  }
  const roof = CAPTAINS_HOUSE_ROOF;
  if (Math.abs(local.x) <= roof.halfWidth && Math.abs(local.z) <= roof.halfDepth) {
    const underside = base + captainsHouseRoofHeight(local.x) - roof.thickness;
    if (underside >= footY + bodyHeight - .001) ceiling = Math.min(ceiling, underside);
  }
  return ceiling;
}

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
    const houseBodyHeight = building.id === CAPTAINS_HOUSE.id ? Math.max(bodyHeight, 3.1) : bodyHeight;
    const original = { ...local }, active = boxes.filter(box => y < floor + box.top && y + houseBodyHeight > floor + box.bottom);
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
  if (Math.abs(entity.x - CAPTAINS_HOUSE.x) < 12 && Math.abs(entity.z - CAPTAINS_HOUSE.z) < 12) {
    const local = buildingLocalPoint(CAPTAINS_HOUSE, entity.x, entity.z);
    const base = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
    // The lip of a floor is solid below its walking surface. The last .65m
    // remains open to a player stepping from the matching stair landing.
    for (const solid of CAPTAINS_HOUSE_SOLIDS) {
      if (solid.kind !== 'floor') continue;
      const bottom = base + solid.y - solid.height / 2, top = bottom + solid.height;
      if (y < top - .65 && y + Math.max(bodyHeight, 3.1) > bottom + .001) pushFromBox(local, solid, radius);
    }
    // The stair volume blocks a side approach from below its slope, but the
    // continuous ramp stays traversable at sprint speed from its foot.
    for (const stair of CAPTAINS_HOUSE_STAIRS) {
      const t = (local.z - stair.zStart) / (stair.zEnd - stair.zStart);
      if (t < 0 || t > 1 || y + Math.max(bodyHeight, 3.1) <= base + stair.bottom || y >= base + stair.top) continue;
      const surface = base + stair.bottom + t * (stair.top - stair.bottom);
      if (surface <= y + .65) continue;
      pushFromBox(local, { x: stair.x, z: (stair.zStart + stair.zEnd) / 2,
        width: stair.width, depth: Math.abs(stair.zEnd - stair.zStart) }, radius);
    }
    const result = buildingWorldPoint(CAPTAINS_HOUSE, local.x, local.z);
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

function segmentHouseRoof(a, b, padding, base) {
  const roof = CAPTAINS_HOUSE_ROOF;
  for (const side of [-1, 1]) {
    const roofAt = x => base + roof.ridge - side * x * (roof.ridge - roof.eave) / roof.halfWidth;
    const da = a.y - roofAt(a.x), db = b.y - roofAt(b.x);
    const candidates = [0, 1];
    for (const boundary of [-roof.thickness - padding, padding]) {
      if (Math.abs(db - da) > 1e-9) candidates.push((boundary - da) / (db - da));
    }
    for (const t of candidates) {
      if (t < 0 || t > 1) continue;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const d = da + (db - da) * t;
      if (side * x >= -padding && side * x <= roof.halfWidth + padding &&
          Math.abs(z) <= roof.halfDepth + padding &&
          d >= -roof.thickness - padding - 1e-7 && d <= padding + 1e-7) return true;
    }
  }
  return false;
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
  const houseStart = { ...buildingLocalPoint(CAPTAINS_HOUSE, a.x, a.z), y: a.y };
  const houseEnd = { ...buildingLocalPoint(CAPTAINS_HOUSE, b.x, b.z), y: b.y };
  const houseBase = heightAt(CAPTAINS_HOUSE.x, CAPTAINS_HOUSE.z);
  if (houseSightBoxes.some(box => segmentBox(houseStart, houseEnd, box, padding, houseBase))) return false;
  if (segmentHouseRoof(houseStart, houseEnd, padding, houseBase)) return false;
  return true;
}
