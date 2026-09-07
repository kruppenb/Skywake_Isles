import * as THREE from 'three';
import { oldWatchWeight, oldWatchRadialWeight } from '../shared/old-watch.js';
import { windwardFarmWeight } from '../shared/windward-farm.js';
import { tideglassWeight } from '../shared/tideglass-market.js';
import { saltwindHarborWeight } from '../shared/saltwind-harbor.js';
import { driftwoodYardWeight, sunwakeStrandWeight } from '../shared/driftwood-yard.js';
import { palmheartWeight } from '../shared/palmheart-camp.js';
import { cinderworksWeight } from '../shared/cinderworks.js';
import { moonwatchWeight } from '../shared/moonwatch.js';

// Profiles are immutable color strings/scalars. Each frame is evaluated from
// the captured island baseline, never from another area's last frame.
export const ENVIRONMENT_PROFILES = Object.freeze({
  oldWatch: Object.freeze({ sky: '#abc6cc', skyStrength: .8, fog: '#b0c8ca', near: 72, far: 340, skyLight: '#d2dce1', groundLight: '#77765e', ambient: 1.5, sunColor: '#f5ddba', sunIntensity: 2.25 }),
  windwardFarm: Object.freeze({ sky: '#b9cecd', skyStrength: .8, fog: '#c0cebf', near: 88, far: 385, skyLight: '#e0dfcf', groundLight: '#858063', ambient: 1.7, sunColor: '#f8e2be', sunIntensity: 2.4 }),
  tideglassMarket: Object.freeze({ sky: '#b9dbdc', skyStrength: .65, fog: '#c6ded5', near: 95, far: 405, skyLight: '#e9e9d7', groundLight: '#8d9171', ambient: 1.85, sunColor: '#ffe7c4', sunIntensity: 2.5 }),
  // Airier and warmer than the market: open beach light with pale sand bounce.
  saltwindHarbor: Object.freeze({ sky: '#b7e0e8', skyStrength: .7, fog: '#cbe6e4', near: 100, far: 420, skyLight: '#eef3ec', groundLight: '#a09f85', ambient: 2.0, sunColor: '#fff1cf', sunIntensity: 2.6 }),
  // Golden working light over the yard; the strand is the airiest of them all.
  driftwoodYard: Object.freeze({ sky: '#bde0e4', skyStrength: .7, fog: '#d2e4dc', near: 100, far: 420, skyLight: '#f2efe0', groundLight: '#a89a78', ambient: 2.0, sunColor: '#ffefc8', sunIntensity: 2.65 }),
  sunwakeStrand: Object.freeze({ sky: '#bfe6ee', skyStrength: .65, fog: '#d6ebe8', near: 110, far: 440, skyLight: '#f4f5ee', groundLight: '#b0aa8c', ambient: 2.1, sunColor: '#fff4d6', sunIntensity: 2.7 }),
  // Humid and green-filtered under the canopy: closer fog, deep green bounce.
  palmheartCamp: Object.freeze({ sky: '#a9d3c4', skyStrength: .7, fog: '#b3cfb6', near: 80, far: 360, skyLight: '#d3e9cf', groundLight: '#4f6b45', ambient: 1.75, sunColor: '#f4ecc0', sunIntensity: 2.3 }),
  // Ash-hazy amber over the forge: closer dusty fog and ember-brown bounce.
  cinderworks: Object.freeze({ sky: '#e4c6a2', skyStrength: .72, fog: '#d6bc9f', near: 80, far: 360, skyLight: '#f0dcc4', groundLight: '#7c5a48', ambient: 1.75, sunColor: '#f9d8ab', sunIntensity: 2.4 }),
  // Cool luminous night-watch light: lilac sky, closer lilac fog, pale cyan-lilac
  // sky light over a lilac-grey ground bounce and a slightly cooler sun.
  moonwatch: Object.freeze({ sky: '#c9c4e6', skyStrength: .70, fog: '#c2c0dc', near: 82, far: 365, skyLight: '#dfe6f4', groundLight: '#6f6a8a', ambient: 1.70, sunColor: '#eeeaf2', sunIntensity: 2.30 }),
});

