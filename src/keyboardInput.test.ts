import assert from 'node:assert/strict';
import test from 'node:test';
import { COMPUTER_PIANO_KEYS, ComputerPianoInput, KeyboardPressController, releaseLostPointerCaptures } from './keyboardInput.ts';

type TestKeyEvent = KeyboardEvent & { defaultPrevented: boolean };

function keyEvent(code: string, options: Record<string, unknown> = {}): TestKeyEvent {
  return {
    code,
    key: code,
    repeat: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    isComposing: false,
    target: { tagName: 'DIV' },
    defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; },
    ...options,
  } as TestKeyEvent;
}

function computerHarness(startPitch = 60) {
  const started: number[] = [];
  const stopped: number[] = [];
  const keys = new KeyboardPressController(
    (pitch) => started.push(pitch),
    (pitch) => stopped.push(pitch),
    () => {},
  );
  const input = new ComputerPianoInput(keys, () => startPitch);
  return { input, keys, started, stopped };
}

function codeAt(offset: number) {
  const key = COMPUTER_PIANO_KEYS.find((item) => item.offset === offset);
  assert.ok(key, `missing computer key for semitone ${offset}`);
  return key.code;
}

test('independent presses can sound together and release separately', () => {
  const started: number[] = [];
  const stopped: number[] = [];
  const changes: number[][] = [];
  const keys = new KeyboardPressController(
    (pitch) => started.push(pitch),
    (pitch) => stopped.push(pitch),
    (pressed) => changes.push([...pressed]),
  );

  keys.press('pointer:1', 60);
  keys.press('pointer:2', 64);
  assert.deepEqual(started, [60, 64]);
  assert.deepEqual(new Set(keys.pressedPitches()), new Set([60, 64]));
  assert.deepEqual(new Set(changes.at(-1)), new Set([60, 64]));

  keys.release('pointer:1');
  assert.deepEqual(stopped, [60]);
  assert.deepEqual(keys.pressedPitches(), [64]);
  keys.release('pointer:2');
  assert.deepEqual(stopped, [60, 64]);
  assert.deepEqual(keys.pressedPitches(), []);
});

test('repeated presses and multiple owners of one pitch use one sounding voice', () => {
  const started: number[] = [];
  const stopped: number[] = [];
  const keys = new KeyboardPressController(
    (pitch) => started.push(pitch),
    (pitch) => stopped.push(pitch),
    () => {},
  );

  keys.press('pointer:1', 67);
  keys.press('pointer:1', 67);
  keys.press('keyboard:67', 67);
  assert.deepEqual(started, [67]);
  assert.deepEqual(keys.pressedPitches(), [67]);

  keys.release('pointer:1');
  assert.deepEqual(stopped, []);
  assert.deepEqual(keys.pressedPitches(), [67]);
  keys.release('keyboard:67');
  keys.release('keyboard:67');
  assert.deepEqual(stopped, [67]);
  assert.deepEqual(keys.pressedPitches(), []);
});

test('cancellation and cleanup release every held pitch once', () => {
  const stopped: number[] = [];
  const changes: number[][] = [];
  const keys = new KeyboardPressController(
    () => {},
    (pitch) => stopped.push(pitch),
    (pressed) => changes.push([...pressed]),
  );

  keys.press('pointer:1', 60);
  keys.press('pointer:2', 64);
  keys.press('keyboard:60', 60);
  keys.releaseAll();
  assert.deepEqual(new Set(stopped), new Set([60, 64]));
  assert.equal(stopped.length, 2);
  assert.deepEqual(keys.pressedPitches(), []);
  assert.deepEqual(changes.at(-1), []);
  keys.releaseAll();
  keys.release('pointer:1');
  assert.equal(stopped.length, 2);
});

test('lost pointer capture releases only its own note before a pointer-up event', () => {
  const stopped: number[] = [];
  const keys = new KeyboardPressController(() => {}, (pitch) => stopped.push(pitch), () => {});
  keys.press('pointer:1', 60);
  keys.press('pointer:2', 64);
  const targets = new Map([
    [1, { hasPointerCapture: () => false }],
    [2, { hasPointerCapture: () => true }],
  ]);

  releaseLostPointerCaptures(targets, (id) => keys.release(`pointer:${id}`));
  assert.deepEqual(stopped, [60]);
  assert.deepEqual(keys.pressedPitches(), [64]);
  assert.deepEqual([...targets.keys()], [2]);
  releaseLostPointerCaptures(targets, (id) => keys.release(`pointer:${id}`));
  assert.deepEqual(stopped, [60]);
});

test('computer mapping covers two octaves with white notes on the home and bottom rows', () => {
  assert.equal(COMPUTER_PIANO_KEYS.length, 24);
  assert.deepEqual(COMPUTER_PIANO_KEYS.map((key) => key.offset).sort((a, b) => a - b),
    Array.from({ length: 24 }, (_, offset) => offset));
  assert.equal(new Set(COMPUTER_PIANO_KEYS.map((key) => key.code)).size, 24);
  assert.ok(COMPUTER_PIANO_KEYS.every((key) => key.label.length > 0));

  const expectedCodes = [
    'KeyA', 'KeyW', 'KeyS', 'KeyE', 'KeyD', 'KeyF', 'KeyT', 'KeyG',
    'KeyY', 'KeyH', 'KeyU', 'KeyJ', 'KeyK', 'KeyO', 'KeyL', 'KeyP',
    'Semicolon', 'Quote', 'BracketLeft', 'Comma', 'BracketRight', 'Period',
    'Backslash', 'Slash',
  ];
  assert.deepEqual(Array.from({ length: 24 }, (_, offset) => codeAt(offset)), expectedCodes);
});

