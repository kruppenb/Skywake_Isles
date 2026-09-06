// Shared authoritative weapon, loadout and pickup presentation contract.
export const WEAPON_ORDER = Object.freeze(['flintlock', 'scatter', 'repeater', 'burst', 'longshot']);
export const WEAPONS = Object.freeze(Object.fromEntries([
  { id: 'flintlock', name: 'Flintlock', ammo: 8, damage: 24, cooldown: 0.3, reload: 1.2, range: 50 },
  { id: 'scatter', name: 'Scatter Blaster', ammo: 5, damage: 10, cooldown: 0.65, reload: 1.5, range: 18, pellets: 5 },
  { id: 'repeater', name: 'Tide Repeater', ammo: 24, damage: 11, cooldown: 0.12, reload: 1.7, range: 35 },
  { id: 'burst', name: 'Burst Carbine', ammo: 18, damage: 13, cooldown: 0.5, reload: 1.6, range: 48, burst: 3, burstInterval: 0.085 },
  { id: 'longshot', name: 'Longshot', ammo: 4, damage: 68, cooldown: 1.1, reload: 2.1, range: 80 },
].map(weapon => [weapon.id, Object.freeze(weapon)])));

export const RARITIES = Object.freeze(Object.fromEntries([
  { id: 'common', name: 'Common', color: '#aebbc5', damageMultiplier: 1, weight: 45 },
  { id: 'uncommon', name: 'Uncommon', color: '#76cf79', damageMultiplier: 1.12, weight: 28 },
  { id: 'rare', name: 'Rare', color: '#65b6ff', damageMultiplier: 1.25, weight: 16 },
  { id: 'epic', name: 'Epic', color: '#bf8cff', damageMultiplier: 1.4, weight: 8 },
  { id: 'legendary', name: 'Legendary', color: '#ffc65c', damageMultiplier: 1.6, weight: 3 },
].map(rarity => [rarity.id, Object.freeze(rarity)])));

export function weaponStats(weapon, rarity = 'common') {
  const base = Object.hasOwn(WEAPONS, weapon) ? WEAPONS[weapon] : WEAPONS.flintlock;
  const quality = Object.hasOwn(RARITIES, rarity) ? RARITIES[rarity] : RARITIES.common;
  return { ...base, rarity: quality.id, damage: base.damage * quality.damageMultiplier };
}

export function rollWeapon(random = Math.random) {
  const sample = () => Math.max(0, Math.min(1 - Number.EPSILON, Number(random()) || 0));
  const weapon = WEAPON_ORDER[Math.floor(sample() * WEAPON_ORDER.length)];
  let roll = sample() * 100;
  for (const rarity of Object.values(RARITIES)) {
    if (roll < rarity.weight) return { weapon, rarity: rarity.id };
    roll -= rarity.weight;
  }
  return { weapon, rarity: 'legendary' };
}
