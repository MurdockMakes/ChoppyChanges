import {
  BEATS_PER_BAR, analyzeTake, chordAtBeat, formatPosition, pitchClass,
  spellDegree, spellNote, type ChordInfo, type NoteEvent, type Progression,
  type Resolution,
} from './theory.ts';

export type CoachEvidenceKind = 'guide-tone' | 'flat-nine' | 'chromatic' | 'no-nearby-resolution' | 'change-landing';
export type CoachNeedId = 'tension-resolution' | 'guide-tone-landing' | 'repeat-guide-tone' | 'repeat-chromatic';
export type ExerciseKind = 'arpeggio' | 'guide-tones' | 'dorian' | 'mixolydian' | 'ionian' | 'flat-nine';

export interface CoachNote {
  id: string;
  pitch: number;
  name: string;
  chordName: string;
  bar: number;
  beat: number;
  position: string;
  startBeat: number;
  durationBeats: number;
  role: string;
}

export interface CoachEvidence {
  id: string;
  kind: CoachEvidenceKind;
  noteIds: string[];
  title: string;
  explanation: string;
  startBeat: number;
  endBeat: number;
  tension?: string;
}

export interface CoachNeed {
  id: CoachNeedId;
  title: string;
  explanation: string;
  evidenceIds: string[];
}

export interface PerformanceSummary {
  key: string;
  form: Progression['form'];
  progressionId: string;
  chords: Array<{ bar: number; name: string; root: string; third: string; fifth: string; seventh: string }>;
  notes: CoachNote[];
  evidence: CoachEvidence[];
  needs: CoachNeed[];
  reliableForPersonalization: boolean;
  limitation: string | null;
}

export interface CatalogExercise {
  id: string;
  kind: ExerciseKind;
  title: string;
  chordName: string;
  bar: number;
  notes: string[];
  purpose: string;
  action: string;
  minutes: number;
  startingBpm: number;
  improvement: string;
}

export interface CoachContext {
  summary: PerformanceSummary;
  catalog: CatalogExercise[];
}

export interface CoachReference {
  noteId: string;
  chordName: string;
  bar: number;
  beat: number;
}

export interface PlanExercise {
  catalogId: string;
  evidenceId: string | null;
  reference: CoachReference | null;
  instruction: string;
}

export interface CoachPlan {
  priorityNeedId: CoachNeedId | 'general-warmup';
  priorityEvidenceIds: string[];
  exercises: PlanExercise[];
}

function positionParts(startBeat: number) {
  return {
    bar: Math.floor(startBeat / BEATS_PER_BAR) + 1,
    beat: Math.round(((startBeat % BEATS_PER_BAR) + 1) * 100) / 100,
  };
}

function noteRole(note: NoteEvent, chord: ChordInfo): string {
  const pc = pitchClass(note.pitch);
  if (pc === chord.root) return 'root';
  if (pc === chord.third) return 'third';
  if (pc === chord.fifth) return 'fifth';
  if (pc === chord.seventh) return 'seventh';
  const tension = chord.tensions.find((item) => item.pitchClass === pc);
  return tension ? `${tension.label} tension` : 'other';
}

function toCoachNote(note: NoteEvent, progression: Progression): CoachNote {
  const chord = chordAtBeat(note.startBeat, progression);
  return {
    id: note.id,
    pitch: note.pitch,
    name: spellNote(note.pitch, chord),
    chordName: chord.name,
    ...positionParts(note.startBeat),
    position: formatPosition(note.startBeat),
    startBeat: note.startBeat,
    durationBeats: note.durationBeats,
    role: noteRole(note, chord),
  };
}

function isValidNote(note: NoteEvent): boolean {
  return typeof note.id === 'string' && note.id.length > 0 &&
    Number.isInteger(note.pitch) && note.pitch >= 0 && note.pitch <= 127 &&
    Number.isFinite(note.startBeat) && note.startBeat >= 0 &&
    Number.isFinite(note.durationBeats) && note.durationBeats >= 0;
}

function chordDegrees(chord: ChordInfo) {
  return [chord.root, chord.third, chord.fifth, chord.seventh].map((pc) => spellNote(pc, chord));
}

