import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildCoachContext, fallbackCoachPlan, validateGeminiCoachResponse,
  type CoachContext,
} from './coach.ts';
import { exampleTakeFor } from './example.ts';
import { DEFAULT_PROGRESSION, PROGRESSIONS, type NoteEvent } from './theory.ts';

function exampleContext() {
  return buildCoachContext(exampleTakeFor(DEFAULT_PROGRESSION), DEFAULT_PROGRESSION);
}

function mockedGeminiResponse(context: CoachContext) {
  const need = context.summary.needs.find((item) => item.id === 'repeat-guide-tone')!;
  const references = [
    { evidenceId: need.evidenceIds[0], noteId: 'c-ex-04', catalogId: 'guide-tones-1' },
    { evidenceId: need.evidenceIds[1], noteId: 'c-ex-11', catalogId: 'guide-tones-3' },
  ];
  return {
    priorityNeedId: need.id,
    priorityEvidenceIds: need.evidenceIds.slice(0, 2),
    exercises: references.map(({ evidenceId, noteId, catalogId }) => {
      const note = context.summary.notes.find((item) => item.id === noteId)!;
      return {
        catalogId, evidenceId,
        reference: { noteId, chordName: note.chordName, bar: note.bar, beat: note.beat },
        instruction: 'Keep the pulse steady and listen for the arrival.',
      };
    }),
  };
}

test('known ii–V–I guide-tone moves and G7 A♭ are grounded in the recorded notes', () => {
  const context = exampleContext();
  const { summary, catalog } = context;
  assert.equal(summary.key, 'C');
  assert.equal(summary.form, 'ii-v-i');
  assert.deepEqual(summary.chords.slice(0, 3).map((item) => item.name), ['Dm7', 'G7', 'Cmaj7']);
  assert.equal(summary.reliableForPersonalization, true);
  assert.ok(summary.evidence.some((item) => item.kind === 'guide-tone' &&
    item.noteIds.join(',') === 'c-ex-04,c-ex-05'));
  assert.ok(summary.evidence.some((item) => item.kind === 'guide-tone' &&
    item.noteIds.join(',') === 'c-ex-10,c-ex-11'));
  const flatNine = summary.evidence.find((item) => item.kind === 'flat-nine');
  assert.ok(flatNine);
  assert.deepEqual(flatNine.noteIds, ['c-ex-07', 'c-ex-08']);
  assert.equal(summary.notes.find((item) => item.id === 'c-ex-07')?.name, 'A♭');
  assert.equal(summary.notes.find((item) => item.id === 'c-ex-07')?.position, 'bar 2, beat 2.4');
  assert.deepEqual(catalog.find((item) => item.kind === 'flat-nine' && item.chordName === 'G7')?.notes, ['A♭', 'G']);
  assert.deepEqual(catalog.find((item) => item.kind === 'dorian')?.notes, ['D', 'E', 'F', 'G', 'A', 'B', 'C']);
  assert.deepEqual(catalog.find((item) => item.kind === 'mixolydian')?.notes, ['G', 'A', 'B', 'C', 'D', 'E', 'F']);
  assert.deepEqual(catalog.find((item) => item.kind === 'ionian')?.notes, ['C', 'D', 'E', 'F', 'G', 'A', 'B']);
});

test('blues take uses its selected changes and reviewed dominant exercises', () => {
  const blues = PROGRESSIONS.find((item) => item.id === 'blues-c')!;
  const context = buildCoachContext(exampleTakeFor(blues), blues);
  assert.equal(context.summary.form, 'blues');
  assert.equal(context.summary.chords.length, 12);
  assert.equal(context.summary.chords[4].name, 'F7');
  assert.equal(context.summary.chords[8].name, 'G7');
  assert.ok(context.summary.evidence.some((item) => item.kind === 'guide-tone' &&
    item.explanation.includes('B♭ on C7') && item.explanation.includes('A on F7')));
  assert.ok(context.catalog.some((item) => item.kind === 'mixolydian' && item.chordName === 'F7'));
  assert.deepEqual(context.catalog.find((item) => item.kind === 'flat-nine' && item.chordName === 'G7')?.notes, ['A♭', 'G']);
  assert.ok(context.catalog.every((item) => item.minutes >= 5 && item.minutes <= 10 && item.startingBpm > 0 && item.improvement));
});

test('catalog roots, intervals, and diatonic spellings agree in every key', () => {
  const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const letters = Object.keys(natural);
  function pitchClassOf(name: string) {
    const accidental = [...name.slice(1)].reduce((value, char) => value + (char === '♯' ? 1 : char === '♭' ? -1 : 0), 0);
    return (natural[name[0]] + accidental + 24) % 12;
  }
  for (const progression of PROGRESSIONS) {
    const catalog = buildCoachContext([], progression).catalog;
    for (const item of catalog) {
      const chord = progression.chords[item.bar - 1];
      const intervals = item.kind === 'arpeggio' ? [0, chord.quality === 'minor7' ? 3 : 4, 7, chord.quality === 'major7' ? 11 : 10]
        : item.kind === 'guide-tones' ? [chord.quality === 'minor7' ? 3 : 4, chord.quality === 'major7' ? 11 : 10]
          : item.kind === 'dorian' ? [0, 2, 3, 5, 7, 9, 10]
            : item.kind === 'mixolydian' ? [0, 2, 4, 5, 7, 9, 10]
              : item.kind === 'ionian' ? [0, 2, 4, 5, 7, 9, 11] : [1, 0];
      assert.deepEqual(item.notes.map((name) => pitchClassOf(name)), intervals.map((interval) => (chord.root + interval) % 12), `${progression.id} ${item.id}`);
      const rootLetterIndex = letters.indexOf(chord.name[0]);
      const steps = item.kind === 'arpeggio' ? [0, 2, 4, 6] : item.kind === 'guide-tones' ? [2, 6]
        : item.kind === 'flat-nine' ? [1, 0] : [0, 1, 2, 3, 4, 5, 6];
      assert.deepEqual(item.notes.map((name) => name[0]), steps.map((step) => letters[(rootLetterIndex + step) % 7]), `${progression.id} ${item.id} letters`);
    }
  }
});

