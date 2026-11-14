export type ChordName = string;
export type ChordQuality = "minor7" | "dominant7" | "major7";
export type ProgressionForm = "ii-v-i" | "blues" | "turnaround";

export interface ChordInfo {
  name: ChordName;
  quality: ChordQuality;
  root: number;
  third: number;
  fifth: number;
  seventh: number;
  tensions: ReadonlyArray<{ pitchClass: number; label: string }>;
  spellings?: Readonly<Partial<Record<number, string>>>;
}

export interface Progression {
  id: string;
  label: string;
  description: string;
  keyId: string;
  form: ProgressionForm;
  chords: readonly ChordInfo[];
}

export interface CircleKey {
  id: string;
  label: string;
  root: number;
}

export interface NoteEvent {
  id: string;
  pitch: number;
  startBeat: number;
  durationBeats: number;
}

export type ResolutionKind = "guide-tone" | "flat-nine" | "chromatic" | "none";

export interface Resolution {
  id: string;
  kind: ResolutionKind;
  from: NoteEvent;
  to?: NoteEvent;
  startBeat: number;
  endBeat: number;
  title: string;
  explanation: string;
}

export const BEATS_PER_BAR = 4;
export const BPM = 90;
const DEFAULT_NAMES = ["C", "C♯", "D", "E♭", "E", "F", "F♯", "G", "G♯", "A", "B♭", "B"];
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"] as const;
const NATURAL_PITCH_CLASSES = [0, 2, 4, 5, 7, 9, 11] as const;

function parsePitchClass(name: string): number {
  const letter = LETTERS.indexOf(name[0] as typeof LETTERS[number]);
  if (letter < 0) throw new Error(`Invalid note name: ${name}`);
  let accidental = 0;
  for (const symbol of name.slice(1)) {
    if (symbol === "♯") accidental += 1;
    else if (symbol === "♭") accidental -= 1;
    else throw new Error(`Invalid note name: ${name}`);
  }
  return pitchClass(NATURAL_PITCH_CLASSES[letter] + accidental);
}

/** Spell an interval by its scale-degree letter, including double accidentals where needed. */
export function spellDegree(rootName: string, semitones: number, letterSteps: number): string {
  const rootLetter = LETTERS.indexOf(rootName[0] as typeof LETTERS[number]);
  const letter = LETTERS[(rootLetter + letterSteps) % LETTERS.length];
  const natural = NATURAL_PITCH_CLASSES[(rootLetter + letterSteps) % LETTERS.length];
  const wanted = pitchClass(parsePitchClass(rootName) + semitones);
  let accidental = (wanted - natural + 12) % 12;
  if (accidental > 6) accidental -= 12;
  if (Math.abs(accidental) > 2) throw new Error(`Cannot spell ${rootName} + ${semitones}`);
  return `${letter}${accidental > 0 ? "♯".repeat(accidental) : "♭".repeat(-accidental)}`;
}

function makeChord(rootName: string, quality: ChordQuality): ChordInfo {
  const root = parsePitchClass(rootName);
  const thirdInterval = quality === "minor7" ? 3 : 4;
  const seventhInterval = quality === "major7" ? 11 : 10;
  const degreeData = [
    { interval: 0, steps: 0 },
    { interval: thirdInterval, steps: 2 },
    { interval: 7, steps: 4 },
    { interval: seventhInterval, steps: 6 },
  ];
  const tensionData = quality === "minor7"
    ? [
        { interval: 2, steps: 1, label: "9" },
        { interval: 5, steps: 3, label: "11" },
        { interval: 9, steps: 5, label: "13" },
      ]
    : quality === "dominant7"
      ? [
          { interval: 1, steps: 1, label: "♭9" },
          { interval: 2, steps: 1, label: "9" },
          { interval: 6, steps: 3, label: "♯11" },
          { interval: 9, steps: 5, label: "13" },
        ]
      : [
          { interval: 2, steps: 1, label: "9" },
          { interval: 6, steps: 3, label: "♯11" },
          { interval: 9, steps: 5, label: "13" },
        ];
  const spellings: Record<number, string> = {};
  for (const degree of [...degreeData, ...tensionData]) {
    spellings[pitchClass(root + degree.interval)] = spellDegree(rootName, degree.interval, degree.steps);
  }
  return {
    name: `${rootName}${quality === "minor7" ? "m7" : quality === "major7" ? "maj7" : "7"}`,
    quality,
    root,
    third: pitchClass(root + thirdInterval),
    fifth: pitchClass(root + 7),
    seventh: pitchClass(root + seventhInterval),
    tensions: tensionData.map(({ interval, label }) => ({ pitchClass: pitchClass(root + interval), label })),
    spellings,
  };
}

