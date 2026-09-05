const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight', 'Space']);
const ACTION_KEYS = { KeyE: 'interact', KeyF: 'melee', KeyQ: 'heal', KeyR: 'reload', KeyG: 'ping', Digit1: 'flintlock', Digit2: 'scatter' };
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const isControl = (element) => !!element?.closest?.('input,textarea,select,button,a,[contenteditable="true"],[role="dialog"]');
const isEditable = (element) => !!element?.closest?.('input,textarea,select,[contenteditable="true"]');

export function createInput(canvas, callbacks = {}, { testMode = false } = {}) {
  const keys = new Set();
  const listeners = [];
  let enabled = false;
  let suspended = true;
  let dragging = false;
  let leftHeld = false;
  let locked = false;
  let requestedRelease = false;
  let fallbackNotified = false;
  let lastX = 0;
  let lastY = 0;
  let pulseJumpUntil = 0;
  let yaw = 0;
  let pitch = -.16;

  const on = (target, name, handler, options) => {
    target.addEventListener(name, handler, options);
    listeners.push(() => target.removeEventListener(name, handler, options));
  };
  const reset = () => {
    keys.clear();
    leftHeld = false;
    dragging = false;
    pulseJumpUntil = 0;
  };
  const canUse = (event) => enabled && !suspended && !isControl(event?.target) && !isControl(document.activeElement);
  const explainFallback = () => {
    if (!fallbackNotified) {
      fallbackNotified = true;
      callbacks.onNotice?.('Hold the right mouse button to look around. WASD still moves your pirate.');
    }
  };

  async function requestLock() {
    if (!enabled || suspended || locked) return;
    canvas.focus({ preventScroll: true });
    if (!canvas.requestPointerLock) { explainFallback(); return; }
    try {
      const request = canvas.requestPointerLock();
      if (request && typeof request.catch === 'function') await request.catch(explainFallback);
    } catch { explainFallback(); }
  }

  function releasePointer() {
    reset();
    if (document.pointerLockElement === canvas) {
      requestedRelease = true;
      document.exitPointerLock?.();
    }
  }

  on(window, 'keydown', (event) => {
    if (event.code === 'Escape') {
      if (enabled && !event.repeat && (suspended || !isEditable(event.target))) {
        event.preventDefault(); reset(); callbacks.onEscape?.();
      }
      return;
    }
    if (event.code === 'KeyM') {
      if (enabled && !event.repeat && !isEditable(event.target)) { event.preventDefault(); reset(); callbacks.onMap?.(); }
      return;
    }
    if (!canUse(event)) return;
    if (MOVEMENT_KEYS.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
      if (event.code === 'Space' && !event.repeat) pulseJumpUntil = performance.now() + 140;
    }
    if (ACTION_KEYS[event.code]) {
      event.preventDefault();
      if (!event.repeat) callbacks.onAction?.(ACTION_KEYS[event.code]);
    }
  });
  on(window, 'keyup', (event) => {
    keys.delete(event.code);
    if (enabled && !isControl(event.target) && MOVEMENT_KEYS.has(event.code)) event.preventDefault();
  });
  function pressMouseButton(event) {
    if (!enabled || suspended || (event.button !== 0 && event.button !== 2)) return;
    callbacks.onGesture?.();
    canvas.focus({ preventScroll: true });
    event.preventDefault();
    if (event.button === 2) {
      dragging = true;
      lastX = event.clientX;
      lastY = event.clientY;
    } else {
      leftHeld = true;
      // Browser tests use normal gameplay inputs without needing a pointer lock.
      if (!testMode) requestLock();
      callbacks.onAction?.('fire');
    }
  }
  function releaseMouseButton(event) {
    if (event.button === 0) leftHeld = false;
    if (event.button === 2) dragging = false;
  }
  // Mouse events report each button in a chord. Canceling mouse pointerdown
  // suppresses mousemove, so keep mouse buttons and look on this one event path.
  on(canvas, 'mousedown', pressMouseButton);
  on(window, 'mouseup', releaseMouseButton);
  on(canvas, 'pointerdown', (event) => {
    if (event.pointerType !== 'mouse') pressMouseButton(event);
  });
  on(window, 'pointerup', (event) => {
    if (event.pointerType !== 'mouse') releaseMouseButton(event);
  });
  on(window, 'pointercancel', (event) => {
    if (event.pointerType !== 'mouse') reset();
  });
  on(window, 'mousemove', (event) => {
    if (!enabled || suspended) return;
    // Recover if a release happened outside the browser before the mouse returned.
    if (!(event.buttons & 1)) leftHeld = false;
    if (!(event.buttons & 2)) dragging = false;
    if (!locked && !dragging) return;
    const dx = locked ? event.movementX : event.clientX - lastX;
    const dy = locked ? event.movementY : event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.abs(dx) > 800 || Math.abs(dy) > 800) return;
    yaw -= dx * .0025;
    yaw = Math.atan2(Math.sin(yaw), Math.cos(yaw));
    pitch = clamp(pitch - dy * .0025, -1.15, 1.1);
  });
  on(canvas, 'contextmenu', (event) => event.preventDefault());
  on(document, 'pointerlockchange', () => {
    const wasLocked = locked;
    locked = document.pointerLockElement === canvas;
    if (wasLocked && !locked) {
      reset();
      if (!requestedRelease && enabled && !suspended) callbacks.onEscape?.();
    }
    requestedRelease = false;
    callbacks.onLockChange?.(locked);
  });
  on(document, 'pointerlockerror', explainFallback);
  on(window, 'blur', () => { reset(); callbacks.onBlur?.(); });
  on(document, 'visibilitychange', () => { if (document.hidden) reset(); });

  return {
    keys,
    testMode,
    get yaw() { return yaw; },
    get pitch() { return pitch; },
    get locked() { return locked; },
    get aiming() { return dragging; },
    get firing() { return enabled && !suspended && leftHeld && !isControl(document.activeElement); },
    get enabled() { return enabled; },
    snapshot() {
      const allowed = enabled && !suspended && !isControl(document.activeElement);
      return {
        forward: allowed ? Number(keys.has('KeyW') || keys.has('ArrowUp')) - Number(keys.has('KeyS') || keys.has('ArrowDown')) : 0,
        right: allowed ? Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft')) : 0,
        sprint: allowed && (keys.has('ShiftLeft') || keys.has('ShiftRight')),
        jump: allowed && (keys.has('Space') || performance.now() < pulseJumpUntil),
        yaw, pitch,
      };
    },
    setEnabled(value) { enabled = !!value; if (!enabled) reset(); },
    setSuspended(value) { suspended = !!value; if (suspended) releasePointer(); },
    setView(nextYaw, nextPitch) {
      if (Number.isFinite(nextYaw)) yaw = Math.atan2(Math.sin(nextYaw), Math.cos(nextYaw));
      if (Number.isFinite(nextPitch)) pitch = clamp(nextPitch, -1.15, 1.1);
    },
    jump() { if (enabled && !suspended) { canvas.focus({ preventScroll: true }); pulseJumpUntil = performance.now() + 140; } },
    reset,
    requestLock,
    releasePointer,
    focus() { canvas.focus({ preventScroll: true }); },
    dispose() { releasePointer(); listeners.forEach((remove) => remove()); },
  };
}