export function environmentWeights(player, { oldWatchReady = false, farmReady = false, tideglassReady = false, saltwindReady = false, driftwoodReady = false, palmheartReady = false, cinderworksReady = false, moonwatchReady = false } = {}) {
  if (!player || player.mode === 'aboard') return { baseline: 1, oldWatch: 0, windwardFarm: 0, tideglassMarket: 0, saltwindHarbor: 0, driftwoodYard: 0, sunwakeStrand: 0, palmheartCamp: 0, cinderworks: 0, moonwatch: 0 };
  const oldWatch = oldWatchReady ? (farmReady ? oldWatchRadialWeight : oldWatchWeight)(player.x, player.z) : 0;
  const windwardFarm = farmReady ? windwardFarmWeight(player.x, player.z) : 0;
  const tideglassMarket = tideglassReady ? tideglassWeight(player.x, player.z) : 0;
  const saltwindHarbor = saltwindReady ? saltwindHarborWeight(player.x, player.z) : 0;
  const driftwoodYard = driftwoodReady ? driftwoodYardWeight(player.x, player.z) : 0;
  const sunwakeStrand = driftwoodReady ? sunwakeStrandWeight(player.x, player.z) : 0;
  const palmheartCamp = palmheartReady ? palmheartWeight(player.x, player.z) : 0;
  const cinderworks = cinderworksReady ? cinderworksWeight(player.x, player.z) : 0;
  const moonwatch = moonwatchReady ? moonwatchWeight(player.x, player.z) : 0;
  const total = oldWatch + windwardFarm + tideglassMarket + saltwindHarbor + driftwoodYard + sunwakeStrand + palmheartCamp + cinderworks + moonwatch, scale = total > 1 ? 1 / total : 1;
  return { baseline: 1 - Math.min(1, total), oldWatch: oldWatch * scale, windwardFarm: windwardFarm * scale, tideglassMarket: tideglassMarket * scale,
    saltwindHarbor: saltwindHarbor * scale, driftwoodYard: driftwoodYard * scale, sunwakeStrand: sunwakeStrand * scale, palmheartCamp: palmheartCamp * scale,
    cinderworks: cinderworks * scale, moonwatch: moonwatch * scale };
}

export function createEnvironmentLighting({ scene, hemisphere = null, sun = null }) {
  const baseline = { sky: scene.background?.isColor ? scene.background.clone() : null, fog: scene.fog?.color.clone(), near: scene.fog?.near, far: scene.fog?.far,
    skyLight: hemisphere?.color.clone(), groundLight: hemisphere?.groundColor.clone(), ambient: hemisphere?.intensity, sunColor: sun?.color.clone(), sunIntensity: sun?.intensity };
  const profiles = Object.fromEntries(Object.entries(ENVIRONMENT_PROFILES).map(([name, value]) => [name, { ...value,
    ...Object.fromEntries(['sky', 'fog', 'skyLight', 'groundLight', 'sunColor'].map(key => [key, new THREE.Color(value[key])])),
  }]));
  let disposed = false;
  function color(target, key, weights) {
    if (!target || !baseline[key]) return;
    target.copy(baseline[key]);
    for (const [name, profile] of Object.entries(profiles)) {
      const weight = weights[name] * (key === 'sky' ? profile.skyStrength : 1);
      target.r += (profile[key].r - baseline[key].r) * weight;
      target.g += (profile[key].g - baseline[key].g) * weight;
      target.b += (profile[key].b - baseline[key].b) * weight;
    }
  }
  function scalar(key, weights) {
    return baseline[key] + Object.entries(profiles).reduce((sum, [name, profile]) => sum + (profile[key] - baseline[key]) * weights[name], 0);
  }
  function apply(weights) {
    if (scene.background?.isColor) color(scene.background, 'sky', weights);
    if (scene.fog) { color(scene.fog.color, 'fog', weights); scene.fog.near = scalar('near', weights); scene.fog.far = scalar('far', weights); }
    if (hemisphere) { color(hemisphere.color, 'skyLight', weights); color(hemisphere.groundColor, 'groundLight', weights); hemisphere.intensity = scalar('ambient', weights); }
    if (sun) { color(sun.color, 'sunColor', weights); sun.intensity = scalar('sunIntensity', weights); }
  }
  return { update(player, ready) { if (!disposed) apply(environmentWeights(player, ready)); }, dispose() {
    if (disposed) return;
    apply({ baseline: 1, oldWatch: 0, windwardFarm: 0, tideglassMarket: 0, saltwindHarbor: 0, driftwoodYard: 0, sunwakeStrand: 0, palmheartCamp: 0, cinderworks: 0, moonwatch: 0 }); disposed = true;
  } };
}
