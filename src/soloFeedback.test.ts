import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeAudioFrames, buildSoloFeedback, type AudioFrame } from './soloFeedback.ts';
import { PROGRESSIONS, type NoteEvent, type Progression } from './theory.ts';

function measure(report: ReturnType<typeof buildSoloFeedback>, id: string) {
  const found = report.measures.find((item) => item.id === id);
  assert.ok(found, `${id} is a separate measure`);
  assert.ok(found.definition, `${id} explains its calculation`);
  assert.ok(found.threshold, `${id} explains its confidence threshold`);
  return found;
}

function landingTake(progression: Progression): NoteEvent[] {
  const notes: NoteEvent[] = [];
  for (let bar = 0; bar < progression.chords.length * 3; bar += 1) {
    const chord = progression.chords[bar % progression.chords.length];
    const previous = progression.chords[(bar - 1 + progression.chords.length) % progression.chords.length];
    if (bar > 0 && chord.name !== previous.name) {
      notes.push({ id: `landing-${bar}`, pitch: 60 + chord.third, startBeat: bar * 4 + 0.12, durationBeats: 0.55 });
    }
  }
  return notes;
}

test('every progression and form gives separate chord-landing evidence tied to played notes', () => {
  assert.deepEqual(new Set(PROGRESSIONS.map((item) => item.form)), new Set(['ii-v-i', 'blues', 'turnaround']));
  for (const progression of PROGRESSIONS) {
    const notes = landingTake(progression);
    const report = buildSoloFeedback(notes, progression, 'piano');
    const landing = measure(report, 'chord-landings');
    assert.notEqual(landing.status, 'unavailable', `${progression.id} landing should have observations`);
    assert.ok(landing.observations.length > 0, `${progression.id} landing observations`);
    assert.ok(!('overallGrade' in report), 'report must not collapse into a solo grade');
    for (const item of report.measures) {
      assert.ok(item.definition && item.threshold, `${progression.id} ${item.id} must describe calculation and threshold`);
    }
  }
});

test('sparse takes use limited or unavailable measures and neutral wording', () => {
  const progression = PROGRESSIONS[0];
  const notes = [{ id: 'only-note', pitch: 62, startBeat: 0.2, durationBeats: 0.3 }];
  const report = buildSoloFeedback(notes, progression, 'piano');
  for (const id of ['chord-landings', 'tension-resolution', 'rhythmic-variety', 'phrase-space', 'motif-development']) {
    const item = measure(report, id);
    assert.notEqual(item.status, 'available', `${id} needs more than one short note`);
  }
  assert.doesNotMatch(JSON.stringify(report), /\b(wrong|mistake|bad solo|poor solo)\b/i);
  assert.equal(measure(report, 'intonation').status, 'unavailable');
  assert.equal(measure(report, 'articulation').status, 'unavailable');
});

test('tension timing reports the median of observed chord-tone arrivals', () => {
  const notes: NoteEvent[] = [
    { id: 'e-tension', pitch: 64, startBeat: 0.5, durationBeats: 0.25 },
    { id: 'f-arrival', pitch: 65, startBeat: 1, durationBeats: 0.25 },
    { id: 'g-tension', pitch: 67, startBeat: 1.5, durationBeats: 0.25 },
    { id: 'c-arrival', pitch: 72, startBeat: 2.5, durationBeats: 0.25 },
  ];
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'piano'), 'tension-resolution');
  assert.equal(result.status, 'available');
  assert.match(result.value, /^Median 0\.8 beats · 2\/2 observed$/);
  assert.deepEqual(result.observations.map((item) => item.noteIds), [
    ['e-tension', 'f-arrival'], ['g-tension', 'c-arrival'],
  ]);
  assert.ok(result.observations.every((item) => item.bar === 1));
});

test('a simultaneous chord tone does not hide a later tension arrival', () => {
  const notes = [
    { id: 'tension', pitch: 64, startBeat: 0.5, durationBeats: 0.25 },
    { id: 'same-beat', pitch: 65, startBeat: 0.5, durationBeats: 0.25 },
    { id: 'arrival', pitch: 62, startBeat: 1.25, durationBeats: 0.25 },
  ];
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'midi'), 'tension-resolution');
  assert.equal(result.status, 'limited');
  assert.match(result.value, /Median 0\.8 beats · 1\/1 observed/);
  assert.deepEqual(result.observations[0].noteIds, ['tension', 'arrival']);
});

test('rhythmic variety counts onset-gap ranges and links an example to each range', () => {
  const gaps = [0.25, 0.5, 1, 1.5, 2, 0.25];
  const onsets = [0];
  for (const gap of gaps) onsets.push(onsets.at(-1)! + gap);
  const notes = onsets.map((startBeat, index) => ({ id: `rhythm-${index}`, pitch: 60 + index, startBeat, durationBeats: 0.1 }));
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'piano'), 'rhythmic-variety');
  assert.equal(result.status, 'available');
  assert.equal(result.value, '5 of 5 onset-gap ranges');
  assert.equal(result.observations.length, 5);
  assert.ok(result.observations.every((item) => item.noteIds.length === 2));
});

