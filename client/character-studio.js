// Skywake Character Studio: an isolated inspection page for the original
// pirate prototype in client/assets/player-character/hero.glb.
//
// This page is a renderer only. It never joins a game session, never imports
// the game entry point and never replaces the live player, which is still the
// procedural buildPirate model in client/models.js. Everything reported here is
// measured from the GLB loaded in the browser; no manifest JSON is fetched,
// because the server intentionally does not serve JSON.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { makePalette, buildPirate } from './models.js';

const HERO_URL = '/assets/player-character/hero.glb';
const CLIPS = ['idle', 'walk', 'rig_check'];
// The accent the GLB ships with. The other swatches in the page mirror the
// in-game crew colours without importing gameplay state.
const AUTHORED_CREW = '#429f9a';
const SPREAD = .95;

// Camera presets. The character faces -Z, so an inspection camera parked on -Z
// looks at its face and the preset yaw spins the turntable underneath it.
// `gameplay` instead uses the real gameplay rig numbers (FOV 50, near .12,
// back 7.45, height 2.42, shoulder 1.48, pitch -.15) as a scale approximation;
// it is not the game world and is deliberately left unscaled.
const CAMERAS = {
  front: { yaw: 0, fov: 32, near: .1, position: [0, 1.48, -5.6], target: [0, 1.36, 0], fit: true },
  threeQuarter: { yaw: -.62, fov: 32, near: .1, position: [0, 1.66, -5.5], target: [0, 1.34, 0], fit: true },
  back: { yaw: Math.PI, fov: 32, near: .1, position: [0, 1.48, -5.6], target: [0, 1.36, 0], fit: true },
  face: { yaw: -.24, fov: 26, near: .05, position: [0, 2.36, -1.75], target: [0, 2.30, 0], fit: true },
  gameplay: { yaw: 0, fov: 50, near: .12, position: [1.48, 2.42, 7.45], pitch: -.15, fit: false },
};
const LIGHTING = {
  studio: { background: '#39424b', ground: '#4c545c', exposure: 1 },
  island: { background: '#85d9ee', ground: '#d9c79b', exposure: 1.18 },
};

const element = id => document.getElementById(id);
const root = element('studio');
const viewport = element('studio-viewport');
const canvas = element('studio-canvas');
const statusPanel = element('studio-status');
const statusText = element('status-text');
const retryButton = element('hero-retry');
const playButton = element('play-toggle');

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const state = {
  mode: 'hero', camera: 'threeQuarter', lighting: 'studio', clip: 'idle', surface: 'textured',
  crew: AUTHORED_CREW, playing: !reducedMotion.matches, yaw: CAMERAS.threeQuarter.yaw,
  cameraYawSource: null, ready: false, loading: true, error: null, attempts: 0,
};

// ---------------------------------------------------------------- renderer --
function createRenderer() {
  try {
    const created = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    created.outputColorSpace = THREE.SRGBColorSpace;
    created.toneMapping = THREE.ACESFilmicToneMapping;
    created.toneMappingExposure = 1;
    created.shadowMap.enabled = true;
    created.shadowMap.type = THREE.PCFSoftShadowMap;
    return created;
  } catch (error) {
    return { failure: error && error.message ? error.message : String(error) };
  }
}
const created = createRenderer();
const renderer = created && created.failure ? null : created;

const scene = new THREE.Scene();
const background = new THREE.Color();
scene.background = background;
const camera = new THREE.PerspectiveCamera(32, 1, .1, 260);
const turntable = new THREE.Group(); turntable.name = 'studio-turntable';
const heroSlot = new THREE.Group(); heroSlot.name = 'studio-hero-slot';
const baselineSlot = new THREE.Group(); baselineSlot.name = 'studio-baseline-slot';
turntable.add(heroSlot, baselineSlot);
scene.add(turntable);

const ground = new THREE.Mesh(new THREE.CircleGeometry(9, 64),
  new THREE.MeshStandardMaterial({ color: LIGHTING.studio.ground, roughness: 1, metalness: 0 }));
