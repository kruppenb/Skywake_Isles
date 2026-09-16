import * as THREE from 'three';
import { REEF_BOUNDS, REEF_EXIT, REEF_SOLIDS } from '../shared/underwater.js';

const MAX_STEP = 1 / 60;
const MAX_FRAME = .12;
const SCHOOL_SPECS = Object.freeze([
  // The first pocket is deliberately beside the return current, so the dive
  // has living motion before a swimmer reaches the old wreck.
  { id: 'entry-current', x: REEF_EXIT.x - 5, y: 7.2, z: REEF_EXIT.z + 6, rx: 4.3, ry: 1.25, rz: 3.6, count: 11, hue: '#e9b264' },
  { id: 'garden-terrace', x: -51, y: 14, z: 65, rx: 7, ry: 2.2, rz: 5, count: 12, hue: '#f1ad76' },
  { id: 'kelp-lane', x: -78, y: 14, z: -12, rx: 7, ry: 2.5, rz: 5, count: 10, hue: '#b9d98b' },
  { id: 'bell-approach', x: 1, y: 14, z: -113, rx: 6, ry: 2.4, rz: 4.5, count: 9, hue: '#d6c278' },
  { id: 'ember-current', x: 72, y: 15, z: -51, rx: 6.5, ry: 2.2, rz: 5.2, count: 12, hue: '#ef956d' },
  { id: 'crown-lane', x: 111, y: 15, z: 34, rx: 6.4, ry: 2.5, rz: 5.8, count: 10, hue: '#cbb4e7' },
]);

function fishGeometry() {
  const geometry = new THREE.BufferGeometry();
  // Forward is +Z. A shallow diamond body with a forked tail stays readable
  // while every fish still shares one inexpensive draw call.
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 1, .52, 0, 0, 0, .28, 0, -.52, 0, 0, 0, -.28, 0,
    0, 0, -.58, 0, .46, -1.12, 0, -.46, -1.12,
  ], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1, 5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4, 5, 6, 7]);
  geometry.computeVertexNormals();
  return geometry;
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const damp = (current, target, rate, dt) => current + (target - current) * (1 - Math.exp(-rate * dt));
function playerPoint(player) {
  const point = player?.position || player;
  return point && Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z) ? point : null;
}
function pushFromSolids(point, radius = .72) {
  point.x = clamp(point.x, REEF_BOUNDS.minX + radius, REEF_BOUNDS.maxX - radius);
  point.y = clamp(point.y, REEF_BOUNDS.minY + radius, REEF_BOUNDS.maxY - radius);
  point.z = clamp(point.z, REEF_BOUNDS.minZ + radius, REEF_BOUNDS.maxZ - radius);
  for (const solid of REEF_SOLIDS) {
    const minX = solid.x - solid.width / 2 - radius, maxX = solid.x + solid.width / 2 + radius;
    const minY = solid.y - solid.height / 2 - radius, maxY = solid.y + solid.height / 2 + radius;
    const minZ = solid.z - solid.depth / 2 - radius, maxZ = solid.z + solid.depth / 2 + radius;
    if (point.x < minX || point.x > maxX || point.y < minY || point.y > maxY || point.z < minZ || point.z > maxZ) continue;
    const faces = [
      [point.x - minX, 'x', minX], [maxX - point.x, 'x', maxX],
      [point.y - minY, 'y', minY], [maxY - point.y, 'y', maxY],
      [point.z - minZ, 'z', minZ], [maxZ - point.z, 'z', maxZ],
    ];
    faces.sort((a, b) => a[0] - b[0]); point[faces[0][1]] = faces[0][2];
  }
}
function makeSchool(spec, first) {
  const members = [];
  for (let member = 0; member < spec.count; member++) {
    const angle = member * 2.399 + first * .41, radius = .6 + (member % 4) * .42;
    members.push({
      x: spec.x + Math.sin(angle) * radius, y: spec.y + ((member % 3) - 1) * .27, z: spec.z + Math.cos(angle) * radius,
      vx: 0, vy: 0, vz: 0, ox: Math.sin(angle) * radius, oy: ((member % 3) - 1) * .27, oz: Math.cos(angle) * radius,
      phase: member * .73 + first * .29,
    });
  }
  return { ...spec, cx: spec.x, cy: spec.y, cz: spec.z, vx: 0, vy: 0, vz: 0, heading: first * .6, patrolPhase: first * .6, alarm: 0, spread: 1, members };
}

