// The Sunken Reach navigator keeps the pirate's face, tricorn, coat, arms and
// weapon rig readable. The tail is a single deforming skin, so its scales and
// fin travel with the body instead of becoming a string of separate props.
import * as THREE from 'three';
import { buildPlayerCharacter } from './player-character.js';

const clamp = THREE.MathUtils.clamp;
const SIDE = new THREE.Vector3(1, 0, 0);

function makeForkedFluke(color, material) {
  // One connected fan, with a shallow central notch and swept outer tips. The
  // old two oval paddles read as props; this silhouette reads as a tail fin.
  const outline = [
    [0, .14], [-.18, .10], [-.28, -.055], [-.46, -.16], [-.63, -.33], [-.74, -.50],
    [-.67, -.61], [-.53, -.63], [-.36, -.56], [-.18, -.43], [0, -.27],
    [.18, -.43], [.36, -.56], [.53, -.63], [.67, -.61], [.74, -.50], [.63, -.33], [.46, -.16], [.28, -.055], [.18, .10],
  ];
  const shape = new THREE.Shape(); shape.moveTo(...outline[0]); for (let i = 1; i < outline.length; i++) shape.lineTo(...outline[i]); shape.closePath();
  const geometry = new THREE.ShapeGeometry(shape, 5), position = geometry.attributes.position, colors = new Float32Array(position.count * 3);
  const finMain = new THREE.Color(color), membrane = finMain.clone().lerp(new THREE.Color('#1b6073'), .22), edge = finMain.clone().lerp(new THREE.Color('#fff0cc'), .16);
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), rim = Math.abs(x) > .54 || y < -.54;
    position.setZ(i, Math.abs(x) * .075 + Math.max(0, -y) * .025);
    const c = rim ? edge : membrane; colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material); mesh.name = 'meridian-forked-fan-membrane'; mesh.castShadow = true;
  const rays = [], rayColors = [], rayTint = finMain.clone().lerp(new THREE.Color('#fff0cc'), .28);
  for (const [x, y] of [[-.54, -.55], [-.28, -.50], [.28, -.50], [.54, -.55]]) {
    rays.push(0, .035, .045, x, y, Math.abs(x) * .08 + .055);
    rayColors.push(membrane.r, membrane.g, membrane.b, rayTint.r, rayTint.g, rayTint.b);
  }
  const rayGeometry = new THREE.BufferGeometry(); rayGeometry.setAttribute('position', new THREE.Float32BufferAttribute(rays, 3)); rayGeometry.setAttribute('color', new THREE.Float32BufferAttribute(rayColors, 3));
  const rayMesh = new THREE.LineSegments(rayGeometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: .78 })); rayMesh.name = 'meridian-fluke-fin-rays';
  const fluke = new THREE.Group(); fluke.name = 'meridian-two-lobed-fluke'; fluke.add(mesh, rayMesh);
  return fluke;
}

