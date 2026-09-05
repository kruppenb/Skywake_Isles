import test from 'node:test';
import assert from 'node:assert/strict';
import { createInput } from '../client/input.js';

function fixture(t) {
  const window = new EventTarget(), document = new EventTarget(), canvas = new EventTarget();
  const actions = [], lockChanges = [];
  let lockRequests = 0;
  document.activeElement = canvas; document.pointerLockElement = null; document.hidden = false;
  canvas.closest = () => null;
  canvas.focus = () => { document.activeElement = canvas; };
  canvas.requestPointerLock = () => { lockRequests++; };
  const emit = (target, type, properties = {}) => {
    const event = new Event(type, { cancelable: true });
    Object.assign(event, properties); target.dispatchEvent(event); return event;
  };
  document.exitPointerLock = () => { document.pointerLockElement = null; emit(document, 'pointerlockchange'); };
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const previousDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: window });
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  const input = createInput(canvas, { onAction: action => actions.push(action), onLockChange: locked => lockChanges.push(locked) });
  input.setEnabled(true); input.setSuspended(false);
  t.after(() => {
    input.dispose();
    if (previousWindow) Object.defineProperty(globalThis, 'window', previousWindow); else delete globalThis.window;
    if (previousDocument) Object.defineProperty(globalThis, 'document', previousDocument); else delete globalThis.document;
  });
  let buttons = 0, x = 100, y = 100, suppressMouse = false;
  const bit = button => button === 0 ? 1 : button === 2 ? 2 : 4;
  const details = (button = -1) => ({ button, buttons, clientX: x, clientY: y, pointerType: 'mouse', pointerId: 1, movementX: 0, movementY: 0 });
  // A canceled initial pointerdown suppresses compatibility mouse events. Chord
  // changes emit mouse down/up individually, but pointer down/up only on first/last.
  const mouse = {
    down(button) {
      const wasUp = buttons === 0; buttons |= bit(button);
      const pointer = emit(wasUp ? canvas : window, wasUp ? 'pointerdown' : 'pointermove', details(button));
      if (wasUp) suppressMouse = pointer.defaultPrevented;
      if (!suppressMouse) emit(canvas, 'mousedown', details(button));
      return pointer;
    },
    up(button) {
      buttons &= ~bit(button);
      emit(window, buttons ? 'pointermove' : 'pointerup', details(button));
      if (!suppressMouse) emit(window, 'mouseup', details(button));
      if (!buttons) suppressMouse = false;
    },
    move(dx, dy, relative = {}) {
      x += dx; y += dy;
      const event = { ...details(), movementX: dx, movementY: dy, ...relative };
      emit(window, 'pointermove', event);
      if (!suppressMouse) emit(window, 'mousemove', event);
    },
  };
  return { input, window, document, canvas, actions, lockChanges, mouse, emit, lockRequests: () => lockRequests };
}

test('normal right drag preserves mouse movement and ends on right release', t => {
  const { input, mouse, lockRequests } = fixture(t);
  assert.equal(mouse.down(2).defaultPrevented, false);
  assert.equal(input.aiming, true);
  mouse.move(120, 40);
  assert.ok(Math.abs(input.yaw + .3) < 1e-9); assert.ok(Math.abs(input.pitch + .26) < 1e-9);
  assert.equal(lockRequests(), 0);
  mouse.up(2); assert.equal(input.aiming, false);
  const yaw = input.yaw; mouse.move(60, 0); assert.equal(input.yaw, yaw);
});

test('right drag plus left fire preserves looking when left is released first', t => {
  const { input, mouse, actions, lockRequests } = fixture(t);
  mouse.down(2); mouse.down(0);
  assert.equal(input.aiming, true); assert.equal(input.firing, true);
  assert.deepEqual(actions, ['fire']); assert.equal(lockRequests(), 1);
  mouse.move(40, 0); const yaw = input.yaw;
  mouse.up(0); assert.equal(input.firing, false); assert.equal(input.aiming, true);
  mouse.move(40, 0); assert.ok(input.yaw < yaw);
  mouse.up(2); assert.equal(input.aiming, false);
});

