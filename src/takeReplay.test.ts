import assert from 'node:assert/strict';
import test from 'node:test';
import { BPM, type NoteEvent } from './theory.ts';
import { TakeReplay, takeEndBeat } from './takeReplay.ts';

const note = (id: string, pitch: number, startBeat: number, durationBeats: number): NoteEvent => (
  { id, pitch, startBeat, durationBeats }
);

function harness(notes: NoteEvent[]) {
  const played: Array<{ pitch: number; seconds: number }> = [];
  let stops = 0;
  const replay = new TakeReplay(notes, (pitch, seconds) => played.push({ pitch, seconds }), () => { stops += 1; });
  return { replay, played, stopCount: () => stops };
}

test('take end includes the last note duration, including an empty take', () => {
  assert.equal(takeEndBeat([]), 0);
  assert.equal(takeEndBeat([note('later-onset', 67, 7, 0.5), note('longer', 60, 4, 5)]), 9);
});

test('beat-zero notes start immediately and rests remain silent', () => {
  const { replay, played } = harness([note('first', 60, 0, 1), note('after-rest', 62, 3, 1)]);
  replay.start(0, 1);
  assert.deepEqual(played.map(({ pitch }) => pitch), [60]);
  replay.advance(0, 2.9);
  assert.equal(played.length, 1);
  replay.advance(2.9, 3);
  assert.deepEqual(played.map(({ pitch }) => pitch), [60, 62]);
});

test('overlapping notes and same-pitch overlaps each receive their remaining duration', () => {
  const { replay, played } = harness([
    note('sustained', 60, 1, 4), note('overlap', 64, 1.5, 2), note('same-pitch', 60, 2, 2),
  ]);
  replay.start(1.75, 0.5);
  assert.deepEqual(played.map(({ pitch }) => pitch), [60, 64]);
  assert.ok(Math.abs(played[0].seconds - (3.25 * 60 / BPM / 0.5)) < 1e-9);
  assert.ok(Math.abs(played[1].seconds - (1.75 * 60 / BPM / 0.5)) < 1e-9);
  replay.advance(1.75, 2.1);
  assert.deepEqual(played.map(({ pitch }) => pitch), [60, 64, 60]);
  assert.ok(Math.abs(played[2].seconds - (1.9 * 60 / BPM / 0.5)) < 1e-9);
});

test('repeated ticks do not double notes and expired notes are skipped', () => {
  const { replay, played } = harness([note('short', 60, 1, 0.1), note('long', 64, 1, 2)]);
  replay.start(0, 1);
  replay.advance(0, 1.5);
  replay.advance(0, 1.5);
  replay.advance(1.5, 2);
  assert.deepEqual(played.map(({ pitch }) => pitch), [64]);
  assert.ok(Math.abs(played[0].seconds - (1.5 * 60 / BPM)) < 1e-9);
});

test('pause, seek, and stop clear voices; seek resumes only when playing', () => {
  const { replay, played, stopCount } = harness([note('long', 60, 0, 4), note('later', 64, 3, 1)]);
  replay.start(0, 1);
  replay.pause();
  assert.equal(stopCount(), 2);
  replay.advance(0, 3);
  assert.deepEqual(played.map(({ pitch }) => pitch), [60]);
  replay.seek(2, 0.5);
  assert.equal(stopCount(), 3);
  assert.equal(played.length, 1);
  replay.start(2, 0.5);
  assert.equal(played.length, 2);
  assert.ok(Math.abs(played[1].seconds - (2 * 60 / BPM / 0.5)) < 1e-9);
  replay.seek(3.5, 1);
  assert.equal(stopCount(), 5);
  assert.deepEqual(played.slice(2).map(({ pitch }) => pitch), [60, 64]);
  replay.stop();
  assert.equal(stopCount(), 6);
  replay.advance(3.5, 4);
  assert.equal(played.length, 4);
});
