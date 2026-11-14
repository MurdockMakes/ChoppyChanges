import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPitch } from './pitchDetection.ts';

const SAMPLE_RATE = 48_000;
const SIZE = 4096;

function waveform(frequencyHz: number, harmonics: Array<[number, number]> = [[1, 0.5]]) {
  return Float32Array.from({ length: SIZE }, (_, index) => {
    const t = index / SAMPLE_RATE;
    return harmonics.reduce((sum, [multiple, amplitude]) => sum + amplitude * Math.sin(2 * Math.PI * frequencyHz * multiple * t), 0);
  });
}

test('estimates mid-register sax note frequencies', () => {
  const estimate = detectPitch(waveform(440), SAMPLE_RATE);
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.frequencyHz - 440) < 1, `estimated ${estimate.frequencyHz} Hz`);
  assert.ok(estimate.confidence > 0.9);
});

test('tracks a low note with strong harmonics', () => {
  const estimate = detectPitch(waveform(110, [[1, 0.15], [2, 0.42], [3, 0.22]]), SAMPLE_RATE);
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.frequencyHz - 110) < 2, `estimated ${estimate.frequencyHz} Hz`);
});

test('longer sax window resolves a low tenor note with a weak fundamental', () => {
  const frequencyHz = 103.826;
  const samples = Float32Array.from({ length: 8192 }, (_, index) => {
    const t = index / SAMPLE_RATE;
    return 0.07 * Math.sin(2 * Math.PI * frequencyHz * t)
      + 0.26 * Math.sin(4 * Math.PI * frequencyHz * t)
      + 0.18 * Math.sin(6 * Math.PI * frequencyHz * t);
  });
  const estimate = detectPitch(samples, SAMPLE_RATE);
  assert.ok(estimate);
  assert.ok(Math.abs(estimate.frequencyHz - frequencyHz) < 2, `estimated ${estimate.frequencyHz} Hz`);
});

test('rejects silence and nonperiodic noise', () => {
  assert.equal(detectPitch(new Float32Array(SIZE), SAMPLE_RATE), null);
  let seed = 12345;
  const noise = Float32Array.from({ length: SIZE }, () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return ((seed / 0xffffffff) * 2 - 1) * 0.25;
  });
  assert.equal(detectPitch(noise, SAMPLE_RATE), null);
});
