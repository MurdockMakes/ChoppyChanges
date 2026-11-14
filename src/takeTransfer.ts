import { addBankedTakes, type BankedTake, type NoteEdit } from './takeBank.ts';
import { PROGRESSIONS, type NoteEvent, type Progression } from './theory.ts';
import type { SaxKey } from './sax.ts';

export const TAKE_FILE_FORMAT = 'changes-coach-takes';
export const TAKE_FILE_VERSION = 1;
export const TAKE_FILE_EXTENSION = '.changes-takes.json';

const MAX_FILE_BYTES = 256 * 1024 * 1024;
const MAX_TAKES = 1000;
// These bounds cover the app's longest 16-pass blues take with room for edits.
export const MAX_PORTABLE_NOTES = 4096;
export const MAX_PORTABLE_TAKE_BEATS = 1024;
const MAX_EDITS = 100000;
let idSequence = 0;

type EncodedAudio = {
  mimeType: string;
  startBeat: number;
  endBeat: number;
  rate: number;
  dataBase64: string;
};

type PortableTake = {
  name: string;
  progression: Progression;
  source: BankedTake['source'];
  saxKey: SaxKey;
  notes: NoteEvent[];
  edits: NoteEdit[];
  savedAt: number;
  audio: EncodedAudio | null;
};

type TakeFile = {
  format: typeof TAKE_FILE_FORMAT;
  version: typeof TAKE_FILE_VERSION;
  exportedAt: number;
  takes: PortableTake[];
};

function record(value: unknown, where: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${where} is missing or damaged.`);
  return value as Record<string, unknown>;
}

function finiteNumber(value: unknown, where: string, minimum = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum) throw new Error(`${where} must be a valid number.`);
  return value;
}

function id(value: unknown, where: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 200) throw new Error(`${where} is missing or invalid.`);
  return value;
}

function note(value: unknown, where: string): NoteEvent {
  const item = record(value, where);
  const pitch = finiteNumber(item.pitch, `${where} pitch`);
  const startBeat = finiteNumber(item.startBeat, `${where} start beat`);
  const durationBeats = finiteNumber(item.durationBeats, `${where} length`, 0.001);
  if (!Number.isInteger(pitch) || pitch > 127 || startBeat + durationBeats > MAX_PORTABLE_TAKE_BEATS) throw new Error(`${where} has an invalid pitch or timing (maximum ${MAX_PORTABLE_TAKE_BEATS} beats).`);
  return { id: id(item.id, `${where} ID`), pitch, startBeat, durationBeats };
}

function edit(value: unknown, where: string): NoteEdit {
  const item = record(value, where);
  const kind = item.kind;
  if (kind !== 'add' && kind !== 'remove' && kind !== 'update') throw new Error(`${where} has an invalid edit type.`);
  const noteId = id(item.noteId, `${where} note ID`);
  const before = item.before === undefined ? undefined : note(item.before, `${where} prior note`);
  const after = item.after === undefined ? undefined : note(item.after, `${where} edited note`);
  if ((kind === 'add' && (before || !after)) || (kind === 'remove' && (!before || after)) ||
      (kind === 'update' && (!before || !after)) || before && before.id !== noteId || after && after.id !== noteId) {
    throw new Error(`${where} has inconsistent note data.`);
  }
  return { at: finiteNumber(item.at, `${where} time`), kind, noteId, ...(before ? { before } : {}), ...(after ? { after } : {}) };
}

function progression(value: unknown, where: string): Progression {
  const snapshot = record(value, `${where} progression`);
  const progressionId = id(snapshot.id, `${where} progression ID`);
  const current = PROGRESSIONS.find((entry) => entry.id === progressionId);
  if (!current) throw new Error(`${where} uses a progression this version of Changes Coach does not support: ${progressionId}.`);
  if (snapshot.form !== current.form || snapshot.keyId !== current.keyId ||
      snapshot.label !== current.label || snapshot.description !== current.description ||
      !Array.isArray(snapshot.chords) || snapshot.chords.length !== current.chords.length) {
    throw new Error(`${where} progression does not match the supported ${current.label} chart.`);
  }
  for (let index = 0; index < current.chords.length; index += 1) {
    const actual = record(snapshot.chords[index], `${where} chord ${index + 1}`);
    const expected = current.chords[index];
    if (actual.name !== expected.name || actual.quality !== expected.quality ||
        actual.root !== expected.root || actual.third !== expected.third ||
        actual.fifth !== expected.fifth || actual.seventh !== expected.seventh ||
        !Array.isArray(actual.tensions) || actual.tensions.length !== expected.tensions.length ||
        actual.tensions.some((tension, tensionIndex) => {
          const item = tension && typeof tension === 'object' ? tension as Record<string, unknown> : {};
          return item.pitchClass !== expected.tensions[tensionIndex].pitchClass || item.label !== expected.tensions[tensionIndex].label;
        })) {
      throw new Error(`${where} chord ${index + 1} does not match the supported ${current.label} chart.`);
    }
  }
  return current;
}

function decodeAudio(value: unknown, where: string): BankedTake['audio'] {
  if (value === null) return null;
  const audio = record(value, `${where} audio`);
  const mimeType = audio.mimeType;
  if (typeof mimeType !== 'string' || mimeType.length > 127 || /[^\x20-\x7e]/.test(mimeType) ||
      mimeType !== '' && !/^(?:audio\/[a-z0-9.+-]+|video\/webm)(?:;.*)?$/i.test(mimeType)) {
    throw new Error(`${where} has an invalid audio type.`);
  }
  const data = audio.dataBase64;
  if (typeof data !== 'string' || !data || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) {
    throw new Error(`${where} has damaged audio data.`);
  }
  const chunks: Uint8Array[] = [];
  try {
    for (let index = 0; index < data.length; index += 32768) {
      const binary = atob(data.slice(index, index + 32768));
      chunks.push(Uint8Array.from(binary, (character) => character.charCodeAt(0)));
    }
  } catch {
    throw new Error(`${where} has damaged audio data.`);
  }
  const startBeat = finiteNumber(audio.startBeat, `${where} audio start beat`);
  const endBeat = finiteNumber(audio.endBeat, `${where} audio end beat`);
  const rate = finiteNumber(audio.rate, `${where} audio recording speed`, 0.001);
  if (endBeat < startBeat || endBeat > MAX_PORTABLE_TAKE_BEATS || rate > 8) throw new Error(`${where} has invalid audio timing.`);
  return { blob: new Blob(chunks, { type: mimeType }), startBeat, endBeat, rate };
}

function newId(prefix: string): string {
  const random = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-${idSequence++}`;
  return `${prefix}-${random}`;
}