function scale(chord: ChordInfo, intervals: readonly number[]) {
  const rootName = spellNote(chord.root, chord);
  return intervals.map((semitones, degree) => spellDegree(rootName, semitones, degree));
}

function buildCatalog(progression: Progression, evidence: CoachEvidence[], notes: CoachNote[]): CatalogExercise[] {
  const catalog: CatalogExercise[] = [];
  const seen = new Set<string>();
  const hasRelevantFlatNine = (chordName: string) => evidence.some((item) =>
    (item.kind === 'flat-nine' || item.tension === '♭9') &&
    item.noteIds.some((id) => notes.find((note) => note.id === id)?.chordName === chordName),
  );

  progression.chords.forEach((chord, index) => {
    if (seen.has(chord.name)) return;
    seen.add(chord.name);
    const bar = index + 1;
    const degrees = chordDegrees(chord);
    const [root, third, , seventh] = degrees;
    const base = { chordName: chord.name, bar, startingBpm: 60 };
    catalog.push({
      ...base, id: `arpeggio-${bar}`, kind: 'arpeggio', title: `${chord.name} chord tones`, notes: degrees,
      purpose: `Hear the 1–3–5–7 shape of ${chord.name}.`,
      action: `For 6 minutes, play ${degrees.join('–')} up and down, one note per beat.`, minutes: 6,
      improvement: `On the next take, include a clean ${third} or ${seventh} within one beat of ${chord.name}'s entrance.`,
    });
    catalog.push({
      ...base, id: `guide-tones-${bar}`, kind: 'guide-tones', title: `${chord.name} guide tones`, notes: [third, seventh],
      purpose: `Make the 3rd and 7th of ${chord.name} easy to hear.`,
      action: `For 6 minutes, alternate ${third} and ${seventh} over the loop; begin with one note per two beats.`, minutes: 6,
      improvement: `On the next take, place ${third} or ${seventh} within one beat of ${chord.name}'s entrance.`,
    });
    if (chord.quality === 'minor7') {
      const notes = scale(chord, [0, 2, 3, 5, 7, 9, 10]);
      catalog.push({
        ...base, id: `dorian-${bar}`, kind: 'dorian', title: `${chord.name} Dorian`, notes,
        purpose: `Connect chord tones with the Dorian color over ${chord.name}.`,
        action: `For 7 minutes, play ${notes.join('–')} slowly, then make short phrases ending on ${third} or ${seventh}.`, minutes: 7,
        improvement: `On the next take, end one ${chord.name} phrase on ${third} or ${seventh} with a clear pulse.`,
      });
    } else if (chord.quality === 'dominant7') {
      const notes = scale(chord, [0, 2, 4, 5, 7, 9, 10]);
      catalog.push({
        ...base, id: `mixolydian-${bar}`, kind: 'mixolydian', title: `${chord.name} Mixolydian`, notes,
        purpose: `Hear the dominant scale around ${chord.name}'s chord tones.`,
        action: `For 7 minutes, play ${notes.join('–')}, then make two-beat phrases ending on ${third} or ${seventh}.`, minutes: 7,
        improvement: `On the next take, shape one ${chord.name} phrase that settles on ${third} or ${seventh}.`,
      });
      if (hasRelevantFlatNine(chord.name)) {
        const flatNine = spellDegree(root, 1, 1);
        catalog.push({
          ...base, id: `flat-nine-${bar}`, kind: 'flat-nine', title: `${chord.name} ♭9 → root`, notes: [flatNine, root],
          purpose: `Practice an intentional ${flatNine} to ${root} resolution on ${chord.name}.`,
          action: `For 5 minutes, play ${flatNine} then ${root} by semitone, leaving one beat of space before repeating.`, minutes: 5,
          improvement: `On the next take, if you use ${flatNine} on ${chord.name}, move to ${root} within the next beat.`,
        });
      }
    } else {
      const notes = scale(chord, [0, 2, 4, 5, 7, 9, 11]);
      catalog.push({
        ...base, id: `ionian-${bar}`, kind: 'ionian', title: `${chord.name} Ionian`, notes,
        purpose: `Hear the major scale against ${chord.name}.`,
        action: `For 7 minutes, play ${notes.join('–')} slowly, then make short phrases ending on ${third} or ${seventh}.`, minutes: 7,
        improvement: `On the next take, finish one ${chord.name} phrase on ${third} or ${seventh}.`,
      });
    }
  });
  return catalog;
}

