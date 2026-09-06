import test from 'node:test';
import assert from 'node:assert/strict';
import { createLootReveal } from '../client/loot-reveal.js';
import { RARITIES, WEAPON_ORDER } from '../shared/weapons.js';

function harness({ reduced = false, animations = true } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), motions = [], starts = [], lookups = [];
  class Element {
    constructor(id, rect = { left: 0, top: 0, width: 0, height: 0 }) {
      this.id = id; this.rect = rect; this.hidden = false; this.isConnected = true;
      this.visible = true; this.children = []; this.textContent = '';
      const classes = new Set();
      this.classList = { add: (value) => classes.add(value), remove: (value) => classes.delete(value),
        contains: (value) => classes.has(value), toggle: (value, enabled) => enabled ? classes.add(value) : classes.delete(value) };
      this.style = { setProperty(key, value) { this[key] = value; }, removeProperty(key) { delete this[key]; } };
      if (animations) this.animate = (frames, options) => {
        const motion = { element: this.id, frames, options, at: now, cancelled: false, cancel() { this.cancelled = true; } };
        motions.push(motion); return motion;
      };
    }
    replaceChildren(...children) { this.children = children; }
    get firstElementChild() { return this.children[0]; }
    getBoundingClientRect() { return this.rect; }
    checkVisibility() { return this.visible; }
    closest() { return this.hidden || this.parentElement?.hidden ? this : null; }
    cloneNode() { return new Element(`${this.id}-clone`, { left: 427.5, top: 254.5, width: 145, height: 91 }); }
  }
  const refs = Object.fromEntries(['root', 'medallion', 'art', 'details', 'kicker', 'name', 'rarity', 'rays'].map(id => [id, new Element(id)]));
  refs.root.hidden = true;
  const icons = Object.fromEntries(WEAPON_ORDER.map((weapon, index) => {
    const icon = new Element(weapon, { left: 650 + index * 65, top: 540, width: 60, height: 29 });
    icon.parentElement = new Element(`slot-${weapon}`);
    return [weapon, icon];
  }));
  const controller = createLootReveal({ ...refs,
    getIcon(weapon) { lookups.push({ weapon, at: now }); return icons[weapon]; },
    reducedMotion: () => reduced,
    onStart: (event) => starts.push({ ...event, at: now }),
    setTimer(callback, delay) { const id = ++nextTimer; timers.set(id, { callback, time: now + delay }); return id; },
    clearTimer: (id) => timers.delete(id),
  });
  const context = { round: 1, playerId: 'me', active: true };
  controller.setContext(context);
  function advance(duration) {
    const until = now + duration;
    while (true) {
      const next = [...timers].sort((a, b) => a[1].time - b[1].time)[0];
      if (!next || next[1].time > until) break;
      now = next[1].time; timers.delete(next[0]); next[1].callback();
    }
    now = until;
  }
  return { ...refs, controller, context, icons, motions, starts, timers, lookups, advance };
}

const reward = (id, overrides = {}) => ({ kind: 'loot', id, playerId: 'me', weapon: 'repeater', rarity: 'rare', upgraded: false, ...overrides });

test('live pickups reveal matching art and names, queue serially, and deduplicate for the round', () => {
  const h = harness();
  // Context/snapshot reconciliation alone must never create a replay celebration.
  h.controller.setContext({ ...h.context, collectedDropIds: ['old-drop'] });
  assert.equal(h.starts.length, 0);
  assert.equal(h.controller.enqueue(reward('one')), true, 'first live event works before any UI tick');
  assert.equal(h.root.hidden, false);
  assert.equal(h.art.firstElementChild.id, 'repeater-clone');
  assert.equal(h.kicker.textContent, 'New weapon');
  assert.equal(h.name.textContent, 'Tide Repeater');
  assert.equal(h.rarity.textContent, 'Rare');
  assert.equal(h.root.style['--loot-accent'], RARITIES.rare.color);
  assert.equal(h.controller.enqueue(reward('one')), false);
  assert.equal(h.controller.enqueue(reward('two', { weapon: 'longshot', rarity: 'legendary', upgraded: true })), true);
  h.advance(1849);
  assert.deepEqual(h.starts.map(event => event.id), ['one'], 'chime callback waits for actual queue start');
  h.advance(1);
  assert.deepEqual(h.starts.map(event => [event.id, event.at]), [['one', 0], ['two', 1850]]);
  assert.equal(h.kicker.textContent, 'Weapon upgraded');
  assert.equal(h.name.textContent, 'Longshot');
  assert.equal(h.art.firstElementChild.id, 'longshot-clone');
  assert.equal(h.root.style['--loot-accent'], RARITIES.legendary.color);
  h.advance(1850);
  assert.equal(h.root.hidden, true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.controller.enqueue(reward('two')), false);
});

test('remote and malformed loot never reaches local presentation or sound', () => {
  const h = harness();
  for (const event of [null, {}, reward('remote', { playerId: 'friend' }), reward('', {}), reward(2),
    reward('weapon-prototype', { weapon: 'constructor' }), reward('rarity-prototype', { rarity: '__proto__' }),
    reward('unknown', { weapon: 'cutlass' }), reward('bad-kind', { kind: 'chest' })]) {
    assert.equal(h.controller.enqueue(event), false);
  }
  assert.equal(h.starts.length, 0); assert.equal(h.root.hidden, true); assert.equal(h.timers.size, 0);
});

