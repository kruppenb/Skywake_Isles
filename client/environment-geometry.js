import { heightAt, WORLD_RADIUS } from '../shared/world.js';

export const TERRAIN_GRID_STEP = 2;
export const TERRAIN_GRID_COUNT = Math.ceil((WORLD_RADIUS + 12) * 2 / TERRAIN_GRID_STEP);
export const TERRAIN_GRID_HALF = TERRAIN_GRID_COUNT * TERRAIN_GRID_STEP / 2;
export const TERRAIN_ORIGIN = -TERRAIN_GRID_HALF;

// Interpolate the exact alternating triangles used by world.buildTerrain.
// A height-function sample between grid vertices would float detail above it.
export function renderedHeightAt(x, z) {
  const step = TERRAIN_GRID_STEP, origin = TERRAIN_ORIGIN;
  const ix = Math.floor((x - origin) / step), iz = Math.floor((z - origin) / step);
  const xx = origin + ix * step, zz = origin + iz * step, u = (x - xx) / step, v = (z - zz) / step;
  const a = heightAt(xx, zz), b = heightAt(xx + step, zz), c = heightAt(xx, zz + step), d = heightAt(xx + step, zz + step);
  if ((ix + iz) % 2) return u + v <= 1 ? a + (b - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b - d) * (1 - v);
  return u >= v ? a + (b - a) * u + (d - b) * v : a + (d - c) * u + (c - a) * v;
}
