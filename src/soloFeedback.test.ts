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

test('each progression form gives separate chord-landing evidence tied to played notes', () => {
  for (const form of ['ii-v-i', 'blues', 'turnaround'] as const) {
    const progression = PROGRESSIONS.find((item) => item.form === form)!;
    const notes = landingTake(progression);
    const report = buildSoloFeedback(notes, progression, 'piano');
    const landing = measure(report, 'chord-landings');
    assert.notEqual(landing.status, 'unavailable', `${form} landing should have observations`);
    assert.ok(landing.observations.length > 0, `${form} landing observations`);
    assert.ok(!('overallGrade' in report), 'report must not collapse into a solo grade');
    for (const item of report.measures) {
      assert.ok(item.definition && item.threshold, `${form} ${item.id} must describe calculation and threshold`);
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
    frames.push({ beat: note.startBeat + 0.6, frequencyHz: null, confidence: 0, rms: 0.001, clipped: false });
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