function buildTail(color) {
  const rings = 18, sides = 14, vertexCount = (rings + 1) * sides, capIndex = vertexCount;
  const tailMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .5, metalness: .08, side: THREE.DoubleSide });
  const positions = new Float32Array((vertexCount + 1) * 3), colors = new Float32Array((vertexCount + 1) * 3), indices = [];
  const geometry = new THREE.BufferGeometry();
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides, a = ring * sides + side, b = ring * sides + next, c = (ring + 1) * sides + side, d = (ring + 1) * sides + next;
    indices.push(a, c, b, b, c, d);
  }
  for (let side = 0; side < sides; side++) {
    const a = rings * sides + side, b = rings * sides + (side + 1) % sides;
    indices.push(a, b, capIndex);
  }
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, tailMaterial); mesh.name = 'meridian-continuous-crew-tail'; mesh.castShadow = true; mesh.receiveShadow = true;

  // Scales are one bounded overlay mesh. Their vertices use the same moving
  // frames as the skin, so the pattern cannot slide or split at a seam.
  const scaleRows = 15, scaleColumns = 14, scaleVertices = scaleRows * scaleColumns * 7;
  const scaleGeometry = new THREE.BufferGeometry();
  scaleGeometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(scaleVertices * 3), 3));
  scaleGeometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(scaleVertices * 3), 3));
  const scaleIndices = [];
  for (let scale = 0; scale < scaleRows * scaleColumns; scale++) {
    const start = scale * 7;
    scaleIndices.push(start, start + 1, start + 2, start, start + 2, start + 6, start + 6, start + 2, start + 5,
      start + 5, start + 2, start + 4, start + 4, start + 2, start + 3);
  }
  scaleGeometry.setIndex(scaleIndices);
  const scales = new THREE.Mesh(scaleGeometry, tailMaterial); scales.name = 'meridian-overlapping-scalloped-scales'; scales.castShadow = true;

  const fluke = makeForkedFluke(color, tailMaterial);

  const center = new THREE.Vector3(), tangent = new THREE.Vector3(), sideAxis = new THREE.Vector3(), normal = new THREE.Vector3();
  const endpoint = new THREE.Vector3(), flukeBasis = new THREE.Matrix4();
  const main = new THREE.Color(color), deep = main.clone().multiplyScalar(.68), warm = main.clone().lerp(new THREE.Color('#ffffff'), .08), pearl = main.clone().lerp(new THREE.Color('#fff5dc'), .18);
  const scaleCenter = new THREE.Vector3(), scaleSide = new THREE.Vector3(), scaleNormal = new THREE.Vector3(), scaleTangent = new THREE.Vector3(), outward = new THREE.Vector3(), point = new THREE.Vector3(), finTangent = new THREE.Vector3(), finNormal = new THREE.Vector3();

  // Narrow steadily from the coat hem to the fluke. A swell below the cuff
  // made the upper tail look like a separate round abdomen.
  const radiusAt = t => .085 + .2 * Math.pow(1 - t, 1.15);

  function frameAt(t, phase, speed, outCenter = center, outTangent = tangent, outSide = sideAxis, outNormal = normal) {
    const moving = clamp(speed / 5, 0, 1), wave = t * t;
    const phaseAt = phase - t * (4.35 + moving * .65), amplitude = .045 + moving * .115;
    const crossFrequency = 3.175 + moving * .48, crossPhase = phase - t * crossFrequency;
    outCenter.set(Math.sin(phaseAt) * amplitude * wave, -1.95 * t, .025 + .38 * t * t + Math.cos(crossPhase) * amplitude * .16 * wave);
    outTangent.set(
      amplitude * (2 * t * Math.sin(phaseAt) - wave * (4.35 + moving * .65) * Math.cos(phaseAt)),
      -1.95,
      .76 * t + amplitude * .16 * (2 * t * Math.cos(crossPhase) + wave * crossFrequency * Math.sin(crossPhase)),
    ).normalize();
    outSide.copy(SIDE).addScaledVector(outTangent, -SIDE.dot(outTangent));
    if (outSide.lengthSq() < 1e-6) outSide.set(0, 0, 1); else outSide.normalize();
    outNormal.crossVectors(outTangent, outSide).normalize();
    return outCenter;
  }

  function pointOnSkin(t, angle, phase, speed, out) {
    frameAt(t, phase, speed, scaleCenter, scaleTangent, scaleSide, scaleNormal);
    const radius = radiusAt(t), vertical = radius * (.78 - .12 * t);
    return out.copy(scaleCenter).addScaledVector(scaleSide, Math.cos(angle) * radius).addScaledVector(scaleNormal, Math.sin(angle) * vertical);
  }

  function deform(phase, speed) {
    const position = geometry.attributes.position, vertexColor = geometry.attributes.color;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings; frameAt(t, phase, speed);
      const radius = radiusAt(t), vertical = radius * (.78 - .12 * t);
      for (let j = 0; j < sides; j++) {
        const angle = j / sides * Math.PI * 2, index = i * sides + j;
        position.setXYZ(index, center.x + Math.cos(angle) * radius * sideAxis.x + Math.sin(angle) * vertical * normal.x,
          center.y + Math.cos(angle) * radius * sideAxis.y + Math.sin(angle) * vertical * normal.y,
          center.z + Math.cos(angle) * radius * sideAxis.z + Math.sin(angle) * vertical * normal.z);
        const tintColor = Math.sin(angle) > .35 ? warm : Math.sin(angle) < -.3 ? deep : main;
        vertexColor.setXYZ(index, tintColor.r, tintColor.g, tintColor.b);
      }
    }
    position.setXYZ(capIndex, center.x, center.y, center.z); vertexColor.setXYZ(capIndex, deep.r, deep.g, deep.b);
    position.needsUpdate = true; vertexColor.needsUpdate = true; geometry.computeVertexNormals(); geometry.computeBoundingBox(); geometry.computeBoundingSphere();

    const scalePosition = scaleGeometry.attributes.position, scaleColor = scaleGeometry.attributes.color;
    for (let row = 0; row < scaleRows; row++) for (let column = 0; column < scaleColumns; column++) {
      const t = .055 + row / (scaleRows - 1) * .875, stagger = row % 2 ? .5 : 0, angle = (column + stagger) / scaleColumns * Math.PI * 2;
      const angleWidth = .245 - t * .035, length = .104 - t * .025, start = (row * scaleColumns + column) * 7;
      const write = (offset, curveT, angleOffset) => {
        pointOnSkin(curveT, angle + angleOffset, phase, speed, point);
        const lift = offset < 2 ? .003 : offset === 4 ? .007 : .005;
        outward.copy(point).sub(scaleCenter).normalize(); point.addScaledVector(outward, lift);
        scalePosition.setXYZ(start + offset, point.x, point.y, point.z);
      };
      write(0, t - length * .42, -angleWidth); write(1, t - length * .42, angleWidth); write(2, t + length * .14, angleWidth * .84);
      write(3, t + length * .47, angleWidth * .40); write(4, t + length * .59, 0); write(5, t + length * .47, -angleWidth * .40); write(6, t + length * .14, -angleWidth * .84);
      const shade = (row + column) % 4 === 0 ? warm : main;
      for (let vertex = 0; vertex < 7; vertex++) {
        const c = vertex >= 3 && vertex <= 5 ? pearl : vertex < 2 ? deep : shade; scaleColor.setXYZ(start + vertex, c.r, c.g, c.b);
      }
    }
    scalePosition.needsUpdate = true; scaleColor.needsUpdate = true; scaleGeometry.computeVertexNormals(); scaleGeometry.computeBoundingBox(); scaleGeometry.computeBoundingSphere();

    frameAt(1, phase, speed); endpoint.copy(center);
    fluke.position.copy(endpoint); finTangent.copy(tangent).negate(); finNormal.crossVectors(sideAxis, finTangent).normalize(); flukeBasis.makeBasis(sideAxis, finTangent, finNormal); fluke.quaternion.setFromRotationMatrix(flukeBasis);
  }
  deform(0, 0); return { mesh, scales, fluke, deform };
}

