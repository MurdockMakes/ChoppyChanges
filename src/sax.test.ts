import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_PROGRESSION } from './theory.ts';
import { saxWrittenChord, saxWrittenKey, saxWrittenPitch, SaxPitchTracker } from './sax.ts';

test('alto and tenor written notes transpose while concert pitch stays fixed', () => {
  assert.equal(saxWrittenPitch(60, 'concert'), 60);
  assert.equal(saxWrittenPitch(60, 'alto'), 69);
  assert.equal(saxWrittenPitch(60, 'tenor'), 74);
  assert.equal(saxWrittenKey(0, 'alto'), 'A');
  assert.equal(saxWrittenKey(0, 'tenor'), 'D');
  assert.deepEqual(DEFAULT_PROGRESSION.chords.slice(0, 3).map((chord) => saxWrittenChord(chord, 'alto')), ['Bm7', 'E7', 'Amaj7']);
  assert.deepEqual(DEFAULT_PROGRESSION.chords.slice(0, 3).map((chord) => saxWrittenChord(chord, 'tenor')), ['Em7', 'A7', 'Dmaj7']);
});

test('pitch tracker rejects a single octave glitch but follows a sustained change', () => {
  const tracker = new SaxPitchTracker();
  assert.deepEqual([60, 60, 72, 60, 62, 62].map((pitch) => tracker.observe(pitch)), [60, 60, 60, 60, 60, 62]);
  assert.equal(tracker.observe(null), null);
  assert.equal(tracker.observe(65), 65);
});