export const CIRCLE_KEYS: readonly CircleKey[] = [
  { id: "c", label: "C", root: 0 },
  { id: "g", label: "G", root: 7 },
  { id: "d", label: "D", root: 2 },
  { id: "a", label: "A", root: 9 },
  { id: "e", label: "E", root: 4 },
  { id: "b", label: "B", root: 11 },
  { id: "f-sharp", label: "F♯", root: 6 },
  { id: "d-flat", label: "D♭", root: 1 },
  { id: "a-flat", label: "A♭", root: 8 },
  { id: "e-flat", label: "E♭", root: 3 },
  { id: "b-flat", label: "B♭", root: 10 },
  { id: "f", label: "F", root: 5 },
];

function makeIiVi(key: CircleKey): Progression {
  const ii = makeChord(spellDegree(key.label, 2, 1), "minor7");
  const v = makeChord(spellDegree(key.label, 7, 4), "dominant7");
  const tonic = makeChord(key.label, "major7");
  const chords = [ii, v, tonic, tonic];
  return {
    id: `ii-v-i-${key.id}`,
    keyId: key.id,
    form: "ii-v-i",
    label: `${key.label} major ii–V–I`,
    description: chords.map((chord) => chord.name).join(" | "),
    chords,
  };
}

function makeBlues(key: CircleKey): Progression {
  const tonic = makeChord(key.label, "dominant7");
  const fourth = makeChord(spellDegree(key.label, 5, 3), "dominant7");
  const fifth = makeChord(spellDegree(key.label, 7, 4), "dominant7");
  const chords = [tonic, tonic, tonic, tonic, fourth, fourth, tonic, tonic, fifth, fourth, tonic, fifth];
  return {
    id: `blues-${key.id}`,
    keyId: key.id,
    form: "blues",
    label: `${key.label} 12-bar blues`,
    description: chords.map((chord) => chord.name).join(" | "),
    chords,
  };
}

const TURNAROUND_C: Progression = {
  id: "turnaround-c",
  keyId: "c",
  form: "turnaround",
  label: "C major turnaround",
  description: "Cmaj7 | A7 | Dm7 | G7",
  chords: [makeChord("C", "major7"), makeChord("A", "dominant7"), makeChord("D", "minor7"), makeChord("G", "dominant7")],
};

export const PROGRESSIONS: readonly Progression[] = [
  ...CIRCLE_KEYS.flatMap((key) => [makeIiVi(key), makeBlues(key)]),
  TURNAROUND_C,
];
export const DEFAULT_PROGRESSION = PROGRESSIONS[0];
export const CHART = DEFAULT_PROGRESSION.chords;

export function pitchClass(pitch: number): number {
  return ((Math.round(pitch) % 12) + 12) % 12;
}

export function chordAtBeat(beat: number, progression: Progression = DEFAULT_PROGRESSION): ChordInfo {
  const absoluteBar = Math.floor(Math.max(0, beat) / BEATS_PER_BAR);
  return progression.chords[absoluteBar % progression.chords.length];
}

export function nextChordAtBeat(beat: number, progression: Progression = DEFAULT_PROGRESSION): ChordInfo {
  const absoluteBar = Math.floor(Math.max(0, beat) / BEATS_PER_BAR);
  return progression.chords[(absoluteBar + 1) % progression.chords.length];
}

export function isChordTone(pitch: number, chord: ChordInfo): boolean {
  const pc = pitchClass(pitch);
  return pc === chord.root || pc === chord.third || pc === chord.fifth || pc === chord.seventh;
}

export function spellNote(pitch: number, chord: ChordInfo = chordAtBeat(0)): string {
  const pc = pitchClass(pitch);
  return chord.spellings?.[pc] ?? DEFAULT_NAMES[pc];
}

export function spellNoteWithOctave(pitch: number, chord: ChordInfo = chordAtBeat(0)): string {
  const name = spellNote(pitch, chord);
  const letter = LETTERS.indexOf(name[0] as typeof LETTERS[number]);
  const accidentals = [...name.slice(1)].reduce((amount, symbol) => amount + (symbol === "♯" ? 1 : symbol === "♭" ? -1 : 0), 0);
  const octave = Math.floor((pitch - NATURAL_PITCH_CLASSES[letter] - accidentals) / 12) - 1;
  return `${name}${octave}`;
}

export function formatPosition(beat: number): string {
  const safeBeat = Math.max(0, beat);
  const bar = Math.floor(safeBeat / BEATS_PER_BAR) + 1;
  const withinBar = (safeBeat % BEATS_PER_BAR) + 1;
  const roundedBeat = Math.round(withinBar * 100) / 100;
  return `bar ${bar}, beat ${roundedBeat}`;
}

