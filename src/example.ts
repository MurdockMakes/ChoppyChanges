import { CIRCLE_KEYS, type NoteEvent, type Progression } from './theory.ts';

/** A hand-entered MIDI event fixture for a complete hardware-free demo. */
export const EXAMPLE_TAKE: NoteEvent[] = [
  { id: 'ex-01', pitch: 62, startBeat: 0.2, durationBeats: 0.6 },
  { id: 'ex-02', pitch: 65, startBeat: 1.15, durationBeats: 0.55 },
  { id: 'ex-03', pitch: 69, startBeat: 2.15, durationBeats: 0.55 },
  { id: 'ex-04', pitch: 72, startBeat: 3.45, durationBeats: 0.42 },
  { id: 'ex-05', pitch: 71, startBeat: 4.0, durationBeats: 0.7 },
  { id: 'ex-06', pitch: 74, startBeat: 4.9, durationBeats: 0.45 },
  { id: 'ex-07', pitch: 68, startBeat: 5.4, durationBeats: 0.36 },
  { id: 'ex-08', pitch: 67, startBeat: 5.9, durationBeats: 0.55 },
  { id: 'ex-09', pitch: 70, startBeat: 6.55, durationBeats: 0.4 },
  { id: 'ex-10', pitch: 65, startBeat: 7.4, durationBeats: 0.42 },
  { id: 'ex-11', pitch: 64, startBeat: 8.0, durationBeats: 0.65 },
  { id: 'ex-12', pitch: 66, startBeat: 9.25, durationBeats: 0.35 },
  { id: 'ex-13', pitch: 67, startBeat: 9.8, durationBeats: 0.8 },
  { id: 'ex-14', pitch: 69, startBeat: 11.3, durationBeats: 0.55 },
  { id: 'ex-15', pitch: 71, startBeat: 12.3, durationBeats: 0.55 },
  { id: 'ex-16', pitch: 72, startBeat: 13.1, durationBeats: 1.2 },
];

const TURNAROUND_TAKE: NoteEvent[] = [
  { id: 'turn-01', pitch: 60, startBeat: 0.2, durationBeats: 0.55 },
  { id: 'turn-02', pitch: 64, startBeat: 1.15, durationBeats: 0.5 },
  { id: 'turn-03', pitch: 67, startBeat: 2.15, durationBeats: 0.55 },
  { id: 'turn-04', pitch: 71, startBeat: 3.45, durationBeats: 0.4 },
  { id: 'turn-05', pitch: 73, startBeat: 4.0, durationBeats: 0.65 },
  { id: 'turn-06', pitch: 76, startBeat: 4.9, durationBeats: 0.4 },
  { id: 'turn-07', pitch: 70, startBeat: 5.4, durationBeats: 0.35 },
  { id: 'turn-08', pitch: 69, startBeat: 5.9, durationBeats: 0.55 },
  { id: 'turn-09', pitch: 67, startBeat: 7.4, durationBeats: 0.42 },
  { id: 'turn-10', pitch: 65, startBeat: 8.0, durationBeats: 0.58 },
  { id: 'turn-11', pitch: 62, startBeat: 8.75, durationBeats: 0.5 },
  { id: 'turn-12', pitch: 69, startBeat: 9.6, durationBeats: 0.55 },
  { id: 'turn-13', pitch: 72, startBeat: 11.45, durationBeats: 0.4 },
  { id: 'turn-14', pitch: 71, startBeat: 12.0, durationBeats: 0.65 },
  { id: 'turn-15', pitch: 68, startBeat: 13.4, durationBeats: 0.35 },
  { id: 'turn-16', pitch: 67, startBeat: 13.9, durationBeats: 0.7 },
  { id: 'turn-17', pitch: 65, startBeat: 15.1, durationBeats: 0.6 },
];

