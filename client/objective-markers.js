import * as THREE from 'three';
import { heightAt } from '../shared/world.js';

const TAU = Math.PI * 2;
const MAIN_CORE = '#fff3b0', MAIN_HALO = '#ffd16c', CONTRAST = '#123c51';

function terrainAnnulus(x, z, radius, width, offset, color, opacity) {
  const inner = Math.max(.01, radius - width / 2), outer = radius + width / 2;
  const segments = Math.max(128, Math.ceil(TAU * outer / .28)), rows = Math.ceil(width / .2);
  const positions = [], indices = [];
  for (let row = 0; row <= rows; row++) {
    const r = inner + (outer - inner) * row / rows;
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * TAU, wx = x + Math.cos(a) * r, wz = z + Math.sin(a) * r;
      positions.push(wx, heightAt(wx, wz) + offset, wz);
      if (row < rows && i < segments) {
        const n = row * (segments + 1) + i;
        indices.push(n, n + segments + 1, n + 1, n + 1, n + segments + 1, n + segments + 2);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeBoundingSphere();
  const material = new THREE.MeshBasicMaterial({ color, opacity, transparent: true, side: THREE.DoubleSide,
    depthTest: true, depthWrite: false, toneMapped: false });
  return new THREE.Mesh(geometry, material);
}

// Every layer is baked in world coordinates. Animate opacity only: scaling or
// lifting the group would pull these sampled vertices away from the terrain.
export function createObjectiveMarker({ x, z, radius, coreColor = MAIN_CORE, haloColor = MAIN_HALO, name = 'objective-ring' }) {
  const group = new THREE.Group(); group.name = name;
  // Leave room above the island's coarser, interpolated 2m render grid too.
  const halo = terrainAnnulus(x, z, radius, 1.44, .25, haloColor, .12);
  const border = terrainAnnulus(x, z, radius, .74, .27, CONTRAST, .9);
  const core = terrainAnnulus(x, z, radius, .44, .30, coreColor, .82);
  halo.name = 'objective-halo'; border.name = 'objective-contrast'; core.name = 'objective-core';
  halo.renderOrder = 4; border.renderOrder = 5; core.renderOrder = 6;
  group.add(halo, border, core); group.userData = { x, z, radius, halo, border, core };
  return group;
}

export function updateObjectiveMarker(marker, { visible = true, active = false, muted = false, time = 0, reducedMotion = false } = {}) {
  marker.visible = visible;
  if (!visible) return;
  const { core, border, halo } = marker.userData;
  core.material.opacity = muted ? .34 : active ? .96 : .82;
  border.material.opacity = muted ? .52 : .92;
  halo.material.opacity = muted ? .045 : (active ? .18 : .12) + (reducedMotion ? 0 : Math.sin(time * 1.65) * .025);
}
