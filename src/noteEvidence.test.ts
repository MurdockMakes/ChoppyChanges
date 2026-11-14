import assert from 'node:assert/strict';
import test from 'node:test';
import { buildNoteEvidenceIndex } from './noteEvidence.ts';
import { buildCoachContext } from './coach.ts';
import { EXAMPLE_TAKE } from './example.ts';
import { analyzeTake, DEFAULT_PROGRESSION } from './theory.ts';
import type { CoachEvidence } from './coach.ts';
import type { NoteEvent } from './theory.ts';

const notes: NoteEvent[] = [
  { id: 'source', pitch: 68, startBeat: 5, durationBeats: 0.4 },
  { id: 'destination', pitch: 67, startBeat: 5.75, durationBeats: 0.4 },
  { id: 'later', pitch: 70, startBeat: 8, durationBeats: 0.4 },
];

function item(id: string, kind: CoachEvidence['kind'], noteIds: string[], title = id): CoachEvidence {
  return { id, kind, noteIds, title, explanation: `${title} explained`, startBeat: 5, endBeat: 6 };
}

test('indexes one passage under its source and destination notes', () => {
  const passage = item('flat-nine', 'flat-nine', ['source', 'destination']);
  const index = buildNoteEvidenceIndex(notes, [passage]);
  assert.deepEqual(index.get('source'), [passage]);
  assert.deepEqual(index.get('destination'), [passage]);
  assert.deepEqual(index.get('later'), []);
});

test('preserves multiple evidence items per note in supplied order without duplicates or dangling IDs', () => {
  const first = item('first', 'chromatic', ['source', 'source', 'missing']);
  const second = item('second', 'guide-tone', ['source', 'destination']);
  const index = buildNoteEvidenceIndex(notes, [first, second, first]);
  assert.deepEqual(index.get('source'), [first, second]);
  assert.deepEqual(index.get('destination'), [second]);
  assert.equal(index.has('missing'), false);
});

test('retains neutral no-nearby-resolution evidence without changing its wording', () => {
  const neutral = item('open', 'no-nearby-resolution', ['source'], 'No nearby resolution detected');
  const indexed = buildNoteEvidenceIndex(notes, [neutral]).get('source');
  assert.equal(indexed?.[0].kind, 'no-nearby-resolution');
  assert.equal(indexed?.[0].title, 'No nearby resolution detected');
});

test('indexes coach-only change-landing observations for both involved notes', () => {
  const landing = item('landing', 'change-landing', ['destination', 'later'], 'Guide-tone landing to explore');
  const index = buildNoteEvidenceIndex(notes, [landing]);
  assert.deepEqual(index.get('destination'), [landing]);
  assert.deepEqual(index.get('later'), [landing]);
});

test('example note shared by an open passage and a guide-tone move exposes both', () => {
  const resolutions = analyzeTake(EXAMPLE_TAKE, DEFAULT_PROGRESSION);
  const evidence = buildCoachContext(EXAMPLE_TAKE, DEFAULT_PROGRESSION, resolutions).summary.evidence;
  const related = buildNoteEvidenceIndex(EXAMPLE_TAKE, evidence).get('ex-10');
  assert.deepEqual(related?.map((item) => item.kind), ['no-nearby-resolution', 'guide-tone']);
  assert.equal(related?.[0].title, 'No nearby resolution detected');
});