export function createReefFishSchools() {
  const group = new THREE.Group(); group.name = 'sunken-reach-fish-schools';
  const schools = SCHOOL_SPECS.map(makeSchool);
  const fish = schools.flatMap(school => school.members);
  // Instance colors use Three's InstancedMesh color attribute directly. Do not
  // enable vertexColors here: this geometry intentionally has no per-vertex
  // color attribute, and the absent attribute would darken every school.
  const geometry = fishGeometry(), material = new THREE.MeshBasicMaterial({ color: '#ffffff', side: THREE.DoubleSide });
  const mesh = new THREE.InstancedMesh(geometry, material, fish.length); mesh.name = 'sunken-reach-batched-fish'; mesh.frustumCulled = false; group.add(mesh);
  let index = 0;
  for (const school of schools) for (let member = 0; member < school.members.length; member++) mesh.setColorAt(index++, new THREE.Color(member % 3 ? school.hue : '#e77f73'));
  mesh.instanceColor.needsUpdate = true;
  const instance = new THREE.Object3D(); instance.rotation.order = 'YXZ';
  let lastTime = null, lowQuality = false, reducedMotion = false, disposed = false;

  const scratchPoint = { x: 0, y: 0, z: 0 };
  function patrol(school, time) {
    const phase = time * .18 + school.patrolPhase;
    school.tx = school.x + Math.sin(phase) * school.rx;
    school.ty = school.y + Math.sin(phase * 1.71) * school.ry;
    school.tz = school.z + Math.cos(phase * .83) * school.rz;
  }
  function stepSchool(school, time, dt, player) {
    patrol(school, time); let tx = school.tx, ty = school.ty, tz = school.tz;
    const dx = school.cx - player?.x || 0, dy = school.cy - player?.y || 0, dz = school.cz - player?.z || 0;
    const distance = Math.hypot(dx, dy, dz);
    if (player && distance < 7) school.alarm = Math.max(school.alarm, 2.4);
    else school.alarm = Math.max(0, school.alarm - dt);
    school.spread = damp(school.spread, school.alarm > 0 ? 1.48 : 1, school.alarm > 0 ? 5 : 1.25, dt);
    if (school.alarm > 0 && player) {
      const inverse = distance > .001 ? 1 / distance : 1;
      tx = school.cx + (distance > .001 ? dx * inverse : Math.sin(school.heading)) * 16;
      ty = school.cy + (distance > .001 ? dy * inverse : .18) * 9;
      tz = school.cz + (distance > .001 ? dz * inverse : Math.cos(school.heading)) * 16;
    }
    scratchPoint.x = tx; scratchPoint.y = ty; scratchPoint.z = tz; pushFromSolids(scratchPoint);
    const toX = scratchPoint.x - school.cx, toY = scratchPoint.y - school.cy, toZ = scratchPoint.z - school.cz;
    const length = Math.hypot(toX, toY, toZ) || 1, speed = school.alarm > 0 ? 7.8 : 1.55;
    const targetVX = toX / length * speed, targetVY = toY / length * speed, targetVZ = toZ / length * speed;
    const turn = school.alarm > 0 ? 8.5 : 2.4;
    school.vx = damp(school.vx, targetVX, turn, dt); school.vy = damp(school.vy, targetVY, turn, dt); school.vz = damp(school.vz, targetVZ, turn, dt);
    school.cx += school.vx * dt; school.cy += school.vy * dt; school.cz += school.vz * dt;
    scratchPoint.x = school.cx; scratchPoint.y = school.cy; scratchPoint.z = school.cz; pushFromSolids(scratchPoint);
    school.cx = scratchPoint.x; school.cy = scratchPoint.y; school.cz = scratchPoint.z;
    if (Math.hypot(school.vx, school.vz) > .03) school.heading = Math.atan2(school.vx, school.vz);
    for (const member of school.members) {
      const sway = Math.sin(time * 1.7 + member.phase) * .12, cos = Math.cos(school.heading), sin = Math.sin(school.heading);
      const wantedX = school.cx + (member.ox * cos + member.oz * sin) * school.spread;
      const wantedY = school.cy + member.oy * school.spread + sway;
      const wantedZ = school.cz + (-member.ox * sin + member.oz * cos) * school.spread;
      member.vx = damp(member.vx, (wantedX - member.x) * 4 + school.vx, school.alarm > 0 ? 10 : 5, dt);
      member.vy = damp(member.vy, (wantedY - member.y) * 4 + school.vy, school.alarm > 0 ? 10 : 5, dt);
      member.vz = damp(member.vz, (wantedZ - member.z) * 4 + school.vz, school.alarm > 0 ? 10 : 5, dt);
      member.x += member.vx * dt; member.y += member.vy * dt; member.z += member.vz * dt; pushFromSolids(member, .38);
    }
  }
  function render() {
    let i = 0;
    for (const school of schools) for (let memberIndex = 0; memberIndex < school.members.length; memberIndex++) {
      const member = school.members[memberIndex], visible = !lowQuality || memberIndex < Math.ceil(school.count * .6);
      const speed = Math.hypot(member.vx, member.vz);
      instance.position.set(member.x, member.y, member.z); instance.scale.set(visible ? .17 : 0, visible ? .17 : 0, visible ? .31 : 0);
      instance.rotation.set(-Math.atan2(member.vy, Math.max(.001, speed)), speed > .02 ? Math.atan2(member.vx, member.vz) : school.heading, 0); instance.updateMatrix(); mesh.setMatrixAt(i++, instance.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  render();
  return { group,
    update(time = 0, { lowQuality: low = false, reducedMotion: reduce = false, player = null } = {}) {
      if (disposed) return;
      lowQuality = !!low; reducedMotion = !!reduce;
      if (reducedMotion) { lastTime = Number.isFinite(time) ? time : lastTime; render(); return; }
      const current = Number.isFinite(time) ? time : (lastTime ?? 0), elapsed = lastTime === null ? 0 : clamp(current - lastTime, 0, MAX_FRAME);
      lastTime = current; const swimmer = playerPoint(player);
      for (let advanced = 0; advanced < elapsed - 1e-8; advanced += MAX_STEP) {
        const dt = Math.min(MAX_STEP, elapsed - advanced), sampleTime = current - elapsed + advanced + dt;
        for (const school of schools) stepSchool(school, sampleTime, dt, swimmer);
      }
      render();
    },
    getStats() { return { fish: fish.length, schools: schools.map(school => ({ id: school.id, count: school.count, center: { x: school.cx, y: school.cy, z: school.cz }, alarm: school.alarm, spread: school.spread, speed: Math.hypot(school.vx, school.vy, school.vz) })), lowQuality, reducedMotion, status: disposed ? 'disposed' : 'ready' }; },
    dispose() { if (disposed) return; disposed = true; geometry.dispose(); material.dispose(); },
  };
}