test('computer keys play only when piano input is activated', () => {
  const { input, keys, started, stopped } = computerHarness();
  const inactive = keyEvent(codeAt(0));
  input.keyDown(inactive);
  input.keyUp(inactive);
  assert.deepEqual(started, []);
  assert.equal(inactive.defaultPrevented, false);

  input.setActive(true);
  assert.equal(input.isActive, true);
  const active = keyEvent(codeAt(0));
  input.keyDown(active);
  assert.deepEqual(started, [60]);
  assert.deepEqual(keys.pressedPitches(), [60]);
  assert.equal(active.defaultPrevented, true);
  input.keyUp(keyEvent(codeAt(0)));
  assert.deepEqual(stopped, [60]);
  assert.deepEqual(keys.pressedPitches(), []);
});

test('unmapped keys and existing Space or Enter piano-key access are left alone', () => {
  const { input, started } = computerHarness();
  input.setActive(true);
  for (const code of ['Space', 'Enter', 'Escape', 'ArrowLeft']) {
    const event = keyEvent(code);
    input.keyDown(event);
    input.keyUp(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(started, []);
});

test('held computer keys play together and repeat does not start duplicate voices', () => {
  const { input, keys, started, stopped } = computerHarness(72);
  input.setActive(true);
  input.keyDown(keyEvent(codeAt(0)));
  input.keyDown(keyEvent(codeAt(4)));
  input.keyDown(keyEvent(codeAt(0), { repeat: true }));
  input.keyDown(keyEvent(codeAt(0)));
  assert.deepEqual(started, [72, 76]);
  assert.deepEqual(keys.pressedPitches(), [72, 76]);

  input.keyUp(keyEvent(codeAt(0)));
  assert.deepEqual(stopped, [72]);
  assert.deepEqual(keys.pressedPitches(), [76]);
  input.keyUp(keyEvent(codeAt(4)));
  input.keyUp(keyEvent(codeAt(4)));
  assert.deepEqual(stopped, [72, 76]);
});

test('computer piano ignores editable controls and their descendants', () => {
  const { input, started } = computerHarness();
  input.setActive(true);
  const targets = [
    { tagName: 'INPUT' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
    { tagName: 'DIV', getAttribute: (name: string) => name === 'role' ? 'textbox' : null },
    { tagName: 'SPAN', parentElement: { tagName: 'DIV', isContentEditable: true } },
  ];
  for (const target of targets) {
    const event = keyEvent(codeAt(0), { target });
    input.keyDown(event);
    assert.equal(event.defaultPrevented, false, `typing in ${target.tagName} was captured`);
  }
  assert.deepEqual(started, []);
});

test('computer piano leaves modified shortcuts and composition alone', () => {
  const { input, started } = computerHarness();
  input.setActive(true);
  for (const options of [{ ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    const event = keyEvent(codeAt(0), options);
    input.keyDown(event);
    assert.equal(event.defaultPrevented, false);
  }
  assert.deepEqual(started, []);
});

test('keyup releases a held note even after focus moves into the editor', () => {
  const { input, started, stopped } = computerHarness();
  input.setActive(true);
  input.keyDown(keyEvent(codeAt(0)));
  input.keyUp(keyEvent(codeAt(0), { target: { tagName: 'TEXTAREA' } }));
  assert.deepEqual(started, [60]);
  assert.deepEqual(stopped, [60]);
});

test('keyup releases the original pitch after the displayed piano range shifts', () => {
  let startPitch = 60;
  const started: number[] = [];
  const stopped: number[] = [];
  const keys = new KeyboardPressController(
    (pitch) => started.push(pitch),
    (pitch) => stopped.push(pitch),
    () => {},
  );
  const input = new ComputerPianoInput(keys, () => startPitch);
  input.setActive(true);
  input.keyDown(keyEvent(codeAt(0)));
  startPitch = 72;
  input.keyUp(keyEvent(codeAt(0)));
  assert.deepEqual(started, [60]);
  assert.deepEqual(stopped, [60]);
  assert.deepEqual(keys.pressedPitches(), []);
});

test('deactivation releases computer notes while leaving a pointer owner intact', () => {
  const { input, keys, started, stopped } = computerHarness();
  keys.press('pointer:1', 60);
  input.setActive(true);
  input.keyDown(keyEvent(codeAt(0)));
  input.keyDown(keyEvent(codeAt(4)));
  assert.deepEqual(started, [60, 64]);

  input.setActive(false);
  assert.equal(input.isActive, false);
  assert.deepEqual(stopped, [64]);
  assert.deepEqual(keys.pressedPitches(), [60]);
  input.keyUp(keyEvent(codeAt(0)));
  assert.deepEqual(stopped, [64]);
  keys.release('pointer:1');
  assert.deepEqual(stopped, [64, 60]);
});

test('blur, visibility loss, and cleanup release held computer notes once', () => {
  for (const reason of ['window blur', 'visibility loss', 'component cleanup']) {
    const { input, keys, started, stopped } = computerHarness();
    input.setActive(true);
    input.keyDown(keyEvent(codeAt(0)));
    input.keyDown(keyEvent(codeAt(4)));
    input.releaseHeld();
    input.releaseHeld();
    input.keyUp(keyEvent(codeAt(0)));
    assert.deepEqual(started, [60, 64], reason);
    assert.deepEqual(stopped, [60, 64], reason);
    assert.deepEqual(keys.pressedPitches(), [], reason);
  }
});