export function buildMermaid(palette, color = '#eb785d', { asset = null } = {}) {
  const group = new THREE.Group(); group.name = 'meridian-swimming-pirate'; group.userData.kind = 'mermaid';
  // Pitch around the waist inside the world's yaw, so sprinting leans toward
  // the facing at every heading without dropping the head around a foot pivot.
  const swimPivot = new THREE.Group(); swimPivot.name = 'meridian-swim-pivot'; swimPivot.position.y = 1.35; swimPivot.rotation.x = -.13; group.add(swimPivot);
  const body = new THREE.Group(); body.position.y = -1.35; swimPivot.add(body);
  const pirate = buildPlayerCharacter(palette, color, { swimming: true, asset }); body.add(pirate.group);
  const tailRoot = new THREE.Group(); tailRoot.name = 'meridian-articulated-tail'; body.add(tailRoot);
  const tail = buildTail(color); tailRoot.add(tail.mesh, tail.scales, tail.fluke);
  let recoil = 0, tailPhase = 0, haveHipRest = false;
  const anchor = new THREE.Vector3(), offset = new THREE.Vector3(), parentInverse = new THREE.Matrix4(), parentQ = new THREE.Quaternion(), hipQ = new THREE.Quaternion(), hipLocal = new THREE.Quaternion(), hipRestInverse = new THREE.Quaternion();

  function attachTailToWaist() {
    // The GLB's Hips is the live pelvis. The compact fallback has no skeleton,
    // so its named upper-body group is the stable equivalent. Offsets put both
    // attachment sources inside the same coat hem before their children draw.
    const hips = pirate.debug?.bones?.hips, upperBody = pirate.group.getObjectByName('pirate-upper-body');
    const waist = hips || upperBody;
    if (!waist) return;
    group.updateMatrixWorld(true); waist.getWorldPosition(anchor);
    parentInverse.copy(tailRoot.parent.matrixWorld).invert(); anchor.applyMatrix4(parentInverse);
    if (hips) {
      tailRoot.parent.getWorldQuaternion(parentQ); hips.getWorldQuaternion(hipQ);
      hipLocal.copy(parentQ).invert().multiply(hipQ);
      if (!haveHipRest) { hipRestInverse.copy(hipLocal).invert(); haveHipRest = true; }
      // Mixamo's rest Hips basis is not character space. Apply only its live
      // delta, so idle/aim body motion carries the tail without a 90 degree twist.
      tailRoot.quaternion.copy(hipLocal).multiply(hipRestInverse); offset.set(0, .02, 0);
    } else {
      tailRoot.parent.getWorldQuaternion(parentQ); upperBody.getWorldQuaternion(hipQ);
      tailRoot.quaternion.copy(parentQ).invert().multiply(hipQ); offset.set(0, .35, 0); haveHipRest = false;
    }
    // The calibrated hem offset shares the waist's live rotation, avoiding a
    // rear-facing gap whenever idle, aim, or recoil moves the upper body.
    tailRoot.position.copy(anchor).add(offset.applyQuaternion(tailRoot.quaternion));
  }

  return {
    group,
    animate(time, speed, player = {}, pose = {}) {
      const motion = player.knockedUntil ? 0 : Math.max(0, Number.isFinite(speed) ? speed : 0);
      const moving = clamp(motion / 8, 0, 1);
      const dt = clamp(Number.isFinite(pose.dt) ? pose.dt : 1 / 60, 0, .1);
      const pitch = clamp(Number.isFinite(player.pitch) ? player.pitch : 0, -1.35, 1.35);
      // Normal swimming tops out at 8 m/s; only the 12 m/s sprint settles into
      // the forward swimming pose. Displayed travel also works for remote crew.
      const surge = THREE.MathUtils.smoothstep(motion, 8.5, 11.5);
      const lean = THREE.MathUtils.lerp(-.13 - moving * .12, -1.12 + pitch * .7, surge);
      swimPivot.rotation.x += (lean - swimPivot.rotation.x) * (1 - Math.exp(-8 * dt));
      // Keep ground-mode weapon handling, but never feed swimming travel into
      // the walk/run clips. Compensate aim for the body's forward pitch.
      pirate.animate(time, 0, { ...player, mode: 'ground', pitch: pitch - swimPivot.rotation.x }, pose);
      const shadow = pirate.group.getObjectByName('pirate-contact-shadow'), glider = pirate.group.getObjectByName('pirate-glider');
      if (shadow) shadow.visible = false;
      if (glider) glider.visible = false;
      // Integrating phase, rather than deriving it from time * speed, makes a
      // speed correction or a non-monotonic render clock unable to snap a fin.
      tailPhase = (tailPhase + dt * (2.35 + moving * 3.65)) % (Math.PI * 2);
      recoil = Math.max(0, recoil - dt * 4); pirate.group.position.z = recoil * .11;
      attachTailToWaist(); tail.deform(tailPhase, motion);
    },
    fire(weapon) { recoil = Math.min(1, recoil + (weapon === 'scatter' ? 1 : .65)); pirate.fire(weapon); },
    getMuzzle(target) { return pirate.getMuzzle(target); },
    // world.js owns traversal/disposal of tail resources after this returns.
    dispose() { pirate.dispose(); },
  };
}
