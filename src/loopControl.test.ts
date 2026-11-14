import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePassCount, passAtBeat, practiceRunStartBeat, progressionEndBeat } from './loopControl.ts';
import { DEFAULT_PROGRESSION, PROGRESSIONS } from './theory.ts';

const blues = PROGRESSIONS.find((item) => item.id === 'blues-c')!;
const turnaround = PROGRESSIONS.find((item) => item.id === 'turnaround-c')!;

test('one pass ends after every bar of the selected progression', () => {
  assert.equal(progressionEndBeat(blues, 0, 1), 48);
  assert.equal(progressionEndBeat(DEFAULT_PROGRESSION, 0, 1), 16);
  assert.equal(progressionEndBeat(turnaround, 0, 1), 16);
  assert.equal(progressionEndBeat(blues, 0, 3), 144);
  assert.equal(progressionEndBeat(DEFAULT_PROGRESSION, 0, 2), 32);
});

test('a practice run starting partway through the form still covers each bar per pass', () => {
  assert.equal(practiceRunStartBeat(7), 4);
  assert.equal(practiceRunStartBeat(53.75), 52);
  assert.equal(practiceRunStartBeat(0.5), 0);
  assert.equal(progressionEndBeat(blues, 52, 1), 100);
  assert.equal(progressionEndBeat(blues, 52, 2), 148);
  assert.equal(progressionEndBeat(turnaround, 4, 2), 36);
  assert.equal(passAtBeat(turnaround, 4, 19.999, 2), 1);
  assert.equal(passAtBeat(turnaround, 4, 20, 2), 2);
  assert.equal(passAtBeat(turnaround, 4, 36, 2), 2);
});

test('pass count defaults to one and stays within its supported range', () => {
  assert.equal(normalizePassCount(NaN), 1);
  assert.equal(normalizePassCount(0), 1);
  assert.equal(normalizePassCount(2.8), 2);
  assert.equal(normalizePassCount(100), 16);
});
