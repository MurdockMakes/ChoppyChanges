import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeBankedTake, type BankedTake } from './takeBank.ts';

test('bank summaries expose take details without retaining audio blobs', () => {
  const take: BankedTake = {
    id: 'demo-1', name: 'Blues chorus', progressionId: 'blues-c', source: 'mic', saxKey: 'tenor', savedAt: 100,
    notes: [{ id: 'n1', pitch: 60, startBeat: 0, durationBeats: 1 }],
    audio: { blob: new Blob(['audio']), startBeat: 0, endBeat: 1, rate: 1 },
  };
  assert.deepEqual(summarizeBankedTake(take), {
    id: 'demo-1', name: 'Blues chorus', progressionId: 'blues-c', source: 'mic', saxKey: 'tenor', savedAt: 100,
    noteCount: 1, hasAudio: true,
  });
});
