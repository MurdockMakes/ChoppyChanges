import assert from 'node:assert/strict';
import test from 'node:test';
import { MicNoteSegmenter } from './micSegmentation.ts';

test('sustained pitch becomes one note when a real gap arrives', () => {
  const segmenter = new MicNoteSegmenter();
  assert.deepEqual(segmenter.observe(69, 0), []);
  assert.deepEqual(segmenter.observe(69, 0.11), []);
  assert.equal(segmenter.currentNote?.startBeat, 0);
  segmenter.observe(69, 0.4);
  segmenter.observe(null, 0.5);
  const completed = segmenter.observe(null, 0.7);
  assert.deepEqual(completed, [{ id: 'mic-0', pitch: 69, startBeat: 0, durationBeats: 0.5 }]);
  assert.equal(segmenter.activePitch, null);
});

test('brief detector dropout does not split a note', () => {
  const segmenter = new MicNoteSegmenter();
  segmenter.observe(69, 0);
  segmenter.observe(69, 0.11);
  segmenter.observe(null, 0.3);
  assert.deepEqual(segmenter.observe(69, 0.38), []);
  segmenter.observe(69, 0.6);
  assert.deepEqual(segmenter.finalize(0.75), [{ id: 'mic-0', pitch: 69, startBeat: 0, durationBeats: 0.75 }]);
});

test('stable semitone change creates adjacent editable notes', () => {
  const segmenter = new MicNoteSegmenter();
  segmenter.observe(69, 0);
  segmenter.observe(69, 0.11);
  segmenter.observe(68, 0.5);
  const completed = segmenter.observe(68, 0.6);
  assert.deepEqual(completed, [{ id: 'mic-0', pitch: 69, startBeat: 0, durationBeats: 0.5 }]);
  assert.equal(segmenter.currentNote?.startBeat, 0.5);
  assert.deepEqual(segmenter.finalize(1), [{ id: 'mic-1', pitch: 68, startBeat: 0.5, durationBeats: 0.5 }]);
});

test('one-frame pitch wobble is ignored', () => {
  const segmenter = new MicNoteSegmenter();
  segmenter.observe(69, 0);
  segmenter.observe(69, 0.11);
  segmenter.observe(70, 0.3);
  segmenter.observe(69, 0.33);
  assert.deepEqual(segmenter.finalize(0.6), [{ id: 'mic-0', pitch: 69, startBeat: 0, durationBeats: 0.6 }]);
});

test('finalize closes the note at the start of trailing silence', () => {
  const segmenter = new MicNoteSegmenter();
  segmenter.observe(72, 1);
  segmenter.observe(72, 1.12);
  segmenter.observe(null, 1.4);
  const completed = segmenter.finalize(1.45);
  assert.equal(completed.length, 1);
  assert.equal(completed[0].id, 'mic-0');
  assert.equal(completed[0].pitch, 72);
  assert.equal(completed[0].startBeat, 1);
  assert.ok(Math.abs(completed[0].durationBeats - 0.4) < 1e-9);
});
