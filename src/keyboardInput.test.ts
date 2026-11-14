import assert from 'node:assert/strict';
import test from 'node:test';
import { KeyboardPressController, releaseLostPointerCaptures } from './keyboardInput.ts';

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