ground.name = 'studio-ground'; ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);

function configureShadow(light, radius, near, far) {
  light.shadow.mapSize.set(2048, 2048);
  light.shadow.bias = -.00025;
  light.shadow.normalBias = .06;
  Object.assign(light.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near, far });
  light.shadow.camera.updateProjectionMatrix();
}

const studioLights = new THREE.Group(); studioLights.name = 'studio-lighting';
const studioKey = new THREE.DirectionalLight('#fff4e6', 2.05);
studioKey.position.set(-3.6, 5.6, -4.8); studioKey.castShadow = true;
configureShadow(studioKey, 4.4, 1, 22);
const studioFill = new THREE.DirectionalLight('#dce8ff', .8); studioFill.position.set(4.8, 2.6, 3.6);
studioLights.add(new THREE.HemisphereLight('#ffffff', '#99a2ac', 1.15), studioKey, studioKey.target, studioFill);

// Exactly the game's rig values, on a bare ground disc rather than the island.
const islandLights = new THREE.Group(); islandLights.name = 'island-lighting';
const islandSun = new THREE.DirectionalLight('#fff0d0', 2.7);
islandSun.position.set(-70, 140, 80); islandSun.castShadow = true;
// The sun sits ~175.8 m away, so the shadow frustum is tightened around the
// subject instead of the island-wide range the game needs.
configureShadow(islandSun, 4.4, 158, 196);
islandLights.add(new THREE.HemisphereLight('#d9f6ff', '#779e7a', 2.2), islandSun, islandSun.target);
scene.add(studioLights, islandLights);

// Shared preview materials, created once and reused by every surface change.
const clayMaterial = new THREE.MeshStandardMaterial({ color: '#c8c1b2', roughness: .93, metalness: 0, side: THREE.DoubleSide });
clayMaterial.name = 'studio_clay';
const wireMaterial = new THREE.MeshBasicMaterial({ color: '#9fe6ff', wireframe: true });
wireMaterial.name = 'studio_wireframe';
const tintColor = new THREE.Color();
const measured = new THREE.Box3();
const meshBounds = new THREE.Box3();
const measuredSize = new THREE.Vector3();

// ---------------------------------------------------------------- baseline --
const palette = makePalette();
const sharedMaterials = new Set([palette.solid, palette.glow]);
// The neutral baseline state required for a fair comparison: on the ground,
// flintlock equipped and visible, no speed, no pitch, no aim.
const BASELINE_PLAYER = Object.freeze({ mode: 'ground', weapon: 'flintlock', pitch: 0, online: true, reloadUntil: 0 });
const baselinePose = { dt: 1 / 60, elapsed: 0, aiming: false };
let baseline = null;
let baselineStats = null;

function materialsOf(mesh) {
  return Array.isArray(mesh.material) ? mesh.material : [mesh.material];
}

function disposeMaterial(material) {
  if (!material) return;
  for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'aoMap', 'alphaMap']) {
    if (material[key] && material[key].dispose) material[key].dispose();
  }
  material.dispose();
}

