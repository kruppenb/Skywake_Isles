import { WEAPONS, RARITIES } from '../shared/weapons.js';

// Presentation consumes live events only; inventory snapshots never enqueue rewards.
export function createLootReveal({ root, medallion, art, details, kicker, name, rarity, rays,
  getIcon, onStart = () => {}, reducedMotion = () => globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  setTimer = setTimeout, clearTimer = clearTimeout }) {
  let context = { round: null, playerId: null, active: false };
  let disposed = false;
  let current = null;
  let glow = null;
  const queue = [];
  const seen = new Set();
  const timers = new Set();
  const animations = new Set();
  const centered = 'translate(-50%, -50%)';

  function later(callback, delay) {
    const timer = setTimer(() => { timers.delete(timer); callback(); }, delay);
    timers.add(timer);
  }

  function animate(element, frames, duration, easing = 'ease-out') {
    if (element.animate) animations.add(element.animate(frames, { duration, easing, fill: 'forwards' }));
    else Object.assign(element.style, frames.at(-1));
  }

  function clearPresentation() {
    for (const timer of timers) clearTimer(timer);
    timers.clear();
    for (const animation of animations) animation.cancel();
    animations.clear();
    if (glow) {
      glow.classList.remove('loot-arrived');
      glow.style.removeProperty('--loot-accent');
      glow = null;
    }
    root.hidden = true;
    art.replaceChildren();
    for (const element of [medallion, details, rays]) {
      element.style.removeProperty('opacity'); element.style.removeProperty('transform');
    }
    current = null;
  }

  function cancel() { queue.length = 0; clearPresentation(); }

  function destination(weapon) {
    const icon = getIcon(weapon);
    if (!icon || icon.closest('[hidden]') || icon.checkVisibility?.({ visibilityProperty: true, opacityProperty: true }) === false) return null;
    const rect = icon.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0)) return null;
    return { icon, rect };
  }

  function finish(target, color) {
    clearPresentation();
    if (target?.icon.isConnected !== false && target?.icon.parentElement) {
      glow = target.icon.parentElement;
      glow.style.setProperty('--loot-accent', color);
      glow.classList.add('loot-arrived');
    }
    later(() => { clearPresentation(); startNext(); }, 300);
  }

  function fly(reduced) {
    // The toolbar can move between the pickup and flight (including mobile rotation).
    const target = destination(current.weapon);
    const color = RARITIES[current.rarity].color;
    const duration = reduced || !target ? 220 : 550;
    animate(details, [{ opacity: 1 }, { opacity: 0 }], 150);
    if (reduced || !target) animate(medallion, [{ opacity: 1 }, { opacity: 0 }], duration);
    else {
      const origin = art.firstElementChild.getBoundingClientRect();
      const dx = target.rect.left + target.rect.width / 2 - (origin.left + origin.width / 2);
      const dy = target.rect.top + target.rect.height / 2 - (origin.top + origin.height / 2);
      const scale = Math.min(target.rect.width / origin.width, target.rect.height / origin.height);
      animate(medallion, [
        { transform: `${centered} scale(1)`, opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(${scale})`, opacity: 0.3 },
      ], duration, 'cubic-bezier(.5, 0, .6, 1)');
    }
    later(() => finish(target, color), duration);
  }

  function startNext() {
    if (disposed || !context.active || current || !queue.length) return;
    clearPresentation();
    current = queue.shift();
    const source = getIcon(current.weapon);
    if (!source) { current = null; startNext(); return; }
    const reduced = reducedMotion();
    root.classList.toggle('loot-reduced', reduced);
    root.style.setProperty('--loot-accent', RARITIES[current.rarity].color);
    kicker.textContent = current.upgraded ? 'Weapon upgraded' : 'New weapon';
    name.textContent = WEAPONS[current.weapon].name;
    rarity.textContent = RARITIES[current.rarity].name;
    art.replaceChildren(source.cloneNode(true));
    root.hidden = false;
    if (!reduced) {
      animate(medallion, [
        { transform: `${centered} scale(.65) rotate(-7deg)`, opacity: 0 },
        { transform: `${centered} scale(1) rotate(0deg)`, opacity: 1 },
      ], 180, 'cubic-bezier(.2, .8, .3, 1.25)');
      animate(details, [{ opacity: 0 }, { opacity: 1 }], 180);
      animate(rays, [
        { transform: `${centered} scale(.65)`, opacity: 0 },
        { transform: `${centered} scale(.9)`, opacity: 1, offset: .3 },
        { transform: `${centered} scale(1.12)`, opacity: 0 },
      ], 580);
    }
    onStart(current);
    // Timers own the lifecycle: cancelled/unsupported animations cannot strand the queue.
    later(() => fly(reduced), 1000);
  }

  return {
    setContext(next) {
      if (disposed) return;
      if (next.round !== context.round || next.playerId !== context.playerId) { cancel(); seen.clear(); }
      context = { ...next, active: !!next.active };
      if (!context.active) cancel();
    },
    enqueue(event) {
      if (disposed || !event || event.kind !== 'loot' || typeof event.id !== 'string' || !event.id
        || !context.playerId || event.playerId !== context.playerId
        || !Object.hasOwn(WEAPONS, event.weapon) || !Object.hasOwn(RARITIES, event.rarity) || seen.has(event.id)) return false;
      seen.add(event.id);
      // Pickups made under a menu/hidden tab still equip immediately, without a stale reveal later.
      if (!context.active) return false;
      queue.push({ id: event.id, weapon: event.weapon, rarity: event.rarity, upgraded: event.upgraded === true });
      if (!current && !timers.size) startNext();
      return true;
    },
    cancel,
    reset() { cancel(); seen.clear(); context = { round: null, playerId: null, active: false }; },
    dispose() { cancel(); seen.clear(); disposed = true; },
  };
}