function observedLandings(notes: CoachNote[], progression: Progression): CoachEvidence[] {
  if (notes.length < 2) return [];
  const lastBeat = notes.at(-1)!.startBeat;
  const observations: CoachEvidence[] = [];
  for (let boundary = BEATS_PER_BAR; boundary <= lastBeat; boundary += BEATS_PER_BAR) {
    const fromChord = chordAtBeat(boundary - 0.01, progression);
    const toChord = chordAtBeat(boundary, progression);
    if (fromChord.name === toChord.name) continue;
    const before = notes.filter((note) => note.startBeat >= boundary - 1.25 && note.startBeat < boundary).at(-1);
    const after = notes.find((note) => note.startBeat >= boundary && note.startBeat <= boundary + 1);
    if (!before || !after) continue;
    const landedPc = pitchClass(after.pitch);
    if (landedPc === toChord.third || landedPc === toChord.seventh) continue;
    observations.push({
      id: `change-landing-${before.id}-${after.id}`,
      kind: 'change-landing',
      noteIds: [before.id, after.id],
      title: 'Guide-tone landing to explore',
      explanation: `${before.name} on ${before.chordName} at ${before.position} leads to ${after.name} on ${after.chordName} at ${after.position}. The first note after this change is not its 3rd or 7th; that can be an intentional choice.`,
      startBeat: before.startBeat,
      endBeat: after.startBeat + after.durationBeats,
    });
  }
  return observations;
}

export function buildCoachContext(rawNotes: readonly NoteEvent[], progression: Progression, suppliedResolutions?: readonly Resolution[]): CoachContext {
  const unique = new Set<string>();
  const notes = rawNotes.filter((note) => {
    if (!isValidNote(note) || unique.has(note.id)) return false;
    unique.add(note.id);
    return true;
  }).slice().sort((a, b) => a.startBeat - b.startBeat).map((note) => toCoachNote(note, progression));
  const validIds = new Set(notes.map((note) => note.id));
  const resolutions = suppliedResolutions ?? analyzeTake(rawNotes, progression);
  const evidence: CoachEvidence[] = resolutions
    .filter((item) => validIds.has(item.from.id) && (!item.to || validIds.has(item.to.id)))
    .map((item) => {
      const from = notes.find((note) => note.id === item.from.id)!;
      const chord = chordAtBeat(from.startBeat, progression);
      const tension = item.kind === 'none'
        ? chord.tensions.find((entry) => entry.pitchClass === pitchClass(from.pitch))?.label
        : undefined;
      return {
        id: item.id,
        kind: item.kind === 'none' ? 'no-nearby-resolution' : item.kind,
        noteIds: [item.from.id, ...(item.to ? [item.to.id] : [])],
        title: item.title,
        explanation: item.explanation,
        startBeat: item.startBeat,
        endBeat: item.endBeat,
        ...(tension ? { tension } : {}),
      };
    });
  evidence.push(...observedLandings(notes, progression));
  evidence.sort((a, b) => a.startBeat - b.startBeat);

  const needs: CoachNeed[] = [];
  const unresolvedTensions = evidence.filter((item) => item.kind === 'no-nearby-resolution' && item.tension);
  if (unresolvedTensions.length >= 2) needs.push({
    id: 'tension-resolution', title: 'Give named tensions a landing point',
    explanation: 'At least two named tensions have no nearby resolution detected. That is a useful phrase to explore, not a verdict on the notes.',
    evidenceIds: unresolvedTensions.map((item) => item.id),
  });
  const otherLandings = evidence.filter((item) => item.kind === 'change-landing');
  if (otherLandings.length >= 2) needs.push({
    id: 'guide-tone-landing', title: 'Make guide tones audible at the changes',
    explanation: 'At least two first notes after a chord change were not its 3rd or 7th. Try that sound as another option.',
    evidenceIds: otherLandings.map((item) => item.id),
  });
  const guideMoves = evidence.filter((item) => item.kind === 'guide-tone');
  if (guideMoves.length >= 2) needs.push({
    id: 'repeat-guide-tone', title: 'Make your guide-tone moves repeatable',
    explanation: 'The take contains multiple detected seventh-to-third moves. Rehearse the arrival so you can call on it again.',
    evidenceIds: guideMoves.map((item) => item.id),
  });
  const chromaticMoves = evidence.filter((item) => item.kind === 'chromatic' || item.kind === 'flat-nine');
  if (chromaticMoves.length >= 2) needs.push({
    id: 'repeat-chromatic', title: 'Shape the approach and its landing',
    explanation: 'The take contains multiple detected semitone approaches. Practice controlling their timing and arrival.',
    evidenceIds: chromaticMoves.map((item) => item.id),
  });

  const key = progression.label.split(' ')[0];
  const span = notes.length ? notes.at(-1)!.startBeat - notes[0].startBeat : 0;
  const reliableForPersonalization = notes.length >= 6 && span >= BEATS_PER_BAR && needs.length > 0;
  const limitation = reliableForPersonalization ? null : notes.length < 6 || span < BEATS_PER_BAR
    ? 'Too little reliable evidence for a personalized priority. Try a longer phrase; here is a general warmup.'
    : 'No repeated pattern supports a specific priority yet. Here is a general warmup.';
  const summary: PerformanceSummary = {
    key, form: progression.form, progressionId: progression.id,
    chords: progression.chords.map((chord, index) => {
      const [root, third, fifth, seventh] = chordDegrees(chord);
      return { bar: index + 1, name: chord.name, root, third, fifth, seventh };
    }),
    notes, evidence, needs, reliableForPersonalization, limitation,
  };
  return { summary, catalog: buildCatalog(progression, evidence, notes) };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function uniqueStrings(value: unknown, minimum: number, maximum: number): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum &&
    value.every((item) => typeof item === 'string') && new Set(value).size === value.length;
}