test('flight measures the matching slot at flight time after responsive layout changes', () => {
  const h = harness();
  h.controller.enqueue(reward('narrow', { weapon: 'burst' }));
  h.advance(900);
  assert.deepEqual(h.lookups, [{ weapon: 'burst', at: 0 }]);
  // The viewport narrowed during the readable hold; the selected gun is irrelevant.
  h.icons.burst.rect = { left: 237, top: 702, width: 46, height: 23 };
  h.advance(100);
  assert.deepEqual(h.lookups.at(-1), { weapon: 'burst', at: 1000 });
  const flight = h.motions.find(motion => motion.element === 'medallion' && motion.at === 1000);
  const transform = flight.frames.at(-1).transform;
  assert.equal(flight.options.duration, 550);
  assert.match(transform, /-240px/); assert.match(transform, /413.5px/);
  assert.match(transform, new RegExp(`scale\\(${23 / 91}\\)`));
  h.advance(550);
  assert.equal(h.icons.burst.parentElement.classList.contains('loot-arrived'), true);
  assert.equal(h.icons.repeater.parentElement.classList.contains('loot-arrived'), false);
  h.advance(300);
  assert.equal(h.icons.burst.parentElement.classList.contains('loot-arrived'), false);
});

test('reduced motion keeps a readable static reveal, fades, and emphasizes the slot without travel or rays', () => {
  const h = harness({ reduced: true });
  h.controller.enqueue(reward('quiet'));
  assert.equal(h.root.classList.contains('loot-reduced'), true);
  assert.equal(h.motions.length, 0);
  h.advance(999); assert.equal(h.root.hidden, false);
  h.advance(1);
  assert.equal(h.motions.some(motion => motion.element === 'rays'), false);
  assert.equal(h.motions.some(motion => motion.frames.some(frame => 'transform' in frame)), false);
  h.advance(220);
  assert.equal(h.root.hidden, true);
  assert.equal(h.icons.repeater.parentElement.classList.contains('loot-arrived'), true);
  h.advance(300);
  assert.equal(h.timers.size, 0); assert.equal(h.icons.repeater.parentElement.classList.contains('loot-arrived'), false);
});

test('missing or hidden destinations fade safely, and cancelled animations cannot strand the queue', () => {
  for (const unavailable of ['removed', 'hidden', 'invisible', 'zero-size']) {
    const h = harness();
    h.controller.enqueue(reward('first'));
    h.controller.enqueue(reward('next', { weapon: 'longshot' }));
    for (const animation of h.motions) animation.cancel();
    if (unavailable === 'removed') delete h.icons.repeater;
    if (unavailable === 'hidden') h.icons.repeater.parentElement.hidden = true;
    if (unavailable === 'invisible') h.icons.repeater.visible = false;
    if (unavailable === 'zero-size') h.icons.repeater.rect.width = 0;
    h.advance(1000);
    const exit = h.motions.find(motion => motion.element === 'medallion' && motion.at === 1000);
    assert.deepEqual(exit.frames, [{ opacity: 1 }, { opacity: 0 }]);
    h.advance(520);
    assert.deepEqual(h.starts.map(event => event.id), ['first', 'next']);
    h.advance(1850); assert.equal(h.timers.size, 0); assert.equal(h.root.hidden, true);
  }
});

test('blocking contexts cancel hold, flight, queue and glow without replay on resume', () => {
  for (const stage of [100, 1200, 1600]) {
    const h = harness();
    h.controller.enqueue(reward('active'));
    h.controller.enqueue(reward('queued'));
    h.advance(stage);
    // UI maps pause, map, downed, victory, disconnect and hidden tabs to inactive.
    h.controller.setContext({ ...h.context, active: false });
    assert.equal(h.root.hidden, true); assert.equal(h.art.children.length, 0); assert.equal(h.timers.size, 0);
    assert.equal(h.motions.every(motion => motion.cancelled), true);
    assert.equal(h.icons.repeater.parentElement.classList.contains('loot-arrived'), false);
    assert.equal(h.icons.repeater.parentElement.style['--loot-accent'], undefined);
    assert.equal(h.controller.enqueue(reward('during-menu')), false);
    h.controller.setContext(h.context); h.advance(5000);
    assert.deepEqual(h.starts.map(event => event.id), ['active']);
    for (const id of ['active', 'queued', 'during-menu']) assert.equal(h.controller.enqueue(reward(id)), false);
    assert.equal(h.controller.enqueue(reward('fresh')), true);
  }
});

test('round change, reset and disposal clear outstanding work and allow drop IDs in a fresh voyage', () => {
  const h = harness();
  h.controller.enqueue(reward('reused')); h.controller.enqueue(reward('stale'));
  h.controller.setContext({ ...h.context, round: 2 });
  assert.equal(h.root.hidden, true); assert.equal(h.timers.size, 0);
  assert.equal(h.controller.enqueue(reward('reused')), true);
  h.controller.reset(); h.advance(5000);
  assert.equal(h.root.hidden, true); assert.equal(h.timers.size, 0);
  assert.equal(h.controller.enqueue(reward('after-leave')), false);
  h.controller.setContext(h.context);
  assert.equal(h.controller.enqueue(reward('reused')), true);
  h.controller.dispose(); h.controller.setContext(h.context);
  assert.equal(h.controller.enqueue(reward('after-dispose')), false);
  h.advance(5000);
  assert.equal(h.starts.length, 3); assert.equal(h.root.hidden, true); assert.equal(h.timers.size, 0);
});

test('browsers without the animation API still complete and clean the reveal', () => {
  const h = harness({ animations: false });
  h.controller.enqueue(reward('fallback')); h.advance(1850);
  assert.equal(h.root.hidden, true); assert.equal(h.timers.size, 0);
  assert.equal(h.medallion.style.transform, undefined); assert.equal(h.medallion.style.opacity, undefined);
});
