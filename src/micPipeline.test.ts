import assert from 'node:assert/strict';
import test from 'node:test';
import { detectPitch } from './pitchDetection.ts';
import { MicNoteSegmenter } from './micSegmentation.ts';
import { analyzeTake, type NoteEvent } from './theory.ts';

const SAMPLE_RATE = 48_000;
const WINDOW = 4096;

function saxLikeTone(frequencyHz: number): Float32Array {
  return Float32Array.from({ length: WINDOW }, (_, index) => {
    const phase = 2 * Math.PI * frequencyHz * index / SAMPLE_RATE;
    return 0.2 * Math.sin(phase) + 0.25 * Math.sin(2 * phase) + 0.12 * Math.sin(3 * phase);
  });
}

test('synthetic acoustic C-to-B phrase reaches the guide-tone analyzer', () => {
  const segmenter = new MicNoteSegmenter();
  const notes: NoteEvent[] = [];
  const feed = (frequencyHz: number | null, beat: number) => {
    const estimate = detectPitch(frequencyHz === null ? new Float32Array(WINDOW) : saxLikeTone(frequencyHz), SAMPLE_RATE);
    const midiPitch = estimate ? Math.round(69 + 12 * Math.log2(estimate.frequencyHz / 440)) : null;
    notes.push(...segmenter.observe(midiPitch, beat));
  };

  for (let beat = 3.35; beat < 3.9; beat += 0.05) feed(523.251, beat); // concert C5 on Dm7
  for (let beat = 3.9; beat < 4.0; beat += 0.05) feed(null, beat);
  for (let beat = 4.0; beat < 4.5; beat += 0.05) feed(493.883, beat); // concert B4 on G7
  notes.push(...segmenter.finalize(4.55));

  assert.deepEqual(notes.map((note) => note.pitch), [72, 71]);
  const evidence = analyzeTake(notes);
  assert.equal(evidence[0]?.kind, 'guide-tone');
  assert.match(evidence[0].explanation, /C on Dm7/);
  assert.match(evidence[0].explanation, /B on G7/);
});
