import assert from 'node:assert/strict';
import test from 'node:test';
import { bluesEndBeat } from './loopControl.ts';
import { DEFAULT_PROGRESSION, PROGRESSIONS } from './theory.ts';

const blues = PROGRESSIONS.find((item) => item.id === 'blues-c')!;

test('12-bar blues can stop after one or several passes or continue', () => {
  assert.equal(bluesEndBeat(blues, 0, 'once', 8), 48);
  assert.equal(bluesEndBeat(blues, 0, 'count', 3), 144);
  assert.equal(bluesEndBeat(blues, 0, 'continuous', 3), null);
});

test('a passage take ends after the chosen passes from its current blues cycle', () => {
  assert.equal(bluesEndBeat(blues, 53, 'once', 1), 96);
  assert.equal(bluesEndBeat(blues, 53, 'count', 2), 144);
  assert.equal(bluesEndBeat(DEFAULT_PROGRESSION, 0, 'once', 1), null);
});
