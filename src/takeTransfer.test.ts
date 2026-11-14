import assert from 'node:assert/strict';
import test from 'node:test';
import { createTakeTransferFile, parseTakeTransferFile } from './takeTransfer.ts';
import type { BankedTake } from './takeBank.ts';
import { PROGRESSIONS } from './theory.ts';

function sampleTake(overrides: Partial<BankedTake> = {}): BankedTake {
  return {
    id: 'existing-take',
    name: 'First chorus',
    progressionId: 'ii-v-i-c',
    source: 'mic',
    saxKey: 'tenor',
    notes: [
      { id: 'old-a', pitch: 62, startBeat: 0.5, durationBeats: 0.5 },
      { id: 'old-b', pitch: 65, startBeat: 1.25, durationBeats: 0.75 },
    ],
    audio: null,
    savedAt: 1_700_000_000_000,
    ...overrides,
  };
}

function asFile(value: unknown): Blob {
  return new Blob([JSON.stringify(value)], { type: 'application/json' });
}

test('one take exports progression, source, sax key, name, edited notes and reimports with new IDs', async () => {
  const original = sampleTake();
  const exported = await createTakeTransferFile([original]);
  const document = JSON.parse(await exported.text());
  assert.equal(document.format, 'changes-coach-takes');
  assert.equal(document.version, 1);
  assert.equal(document.takes.length, 1);
  assert.deepEqual(document.takes[0].progression, PROGRESSIONS.find((item) => item.id === original.progressionId));
  assert.equal(document.takes[0].name, original.name);
  assert.equal(document.takes[0].source, original.source);
  assert.equal(document.takes[0].saxKey, original.saxKey);
  assert.deepEqual(document.takes[0].notes, original.notes);
  assert.ok(Array.isArray(document.takes[0].edits));

  const [restored] = await parseTakeTransferFile(exported);
  assert.equal(restored.progressionId, original.progressionId);
  assert.equal(restored.name, original.name);
  assert.equal(restored.source, original.source);
  assert.equal(restored.saxKey, original.saxKey);
  assert.deepEqual(restored.notes.map(({ pitch, startBeat, durationBeats }) => ({ pitch, startBeat, durationBeats })),
    original.notes.map(({ pitch, startBeat, durationBeats }) => ({ pitch, startBeat, durationBeats })));
  assert.notEqual(restored.id, original.id);
  assert.ok(restored.notes.every((note) => !original.notes.some((old) => old.id === note.id)));
});

test('microphone audio survives a portable round trip byte for byte with replay timing', async () => {
  const bytes = Uint8Array.from([0, 255, 42, 10, 13, 128, 99]);
  const original = sampleTake({ audio: {
    blob: new Blob([bytes], { type: 'audio/webm' }), startBeat: 2.5, endBeat: 8.25, rate: 0.75,
  } });
  const [restored] = await parseTakeTransferFile(await createTakeTransferFile([original]));
  assert.ok(restored.audio);
  assert.equal(restored.audio.blob.type, 'audio/webm');
  assert.equal(restored.audio.startBeat, 2.5);
  assert.equal(restored.audio.endBeat, 8.25);
  assert.equal(restored.audio.rate, 0.75);
  assert.deepEqual(new Uint8Array(await restored.audio.blob.arrayBuffer()), bytes);
});

test('note edits survive import with references mapped to the imported notes', async () => {
  const before = { id: 'old-a', pitch: 62, startBeat: 0.5, durationBeats: 0.5 };
  const after = { ...before, pitch: 63, durationBeats: 0.75 };
  const original = sampleTake({
    notes: [after], edits: [{ at: 1_700_000_000_100, kind: 'update', noteId: 'old-a', before, after }],
  });
  const file = await createTakeTransferFile([original]);
  const document = JSON.parse(await file.text());
  assert.deepEqual(document.takes[0].edits, original.edits);
  const [restored] = await parseTakeTransferFile(file);
  assert.equal(restored.edits?.length, 1);
  assert.equal(restored.edits?.[0].kind, 'update');
  assert.equal(restored.edits?.[0].noteId, restored.notes[0].id);
  assert.equal(restored.edits?.[0].before?.id, restored.notes[0].id);
  assert.equal(restored.edits?.[0].after?.id, restored.notes[0].id);
  assert.equal(restored.edits?.[0].after?.pitch, 63);
});

test('whole-bank export imports multiple distinct takes, with and without audio', async () => {
  const a = sampleTake();
  const b = sampleTake({
    id: 'other-take', name: 'Blues piano', progressionId: 'blues-c', source: 'piano', saxKey: 'concert',
    notes: [{ id: 'other-note', pitch: 60, startBeat: 16.1, durationBeats: 0.4 }],
    audio: null,
  });
  const file = await createTakeTransferFile([a, b]);
  const first = await parseTakeTransferFile(file);
  const second = await parseTakeTransferFile(file);
  assert.equal(first.length, 2);
  assert.deepEqual(first.map((take) => take.name), ['First chorus', 'Blues piano']);
  assert.equal(new Set(first.map((take) => take.id)).size, 2);
  assert.ok(first.every((take) => take.audio === null));
  assert.ok(first.every((take) => ![a.id, b.id].includes(take.id)));
  assert.ok(first.every((take, index) => take.id !== second[index].id), 'repeat imports must have fresh take IDs');
});

test('damaged, unsupported and invalid files fail with useful errors', async () => {
  const valid = JSON.parse(await (await createTakeTransferFile([sampleTake()])).text());
  const cases: Array<[string, Blob]> = [
    ['empty', new Blob([])],
    ['broken JSON', new Blob(['{"format":'])],
    ['unsupported version', asFile({ ...valid, version: 999 })],
    ['unknown progression', asFile({ ...valid, takes: [{ ...valid.takes[0], progression: { ...valid.takes[0].progression, id: 'not-a-progression' } }] })],
    ['invalid note', asFile({ ...valid, takes: [{ ...valid.takes[0], notes: [{ id: 'n', pitch: 999, startBeat: 0, durationBeats: 1 }] }] })],
    ['invalid audio', asFile({ ...valid, takes: [{ ...valid.takes[0], audio: { mimeType: 'audio/webm', startBeat: 0, endBeat: 1, rate: 1, dataBase64: 'not base64!' } }] })],
  ];
  for (const [label, file] of cases) {
    await assert.rejects(parseTakeTransferFile(file), (error: unknown) =>
      error instanceof Error && error.message.trim().length >= 8, label);
  }
  await assert.rejects(parseTakeTransferFile(cases[2][1]), /version|unsupported/i);
});