function validateTake(value: unknown, index: number): BankedTake {
  const where = `Take ${index + 1}`;
  const item = record(value, where);
  const name = item.name;
  if (typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error(`${where} has an invalid name.`);
  const chart = progression(item.progression, where);
  const source = item.source;
  if (source !== 'midi' && source !== 'mic' && source !== 'piano' && source !== 'example') throw new Error(`${where} has an unsupported source.`);
  const saxKey = item.saxKey;
  if (saxKey !== 'concert' && saxKey !== 'alto' && saxKey !== 'tenor') throw new Error(`${where} has an unsupported sax key.`);
  if (!Array.isArray(item.notes)) throw new Error(`${where} has an invalid note list.`);
  if (item.notes.length > MAX_PORTABLE_NOTES) throw new Error(`${where} exceeds the ${MAX_PORTABLE_NOTES}-note limit.`);
  const notes = item.notes.map((entry, noteIndex) => note(entry, `${where}, note ${noteIndex + 1}`));
  if (new Set(notes.map((entry) => entry.id)).size !== notes.length) throw new Error(`${where} contains duplicate note IDs.`);
  if (!Array.isArray(item.edits) || item.edits.length > MAX_EDITS) throw new Error(`${where} has an invalid edit list.`);
  const edits = item.edits.map((entry, editIndex) => edit(entry, `${where}, edit ${editIndex + 1}`));
  const audio = decodeAudio(item.audio, where);
  if (notes.length === 0 && !audio) throw new Error(`${where} contains no notes or audio.`);
  if (audio && source !== 'mic') throw new Error(`${where} has microphone audio but is not a sax take.`);
  const savedAt = finiteNumber(item.savedAt, `${where} saved time`);
  const ids = new Map<string, string>();
  const mapId = (oldId: string) => {
    if (!ids.has(oldId)) ids.set(oldId, newId('import-note'));
    return ids.get(oldId)!;
  };
  return {
    id: newId('import-take'), name, progressionId: chart.id, source, saxKey, savedAt,
    notes: notes.map((entry) => ({ ...entry, id: mapId(entry.id) })),
    edits: edits.map((entry) => ({
      ...entry, noteId: mapId(entry.noteId),
      ...(entry.before ? { before: { ...entry.before, id: mapId(entry.before.id) } } : {}),
      ...(entry.after ? { after: { ...entry.after, id: mapId(entry.after.id) } } : {}),
    })),
    audio,
  };
}

function encodeBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let index = 0; index < bytes.length; index += 32766) {
    chunks.push(btoa(String.fromCharCode(...bytes.subarray(index, index + 32766))));
  }
  // Each chunk is divisible by three except the final one, so concatenation remains valid base64.
  return chunks.join('');
}

