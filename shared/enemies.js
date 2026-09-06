// Shared enemy archetypes. The server adds crew scaling on top of these base
// values; the client uses the names and scales for presentation only.
export const ENEMY_TYPES = Object.freeze(Object.fromEntries([
  { id: 'crab', name: 'Cheeky crab', hp: 52, radius: .85, scale: 1, attackRadius: 2.3, damage: 10, speed: 3.6, windup: .8, pearls: 3, supplyDamage: 8 },
  { id: 'spitter', name: 'Splash crab', hp: 60, radius: .85, scale: 1.1, attackRadius: 2.5, damage: 12, speed: 2.7, windup: .8, pearls: 3, supplyDamage: 8, ranged: true },
  // Optional-defense mini boss: a slow, armoured tide crab with a wide swipe.
  { id: 'tidebreaker', name: 'Tidebreaker crab', hp: 240, hpPerExtraPlayer: 30, radius: 1.25, scale: 1.9, attackRadius: 3.4, damage: 18, speed: 2.9, windup: 1, pearls: 15, supplyDamage: 14, miniBoss: true },
  { id: 'tempest', name: 'Tempest Crab', hp: 650, hpPerExtraPlayer: 180, radius: 2.4, scale: 3.1, attackRadius: 5.5, damage: 22, speed: 3, windup: 1.05, pearls: 60, boss: true },
].map(type => [type.id, Object.freeze(type)])));

export const enemyStats = type => ENEMY_TYPES[type] ?? ENEMY_TYPES.crab;