/** A fixed twelve-bar C blues phrase, with changes highlighted near bar lines. */
const BLUES_C_TAKE: NoteEvent[] = [
  { id: 'blues-01', pitch: 60, startBeat: 0.2, durationBeats: 0.55 },
  { id: 'blues-02', pitch: 64, startBeat: 1.15, durationBeats: 0.6 },
  { id: 'blues-03', pitch: 63, startBeat: 3.4, durationBeats: 0.42 },
  { id: 'blues-04', pitch: 64, startBeat: 4.0, durationBeats: 0.68 },
  { id: 'blues-05', pitch: 72, startBeat: 5.3, durationBeats: 0.56 },
  { id: 'blues-06', pitch: 75, startBeat: 7.4, durationBeats: 0.42 },
  { id: 'blues-07', pitch: 76, startBeat: 8.0, durationBeats: 0.72 },
  { id: 'blues-08', pitch: 73, startBeat: 9.3, durationBeats: 0.4 },
  { id: 'blues-09', pitch: 72, startBeat: 9.85, durationBeats: 0.72 },
  { id: 'blues-10', pitch: 67, startBeat: 12.2, durationBeats: 0.65 },
  { id: 'blues-11', pitch: 70, startBeat: 15.4, durationBeats: 0.42 },
  { id: 'blues-12', pitch: 69, startBeat: 16.0, durationBeats: 0.7 },
  { id: 'blues-13', pitch: 72, startBeat: 17.3, durationBeats: 0.62 },
  { id: 'blues-14', pitch: 65, startBeat: 20.2, durationBeats: 0.75 },
  { id: 'blues-15', pitch: 75, startBeat: 23.4, durationBeats: 0.42 },
  { id: 'blues-16', pitch: 76, startBeat: 24.0, durationBeats: 0.72 },
  { id: 'blues-17', pitch: 67, startBeat: 25.3, durationBeats: 0.65 },
  { id: 'blues-18', pitch: 72, startBeat: 28.2, durationBeats: 0.68 },
  { id: 'blues-19', pitch: 70, startBeat: 31.4, durationBeats: 0.42 },
  { id: 'blues-20', pitch: 71, startBeat: 32.0, durationBeats: 0.68 },
  { id: 'blues-21', pitch: 68, startBeat: 33.4, durationBeats: 0.36 },
  { id: 'blues-22', pitch: 67, startBeat: 33.9, durationBeats: 0.65 },
  { id: 'blues-23', pitch: 69, startBeat: 36.1, durationBeats: 0.65 },
  { id: 'blues-24', pitch: 75, startBeat: 39.4, durationBeats: 0.42 },
  { id: 'blues-25', pitch: 76, startBeat: 40.0, durationBeats: 0.72 },
  { id: 'blues-26', pitch: 70, startBeat: 43.4, durationBeats: 0.42 },
  { id: 'blues-27', pitch: 71, startBeat: 44.0, durationBeats: 0.68 },
  { id: 'blues-28', pitch: 74, startBeat: 45.2, durationBeats: 0.56 },
  { id: 'blues-29', pitch: 65, startBeat: 46.4, durationBeats: 0.6 },
];

function transpose(notes: readonly NoteEvent[], keyId: string, root: number): NoteEvent[] {
  // Use the nearer octave so every example stays in a comfortable solo register.
  const semitones = root > 6 ? root - 12 : root;
  return notes.map((note) => ({ ...note, id: `${keyId}-${note.id}`, pitch: note.pitch + semitones }));
}

export function exampleTakeFor(progression: Progression): NoteEvent[] {
  if (progression.id === 'turnaround-c') return TURNAROUND_TAKE.map((note) => ({ ...note }));
  const keyId = progression.keyId ?? progression.id.replace(/^(ii-v-i|blues)-/, '');
  const root = CIRCLE_KEYS.find((key) => key.id === keyId)?.root;
  if (root !== undefined) {
    if (progression.form === 'blues' || progression.id.startsWith('blues-')) return transpose(BLUES_C_TAKE, keyId, root);
    if (progression.form === 'ii-v-i' || progression.id.startsWith('ii-v-i-')) return transpose(EXAMPLE_TAKE, keyId, root);
  }
  return EXAMPLE_TAKE.map((note) => ({ ...note }));
}