test('left fire plus right drag preserves firing when right is released first', t => {
  const { input, mouse, actions } = fixture(t);
  mouse.down(0); mouse.down(2);
  assert.equal(input.firing, true); assert.equal(input.aiming, true);
  mouse.move(40, 10); assert.notEqual(input.yaw, 0);
  mouse.up(2); assert.equal(input.aiming, false); assert.equal(input.firing, true);
  assert.deepEqual(actions, ['fire']);
  mouse.up(0); assert.equal(input.firing, false);
});

test('locked mouse look uses relative movement once and primary click requests lock', t => {
  const { input, mouse, actions, document, canvas, emit, lockRequests, lockChanges } = fixture(t);
  mouse.down(0); assert.equal(lockRequests(), 1); assert.equal(input.firing, true);
  document.pointerLockElement = canvas; emit(document, 'pointerlockchange');
  assert.equal(input.locked, true); assert.deepEqual(lockChanges, [true]);
  mouse.move(120, 40, { movementX: 12, movementY: -4 });
  assert.ok(Math.abs(input.yaw + .03) < 1e-9); assert.ok(Math.abs(input.pitch + .15) < 1e-9);
  assert.deepEqual(actions, ['fire']);
  mouse.up(0); assert.equal(input.firing, false);
  mouse.move(40, 0, { movementX: 4 }); assert.ok(Math.abs(input.yaw + .04) < 1e-9);
});

test('blur and menus clear both mouse buttons, movement, and buffered jump', t => {
  const { input, mouse, window, emit, actions } = fixture(t);
  const holdInputs = () => {
    mouse.down(2); mouse.down(0); emit(window, 'keydown', { code: 'KeyW', repeat: false });
    emit(window, 'keydown', { code: 'Space', repeat: false }); emit(window, 'keyup', { code: 'Space' });
  };
  const assertClear = () => {
    assert.equal(input.aiming, false); assert.equal(input.firing, false);
    assert.equal(input.snapshot().forward, 0); assert.equal(input.snapshot().jump, false);
  };
  holdInputs(); assert.equal(input.snapshot().jump, true); emit(window, 'blur'); assertClear();
  mouse.up(0); mouse.up(2); holdInputs(); input.setSuspended(true); assertClear();
  const count = actions.length, yaw = input.yaw;
  mouse.move(50, 20); mouse.up(0); mouse.down(0);
  assert.equal(actions.length, count); assert.equal(input.yaw, yaw); assertClear();
});

test('quick Space taps remain buffered for a simulation tick and held Space still works', t => {
  const { input, window, emit } = fixture(t);
  let now = 1000; t.mock.method(performance, 'now', () => now);
  emit(window, 'keydown', { code: 'Space', repeat: false }); emit(window, 'keyup', { code: 'Space' });
  now = 1050; assert.equal(input.snapshot().jump, true);
  now = 1141; assert.equal(input.snapshot().jump, false);
  emit(window, 'keydown', { code: 'Space', repeat: false });
  now = 2000; assert.equal(input.snapshot().jump, true);
  emit(window, 'keyup', { code: 'Space' }); assert.equal(input.snapshot().jump, false);
});

test('non-mouse pointer taps keep their existing fire and release behavior', t => {
  const { input, canvas, window, emit, actions } = fixture(t);
  const down = emit(canvas, 'pointerdown', { pointerType: 'touch', pointerId: 5, button: 0 });
  assert.equal(down.defaultPrevented, true); assert.equal(input.firing, true); assert.deepEqual(actions, ['fire']);
  emit(window, 'pointerup', { pointerType: 'touch', pointerId: 5, button: 0 });
  assert.equal(input.firing, false);
});
