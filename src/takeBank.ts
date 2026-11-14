import type { SaxKey } from './sax.ts';
import type { NoteEvent } from './theory.ts';
import type { TakeSource } from './useTake.ts';

export type MicAudioTake = { blob: Blob; startBeat: number; endBeat: number; rate: number };
export type NoteEdit = {
  at: number;
  kind: 'add' | 'remove' | 'update';
  noteId: string;
  before?: NoteEvent;
  after?: NoteEvent;
};
export type BankedTake = {
  id: string;
  name: string;
  progressionId: string;
  source: Exclude<TakeSource, null>;
  saxKey: SaxKey;
  notes: NoteEvent[];
  /** Older saved takes have no edit history; their notes are still the edited state. */
  edits?: NoteEdit[];
  audio: MicAudioTake | null;
  savedAt: number;
};
export type BankedTakeSummary = Pick<BankedTake, 'id' | 'name' | 'progressionId' | 'source' | 'saxKey' | 'savedAt'> & {
  noteCount: number;
  hasAudio: boolean;
};

/** Captures changes to the editable note state without changing the original audio. */
export function diffNoteEdits(before: readonly NoteEvent[], after: readonly NoteEvent[], at = Date.now()): NoteEdit[] {
  const previous = new Map(before.map((entry) => [entry.id, entry]));
  const next = new Map(after.map((entry) => [entry.id, entry]));
  const edits: NoteEdit[] = [];
  for (const prior of before) {
    const current = next.get(prior.id);
    if (!current) edits.push({ at, kind: 'remove', noteId: prior.id, before: { ...prior } });
    else if (prior.pitch !== current.pitch || prior.startBeat !== current.startBeat || prior.durationBeats !== current.durationBeats) {
      edits.push({ at, kind: 'update', noteId: prior.id, before: { ...prior }, after: { ...current } });
    }
  }
  for (const current of after) {
    if (!previous.has(current.id)) edits.push({ at, kind: 'add', noteId: current.id, after: { ...current } });
  }
  return edits;
}

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

export function loadAllBankedTakes(): Promise<BankedTake[]> {
  return withStore<BankedTake[]>('readonly', (store) => store.getAll());
}

export async function saveBankedTake(take: BankedTake): Promise<void> {
  await withStore<IDBValidKey>('readwrite', (store) => store.add(take));
}

/** Adds an entire imported file in one transaction, without replacing any saved take. */
export async function addBankedTakes(takes: readonly BankedTake[]): Promise<void> {
  if (takes.length === 0) return;
  const db = await openBank();
  await new Promise<void>((resolve, reject) => {
    let transaction: IDBTransaction;
    try {
      transaction = db.transaction(STORE, 'readwrite');
    } catch (error) {
      db.close();
      reject(error);
      return;
    }
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(transaction.error ?? new Error('Could not import takes. No takes were added.')); };
    transaction.onabort = () => { db.close(); reject(transaction.error ?? new Error('Could not import takes. No takes were added.')); };
    try {
      const store = transaction.objectStore(STORE);
      for (const take of takes) store.add(take);
    } catch (error) {
      transaction.abort();
      reject(error);
    }
  });
}

export async function deleteBankedTake(id: string): Promise<void> {
  await withStore<undefined>('readwrite', (store) => store.delete(id));
}