// Counts and bounds for what is actually on screen. Hidden parts are skipped so
// the current player's stowed guns and folded glider cannot inflate the numbers,
// and so the reported height is the figure's height.
function measure(object) {
  let triangles = 0, meshes = 0, skinned = 0, joints = 0;
  const names = new Set();
  object.updateMatrixWorld(true);
  measured.makeEmpty();
  const walk = node => {
    if (node.visible === false) return;
    if (node.isMesh && node.geometry) {
      meshes++;
      if (node.isSkinnedMesh) { skinned++; joints = Math.max(joints, node.skeleton ? node.skeleton.bones.length : 0); }
      const attribute = node.geometry.index || node.geometry.attributes.position;
      if (attribute) triangles += Math.floor(attribute.count / 3);
      for (const material of materialsOf(node)) if (material) names.add(material.name || material.type);
      // Skinned meshes carry their own pose-aware box; plain meshes use the
      // geometry box, exactly as Box3.expandByObject would.
      if (node.boundingBox !== undefined) {
        if (node.boundingBox === null) node.computeBoundingBox();
        meshBounds.copy(node.boundingBox);
      } else {
        if (node.geometry.boundingBox === null) node.geometry.computeBoundingBox();
        meshBounds.copy(node.geometry.boundingBox);
      }
      measured.union(meshBounds.applyMatrix4(node.matrixWorld));
    }
    for (const child of node.children) walk(child);
  };
  walk(object);
  measured.getSize(measuredSize);
  return {
    triangles, meshes, skinnedMeshes: skinned, joints,
    materials: names.size, materialNames: [...names].sort(),
    height: Number(measuredSize.y.toFixed(4)),
    bounds: {
      min: measured.min.toArray().map(value => Number(value.toFixed(4))),
      max: measured.max.toArray().map(value => Number(value.toFixed(4))),
    },
  };
}

// Frees a mesh's own resources. The shared palette, clay and wireframe
// materials outlive every subject and must never be disposed here, and a mesh
// currently wearing a preview material still owns the material it came with.
function disposeMeshResources(node) {
  if (node.geometry) node.geometry.dispose();
  const original = node.userData.studioBaseMaterial;
  const list = original ? (Array.isArray(original) ? original : [original]) : materialsOf(node);
  for (const material of list) {
    if (!material || material === clayMaterial || material === wireMaterial || sharedMaterials.has(material)) continue;
    disposeMaterial(material);
  }
}

function disposeBaseline() {
  if (!baseline) return;
  baselineSlot.remove(baseline.group);
  baseline.group.traverse(node => { if (node.isMesh) disposeMeshResources(node); });
  baseline = null;
}

function buildBaseline(hex) {
  disposeBaseline();
  baseline = buildPirate(palette, hex);
  baseline.group.name = 'current-player-baseline';
  // buildPirate leaves itself in the 'aboard' pose with the gun hidden, and its
  // blends are eased. Settle them before the first frame so the neutral ground
  // stance is what the reviewer sees.
  for (let i = 0; i < 30; i++) baseline.animate(0, 0, BASELINE_PLAYER, baselinePose);
  // Measured detached, so the side-by-side offset never leaks into the numbers.
  baselineStats = measure(baseline.group);
  baselineSlot.add(baseline.group);
  applySurface();
}

// -------------------------------------------------------------------- hero --
const loader = new GLTFLoader();
let heroRoot = null;
let mixer = null;
let actions = Object.create(null);
let heroStats = null;
let crewMaterial = null;

function disposeHero() {
  if (mixer) {
    mixer.stopAllAction();
    const mixerRoot = mixer.getRoot();
    if (mixerRoot) mixer.uncacheRoot(mixerRoot);
    mixer = null;
  }
  actions = Object.create(null);
  if (heroRoot) {
    heroSlot.remove(heroRoot);
    heroRoot.traverse(node => {
      if (!node.isMesh) return;
      disposeMeshResources(node);
      if (node.isSkinnedMesh && node.skeleton && node.skeleton.dispose) node.skeleton.dispose();
    });
    heroRoot = null;
  }
  crewMaterial = null;
  heroStats = null;
}

function setStatus(kind, message, showRetry = false) {
  statusPanel.dataset.state = kind;
  statusText.textContent = message;
  retryButton.hidden = !showRetry;
}

function loadHero() {
  if (!renderer) return;
  disposeHero();
  state.loading = true; state.ready = false; state.error = null;
  setStatus('loading', 'Loading the original prototype…');
  applyMode();
  sync();
  // A retry must not be answered from a cached failure.
  const url = state.attempts ? `${HERO_URL}?attempt=${state.attempts}` : HERO_URL;
  loader.load(url, onHeroLoaded, undefined, onHeroError);
}

