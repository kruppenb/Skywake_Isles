import { WORLD_RADIUS, SHIP_DURATION, SPAWN, SHIP_OBSTACLES, heightAt, shipAt } from './world.js';
import { resolveWorldCollision } from './collision.js';

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const finite = (x, fallback = 0) => Number.isFinite(x) ? x : fallback;
export function makePlayerPosition() {
  const ship = shipAt(0);
  return { x: ship.x, y: ship.y, z: ship.z, yaw: 0, pitch: 0, vy: 0,
    mode: 'aboard', jumpHeld: false, grounded: true, deckX: 0, deckZ: 0 };
}

export function movePlayer(p, input = {}, dt, elapsed = 0) {
  dt = clamp(finite(dt), 0, 0.05);
  p.yaw = finite(input.yaw, finite(p.yaw));
  p.pitch = clamp(finite(input.pitch, finite(p.pitch)), -1.35, 1.35);
  let forward = clamp(finite(input.forward), -1, 1), right = clamp(finite(input.right), -1, 1);
  const length = Math.hypot(forward, right);
  if (length > 1) { forward /= length; right /= length; }
  const dx = -Math.sin(p.yaw) * forward + Math.cos(p.yaw) * right;
  const dz = -Math.cos(p.yaw) * forward - Math.sin(p.yaw) * right;
  const speed = input.sprint ? 11 : 8;
  const jump = !!input.jump && !p.jumpHeld;
  p.jumpHeld = !!input.jump;

  if (p.mode === 'aboard') {
    const ship = shipAt(elapsed);
    p.deckX = clamp(finite(p.deckX) + dx * speed * dt, -4, 4);
    p.deckZ = clamp(finite(p.deckZ) + dz * speed * dt, -8, 8);
    for (const obstacle of SHIP_OBSTACLES) {
      if (obstacle.type === 'circle') {
        const ox = p.deckX - obstacle.x, oz = p.deckZ - obstacle.z;
        const distance = Math.hypot(ox, oz), radius = obstacle.radius + 0.6;
        if (distance < radius) {
          p.deckX = obstacle.x + (distance > 0.0001 ? ox / distance : 1) * radius;
          p.deckZ = obstacle.z + (distance > 0.0001 ? oz / distance : 0) * radius;
        }
      } else {
        const minX = obstacle.minX - 0.6, maxX = obstacle.maxX + 0.6;
        const minZ = obstacle.minZ - 0.6, maxZ = obstacle.maxZ + 0.6;
        if (p.deckX > minX && p.deckX < maxX && p.deckZ > minZ && p.deckZ < maxZ) {
          const sides = [
            { distance: p.deckX - minX, axis: 'deckX', value: minX },
            { distance: maxX - p.deckX, axis: 'deckX', value: maxX },
            { distance: p.deckZ - minZ, axis: 'deckZ', value: minZ },
            { distance: maxZ - p.deckZ, axis: 'deckZ', value: maxZ },
          ].sort((a, b) => a.distance - b.distance);
          p[sides[0].axis] = sides[0].value;
        }
      }
    }
    p.x = ship.x + p.deckX;
    p.z = ship.z + p.deckZ;
    p.y = ship.y;
    p.vy = 0;
    p.grounded = true;
    if (elapsed >= SHIP_DURATION) {
      p.x = SPAWN.x + clamp(p.deckX, -3, 3); p.z = SPAWN.z + clamp(p.deckZ, -3, 3);
      p.y = 42; p.mode = 'gliding'; p.grounded = false; p.vy = -6;
    } else if (jump) {
      p.mode = 'gliding'; p.vy = -6; p.grounded = false;
    }
    return p;
  }

  p.x = finite(p.x, SPAWN.x) + dx * speed * dt;
  p.z = finite(p.z, SPAWN.z) + dz * speed * dt;
  p.y = finite(p.y, heightAt(p.x, p.z));
  resolveWorldCollision(p);
  const ground = heightAt(p.x, p.z);
  if (Math.hypot(p.x, p.z) > WORLD_RADIUS || (ground < 0.3 && p.y < 2.5) || p.y < -4) {
    p.x = SPAWN.x; p.z = SPAWN.z; p.y = heightAt(SPAWN.x, SPAWN.z);
    p.mode = 'ground'; p.vy = 0; p.grounded = true;
    return p;
  }
  if (p.mode === 'gliding') {
    p.vy = -6; p.y -= 6 * dt; p.grounded = false;
  } else {
    if (p.grounded) {
      p.y = ground; p.vy = 0;
      if (jump) { p.vy = 8; p.grounded = false; }
    }
    if (!p.grounded) {
      p.vy = finite(p.vy) - 22 * dt;
      if (p.vy < -6 && p.y - ground > 3) { p.mode = 'gliding'; p.vy = -6; }
      p.y += p.vy * dt;
    }
  }
  if (p.y <= ground) { p.y = ground; p.vy = 0; p.mode = 'ground'; p.grounded = true; }
  return p;
}