function noteEvidence(note: NoteEvent, progression: Progression): string {
  const chord = chordAtBeat(note.startBeat, progression);
  return `${spellNote(note.pitch, chord)} on ${chord.name} at ${formatPosition(note.startBeat)}`;
}

function makeResolution(kind: Exclude<ResolutionKind, "none">, from: NoteEvent, to: NoteEvent, progression: Progression): Resolution {
  const fromEvidence = noteEvidence(from, progression);
  const toEvidence = noteEvidence(to, progression);
  const fromChord = chordAtBeat(from.startBeat, progression);
  const explanation =
    kind === "guide-tone"
      ? `${fromEvidence} (7th) moves to ${toEvidence} (3rd): a seventh-to-third guide-tone resolution.`
      : kind === "flat-nine"
        ? `${fromEvidence} (♭9) moves to ${toEvidence} (root): the ${fromChord.name} ♭9 resolves by semitone to its root.`
        : `${fromEvidence} approaches ${toEvidence} (chord tone) by semitone within about one beat.`;
  return {
    id: `${kind}-${from.id}-${to.id}`,
    kind,
    from,
    to,
    startBeat: from.startBeat,
    endBeat: Math.max(from.startBeat, to.startBeat + Math.max(0, to.durationBeats)),
    title: kind === "guide-tone" ? "7th → 3rd" : kind === "flat-nine" ? "♭9 → root" : "Chromatic approach",
    explanation,
  };
}

function classifyPair(from: NoteEvent, to: NoteEvent, progression: Progression): Exclude<ResolutionKind, "none"> | null {
  const onsetGap = to.startBeat - from.startBeat;
  if (onsetGap <= 0 || onsetGap > 1.25) return null;

  const fromChord = chordAtBeat(from.startBeat, progression);
  const toChord = chordAtBeat(to.startBeat, progression);
  const fromPc = pitchClass(from.pitch);
  const toPc = pitchClass(to.pitch);
  const interval = Math.abs(to.pitch - from.pitch);

  if (
    fromChord.name !== toChord.name &&
    fromPc === fromChord.seventh && toPc === toChord.third && interval >= 1 && interval <= 2
  ) {
    return "guide-tone";
  }

  if (
    fromChord.quality === "dominant7" && fromChord.name === toChord.name &&
    fromPc === (fromChord.root + 1) % 12 && toPc === fromChord.root && to.pitch === from.pitch - 1
  ) {
    return "flat-nine";
  }

  if (interval === 1 && !isChordTone(from.pitch, fromChord) && isChordTone(to.pitch, toChord)) return "chromatic";
  return null;
}

function makeAmbiguous(from: NoteEvent, progression: Progression, to?: NoteEvent): Resolution {
  const evidence = to ? `${noteEvidence(from, progression)} followed by ${noteEvidence(to, progression)}` : noteEvidence(from, progression);
  return {
    id: `none-${from.id}`,
    kind: "none",
    from,
    to,
    startBeat: from.startBeat,
    endBeat: to ? to.startBeat + Math.max(0, to.durationBeats) : from.startBeat + Math.max(0, from.durationBeats),
    title: "No nearby resolution detected",
    explanation: `${evidence}: No nearby resolution detected.`,
  };
}

/** Finds evidence in adjacent notes of a monophonic phrase; it does not rate the solo. */
export function analyzeTake(notes: readonly NoteEvent[], progression: Progression = DEFAULT_PROGRESSION): Resolution[] {
  const sorted = notes
    .filter((note) =>
      Number.isFinite(note.pitch) && note.pitch >= 0 && note.pitch <= 127 &&
      Number.isFinite(note.startBeat) && note.startBeat >= 0 &&
      Number.isFinite(note.durationBeats) && note.durationBeats >= 0,
    )
    .slice()
    .sort((a, b) => a.startBeat - b.startBeat);

  const results: Resolution[] = [];
  const resolvedSourceIds = new Set<string>();
  for (let index = 0; index < sorted.length - 1; index += 1) {
    const from = sorted[index];
    const to = sorted[index + 1];
    const kind = classifyPair(from, to, progression);
    if (kind) {
      results.push(makeResolution(kind, from, to, progression));
      resolvedSourceIds.add(from.id);
    }
  }

  // An unresolved non-chord note is neutral evidence, never a verdict that it was wrong.
  for (let index = 0; index < sorted.length; index += 1) {
    const note = sorted[index];
    if (!resolvedSourceIds.has(note.id) && !isChordTone(note.pitch, chordAtBeat(note.startBeat, progression))) {
      results.push(makeAmbiguous(note, progression, sorted[index + 1]));
    }
  }

  if (results.length === 0 && sorted.length > 0) results.push(makeAmbiguous(sorted[0], progression, sorted[1]));
  return results.sort((a, b) => a.startBeat - b.startBeat);
}