function onHeroLoaded(gltf) {
  try {
    heroRoot = gltf.scene;
    if (!heroRoot.name) heroRoot.name = 'SkywakeNavigator';
    heroRoot.traverse(node => {
      if (!node.isMesh) return;
      node.castShadow = true;
      node.receiveShadow = true;
      // Skinned bounds are computed from the rest pose; animated poses must not
      // be culled while the turntable spins.
      node.frustumCulled = false;
      node.userData.studioBaseMaterial = node.material;
      for (const material of materialsOf(node)) if (material && material.name === 'crew_accent') crewMaterial = material;
    });
    heroStats = measure(heroRoot);
    heroStats.url = HERO_URL;
    heroStats.animations = (gltf.animations || []).map(clip => ({
      name: clip.name, duration: Number(clip.duration.toFixed(4)), tracks: clip.tracks.length,
    }));
    heroStats.crewMaterial = crewMaterial ? crewMaterial.name : null;
    heroStats.authoredCrewHex = crewMaterial ? `#${crewMaterial.color.getHexString(THREE.SRGBColorSpace)}` : null;

    if (gltf.animations && gltf.animations.length) {
      mixer = new THREE.AnimationMixer(heroRoot);
      for (const clip of gltf.animations) actions[clip.name] = mixer.clipAction(clip);
    }
    heroSlot.add(heroRoot);
    applyCrew(state.crew);
    applySurface();
    applyClip(state.clip);
    state.ready = true; state.loading = false; state.error = null;
    applyMode();
    setStatus('ready', `Loaded ${HERO_URL} — ${heroStats.triangles.toLocaleString('en-US')} triangles, `
      + `${heroStats.materials} materials, ${heroStats.joints} joints.`);
    renderReport();
    sync();
  } catch (error) {
    onHeroError(error);
  }
}

function onHeroError(error) {
  const detail = error && error.message ? error.message : String(error || 'unknown error');
  state.error = `Could not load ${HERO_URL}: ${detail}`;
  state.ready = false; state.loading = false;
  // The current player stays available so the page is still useful.
  if (state.mode !== 'current') applyMode('current');
  setStatus('error', `${state.error} Showing the current player instead.`, true);
  renderReport();
  sync();
}

function renderReport() {
  const text = (id, value) => { const node = element(id); if (node) node.textContent = value; };
  if (heroStats) {
    text('report-triangles', heroStats.triangles.toLocaleString('en-US'));
    text('report-primitives', String(heroStats.meshes));
    text('report-skinned', String(heroStats.skinnedMeshes));
    text('report-materials', `${heroStats.materials} (${heroStats.materialNames.join(', ')})`);
    text('report-joints', String(heroStats.joints));
    text('report-clips', heroStats.animations.length
      ? heroStats.animations.map(clip => `${clip.name} ${clip.duration}s / ${clip.tracks} tracks`).join(', ')
      : 'none');
    text('report-height', `${heroStats.height.toFixed(3)} m`);
    text('report-bounds', `min ${heroStats.bounds.min.join(', ')} — max ${heroStats.bounds.max.join(', ')}`);
  } else {
    for (const id of ['report-triangles', 'report-primitives', 'report-skinned', 'report-materials',
      'report-joints', 'report-clips', 'report-height', 'report-bounds']) text(id, state.error ? 'not loaded' : '—');
  }
  text('report-baseline', baselineStats
    ? `${baselineStats.triangles.toLocaleString('en-US')} triangles, ${baselineStats.meshes} visible meshes, `
      + `${baselineStats.height.toFixed(3)} m (procedural buildPirate)`
    : '—');
}

// ------------------------------------------------------------------ modes ---
function applyMode(next = state.mode) {
  if (next !== 'hero' && next !== 'current' && next !== 'side') return;
  state.mode = next;
  const side = next === 'side';
  heroSlot.position.x = side ? SPREAD : 0;
  baselineSlot.position.x = side ? -SPREAD : 0;
  heroSlot.visible = next !== 'current' && !!heroRoot;
  baselineSlot.visible = next !== 'hero';
  press('mode-buttons', 'mode', next);
  applyCamera();
  sync();
}

