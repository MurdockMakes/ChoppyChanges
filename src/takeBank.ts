import type { SaxKey } from './sax.ts';
import type { NoteEvent } from './theory.ts';
import type { TakeSource } from './useTake.ts';

export type MicAudioTake = { blob: Blob; startBeat: number; endBeat: number; rate: number };
export type BankedTake = {
  id: string;
  name: string;
  progressionId: string;
  source: Exclude<TakeSource, null>;
  saxKey: SaxKey;
  notes: NoteEvent[];
  audio: MicAudioTake | null;
  savedAt: number;
};
export type BankedTakeSummary = Pick<BankedTake, 'id' | 'name' | 'progressionId' | 'source' | 'saxKey' | 'savedAt'> & {
  noteCount: number;
  hasAudio: boolean;
};

const DATABASE = 'changes-coach-take-bank';
const STORE = 'takes';

function openBank(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('This browser does not support saved takes.'));
      return;
    }
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('Could not open the take bank.'));
    request.onblocked = () => reject(new Error('Close other tabs using the take bank, then try again.'));
  });
}

async function withStore<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openBank();
  return new Promise((resolve, reject) => {
    let result: T;
    const transaction = db.transaction(STORE, mode);
    const request = action(transaction.objectStore(STORE));
    request.onsuccess = () => { result = request.result; };
    transaction.oncomplete = () => { db.close(); resolve(result); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Take bank operation failed.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Take bank operation was cancelled.')); };
  });
}

export function summarizeBankedTake(take: BankedTake): BankedTakeSummary {
  return {
    id: take.id,
    name: take.name,
    progressionId: take.progressionId,
    source: take.source,
    saxKey: take.saxKey,
    savedAt: take.savedAt,
    noteCount: take.notes.length,
    hasAudio: !!take.audio?.blob,
  };
}

export async function listBankedTakes(): Promise<BankedTakeSummary[]> {
  const takes = await withStore<BankedTake[]>('readonly', (store) => store.getAll());
  return takes.map(summarizeBankedTake).sort((a, b) => b.savedAt - a.savedAt);
}

export function loadBankedTake(id: string): Promise<BankedTake | undefined> {
  return withStore<BankedTake | undefined>('readonly', (store) => store.get(id));
}

export async function saveBankedTake(take: BankedTake): Promise<void> {
  await withStore<IDBValidKey>('readwrite', (store) => store.put(take));
}

export async function deleteBankedTake(id: string): Promise<void> {
  await withStore<undefined>('readwrite', (store) => store.delete(id));
}
