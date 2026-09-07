import { WEAPONS } from '../shared/weapons.js';

const smooth = value => {
  const t = Math.max(0, Math.min(1, value));
  return t * t * (3 - 2 * t);
};

// Wrist positions are in gun space, at the back of the left palm. The short
// breech strokes, magazine feed and receiver stroke deliberately have different
// paths; even the Longshot is serviced at its receiver, never at its muzzle.
const ACTIONS = {
  flintlock: { pitch: .56, roll: .28, hand: [
    [.18, [-.27, .035, -.06]], [.34, [-.30, .12, -.14]],
    [.49, [-.34, .21, -.15]], [.65, [-.27, .045, -.14]], [.76, [-.27, .035, -.06]],
  ] },
  scatter: { pitch: .48, roll: .34, hand: [
    [.18, [-.28, .015, -.16]], [.34, [-.32, .14, -.24]],
    [.49, [-.29, .10, -.48]], [.64, [-.28, .015, -.20]], [.76, [-.28, .015, -.16]],
  ] },
  repeater: { pitch: .44, roll: .40, hand: [
    [.18, [-.31, -.32, -.10]], [.34, [-.53, -.43, -.12]],
    [.49, [-.57, -.45, -.14]], [.67, [-.31, -.32, -.10]], [.76, [-.31, -.28, -.10]],
  ] },
  burst: { pitch: .46, roll: .32, hand: [
    [.18, [-.29, -.33, -.10]], [.34, [-.51, -.45, -.02]],
    [.49, [-.56, -.47, -.06]], [.67, [-.29, -.33, -.10]], [.76, [-.29, -.29, -.10]],
  ] },
  longshot: { pitch: .42, roll: .20, hand: [
    [.18, [-.24, .14, -.11]], [.34, [-.25, .24, .08]],
    [.49, [-.29, .28, -.13]], [.64, [-.24, .14, -.11]], [.76, [-.24, .10, -.11]],
  ] },
};

function sampleHand(keys, progress, rest) {
  const frames = [[.08, rest], ...keys, [.94, rest]];
  for (let i = 1; i < frames.length; i++) {
    if (progress > frames[i][0]) continue;
    const [start, a] = frames[i - 1], [end, b] = frames[i];
    const mix = smooth((progress - start) / (end - start));
    return a.map((value, index) => value + (b[index] - value) * mix);
  }
  return rest;
}

// All motion is sampled from the shared reload deadline, including when the
// first visible snapshot arrives halfway through or the render delta is zero.
export function sampleReloadAnimation(weapon, reloadUntil, elapsed, rest, eligible = true) {
  const action = ACTIONS[weapon], duration = WEAPONS[weapon]?.reload;
  const active = !!(eligible && action && Number.isFinite(reloadUntil) && Number.isFinite(elapsed)
    && reloadUntil > elapsed && reloadUntil - elapsed <= duration + 1e-7);
  const progress = active ? Math.max(0, Math.min(1, 1 - (reloadUntil - elapsed) / duration)) : 0;
  const work = active ? smooth(progress / .18) * (1 - smooth((progress - .76) / .24)) : 0;
  const release = active ? smooth((progress - .08) / .10) * (1 - smooth((progress - .76) / .18)) : 0;
  const open = active ? smooth((progress - .18) / .16) * (1 - smooth((progress - .49) / .18)) : 0;
  return { active, progress, work, release, open, pitch: action?.pitch || 0, roll: action?.roll || 0,
    hand: active ? sampleHand(action.hand, progress, rest) : rest };
}