function applyCamera(next = state.camera) {
  const preset = CAMERAS[next];
  if (!preset) return;
  state.camera = next;
  // Choosing a camera snaps the turntable to that preset's yaw; a resize or a
  // view change keeps whatever the reviewer has dragged to.
  if (next !== state.cameraYawSource) {
    state.yaw = preset.yaw;
    state.cameraYawSource = next;
  }
  turntable.rotation.y = state.yaw;
  camera.fov = preset.fov;
  camera.near = preset.near;
  let [x, y, z] = preset.position;
  if (preset.fit) {
    // Widen for two subjects, and again for tall narrow phone viewports so the
    // figure is never cropped sideways. The procedural player's hat plume
    // reaches ~3.27 m, above the prototype's 2.72 m, so any view containing it
    // needs a taller frame.
    let scale = state.mode === 'hero' ? 1 : state.mode === 'current' ? 1.2 : 1.25;
    const aspect = camera.aspect || 1;
    if (aspect < 1.2) scale *= Math.min(2.1, 1.2 / aspect);
    z *= scale;
  }
  camera.position.set(x, y, z);
  if (preset.pitch === undefined) camera.lookAt(preset.target[0], preset.target[1], preset.target[2]);
  else camera.rotation.set(preset.pitch, 0, 0);
  camera.updateProjectionMatrix();
  press('camera-buttons', 'camera', next);
  sync();
}

function applyLighting(next = state.lighting) {
  const preset = LIGHTING[next];
  if (!preset) return;
  state.lighting = next;
  background.set(preset.background);
  ground.material.color.set(preset.ground);
  if (renderer) renderer.toneMappingExposure = preset.exposure;
  studioLights.visible = next === 'studio';
  islandLights.visible = next === 'island';
  press('lighting-buttons', 'lighting', next);
  sync();
}

function applyClip(next = state.clip) {
  if (!CLIPS.includes(next)) return;
  state.clip = next;
  if (mixer && actions[next]) {
    for (const name of Object.keys(actions)) if (name !== next) actions[name].stop();
    actions[next].reset().setLoop(THREE.LoopRepeat, Infinity).play();
    // Evaluate frame zero so a paused studio still shows the posed clip rather
    // than the rest pose.
    mixer.setTime(0);
  }
  press('clip-buttons', 'clip', next);
  sync();
}

function applyPlaying(next = state.playing) {
  state.playing = !!next;
  playButton.textContent = state.playing ? 'Pause' : 'Play';
  playButton.setAttribute('aria-pressed', String(state.playing));
  sync();
}

