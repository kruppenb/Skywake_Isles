// The Sunken Reach navigator keeps the pirate's face, tricorn, coat, arms and
// weapon rig readable.  The compact procedural figure is intentional here: it
// gives the reef a dependable mermaid fallback even while the skinned navigator
// asset is still loading elsewhere in the game.
import * as THREE from 'three';
import { buildPlayerCharacter } from './player-character.js';

const clamp = THREE.MathUtils.clamp;

function buildTail(palette, color) {
  const rings = 15, sides = 12, positions = new Float32Array((rings + 1) * sides * 3), colors = new Float32Array((rings + 1) * sides * 3), indices = [];
  const geometry = new THREE.BufferGeometry(), main = new THREE.Color(color), ridge = main.clone().lerp(new THREE.Color('#ffb080'), .32), shade = main.clone().lerp(new THREE.Color('#743f58'), .25);
  for (let ring = 0; ring < rings; ring++) for (let side = 0; side < sides; side++) {
    const next = (side + 1) % sides, a = ring * sides + side, b = ring * sides + next, c = (ring + 1) * sides + side, d = (ring + 1) * sides + next;
    indices.push(a, c, b, b, c, d);
  }
  const position = geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3)).attributes.position;
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3)); geometry.setIndex(indices);
  const mesh = new THREE.Mesh(geometry, palette.solid); mesh.name = 'meridian-continuous-crew-tail';
  const fluke = new THREE.Group(); fluke.name = 'meridian-two-lobed-fluke';
  const flukeMaterial = new THREE.MeshToonMaterial({ color: main, gradientMap: palette.ramp, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const lobe = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), flukeMaterial); lobe.name = side < 0 ? 'meridian-fluke-port' : 'meridian-fluke-starboard';
    lobe.position.set(side * .28, 0, .04); lobe.scale.set(.42, .055, .30); lobe.rotation.z = side * -.18; fluke.add(lobe);
  }
  const center = new THREE.Vector3(), tangent = new THREE.Vector3(), frame = new THREE.Vector3(), sideAxis = new THREE.Vector3(1, 0, 0), endpoint = new THREE.Vector3();
  function deform(time, speed) {
    const moving = clamp(speed / 5, 0, 1), phase = time * (2.6 + moving * 3.8), amplitude = .045 + moving * .11;
    for (let i = 0; i <= rings; i++) {
      const t = i / rings, sway = Math.sin(phase - t * 4.6) * amplitude * t;
      // The first ring runs .42m up inside the retained coat/pelvis hem.  The
      // endpoint remains fixed, so this closes the visible waist gap without
      // lengthening the fluke below the swimmer's authoritative origin.
      center.set(sway, .42 * (1 - t) - 1.42 * t, .08 + .66 * t * t);
      tangent.set(Math.cos(phase - t * 4.6) * amplitude * 4.6 / 1.84, -1, 1.32 * t / 1.84).normalize();
      frame.crossVectors(tangent, sideAxis).normalize();
      const radius = .315 * (1 - t * .72), vertical = radius * (.92 - t * .22);
      for (let j = 0; j < sides; j++) {
        const angle = j / sides * Math.PI * 2, index = i * sides + j;
        position.setXYZ(index, center.x + Math.cos(angle) * radius, center.y + frame.y * Math.sin(angle) * vertical, center.z + frame.z * Math.sin(angle) * vertical);
        const tint = j === 0 || j === sides / 2 ? ridge : j > sides / 2 ? shade : main;
        colors[index * 3] = tint.r; colors[index * 3 + 1] = tint.g; colors[index * 3 + 2] = tint.b;
      }
    }
    position.needsUpdate = true; geometry.attributes.color.needsUpdate = true; geometry.computeVertexNormals();
    endpoint.copy(center); fluke.position.copy(endpoint); fluke.rotation.x = Math.atan2(tangent.z, -tangent.y); fluke.rotation.y = Math.atan2(tangent.x, -tangent.y) * .35;
  }
  deform(0, 0); return { mesh, fluke, deform };
}

export function buildMermaid(palette, color = '#eb785d', { asset = null } = {}) {
  const group = new THREE.Group(); group.name = 'meridian-swimming-pirate'; group.userData.kind = 'mermaid';
  // This begins as the same compact pirate used while assets load, then swaps
  // to a leg-trimmed navigator GLB upper body. Both paths preserve the tricorn,
  // face, coat, arms, crew tint, and actual weapon sockets.
  const pirate = buildPlayerCharacter(palette, color, { swimming: true, asset }); group.add(pirate.group);

  const tailRoot = new THREE.Group(); tailRoot.name = 'meridian-articulated-tail'; tailRoot.position.set(0, 1.08, .11); group.add(tailRoot);
  const tail = buildTail(palette, color); tailRoot.add(tail.mesh, tail.fluke);
  let recoil = 0;
  return {
    group,
    animate(time, speed, player = {}, pose = {}) {
      pirate.animate(time, speed, { ...player, mode: 'ground' }, pose);
      // Ground stance keeps the gun hands live; it also creates a contact shadow
      // in the shared pirate rig, which has no place in open water.
      const shadow = pirate.group.getObjectByName('pirate-contact-shadow'), glider = pirate.group.getObjectByName('pirate-glider');
      if (shadow) shadow.visible = false;
      if (glider) glider.visible = false;
      const moving = clamp((speed || 0) / 5, 0, 1), phase = time * (3.1 + moving * 4.4);
      tailRoot.rotation.x = -.22 + Math.sin(phase) * (.035 + moving * .045);
      tailRoot.rotation.y = Math.sin(phase * .72) * (.035 + moving * .055); tail.deform(time, speed || 0);
      group.rotation.x = -.13 - moving * .12;
      recoil = Math.max(0, recoil - (pose.dt || 1 / 60) * 4);
      pirate.group.position.z = recoil * .11;
    },
    fire(weapon) { recoil = Math.min(1, recoil + (weapon === 'scatter' ? 1 : .65)); pirate.fire(weapon); },
    getMuzzle(target) { return pirate.getMuzzle(target); },
    dispose() { pirate.dispose(); },
  };
}