function safeInstruction(value: unknown): value is string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 160 || value.trim() !== value) return false;
  // Musical facts are displayed from validated structured references and the reviewed catalog.
  // Prose may give an imperative coaching cue but may not assert performed notes or positions.
  if (/\b(?:bar|beat)\s*\d|\b(?:played|missed|heard|resolved|detected|landed)\b/i.test(value) ||
    /\b[A-G](?:♯|♭|#|b){0,2}(?:maj7|m7|7)?\b/.test(value)) return false;
  return /^(?:Try|Keep|Start|Listen|Aim|Play|Repeat|Slow|Let|Focus|Use|Breathe|Leave|Take)\b/.test(value);
}

/** Reject any model-created fact that does not match a deterministic note, chord, position or catalog entry. */
export function validateGeminiCoachResponse(raw: unknown, context: CoachContext): CoachPlan {
  if (!context.summary.reliableForPersonalization || !isObject(raw)) throw new Error('Invalid coach response');
  const need = context.summary.needs.find((item) => item.id === raw.priorityNeedId);
  if (!need || !uniqueStrings(raw.priorityEvidenceIds, 1, 3) ||
    !raw.priorityEvidenceIds.every((id) => need.evidenceIds.includes(id))) throw new Error('Invalid priority evidence');
  if (!Array.isArray(raw.exercises) || raw.exercises.length < 2 || raw.exercises.length > 3) throw new Error('Invalid exercise count');
  const exerciseIds = new Set<string>();
  const exercises: PlanExercise[] = raw.exercises.map((item: unknown) => {
    if (!isObject(item) || typeof item.catalogId !== 'string' || typeof item.evidenceId !== 'string' ||
      !isObject(item.reference) || !safeInstruction(item.instruction)) throw new Error('Invalid exercise');
    const reference = item.reference;
    const catalog = context.catalog.find((entry) => entry.id === item.catalogId);
    const evidence = context.summary.evidence.find((entry) => entry.id === item.evidenceId);
    const note = context.summary.notes.find((entry) => entry.id === reference.noteId);
    if (!catalog || exerciseIds.has(catalog.id) || !evidence || !need.evidenceIds.includes(evidence.id) ||
      !note || !evidence.noteIds.includes(note.id) || catalog.chordName !== note.chordName ||
      reference.chordName !== note.chordName || reference.bar !== note.bar ||
      reference.beat !== note.beat) throw new Error('Invented coach reference');
    exerciseIds.add(catalog.id);
    return {
      catalogId: catalog.id,
      evidenceId: evidence.id,
      reference: { noteId: note.id, chordName: note.chordName, bar: note.bar, beat: note.beat },
      instruction: item.instruction as string,
    };
  });
  return { priorityNeedId: need.id, priorityEvidenceIds: raw.priorityEvidenceIds, exercises };
}

function referenceFor(catalog: CatalogExercise, evidence: CoachEvidence, notes: CoachNote[]): CoachReference | null {
  const note = notes.find((item) => evidence.noteIds.includes(item.id) && item.chordName === catalog.chordName);
  return note ? { noteId: note.id, chordName: note.chordName, bar: note.bar, beat: note.beat } : null;
}

export function fallbackCoachPlan(context: CoachContext): CoachPlan {
  const { summary, catalog } = context;
  if (!summary.reliableForPersonalization) {
    const warmups = [catalog.find((item) => item.kind === 'arpeggio'), catalog.find((item) => item.kind === 'guide-tones')]
      .filter((item): item is CatalogExercise => Boolean(item));
    return {
      priorityNeedId: 'general-warmup', priorityEvidenceIds: [],
      exercises: warmups.map((item) => ({ catalogId: item.id, evidenceId: null, reference: null, instruction: 'Start slowly and keep a relaxed pulse.' })),
    };
  }
  const need = summary.needs[0];
  const priorityEvidenceIds = need.evidenceIds.slice(0, 3);
  const suitable = catalog.filter((item) => {
    if (need.id === 'tension-resolution') return item.kind === 'flat-nine' || item.kind === 'guide-tones' || item.kind === 'arpeggio';
    if (need.id === 'guide-tone-landing' || need.id === 'repeat-guide-tone') return item.kind === 'guide-tones' || item.kind === 'arpeggio';
    return item.kind === 'flat-nine' || item.kind === 'mixolydian' || item.kind === 'guide-tones' || item.kind === 'arpeggio';
  });
  const choices: PlanExercise[] = [];
  for (const catalogItem of suitable) {
    const match = need.evidenceIds.map((id) => summary.evidence.find((item) => item.id === id)!)
      .map((item) => ({ evidence: item, reference: referenceFor(catalogItem, item, summary.notes) }))
      .find((item) => item.reference);
    if (!match) continue;
    choices.push({
      catalogId: catalogItem.id, evidenceId: match.evidence.id, reference: match.reference,
      instruction: 'Keep the pulse steady and listen for the arrival.',
    });
    if (choices.length === 3) break;
  }
  // A supported need always has at least one observed chord; arpeggios and guide tones cover it.
  return { priorityNeedId: need.id, priorityEvidenceIds, exercises: choices };
}

export function planPriority(context: CoachContext, plan: CoachPlan): { title: string; explanation: string } {
  if (plan.priorityNeedId === 'general-warmup') return {
    title: 'General warmup', explanation: context.summary.limitation ?? 'Try a short warmup before the next take.',
  };
  const need = context.summary.needs.find((item) => item.id === plan.priorityNeedId)!;
  return { title: need.title, explanation: need.explanation };
}

export function planExercise(context: CoachContext, item: PlanExercise): CatalogExercise {
  const catalog = context.catalog.find((entry) => entry.id === item.catalogId);
  if (!catalog) throw new Error('Unknown catalog exercise');
  return catalog;
}

export function passageForExercise(context: CoachContext, item: PlanExercise): CoachEvidence | null {
  return context.summary.evidence.find((entry) => entry.id === item.evidenceId) ?? null;
}

