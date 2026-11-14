import assert from 'node:assert/strict';
import test from 'node:test';
import { addBankedTakes, saveBankedTake, type BankedTake } from './takeBank.ts';

function sample(id: string): BankedTake {
  return {
    id, name: id, progressionId: 'ii-v-i-c', source: 'piano', saxKey: 'concert',
    notes: [{ id: `${id}-note`, pitch: 60, startBeat: 0, durationBeats: 1 }],
    audio: null, savedAt: 100,
  };
}

/** Small IndexedDB transaction stand-in that commits add() requests atomically. */
function bankFactory(records: Map<string, BankedTake>): IDBFactory {
  const database = {
    close() {},
    transaction() {
      const pending: BankedTake[] = [];
      const transaction = {
        error: null as Error | null,
        oncomplete: null as null | (() => void),
        onerror: null as null | (() => void),
        onabort: null as null | (() => void),
        objectStore() {
          return { add(take: BankedTake) { pending.push(take); return {}; } };
        },
      };
      queueMicrotask(() => {
        const ids = pending.map((take) => take.id);
        if (new Set(ids).size !== ids.length || ids.some((id) => records.has(id))) {
          transaction.error = new Error('ConstraintError: take ID already exists');
          transaction.onerror?.();
          return;
        }
        for (const take of pending) records.set(take.id, take);
        transaction.oncomplete?.();
      });
      return transaction;
    },
  };
  return {
    open() {
      const request = { result: database, onupgradeneeded: null, onsuccess: null as null | (() => void), onerror: null, onblocked: null };
      queueMicrotask(() => request.onsuccess?.());
      return request;
    },
  } as unknown as IDBFactory;
}

test('atomic import add refuses a duplicate ID without replacing or partly adding takes', async () => {
  const existing = sample('existing');
  const records = new Map([[existing.id, existing]]);
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'indexedDB');
  Object.defineProperty(globalThis, 'indexedDB', { configurable: true, value: bankFactory(records) });
  try {
    await assert.rejects(addBankedTakes([sample('new'), sample('existing')]), /ConstraintError|already exists/i);
    assert.deepEqual([...records.keys()], ['existing']);
    assert.equal(records.get('existing'), existing);
    await assert.rejects(saveBankedTake(sample('existing')), /ConstraintError|already exists/i);
    assert.equal(records.get('existing'), existing);
    await addBankedTakes([sample('first'), sample('second')]);
    assert.deepEqual([...records.keys()], ['existing', 'first', 'second']);
  } finally {
    if (prior) Object.defineProperty(globalThis, 'indexedDB', prior);
    else Reflect.deleteProperty(globalThis, 'indexedDB');
  }
});
