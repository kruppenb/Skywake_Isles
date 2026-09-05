// Original designed island. These values are shared by rendering and authority.
export const MAX_PLAYERS = 5;
export const WORLD_RADIUS = 138;
export const SHIP_DURATION = 28;
export const SEED = 271828;
export const COLORS = ['#f4a261', '#55c9ba', '#b19cff', '#f58faf', '#ffdb70'];
export const SPAWN = { x: 0, z: 94 };
export const BEACON = { id: 'beacon', x: 0, z: 4 };
// Local deck coordinates match the original galleon's solid cabin and masts.
export const SHIP_OBSTACLES = [
  { id: 'fore-mast', type: 'circle', x: 0, z: -4.8, radius: 0.2 },
  { id: 'aft-mast', type: 'circle', x: 0, z: 4.4, radius: 0.2 },
  { id: 'cabin', type: 'box', minX: -3.2, maxX: 3.2, minZ: 6.45, maxZ: 10.45 },
];
export const REGIONS = [
  { id: 'beach', name: 'Sunwake Strand', x: 0, z: 94, radius: 42, color: '#f4d89a', accent: '#ffce62', description: 'Golden coves and a friendly landing beach.' },
  { id: 'jungle', name: 'Palmheart Wilds', x: -68, z: 12, radius: 46, color: '#3b9e69', accent: '#9deb75', description: 'Tall palms shelter an ancient compass shrine.' },
  { id: 'volcano', name: 'Emberpeak Caldera', x: 48, z: -65, radius: 45, color: '#bf714a', accent: '#ffac66', description: 'Warm amber cliffs surround the ember shard.' },
  { id: 'moon', name: 'Moonbloom Grove', x: 76, z: 32, radius: 39, color: '#9188c4', accent: '#8de9ee', description: 'Luminous mushrooms and curling silver trees.' },
  { id: 'haven', name: 'Tideglass Haven', x: 0, z: 4, radius: 45, color: '#73bca7', accent: '#ffe4a1', description: 'Restore the great lighthouse with your crew.' },
];
export const SHRINES = [
  { id: 'palm', region: 'jungle', name: 'Palmheart Shrine', x: -68, z: 12, color: '#b6f379' },
  { id: 'ember', region: 'volcano', name: 'Emberpeak Shrine', x: 48, z: -65, color: '#ffb76e' },
  { id: 'moon', region: 'moon', name: 'Moonbloom Shrine', x: 76, z: 32, color: '#9aeaf7' },
];
export const CHESTS = [
  [0, 88], [-8, 97], [9, 100], [-16, 66], [18, 52], [-32, 36],
  [-56, 26], [-83, -1], [-93, 31], [-25, -26], [17, -38], [39, -52],
  [61, -83], [79, -49], [87, 18], [64, 50], [97, 53], [13, 15],
].map(([x, z], i) => ({ id: `chest-${i + 1}`, x, z }));
const obstacleLayout = [
  [-24, 101, 2.5, 5, 'rock'], [27, 93, 2.2, 7, 'tree'], [-35, 81, 2, 8, 'tree'],
  [31, 70, 2.2, 7, 'tree'], [-30, 60, 2.2, 7, 'tree'], [20, 76, 2, 3, 'rock'],
  [-53, 51, 3, 10, 'tree'], [-83, 47, 3.5, 12, 'tree'], [-98, 18, 3, 11, 'tree'],
  [-82, -19, 3, 12, 'tree'], [-44, -6, 2.5, 9, 'tree'], [-103, -11, 3, 4, 'rock'],
  [-63, -22, 2.6, 11, 'tree'], [-100, 44, 3.5, 11, 'tree'], [-53, 77, 2, 8, 'tree'],
  [-20, 15, 3.2, 5, 'hut'], [18, 27, 3.2, 5, 'hut'], [-19, -16, 2.6, 4, 'rock'],
  [-8, -48, 3, 6, 'rock'], [19, -73, 3.5, 8, 'rock'], [36, -92, 3.5, 9, 'rock'],
  [73, -76, 3.8, 10, 'rock'], [69, -34, 3, 8, 'rock'], [89, -64, 2.4, 6, 'rock'],
  [58, -103, 3.5, 8, 'rock'], [29, -45, 2.1, 5, 'rock'], [101, 6, 3, 8, 'tree'],
  [109, 35, 2.3, 9, 'tree'], [89, 65, 3, 10, 'tree'], [56, 66, 2.5, 9, 'tree'],
  [51, 18, 2.5, 8, 'tree'], [69, 5, 2.5, 9, 'tree'], [109, 57, 2.2, 4, 'rock'],
  [0, -20, 4.5, 31, 'landmark'],
];
export const OBSTACLES = obstacleLayout.map(([x, z, radius, height, type], i) => ({ id: `prop-${i + 1}`, x, z, radius, height, type }));

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
const smooth = t => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
function distanceToSegment(x, z, a, b) {
  const dx = b.x - a.x, dz = b.z - a.z;
  const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1), 0, 1);
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
}

export function heightAt(x, z) {
  if (!Number.isFinite(x) || !Number.isFinite(z)) return 0;
  const r = Math.hypot(x, z);
  // A gently scalloped shoreline, 119-137m from the center, fades into sea.
  const theta = Math.atan2(z, x);
  const shore = 129 + 5 * Math.sin(theta * 3 + 0.4) + 3 * Math.sin(theta * 5 - 0.7);
  const edge = smooth((shore + 4 - r) / 17);
  const base = 3.25 + 0.7 * Math.sin(x * 0.027) * Math.cos(z * 0.033);
  const routeDistance = Math.min(...[SPAWN, ...SHRINES].map(p => distanceToSegment(x, z, BEACON, p)));
  const routeEase = smooth((routeDistance - 8) / 17);
  const hill = (cx, cz, h, spread) => h * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (spread * spread));
  const hills = hill(48, -87, 13, 27) + hill(-77, -14, 6.5, 29) + hill(99, 39, 5, 25);
  return edge * (base + routeEase * hills) - (1 - edge) * 0.8;
}

export function regionAt(x, z) {
  let best = REGIONS[4], distance = Infinity;
  for (const region of REGIONS) {
    const d = Math.hypot(x - region.x, z - region.z) / region.radius;
    if (d < distance) { best = region; distance = d; }
  }
  return best;
}

export function shipAt(elapsed = 0) {
  const t = clamp(Number.isFinite(elapsed) ? elapsed / SHIP_DURATION : 0, 0, 1);
  return { x: 0, y: 62 + 0.6 * Math.sin(t * Math.PI * 2), z: 102 - 162 * t, yaw: 0 };
}

export function seededRandom(seed = SEED) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let t = value;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