// Tinting reuses one THREE.Color and mutates the existing material, so no
// texture, material or geometry is recreated for a colour change.
function applyCrew(hex = state.crew) {
  if (typeof hex !== 'string' || !/^#[0-9a-f]{6}$/i.test(hex)) return;
  const changed = hex.toLowerCase() !== state.crew.toLowerCase();
  state.crew = hex.toLowerCase();
  if (crewMaterial) crewMaterial.color.copy(tintColor.setStyle(hex, THREE.SRGBColorSpace));
  // The procedural baseline bakes its accent into vertex colours, so matching
  // it means rebuilding that one model; the old one is disposed first.
  if (!baseline || changed) buildBaseline(state.crew);
  renderReport();
  press('crew-buttons', 'crew', state.crew);
  sync();
}

function applySurface(next = state.surface) {
  if (next !== 'textured' && next !== 'clay' && next !== 'wireframe') return;
  state.surface = next;
  const override = next === 'clay' ? clayMaterial : next === 'wireframe' ? wireMaterial : null;
  for (const subject of [heroRoot, baseline && baseline.group]) {
    if (!subject) continue;
    subject.traverse(node => {
      if (!node.isMesh || node.name === 'pirate-contact-shadow') return;
      if (node.userData.studioBaseMaterial === undefined) node.userData.studioBaseMaterial = node.material;
      node.material = override || node.userData.studioBaseMaterial;
    });
  }
  press('surface-buttons', 'surface', next);
  sync();
}

function rotate(delta) {
  state.yaw = (state.yaw + delta) % (Math.PI * 2);
  turntable.rotation.y = state.yaw;
  sync();
}

function resetView() {
  const preset = CAMERAS[state.camera];
  state.yaw = preset ? preset.yaw : 0;
  turntable.rotation.y = state.yaw;
  applyCamera(state.camera);
}

// --------------------------------------------------------------- controls ---
function press(containerId, attribute, value) {
  const container = element(containerId);
  if (!container) return;
  for (const button of container.querySelectorAll(`button[data-${attribute}]`)) {
    button.setAttribute('aria-pressed', String(button.dataset[attribute] === value));
  }
}

function bindGroup(containerId, attribute, handler) {
  const container = element(containerId);
  if (!container) return;
  container.addEventListener('click', event => {
    const button = event.target.closest(`button[data-${attribute}]`);
    if (button && container.contains(button)) handler(button.dataset[attribute]);
  });
}

bindGroup('mode-buttons', 'mode', applyMode);
bindGroup('camera-buttons', 'camera', value => { state.cameraYawSource = null; applyCamera(value); });
bindGroup('lighting-buttons', 'lighting', applyLighting);
bindGroup('clip-buttons', 'clip', applyClip);
bindGroup('crew-buttons', 'crew', applyCrew);
bindGroup('surface-buttons', 'surface', applySurface);
playButton.addEventListener('click', () => applyPlaying(!state.playing));
element('rotate-left').addEventListener('click', () => rotate(-.22));
element('rotate-right').addEventListener('click', () => rotate(.22));
element('view-reset').addEventListener('click', resetView);
retryButton.addEventListener('click', () => { state.attempts++; loadHero(); });

let dragPointer = null;
let dragX = 0;
canvas.addEventListener('pointerdown', event => {
  dragPointer = event.pointerId;
  dragX = event.clientX;
  canvas.classList.add('is-dragging');
  try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is a convenience only */ }
});
canvas.addEventListener('pointermove', event => {
  if (event.pointerId !== dragPointer) return;
  rotate((event.clientX - dragX) * .0075);
  dragX = event.clientX;
});
const endDrag = event => {
  if (event.pointerId !== dragPointer) return;
  dragPointer = null;
  canvas.classList.remove('is-dragging');
  try { canvas.releasePointerCapture(event.pointerId); } catch { /* already released */ }
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft') rotate(-.14);
  else if (event.key === 'ArrowRight') rotate(.14);
  else if (event.key === 'Home') resetView();
  else return;
  event.preventDefault();
});

// ------------------------------------------------------- resize and render --
function resize() {
  if (!renderer) return;
  const width = Math.max(1, Math.round(viewport.clientWidth));
  const height = Math.max(1, Math.round(viewport.clientHeight));
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  applyCamera(state.camera);
}

const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
if (observer) observer.observe(viewport);
window.addEventListener('resize', resize);

const clock = new THREE.Clock();
let frameHandle = 0;
let elapsed = 0;
function frame() {
  frameHandle = requestAnimationFrame(frame);
  const delta = Math.min(clock.getDelta(), .1);
  if (state.playing) {
    elapsed += delta;
    if (mixer) mixer.update(delta);
    if (baseline && baselineSlot.visible) {
      baselinePose.dt = delta;
      baseline.animate(elapsed, 0, BASELINE_PLAYER, baselinePose);
    }
  }
  renderer.render(scene, camera);
}

