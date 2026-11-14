import assert from 'node:assert/strict';
import test from 'node:test';
import { TakeNoteCapture } from './takeRecording.ts';

test('note boundaries retain fractional beat timing for the piano roll', () => {
  const capture = new TakeNoteCapture();
  assert.equal(capture.noteOn(60, 2.125), null);
  assert.equal(capture.pending().length, 1);
  assert.equal(capture.pending()[0].startBeat, 2.125);
  const note = capture.noteOff(60, 3.375);
  assert.ok(note);
  assert.equal(note.pitch, 60);
  assert.equal(note.startBeat, 2.125);
  assert.equal(note.durationBeats, 1.25);
  assert.deepEqual(capture.pending(), []);
});

test('simultaneous notes get independent start and release times', () => {
  const capture = new TakeNoteCapture();
  capture.noteOn(60, 0.25);
  capture.noteOn(64, 0.5);
  assert.deepEqual(new Set(capture.pending().map((note) => note.pitch)), new Set([60, 64]));
  const first = capture.noteOff(60, 1.5);
  assert.equal(first?.durationBeats, 1.25);
  assert.deepEqual(capture.pending().map((note) => note.pitch), [64]);
  const second = capture.noteOff(64, 2.25);
  assert.equal(second?.durationBeats, 1.75);
  assert.notEqual(first?.id, second?.id);
});

test('retrigger completes the old note and begins a new one', () => {
  const capture = new TakeNoteCapture();
  capture.noteOn(67, 4);
  const first = capture.noteOn(67, 4.75);
  assert.ok(first);
  assert.equal(first.startBeat, 4);
  assert.equal(first.durationBeats, 0.75);
  const pending = capture.pending()[0];
  assert.equal(pending.startBeat, 4.75);
  assert.notEqual(pending.id, first.id);
  const second = capture.noteOff(67, 5);
  assert.equal(second?.durationBeats, 0.25);
});

test('stop finalizes all held notes and reset discards them', () => {
  const capture = new TakeNoteCapture();
  capture.noteOn(60, 1.5);
  capture.noteOn(64, 2);
  const completed = capture.finishAll(3.25);
  assert.deepEqual(completed.map((note) => [note.pitch, note.startBeat, note.durationBeats]), [
    [60, 1.5, 1.75],
    [64, 2, 1.25],
  ]);
  assert.deepEqual(capture.pending(), []);
  assert.deepEqual(capture.finishAll(4), []);
  capture.noteOn(72, 5);
  capture.reset();
  assert.deepEqual(capture.pending(), []);
  assert.equal(capture.noteOff(72, 6), null);
});

test('a note held through the final bar is clipped to the exact run boundary', () => {
  const capture = new TakeNoteCapture();
  capture.noteOn(72, 31.98);
  assert.deepEqual(capture.finishAll(32).map((note) => [note.startBeat, note.startBeat + note.durationBeats]), [
    [31.98, 32],
  ]);
});
