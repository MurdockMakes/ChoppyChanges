import assert from 'node:assert/strict';
import test from 'node:test';
import { countInPulses, transportFrame } from './transportTiming.ts';

test('four audible pulses precede the first pass and count-in ends at beat zero', () => {
  const pulses = [-3.99, -2.99, -1.99, -0.99, 0].flatMap((beat, index) =>
    countInPulses(-4 + index, beat, 0));
  assert.deepEqual(pulses, [-4, -3, -2, -1]);
  assert.deepEqual(transportFrame('counting-in', -0.01, 0, 32), { phase: 'count-in', beat: -0.01 });
  assert.deepEqual(transportFrame('counting-in', 0, 0, 32), { phase: 'start', beat: 0 });
  assert.deepEqual(transportFrame('recording', 0, 0, 32), { phase: 'run', beat: 0 });
});

test('the final frame stops at the precise end of the final bar', () => {
  assert.deepEqual(transportFrame('playing', 31.999, 0, 32), { phase: 'run', beat: 31.999 });
  assert.deepEqual(transportFrame('playing', 32, 0, 32), { phase: 'limit', beat: 32 });
  assert.deepEqual(transportFrame('recording', 32.02, 0, 32), { phase: 'limit', beat: 32 });
});
