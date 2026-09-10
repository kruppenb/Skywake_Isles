import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { makePalette, buildChest, buildShrine } from '../client/models.js';

// These two props are the ones a pirate walks right up to, so the checks below
// are about the model itself: where the hinge really is, whether the box is
// really hollow, what the glyphs say about a shrine's state, and that none of
// it costs more draw calls, lights or shared palette mutations than agreed.

const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} vs ${expected} +-${tolerance}`);

function meshesOf(root) {
  const found = []; root.traverse(object => { if (object.isMesh) found.push(object); }); return found;
}
function lightsOf(root) {
  let lights = 0; root.traverse(object => { if (object.isLight) lights++; }); return lights;
}
// Box3.setFromObject only transforms a geometry's corner box, which balloons
// once the lid is rotated. Every measurement here walks the real vertices.
function worldPoints(root) {
  const points = [], vertex = new THREE.Vector3();
  root.updateMatrixWorld(true);
  for (const mesh of meshesOf(root)) {
    const position = mesh.geometry.attributes.position;
    for (let i = 0; i < position.count; i++) points.push(vertex.fromBufferAttribute(position, i).clone().applyMatrix4(mesh.matrixWorld));
  }
  return points;
}
function bounds(points) {
  const box = new THREE.Box3(); for (const point of points) box.expandByPoint(point); return box;
}
function triangles(root) {
  return meshesOf(root).reduce((sum, mesh) => sum + mesh.geometry.attributes.position.count / 3, 0);
}
function distinctColors(mesh) {
  const color = mesh.geometry.attributes.color, seen = new Set();
  for (let i = 0; i < color.count; i++) seen.add(`${color.getX(i).toFixed(2)},${color.getY(i).toFixed(2)},${color.getZ(i).toFixed(2)}`);
  return seen;
}
function allFinite(root) {
  for (const mesh of meshesOf(root)) for (const key of ['position', 'normal', 'color']) {
    const attribute = mesh.geometry.attributes[key];
    assert.ok(attribute && attribute.count > 0, `${mesh.name} is missing ${key}`);
    for (let i = 0; i < attribute.array.length; i++) assert.ok(Number.isFinite(attribute.array[i]), `${mesh.name} ${key}[${i}] is not finite`);
  }
}
const shrineFor = (palette, color = '#b6f379') => buildShrine(palette, color);

test('the chest keeps its original block and swings on a real back-edge hinge', () => {
  const palette = makePalette(), chest = buildChest(palette);
  chest.animate(0, false, { reducedMotion: true });
  const closed = bounds(worldPoints(chest.group));
  // The original prop measured 1.50 x 1.14 x 1.06 including its bands; the new
  // one keeps that silhouette instead of growing a bigger footprint.
  near(closed.max.x, .75, .06, 'right hand trim'); near(closed.min.x, -.75, .06, 'left hand trim');
  near(closed.max.z, .53, .06, 'back trim'); near(closed.min.z, -.53, .06, 'front trim');
  near(closed.min.y, 0, .01, 'the chest sits on the ground');
  near(closed.max.y, 1.13, .05, 'lid crown');
  assert.ok(closed.max.x - closed.min.x > 1.44 && closed.max.y - closed.min.y > 1.05 && closed.max.z - closed.min.z > .99,
    'the chest still fills its nominal 1.5 x 1.1 x 1.0 block');

  // The pivot is the hinge line itself: back wall, mouth height, dead centre.
  near(chest.lid.position.x, 0, 1e-9, 'hinge is centred');
  near(chest.lid.position.y, chest.seam, 1e-9, 'hinge sits at the mouth');
  near(chest.lid.position.z, .50, .01, 'hinge sits on the back wall');
  assert.ok(chest.openAngle > 1.5 && chest.openAngle < Math.PI, 'the lid falls back without going over centre');

  // Distance to the hinge line itself, which runs along x through the pivot.
  const toHinge = point => Math.hypot(point.y - chest.seam, point.z - .50);
  const local = worldPoints(chest.lid).map(point => point.clone());
  const closest = local.reduce((best, point) => toHinge(point) < toHinge(best) ? point : best);
  const front = local.reduce((best, point) => point.z < best.z ? point : best);
  chest.animate(0, true, { reducedMotion: true });
  const opened = worldPoints(chest.lid);
  const closestOpen = opened.reduce((best, point) => toHinge(point) < toHinge(best) ? point : best);
  assert.ok(toHinge(closest) < .05 && toHinge(closestOpen) < .05, 'boards reach the hinge line in both poses');
  const frontOpen = opened.reduce((best, point) => point.y > best.y ? point : best);
  assert.ok(frontOpen.y - front.y > .8, 'the front edge lifts');
  assert.ok(frontOpen.z - front.z > .9, 'and travels back over the hinge rather than through the mouth');
});

test('the chest is a hollow planked box whose hoard only reads through an open lid', () => {
  const palette = makePalette(), chest = buildChest(palette);
  chest.animate(0, false, { reducedMotion: true });
  const cavity = chest.cavity;
  assert.ok(cavity.isBox3 && cavity.max.y <= chest.seam + 1e-9, 'the cavity stops at the seam');
  assert.ok(cavity.max.x - cavity.min.x > 1.1 && cavity.max.z - cavity.min.z > .6 && cavity.max.y - cavity.min.y > .35,
    'the hollow is big enough to be worth opening');

  // Nothing structural intrudes: the shell is a shell.
  const probe = cavity.clone().expandByScalar(-.012);
  const intruding = worldPoints(chest.shell).filter(point => probe.containsPoint(point));
  assert.equal(intruding.length, 0, 'no chest body geometry fills the cavity');
  // ...but there is a liner, so the inside is planked instead of open air.
  const walls = worldPoints(chest.shell).filter(point => cavity.expandByScalar(0).distanceToPoint(point) < .02
    && point.y > cavity.min.y && point.y < cavity.max.y);
  assert.ok(walls.length > 60, 'the cavity is lined with real interior boards');

  const hoard = bounds([...worldPoints(chest.hoard), ...worldPoints(chest.glints)]);
  assert.ok(cavity.containsBox(hoard), 'coins and gems sit entirely inside the cavity');
  assert.ok(hoard.max.y < chest.seam - .1, 'the hoard never pokes above the seam');
  assert.ok(hoard.max.x - hoard.min.x > .8 && hoard.max.z - hoard.min.z > .4, 'the hoard fills the floor rather than being one lump');
  assert.ok(distinctColors(chest.hoard).size >= 6, 'struck coin and cut stones are differentiated surfaces, not one gold blob');

  // Closed, the lid boards cover the whole mouth; open, they are clear of it.
  const closedLid = bounds(worldPoints(chest.lid));
  assert.ok(closedLid.min.x <= cavity.min.x && closedLid.max.x >= cavity.max.x, 'the closed lid spans the mouth across');
  assert.ok(closedLid.min.z <= cavity.min.z && closedLid.max.z >= cavity.max.z, 'and front to back');
  assert.ok(closedLid.min.y <= chest.seam + .01, 'the closed lid meets the mouth frame');
  chest.animate(0, true, { reducedMotion: true });
  assert.ok(bounds(worldPoints(chest.lid)).min.z > cavity.max.z, 'the open lid stands clear behind the mouth');
});

test('the chest lid eases the same at any frame rate and reduced motion snaps it', () => {
  const palette = makePalette(), chest = buildChest(palette), slow = buildChest(palette), legacy = buildChest(palette);
  for (let i = 0; i < 30; i++) chest.animate(i / 60, true, { dt: 1 / 60 });
  for (let i = 0; i < 72; i++) slow.animate(i / 144, true, { dt: 1 / 144 });
  near(slow.lid.rotation.x, chest.lid.rotation.x, .01, 'half a second of opening looks the same at 60 and 144 Hz');
  // The old call site passed two arguments and eased by .14 a frame.
  legacy.animate(0, true);
  near(legacy.lid.rotation.x / chest.openAngle, .14, .005, 'the two argument call keeps the original 60 Hz feel');
  for (let i = 0; i < 60; i++) legacy.animate(i / 60, true);
  assert.ok(legacy.lid.rotation.x > chest.openAngle * .99, 'and still reaches the open pose');

  const snapped = buildChest(palette);
  snapped.animate(0, true, { reducedMotion: true });
  assert.equal(snapped.lid.rotation.x, snapped.openAngle, 'reduced motion opens without a sweep');
  snapped.animate(1, false, { reducedMotion: true });
  assert.equal(snapped.lid.rotation.x, 0, 'and closes without one');
  snapped.animate(2, true, true);
  assert.equal(snapped.lid.rotation.x, snapped.openAngle, 'a bare boolean third argument also means reduced motion');
  const still = new Set();
  for (let i = 0; i < 120; i++) { snapped.animate(i / 4, true, { reducedMotion: true }); still.add(snapped.glintMaterial.opacity.toFixed(6)); }
  assert.equal(still.size, 1, 'reduced motion holds the treasure glow steady');

  const lit = buildChest(palette);
  lit.animate(0, false, { reducedMotion: true });
  const shut = lit.glintMaterial.opacity;
  lit.animate(0, true, { reducedMotion: true });
  assert.ok(lit.glintMaterial.opacity > shut + .4, 'the hoard brightens once the lid is up');
  assert.ok(lit.readout.openness === 1 && lit.readout.lidAngle === lit.openAngle, 'the readout follows the lid');
});

test('the chest stays inside its draw call, triangle and material budget', () => {
  const palette = makePalette(), chest = buildChest(palette), other = buildChest(palette);
  const drawn = meshesOf(chest.group);
  assert.ok(drawn.length <= 8, `chest draw calls: ${drawn.length}`);
  assert.ok(triangles(chest.group) < 6500, `chest triangles: ${triangles(chest.group)}`);
  assert.equal(lightsOf(chest.group), 0, 'the chest lights itself with colour, never with a light');
  allFinite(chest.group);
  for (const mesh of drawn) {
    mesh.geometry.computeBoundingSphere();
    assert.ok(Number.isFinite(mesh.geometry.boundingSphere.radius) && mesh.geometry.boundingSphere.radius > 0, `${mesh.name} has a usable bounding sphere`);
  }
  assert.equal(chest.glints.castShadow, false, 'the glint pass skips shadows');
  assert.equal(chest.shell.material, palette.solid, 'solid parts still share the batched toon material');
  assert.equal(chest.lid.children[0].material, palette.solid, 'so does the lid');
  assert.notEqual(chest.glintMaterial, palette.glow, 'the animated glow is a per model material');
  assert.notEqual(chest.glintMaterial, other.glintMaterial, 'and one chest never dims another');
  chest.animate(3, true, { nearby: true, reducedMotion: true }); other.animate(3, false, {});
  assert.ok(chest.glintMaterial.opacity - other.glintMaterial.opacity > .3, 'two chests hold independent glow');
  assert.equal(palette.glow.opacity, 1); assert.equal(palette.glow.transparent, false);
  assert.equal(palette.glow.color.getHexString(), 'ffffff', 'the shared palette is never mutated');
});

test('the shrine keeps its footprint, gem height and a tiered carved plinth', () => {
  const palette = makePalette(), shrine = shrineFor(palette);
  shrine.animate(0, null, { reducedMotion: true });
  const stone = worldPoints(shrine.stone), plinth = bounds(stone);
  const radiusIn = (low, high) => stone.reduce((max, point) => point.y >= low && point.y <= high ? Math.max(max, Math.hypot(point.x, point.z)) : max, 0);
  near(Math.max(plinth.max.x, plinth.max.z), 2.30, .09, 'the plinth still covers the original 2.3 radius');
  near(shrine.gem.position.y, 2.65, 1e-9, 'the crystal floats at the original height');
  near(shrine.gemHeight, 2.65, 1e-9, 'and reports it');
  near(plinth.min.y, 0, .01, 'the plinth sits on the ground');

  const tiers = [radiusIn(0, .18), radiusIn(.24, .40), radiusIn(.47, .60)];
  assert.ok(tiers[0] > tiers[1] && tiers[1] > tiers[2], `three stepped treads, not one drum: ${tiers.join(' > ')}`);
  assert.ok(tiers[0] - tiers[2] > .5, 'the steps are deep enough to read from the ground');
  assert.ok(radiusIn(.70, 1.45) > 1.5, 'the two original support sites still carry sculpted posts');
  assert.ok(distinctColors(shrine.stone).size >= 8, 'cut stone, weathered stone and brass are separate surfaces');
});

test('the shrine ornament is cut into the stone and the crystal is really faceted', () => {
  const palette = makePalette(), shrine = shrineFor(palette);
  shrine.animate(0, null, { reducedMotion: true });
  const band = point => point.y > .22 && point.y < .44;
  const stoneBand = worldPoints(shrine.stone).filter(band).map(point => Math.hypot(point.x, point.z));
  const runeBand = worldPoints(shrine.runes).filter(band).map(point => Math.hypot(point.x, point.z));
  assert.ok(runeBand.length > 100, 'the carved band carries glyphs');
  const frame = Math.max(...stoneBand), floor = Math.min(...stoneBand);
  assert.ok(frame - floor > .15, 'the panel frames stand proud of a recessed back');
  assert.ok(Math.max(...runeBand) < frame - .04, 'and the glyphs sit down inside the recess rather than on the surface');

  const gem = shrine.gem.geometry.attributes;
  const normals = new Set();
  for (let i = 0; i < gem.normal.count; i++) normals.add(`${gem.normal.getX(i).toFixed(2)},${gem.normal.getY(i).toFixed(2)},${gem.normal.getZ(i).toFixed(2)}`);
  assert.ok(normals.size >= 40, `the crystal is cut, not smoothed: ${normals.size} facet normals`);
  const radii = [];
  for (let i = 0; i < gem.position.count; i++) radii.push(Math.hypot(gem.position.getX(i), gem.position.getZ(i)));
  const crown = radii.filter(r => r > 1e-6);
  assert.ok(Math.max(...crown) / Math.min(...crown) > 1.5, 'a girdle, a crown and a point rather than a ball');
  const gemBox = bounds(worldPoints(shrine.gem));
  near((gemBox.min.y + gemBox.max.y) / 2, 2.65, .05, 'the crystal is centred on its float height');
  assert.ok(gemBox.max.y - gemBox.min.y > 1.2, 'and is large enough to read from the beach');

  assert.equal(shrine.orrery.isGroup, true, 'the astrolabe turns on its own pivot');
  assert.ok(triangles(shrine.orrery) > 300, 'brass rings, an inclined axis and graduations');
  near(shrine.orrery.position.y, 2.65, 1e-9, 'the rings ride with the crystal');
});

test('the shrine stays inside its draw call, triangle and material budget', () => {
  const palette = makePalette(), shrine = shrineFor(palette), neighbour = shrineFor(palette, '#ffb76e');
  const drawn = meshesOf(shrine.group);
  assert.ok(drawn.length <= 8, `shrine draw calls: ${drawn.length}`);
  assert.ok(triangles(shrine.group) < 7000, `shrine triangles: ${triangles(shrine.group)}`);
  assert.equal(lightsOf(shrine.group), 0, 'a shrine glows with colour, never with a point light');
  allFinite(shrine.group);
  assert.equal(shrine.stone.material, palette.solid, 'the plinth still batches on the shared toon material');
  for (const material of [shrine.gemMaterial, shrine.runeMaterial, shrine.returnMaterial]) {
    assert.notEqual(material, palette.glow, 'every animated glow is a per model material');
    assert.equal(material.transparent, true);
  }
  assert.notEqual(shrine.gemMaterial, shrine.runeMaterial);
  assert.notEqual(shrine.gemMaterial, neighbour.gemMaterial, 'two shrines never share intensity');
  assert.equal(shrine.gem.castShadow, false); assert.equal(shrine.runes.castShadow, false); assert.equal(shrine.returnMarker.castShadow, false);

  shrine.animate(2, { status: 'cleared' }, { nearby: true, reducedMotion: true });
  neighbour.animate(2, { status: 'dormant' }, { nearby: false, reducedMotion: true });
  assert.ok(shrine.runeMaterial.opacity - neighbour.runeMaterial.opacity > .3, 'a captured shrine reads brighter than a distant untouched one');
  assert.equal(palette.glow.opacity, 1); assert.equal(palette.glow.transparent, false);
  assert.equal(palette.glow.color.getHexString(), 'ffffff', 'the shared glow material is untouched');
  assert.equal(palette.solid.opacity, 1); assert.equal(palette.solid.transparent, false);
});

test('a captured shrine stays lit and grows a cyan way home glyph on approach', () => {
  const palette = makePalette(), shrine = shrineFor(palette), cleared = { status: 'cleared' };
  shrine.animate(0, cleared, { nearby: false, reducedMotion: true });
  const farOpacity = shrine.returnMaterial.opacity, farY = shrine.returnMarker.position.y;
  const farScale = shrine.returnMarker.scale.x, farRunes = shrine.runeMaterial.opacity, farGem = shrine.gemMaterial.opacity;
  assert.equal(shrine.returnMarker.visible, true, 'the way home is offered from a distance');
  assert.ok(farOpacity > .05 && farOpacity < .45, `a minimal steady glow far off: ${farOpacity}`);

  shrine.animate(0, cleared, { nearby: true, reducedMotion: true });
  assert.ok(shrine.returnMaterial.opacity > farOpacity + .4, 'and lights much more strongly up close');
  assert.ok(shrine.returnMarker.position.y > farY + .1, 'the marker rises as it appears');
  assert.ok(shrine.returnMarker.scale.x > farScale, 'and grows');
  assert.ok(shrine.runeMaterial.opacity > farRunes + .3, 'the runes come up with it');
  assert.ok(shrine.gemMaterial.opacity > farGem, 'so does the crystal');

  const cyan = shrine.runeMaterial.color;
  assert.ok(cyan.b > cyan.r + .25 && cyan.b >= cyan.g, `captured runes read cyan: ${cyan.getHexString()}`);
  const glyph = shrine.returnMaterial.color;
  assert.ok(glyph.b > glyph.r + .25 && glyph.b >= glyph.g, `the return glyph reads cyan: ${glyph.getHexString()}`);
  assert.ok(shrine.gemMaterial.opacity > .55 && shrine.gem.scale.x > .7, 'a captured shrine is still visibly active, not switched off');

  const markerBox = bounds(worldPoints(shrine.returnMarker));
  assert.ok(markerBox.min.y > bounds(worldPoints(shrine.stone)).max.y, 'the glyph hovers above the shrine where a pirate can see it');
  assert.ok(Math.max(markerBox.max.x, markerBox.max.z) < 1.0, 'and stays over the plinth');
  assert.equal(shrine.returnMarker.name, 'shrine-return-to-boat-marker');
  assert.ok(shrine.readout.returnVisible && shrine.readout.cleared, 'the readout reports the guiding state');
});

test('a shrine that is not captured never offers the way home', () => {
  const palette = makePalette(), shrine = shrineFor(palette);
  for (const state of [undefined, null, {}, { status: 'dormant' }, { status: 'active' }, { status: 'locked' }, { status: 'CLEARED' }, 'cleared', 7])
    for (const nearby of [false, true]) {
      shrine.animate(1.5, state, { nearby, reducedMotion: true });
      assert.equal(shrine.returnMarker.visible, false, `no return glyph for ${JSON.stringify(state)}`);
      assert.equal(shrine.returnMaterial.opacity, 0, `and no return glow for ${JSON.stringify(state)}`);
      assert.equal(shrine.readout.returnVisible, false);
      const warm = shrine.runeMaterial.color;
      assert.ok(warm.r >= warm.b, 'uncaptured runes stay warm');
    }
  // The central beacon reuses the shrine and must never advertise a return.
  for (const state of [null, { status: 'cleared' }]) {
    shrine.animate(1.5, state, { nearby: true, reducedMotion: true, returnEnabled: false });
    assert.equal(shrine.returnMarker.visible, false, 'returnEnabled false hides the glyph outright');
    assert.equal(shrine.returnMaterial.opacity, 0);
    const warm = shrine.runeMaterial.color;
    assert.ok(warm.r >= warm.b, 'and leaves the beacon runes warm');
    assert.ok(shrine.gemMaterial.opacity > .55, 'while the beacon crystal stays lit');
  }
  shrine.animate(1.5, { status: 'cleared' }, { nearby: true, reducedMotion: true });
  assert.equal(shrine.returnMarker.visible, true, 'a normal shrine still offers it');
});

test('reduced motion stills the shrine without hiding what it is doing', () => {
  const palette = makePalette(), shrine = shrineFor(palette), cleared = { status: 'cleared' };
  const samples = new Set();
  for (let i = 0; i < 200; i++) {
    shrine.animate(i * .137, cleared, { nearby: true, reducedMotion: true, dt: 1 / 60 });
    samples.add([shrine.gem.position.y, shrine.gem.rotation.y, shrine.orrery.rotation.y, shrine.orrery.rotation.z,
      shrine.returnMarker.position.y, shrine.returnMarker.rotation.y, shrine.runeMaterial.opacity.toFixed(6),
      shrine.gemMaterial.opacity.toFixed(6), shrine.returnMaterial.opacity.toFixed(6)].join('|'));
  }
  assert.equal(samples.size, 1, 'no bob, no spin, no pulse');
  near(shrine.gem.position.y, 2.65, 1e-9, 'the crystal rests at its float height');
  near(shrine.gem.rotation.y, 0, 1e-12, 'the crystal does not turn');
  near(shrine.orrery.rotation.y, 0, 1e-12, 'the astrolabe does not turn');
  near(shrine.orrery.rotation.z, 0, 1e-12, 'nor does it rock');
  const capturedNear = { runes: shrine.runeMaterial.opacity, glyph: shrine.returnMaterial.opacity, visible: shrine.returnMarker.visible };
  shrine.animate(0, cleared, { nearby: false, reducedMotion: true });
  assert.ok(capturedNear.glyph > shrine.returnMaterial.opacity + .4, 'near and far still read differently');
  shrine.animate(0, { status: 'dormant' }, { nearby: true, reducedMotion: true });
  assert.ok(shrine.returnMarker.visible === false && capturedNear.visible === true, 'captured and uncaptured still read differently');
  assert.ok(Math.abs(shrine.runeMaterial.opacity - capturedNear.runes) > .01, 'state still changes the rune glow');
});

test('shrine and chest glow breathes but never flashes', () => {
  const palette = makePalette(), shrine = shrineFor(palette), chest = buildChest(palette);
  const runes = [], gem = [], glyph = [], hoard = [];
  let previous = null, biggestStep = 0;
  // Settle the approach ramp and the lid first: this test is about the idle
  // breathing, not about the deliberate transitions into it.
  for (let frame = 0; frame < 300; frame++) {
    shrine.animate(frame / 60, { status: 'cleared' }, { nearby: true, dt: 1 / 60 });
    chest.animate(frame / 60, true, { dt: 1 / 60 });
  }
  for (let frame = 300; frame < 900; frame++) {
    const time = frame / 60;
    shrine.animate(time, { status: 'cleared' }, { nearby: true, dt: 1 / 60 });
    chest.animate(time, true, { dt: 1 / 60 });
    runes.push(shrine.runeMaterial.opacity); gem.push(shrine.gemMaterial.opacity);
    glyph.push(shrine.returnMaterial.opacity); hoard.push(chest.glintMaterial.opacity);
    if (previous !== null) biggestStep = Math.max(biggestStep, Math.abs(shrine.runeMaterial.opacity - previous));
    previous = shrine.runeMaterial.opacity;
  }
  const spread = list => Math.max(...list) - Math.min(...list);
  assert.ok(spread(runes) < .12, `rune glow breathes gently: ${spread(runes)}`);
  assert.ok(spread(gem) < .12, `crystal glow breathes gently: ${spread(gem)}`);
  assert.ok(spread(glyph) < .01, 'the way home glyph holds a steady brightness once you are near');
  assert.ok(spread(hoard) < .12, 'the open hoard shimmers rather than strobes');
  assert.ok(biggestStep < .01, `no frame to frame jump: ${biggestStep}`);
  for (const list of [runes, gem, glyph, hoard]) for (const value of list) assert.ok(value >= 0 && value <= 1, 'opacity stays legal');
});

test('both models survive odd animation arguments and stay finite', () => {
  const palette = makePalette(), shrine = shrineFor(palette), chest = buildChest(palette);
  const options = [undefined, null, {}, { dt: 0 }, { dt: -1 }, { dt: NaN }, { dt: Infinity }, { dt: 12 },
    { nearby: true, dt: 1 / 240 }, { reducedMotion: true, dt: 0 }, { nearby: true, returnEnabled: false }];
  for (const option of options) for (const state of [null, { status: 'cleared' }, { status: 'active' }]) {
    const readout = shrine.animate(3.25, state, option);
    assert.ok(Number.isFinite(shrine.gem.position.y) && Number.isFinite(shrine.gem.rotation.y), 'crystal stays finite');
    assert.ok(Number.isFinite(shrine.returnMarker.position.y) && Number.isFinite(shrine.returnMarker.scale.x), 'marker stays finite');
    for (const material of [shrine.gemMaterial, shrine.runeMaterial, shrine.returnMaterial])
      assert.ok(material.opacity >= 0 && material.opacity <= 1, 'opacity stays in range');
    assert.ok(readout.proximity >= 0 && readout.proximity <= 1, 'proximity stays in range');
  }
  for (const option of [...options, true, false]) {
    chest.animate(3.25, true, option);
    assert.ok(Number.isFinite(chest.lid.rotation.x), 'lid angle stays finite');
    assert.ok(chest.lid.rotation.x >= 0 && chest.lid.rotation.x <= chest.openAngle + 1e-9, 'lid never overshoots');
    assert.ok(chest.glintMaterial.opacity >= 0 && chest.glintMaterial.opacity <= 1, 'hoard glow stays in range');
  }
  // The legacy signatures both call sites used before this pass still work.
  chest.animate(1, false);
  shrine.animate(1, null);
  assert.ok(Number.isFinite(shrine.gem.position.y) && Number.isFinite(chest.lid.rotation.x), 'two argument calls still animate');
  allFinite(shrine.group); allFinite(chest.group);
});