/** Creates a self-contained JSON file. The stored microphone Blob never leaves this browser except through the download. */
export async function createTakeTransferFile(takes: readonly BankedTake[]): Promise<Blob> {
  if (takes.length === 0 || takes.length > MAX_TAKES) throw new Error('Choose between 1 and 1,000 takes to export.');
  const portable: PortableTake[] = [];
  for (const take of takes) {
    const chart = PROGRESSIONS.find((entry) => entry.id === take.progressionId);
    if (!chart) throw new Error(`Cannot export “${take.name}”: its progression is unavailable.`);
    if (take.notes.length > MAX_PORTABLE_NOTES || take.notes.some((entry) => !Number.isFinite(entry.startBeat + entry.durationBeats) || entry.startBeat + entry.durationBeats > MAX_PORTABLE_TAKE_BEATS) ||
        take.audio && take.audio.endBeat > MAX_PORTABLE_TAKE_BEATS) {
      throw new Error(`Cannot export “${take.name}”: a take file supports at most ${MAX_PORTABLE_NOTES} notes and ${MAX_PORTABLE_TAKE_BEATS} beats per take.`);
    }
    const audio = take.audio ? {
      mimeType: take.audio.blob.type,
      startBeat: take.audio.startBeat,
      endBeat: take.audio.endBeat,
      rate: take.audio.rate,
      dataBase64: encodeBase64(new Uint8Array(await take.audio.blob.arrayBuffer())),
    } : null;
    portable.push({
      name: take.name, progression: chart, source: take.source, saxKey: take.saxKey,
      notes: take.notes.map((entry) => ({ ...entry })),
      edits: (take.edits ?? []).map((entry) => ({ ...entry, before: entry.before ? { ...entry.before } : undefined, after: entry.after ? { ...entry.after } : undefined })),
      savedAt: take.savedAt, audio,
    });
  }
  const document: TakeFile = { format: TAKE_FILE_FORMAT, version: TAKE_FILE_VERSION, exportedAt: Date.now(), takes: portable };
  const content = JSON.stringify(document);
  if (new Blob([content]).size > MAX_FILE_BYTES) throw new Error('The export exceeds the 256 MB take-file limit.');
  return new Blob([content], { type: 'application/json' });
}

/** Validates every take before returning records with fresh IDs. No bank writes happen here. */
export async function parseTakeTransferFile(file: Blob): Promise<BankedTake[]> {
  if (file.size > MAX_FILE_BYTES) throw new Error('This take file is larger than the 256 MB limit.');
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error('This take file is damaged or is not valid JSON.');
  }
  const document = record(parsed, 'Take file');
  if (document.format !== TAKE_FILE_FORMAT) throw new Error('This is not a Changes Coach take file.');
  if (document.version !== TAKE_FILE_VERSION) throw new Error(`Unsupported take file version: ${String(document.version)}. This app supports version ${TAKE_FILE_VERSION}.`);
  finiteNumber(document.exportedAt, 'Take file export time');
  if (!Array.isArray(document.takes) || document.takes.length === 0 || document.takes.length > MAX_TAKES) {
    throw new Error('The take file must contain between 1 and 1,000 takes.');
  }
  return document.takes.map(validateTake);
}

/** A valid container must decode here before any imported record is committed. */
async function validatePlayableAudio(takes: readonly BankedTake[]): Promise<void> {
  if (!takes.some((take) => take.audio)) return;
  const Context = globalThis.AudioContext;
  if (!Context) throw new Error('This browser cannot verify microphone audio in a take file.');
  let context: AudioContext;
  try {
    context = new Context();
  } catch {
    throw new Error('This browser could not open its local audio decoder for the take file. No takes were imported.');
  }
  try {
    for (const [index, take] of takes.entries()) {
      if (!take.audio) continue;
      try {
        const decoded = await context.decodeAudioData(await take.audio.blob.arrayBuffer());
        if (!Number.isFinite(decoded.duration) || decoded.duration <= 0) throw new Error('Empty decoded audio');
      } catch {
        throw new Error(`Take ${index + 1} has damaged or unsupported microphone audio. No takes were imported.`);
      }
    }
  } finally {
    await context.close();
  }
}

/** Imports only after complete validation; IndexedDB add() keeps existing takes untouched. */
export async function importTakeTransferFile(file: Blob): Promise<BankedTake[]> {
  const takes = await parseTakeTransferFile(file);
  await validatePlayableAudio(takes);
  await addBankedTakes(takes);
  return takes;
}