test('one ambiguous passage remains neutral and is not a personalized diagnosis', () => {
  const notes: NoteEvent[] = [
    { id: 'unsettled', pitch: 68, startBeat: 5, durationBeats: 0.4 },
    { id: 'following', pitch: 70, startBeat: 5.5, durationBeats: 0.4 },
  ];
  const context = buildCoachContext(notes, DEFAULT_PROGRESSION);
  const open = context.summary.evidence.find((item) => item.noteIds.includes('unsettled'));
  assert.equal(open?.kind, 'no-nearby-resolution');
  assert.equal(open?.title, 'No nearby resolution detected');
  assert.equal(open?.tension, '♭9');
  assert.equal(context.summary.needs.length, 0);
  assert.equal(context.summary.reliableForPersonalization, false);
  assert.equal(fallbackCoachPlan(context).priorityNeedId, 'general-warmup');
});

test('repeated observations support a focused need without calling an outside note wrong', () => {
  const missedLandings: NoteEvent[] = [
    { id: 'd', pitch: 62, startBeat: 1, durationBeats: 0.4 },
    { id: 'c', pitch: 60, startBeat: 3.5, durationBeats: 0.3 },
    { id: 'g', pitch: 67, startBeat: 4, durationBeats: 0.4 },
    { id: 'b', pitch: 71, startBeat: 5, durationBeats: 0.4 },
    { id: 'f', pitch: 65, startBeat: 7.5, durationBeats: 0.3 },
    { id: 'c2', pitch: 72, startBeat: 8, durationBeats: 0.4 },
    { id: 'e', pitch: 64, startBeat: 9, durationBeats: 0.4 },
  ];
  const landings = buildCoachContext(missedLandings, DEFAULT_PROGRESSION);
  assert.equal(landings.summary.evidence.filter((item) => item.kind === 'change-landing').length, 2);
  assert.ok(landings.summary.needs.some((item) => item.id === 'guide-tone-landing'));
  assert.equal(landings.summary.reliableForPersonalization, true);
  assert.doesNotMatch(JSON.stringify(landings.summary.needs), /wrong|mistake|score/i);

  const openTensions: NoteEvent[] = [
    { id: 'd1', pitch: 62, startBeat: 0.5, durationBeats: 0.3 },
    { id: 'f1', pitch: 65, startBeat: 1.5, durationBeats: 0.3 },
    { id: 'ab1', pitch: 68, startBeat: 5, durationBeats: 0.3 },
    { id: 'bb1', pitch: 70, startBeat: 5.6, durationBeats: 0.3 },
    { id: 'ab2', pitch: 68, startBeat: 6.5, durationBeats: 0.3 },
    { id: 'f2', pitch: 65, startBeat: 7.5, durationBeats: 0.3 },
  ];
  const tensions = buildCoachContext(openTensions, DEFAULT_PROGRESSION);
  assert.ok(tensions.summary.needs.some((item) => item.id === 'tension-resolution'));
  assert.equal(tensions.summary.evidence.filter((item) => item.tension === '♭9').length, 2);
  assert.deepEqual(tensions.catalog.find((item) => item.kind === 'flat-nine')?.notes, ['A♭', 'G']);
});

test('insufficient data offers a labeled general warmup with catalog actions', () => {
  const context = buildCoachContext([], DEFAULT_PROGRESSION);
  const plan = fallbackCoachPlan(context);
  assert.equal(context.summary.reliableForPersonalization, false);
  assert.match(context.summary.limitation ?? '', /Too little reliable evidence/);
  assert.equal(plan.priorityNeedId, 'general-warmup');
  assert.deepEqual(plan.priorityEvidenceIds, []);
  assert.equal(plan.exercises.length, 2);
  assert.ok(plan.exercises.every((item) => item.reference === null && item.evidenceId === null));
  assert.ok(plan.exercises.every((item) => context.catalog.some((exercise) => exercise.id === item.catalogId)));
});

test('valid mocked Gemini structured response selects grounded evidence and exercises', () => {
  const context = exampleContext();
  const response = mockedGeminiResponse(context);
  assert.deepEqual(validateGeminiCoachResponse(response, context), response);
});

test('Gemini response rejects invented note, chord, position, evidence, and catalog facts', () => {
  const context = exampleContext();
  const changes: Array<[string, (response: ReturnType<typeof mockedGeminiResponse>) => void]> = [
    ['note', (response) => { response.exercises[0].reference.noteId = 'never-played'; }],
    ['chord', (response) => { response.exercises[0].reference.chordName = 'B7'; }],
    ['bar', (response) => { response.exercises[0].reference.bar = 99; }],
    ['beat', (response) => { response.exercises[0].reference.beat = 3.25; }],
    ['evidence', (response) => { response.exercises[0].evidenceId = 'fabricated-resolution'; }],
    ['catalog exercise', (response) => { response.exercises[0].catalogId = 'invented-scale'; }],
  ];
  for (const [fact, change] of changes) {
    const response = mockedGeminiResponse(context);
    change(response);
    assert.throws(() => validateGeminiCoachResponse(response, context), undefined, `accepted invented ${fact}`);
  }
  const prose = mockedGeminiResponse(context);
  prose.exercises[0].instruction = 'You played F on B7 at bar 99, beat 3.';
  assert.throws(() => validateGeminiCoachResponse(prose, context));
});