function dispose() {
  if (frameHandle) cancelAnimationFrame(frameHandle);
  frameHandle = 0;
  if (observer) observer.disconnect();
  window.removeEventListener('resize', resize);
  disposeHero();
  disposeBaseline();
  ground.geometry.dispose();
  ground.material.dispose();
  clayMaterial.dispose();
  wireMaterial.dispose();
  palette.solid.dispose();
  palette.glow.dispose();
  palette.ramp.dispose();
  for (const geometry of Object.values(palette.geometry)) geometry.dispose();
  if (renderer) renderer.dispose();
}

// ------------------------------------------------------------- test surface --
// Small QA surface for the lead's independent checks. Nothing here is used by
// the game; the studio page is the only consumer.
const api = {
  version: 1,
  url: HERO_URL,
  ready: false, loading: true, error: null,
  mode: state.mode, camera: state.camera, lighting: state.lighting, clip: state.clip,
  surface: state.surface, crewColor: state.crew, playing: state.playing, yaw: state.yaw,
  clips: CLIPS.slice(), modes: ['hero', 'current', 'side'], cameras: Object.keys(CAMERAS),
  lightings: Object.keys(LIGHTING), surfaces: ['textured', 'clay', 'wireframe'],
  layout: { heroX: SPREAD, baselineX: -SPREAD, note: 'Side by side only; both slots sit at x=0 otherwise.' },
  hero: null, baseline: null,
  setMode: applyMode,
  setCamera: value => { state.cameraYawSource = null; applyCamera(value); },
  setLighting: applyLighting,
  setClip: applyClip,
  setSurface: applySurface,
  setCrewColor: applyCrew,
  setPlaying: applyPlaying,
  rotate,
  reset: resetView,
  retry: () => { state.attempts++; loadHero(); },
  resize,
  dispose,
  getState: () => ({
    ready: state.ready, loading: state.loading, error: state.error, attempts: state.attempts,
    mode: state.mode, camera: state.camera, lighting: state.lighting, clip: state.clip,
    surface: state.surface, crewColor: state.crew, playing: state.playing, yaw: state.yaw,
    exposure: renderer ? renderer.toneMappingExposure : null,
    cameraPosition: camera.position.toArray(), fov: camera.fov, near: camera.near,
    heroVisible: heroSlot.visible, baselineVisible: baselineSlot.visible,
    hero: heroStats, baseline: baselineStats,
  }),
  refs: {
    THREE, renderer, scene, camera, turntable, heroSlot, baselineSlot, ground, studioLights, islandLights,
    clayMaterial, wireMaterial, palette,
    get heroRoot() { return heroRoot; },
    get mixer() { return mixer; },
    get actions() { return actions; },
    get crewMaterial() { return crewMaterial; },
    get baseline() { return baseline; },
  },
};

function sync() {
  api.ready = state.ready; api.loading = state.loading; api.error = state.error;
  api.mode = state.mode; api.camera = state.camera; api.lighting = state.lighting;
  api.clip = state.clip; api.surface = state.surface; api.crewColor = state.crew;
  api.playing = state.playing; api.yaw = state.yaw; api.attempts = state.attempts;
  api.hero = heroStats; api.baseline = baselineStats;
  const data = root.dataset;
  data.mode = state.mode; data.camera = state.camera; data.lighting = state.lighting;
  data.clip = state.clip; data.surface = state.surface;
  data.playing = String(state.playing); data.ready = String(state.ready);
  data.error = state.error ? 'true' : 'false';
}
window.characterStudio = api;

// ------------------------------------------------------------------- start --
applyCrew(state.crew);
applyLighting(state.lighting);
applyPlaying(state.playing);
applyMode(state.mode);
press('clip-buttons', 'clip', state.clip);
renderReport();
if (renderer) {
  resize();
  loadHero();
  frameHandle = requestAnimationFrame(frame);
} else {
  const detail = created && created.failure ? created.failure : 'unknown error';
  state.error = `WebGL is unavailable in this browser: ${detail}`;
  state.loading = false;
  setStatus('error', state.error);
  sync();
}