test('phrase space sums pauses and reports their share of the recorded span', () => {
  const notes = [0, 1, 3, 5, 7, 9].map((startBeat, index) => ({
    id: `space-${index}`, pitch: 60 + index, startBeat, durationBeats: 0.5,
  }));
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'piano'), 'phrase-space');
  assert.equal(result.status, 'available');
  assert.equal(result.value, '6.5 beats across 5 pauses · 68% of span');
  assert.equal(result.observations.length, 5);
  assert.ok(result.observations.every((item) => item.noteIds.length === 2));
});

test('overlapping notes do not create negative phrase space', () => {
  const notes = [
    { id: 'held', pitch: 60, startBeat: 0, durationBeats: 2 },
    { id: 'overlap', pitch: 64, startBeat: 1, durationBeats: 0.5 },
    { id: 'next', pitch: 65, startBeat: 3, durationBeats: 0.5 },
    { id: 'last', pitch: 67, startBeat: 5, durationBeats: 0.5 },
  ];
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'midi'), 'phrase-space');
  assert.equal(result.status, 'limited');
  assert.equal(result.value, '2.5 beats across 2 pauses · 45% of span');
  assert.equal(result.observations.length, 2);
  assert.deepEqual(result.observations.map((item) => item.noteIds), [['held', 'next'], ['next', 'last']]);
});

test('motif development identifies a related three-note variation without grading it', () => {
  const notes = [
    [60, 0], [62, 1], [64, 2],
    [65, 4], [67, 5], [70, 6],
  ].map(([pitch, startBeat], index) => ({ id: `motif-${index}`, pitch, startBeat, durationBeats: 0.4 }));
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'piano'), 'motif-development');
  assert.equal(result.status, 'limited');
  assert.equal(result.value, '1 related three-note return · 1 varied');
  assert.deepEqual(result.observations[0].noteIds, notes.map((note) => note.id));
});

test('motif comparisons never reuse overlapping notes', () => {
  const notes = [60, 62, 64, 60, 62, 64, 60, 62, 64].map((pitch, index) => ({
    id: `repeat-${index}`, pitch, startBeat: index, durationBeats: 0.4,
  }));
  const result = measure(buildSoloFeedback(notes, PROGRESSIONS[0], 'piano'), 'motif-development');
  assert.equal(result.observations.length, 1);
  assert.equal(result.observations[0].focusNoteId, 'repeat-3');
});

function audioPhrase(): { notes: NoteEvent[]; frames: AudioFrame[] } {
  const notes = [60, 62, 64, 65, 67, 69].map((pitch, index) => ({
    id: `mic-${index}`, pitch, startBeat: index * 0.8, durationBeats: 0.48,
  }));
  const frames: AudioFrame[] = [];
  for (const note of notes) {
    const frequencyHz = 440 * 2 ** ((note.pitch - 69) / 12);
    for (let index = 0; index < 20; index += 1) {
      frames.push({ beat: note.startBeat + index * 0.024, frequencyHz, confidence: 0.98, rms: 0.12, clipped: false });
    }
    for (const offset of [0.55, 0.6, 0.65, 0.7]) {
      frames.push({ beat: note.startBeat + offset, frequencyHz: null, confidence: 0, rms: 0.001, clipped: false });
    }
  }
  return { notes, frames };
}

test('sax intonation and articulation require reliable local audio evidence', () => {
  const { notes, frames } = audioPhrase();
  const clean = analyzeAudioFrames(notes, frames, 0, 5);
  const cleanReport = buildSoloFeedback(notes, PROGRESSIONS[0], 'mic', clean);
  assert.notEqual(measure(cleanReport, 'intonation').status, 'unavailable');
  assert.notEqual(measure(cleanReport, 'articulation').status, 'unavailable');

  const noisyFrames = frames.map((frame, index) => ({
    ...frame, frequencyHz: index % 2 ? 120 : 1100, confidence: 0.2, rms: 0.9, clipped: true,
  }));
  const noisy = analyzeAudioFrames(notes, noisyFrames, 0, 5);
  const noisyReport = buildSoloFeedback(notes, PROGRESSIONS[0], 'mic', noisy);
  assert.equal(measure(noisyReport, 'intonation').status, 'unavailable');
  assert.equal(measure(noisyReport, 'articulation').status, 'unavailable');
  const noAudioReport = buildSoloFeedback(notes, PROGRESSIONS[0], 'mic', null);
  assert.equal(measure(noAudioReport, 'intonation').status, 'unavailable');
  assert.equal(measure(noAudioReport, 'articulation').status, 'unavailable');
});

test('unavailable audio measures do not expose per-note assessments', () => {
  const { notes, frames } = audioPhrase();
  const enoughAudio = analyzeAudioFrames(notes, frames);
  const report = buildSoloFeedback(notes, PROGRESSIONS[0], 'mic', {
    ...enoughAudio,
    intonationCents: null,
    intonationNotes: 2,
    articulationStarts: 2,
  });
  assert.equal(measure(report, 'intonation').status, 'unavailable');
  assert.deepEqual(measure(report, 'intonation').observations, []);
  assert.equal(measure(report, 'articulation').status, 'unavailable');
  assert.deepEqual(measure(report, 'articulation').observations, []);
});
