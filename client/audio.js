const readMute = () => { try { return localStorage.getItem('skywake-muted') === 'true'; } catch { return false; } };

// Every sound is synthesized in the browser. No samples or remote audio assets.
export function createAudio() {
  let context = null;
  let master = null;
  let muted = readMute();
  let noiseBuffer = null;
  let lastSound = new Map();

  function unlock() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) return;
    try {
      if (!context) {
        context = new AudioContext();
        master = context.createGain();
        master.gain.value = muted ? 0 : .35;
        master.connect(context.destination);
        noiseBuffer = context.createBuffer(1, context.sampleRate, context.sampleRate);
        const samples = noiseBuffer.getChannelData(0);
        for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;
      }
      if (context.state === 'suspended') context.resume().catch(() => {});
    } catch { /* A blocked audio device should never interrupt a voyage. */ }
  }

  function tone(frequency, duration = .12, volume = .16, type = 'sine', delay = 0, endFrequency = frequency) {
    if (!context || muted || context.state !== 'running') return;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, endFrequency), start + duration);
    gain.gain.setValueAtTime(.0001, start);
    gain.gain.exponentialRampToValueAtTime(Math.max(.001, volume), start + .008);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    oscillator.connect(gain); gain.connect(master);
    oscillator.start(start); oscillator.stop(start + duration + .02);
    oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
  }

  function noise(duration = .12, volume = .2, frequency = 1500, delay = 0) {
    if (!context || muted || context.state !== 'running') return;
    const source = context.createBufferSource();
    const filter = context.createBiquadFilter();
    const gain = context.createGain();
    const start = context.currentTime + delay;
    source.buffer = noiseBuffer;
    filter.type = 'lowpass'; filter.frequency.value = frequency;
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(filter); filter.connect(gain); gain.connect(master);
    source.start(start); source.stop(start + duration + .02);
    source.onended = () => { source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }

  function play(kind, { distant = false, weapon = 'flintlock' } = {}) {
    if (!context || muted) return;
    const time = performance.now();
    if (time - (lastSound.get(kind) || -1000) < (kind === 'hit' ? 50 : 22)) return;
    lastSound.set(kind, time);
    const v = distant ? .22 : 1;
    switch (kind) {
      case 'shot': {
        const voice = { flintlock: [.11, 165, 2500], scatter: [.18, 100, 1800], repeater: [.065, 220, 3600], burst: [.075, 185, 3200], longshot: [.24, 75, 2300] }[weapon] || [.11, 165, 2500];
        noise(voice[0], .34 * v, voice[2]);
        tone(voice[1], voice[0] + .03, .3 * v, 'triangle', 0, 48);
        tone(weapon === 'longshot' ? 950 : 650, .045, .065 * v, 'square', 0, 190);
        break;
      }
      case 'melee': noise(.17, .16 * v, 3200); tone(300, .1, .09 * v, 'triangle', 0, 95); break;
      case 'reload':
        noise(.045, .13 * v, 3500); tone(800, .035, .09 * v, 'square');
        noise(.045, .15 * v, 2800, .24); tone(1100, .05, .08 * v, 'triangle', .3);
        break;
      case 'hit': tone(660, .055, .13 * v, 'triangle', 0, 420); noise(.04, .07 * v, 4000); break;
      case 'hurt': tone(180, .16, .16 * v, 'triangle', 0, 90); break;
      case 'splash': noise(.35, .18 * v, 950); tone(260, .18, .09 * v, 'sine', 0, 120); break;
      // A breaking wave: a low rumble under two overlapping foam hisses.
      case 'surge': tone(64, 1.1, .16 * v, 'sine', 0, 38); noise(1.15, .2 * v, 520); noise(.75, .14 * v, 1400, .22); noise(.6, .09 * v, 2600, .5); break;
      case 'collect': [660, 880, 1320].forEach((f, i) => tone(f, .19, .14 * v, 'sine', i * .075)); break;
      case 'shrine': [392, 494, 587, 784].forEach((f, i) => tone(f, .48, .13 * v, 'triangle', i * .12)); break;
      case 'heal': [440, 554, 660].forEach((f, i) => tone(f, .45, .1 * v, 'sine', i * .09)); break;
      case 'ping': tone(880, .18, .12 * v, 'sine'); tone(660, .22, .08 * v, 'sine', .12); break;
      case 'drop': tone(440, .32, .12, 'triangle', 0, 880); noise(.4, .07, 600); break;
      case 'land': noise(.16, .1, 600); tone(85, .15, .15, 'sine', 0, 45); break;
      case 'downed': [330, 294, 220].forEach((f, i) => tone(f, .25, .13, 'triangle', i * .15)); break;
      case 'victory': {
        const notes = [[392, 0], [494, .18], [587, .36], [784, .55], [740, .8], [784, 1.05]];
        notes.forEach(([f, d]) => { tone(f, .5, .14, 'triangle', d); tone(f / 2, .5, .09, 'sine', d); });
        [392, 494, 587, 784].forEach((f) => tone(f, 1.3, .09, 'sine', 1.4));
        break;
      }
      default: break;
    }
  }

  return {
    unlock, play,
    get muted() { return muted; },
    setMuted(value) {
      muted = !!value;
      if (master && context) master.gain.setTargetAtTime(muted ? 0 : .35, context.currentTime, .035);
      try { localStorage.setItem('skywake-muted', String(muted)); } catch { /* Optional preference. */ }
      if (!muted) unlock();
    },
    dispose() { context?.close().catch(() => {}); context = null; master = null; lastSound.clear(); },
  };
}
