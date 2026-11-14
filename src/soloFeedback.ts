import { detectPitch } from './pitchDetection.ts';
import { BEATS_PER_BAR, BPM, chordAtBeat, formatPosition, pitchClass, spellNote, type NoteEvent, type Progression } from './theory.ts';
import type { TakeSource } from './useTake.ts';

export type SoloMeasureId = 'chord-landings' | 'tension-resolution' | 'rhythmic-variety' | 'phrase-space' | 'motif-development' | 'intonation' | 'articulation';
export type MeasureStatus = 'available' | 'limited' | 'unavailable';

export interface MeasureObservation {
  id: string;
  label: string;
  detail: string;
  noteIds: string[];
  beat: number;
  bar: number;
}

export interface SoloMeasure {
  id: SoloMeasureId;
  title: string;
  status: MeasureStatus;
  value: string;
  definition: string;
  threshold: string;
  sample: string;
  observations: MeasureObservation[];
}

export interface SoloFeedbackReport { measures: SoloMeasure[] }

export interface AudioFrame {
  beat: number;
  frequencyHz: number | null;
  confidence: number;
  rms: number;
  clipped: boolean;
}

export interface MicAudioAnalysis {
  reliable: boolean;
  reason: string;
  stableFrames: number;
  noteFrames: number;
  confidence: number;
  clipFraction: number;
  voiceToNoise: number | null;
  intonationCents: number | null;
  intonationNotes: number;
  intonationObservations: MeasureObservation[];
  articulationClear: number;
  articulationStarts: number;
  articulationObservations: MeasureObservation[];
}

const noteEnd = (note: NoteEvent) => note.startBeat + note.durationBeats;
const barAt = (beat: number) => Math.floor(beat / BEATS_PER_BAR) + 1;
const round = (value: number, decimals = 1) => Number(value.toFixed(decimals));
const median = (numbers: readonly number[]) => {
  if (!numbers.length) return 0;
  const sorted = numbers.slice().sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
const observation = (id: string, label: string, detail: string, notes: NoteEvent[], beat: number): MeasureObservation =>
  ({ id, label, detail, noteIds: notes.map((note) => note.id), beat, bar: barAt(beat) });

function cleanNotes(raw: readonly NoteEvent[]): NoteEvent[] {
  const ids = new Set<string>();
  return raw.filter((note) => {
    if (typeof note.id !== 'string' || !note.id || ids.has(note.id) ||
      !Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127 ||
      !Number.isFinite(note.startBeat) || note.startBeat < 0 ||
      !Number.isFinite(note.durationBeats) || note.durationBeats <= 0) return false;
    ids.add(note.id);
    return true;
  }).slice().sort((a, b) => a.startBeat - b.startBeat || a.id.localeCompare(b.id));
}

function chordLandings(notes: NoteEvent[], progression: Progression): SoloMeasure {
  const observations: MeasureObservation[] = [];
  const end = notes.length ? Math.max(...notes.map(noteEnd)) : 0;
  let guide = 0;
  for (let boundary = BEATS_PER_BAR; boundary <= end; boundary += BEATS_PER_BAR) {
    const from = chordAtBeat(boundary - 0.001, progression);
    const to = chordAtBeat(boundary, progression);
    if (from.name === to.name) continue;
    const landed = notes.find((note) => note.startBeat >= boundary && note.startBeat < boundary + 1);
    if (!landed) continue;
    const pc = pitchClass(landed.pitch);
    const isGuide = pc === to.third || pc === to.seventh;
    if (isGuide) guide += 1;
    const role = pc === to.third ? '3rd' : pc === to.seventh ? '7th' : pc === to.root ? 'root' : pc === to.fifth ? '5th' : 'another color';
    observations.push(observation(`landing-${boundary}-${landed.id}`, `Bar ${barAt(boundary)} · ${spellNote(landed.pitch, to)}`, `The first onset within one beat of ${to.name} at ${formatPosition(boundary)} is ${spellNote(landed.pitch, to)} (${role}).`, [landed], landed.startBeat));
  }
  const count = observations.length;
  return {
    id: 'chord-landings', title: 'Chord-change landings',
    status: count >= 2 ? 'available' : count === 1 ? 'limited' : 'unavailable',
    value: count ? `${guide} of ${count} on a 3rd or 7th` : 'No observed change landing',
    definition: 'For each actual chord change, inspect the first note beginning within one beat after the new bar. Count arrivals on that chord’s 3rd or 7th.',
    threshold: 'Available with 2 or more observed changes; limited with 1; unavailable with 0. A bar without an onset in the first beat is excluded.',
    sample: `${count} observed chord ${count === 1 ? 'change' : 'changes'}`,
    observations,
  };
}

function tensionResolution(notes: NoteEvent[], progression: Progression): SoloMeasure {
  const observations: MeasureObservation[] = [];
  const finalEnd = notes.length ? Math.max(...notes.map(noteEnd)) : 0;
  let resolved = 0;
  let open = 0;
  const times: number[] = [];
  for (const [index, note] of notes.entries()) {
    const chord = chordAtBeat(note.startBeat, progression);
    const tension = chord.tensions.find((item) => item.pitchClass === pitchClass(note.pitch));
    if (!tension) continue;
    const arrival = notes.slice(index + 1).find((candidate) => {
      if (candidate.startBeat - note.startBeat > 2) return false;
      const target = chordAtBeat(candidate.startBeat, progression);
      const pc = pitchClass(candidate.pitch);
      return pc === target.root || pc === target.third || pc === target.fifth || pc === target.seventh;
    });
    const gap = arrival ? arrival.startBeat - note.startBeat : null;
    if (gap !== null && gap > 0 && gap <= 2) {
      resolved += 1;
      times.push(gap);
      observations.push(observation(`tension-${note.id}`, `${tension.label} · ${round(gap)} beats`, `${spellNote(note.pitch, chord)} (${tension.label}) on ${chord.name} at ${formatPosition(note.startBeat)} is followed by ${spellNote(arrival!.pitch, chordAtBeat(arrival!.startBeat, progression))} at ${formatPosition(arrival!.startBeat)} after ${round(gap)} beats.`, [note, arrival!], note.startBeat));
    } else if (finalEnd >= note.startBeat + 2) {
      open += 1;
      observations.push(observation(`tension-${note.id}`, `${tension.label} · no arrival in 2 beats`, `${spellNote(note.pitch, chord)} (${tension.label}) on ${chord.name} at ${formatPosition(note.startBeat)} has no detected chord-tone onset within the next two beats. This may be intentional.`, [note], note.startBeat));
    }
  }
  const count = resolved + open;
  return {
    id: 'tension-resolution', title: 'Time to resolve tension',
    status: count >= 2 ? 'available' : count === 1 ? 'limited' : 'unavailable',
    value: resolved ? `Median ${round(median(times))} beats · ${resolved}/${count} observed` : count ? `No chord-tone arrival within 2 beats · 0/${count}` : 'No complete tension window',
    definition: 'For each named chord tension, measure beats to the next onset on a chord tone within two beats. Report the median of observed arrival times. A tension near the end is excluded unless two following beats were recorded.',
    threshold: 'Available with 2 or more complete tension windows; limited with 1; unavailable with 0. An unobserved arrival is neutral evidence.',
    sample: `${count} complete tension ${count === 1 ? 'window' : 'windows'} · ${resolved} arrivals`,
    observations,
  };
}

function gapBucket(gap: number): string {
  if (gap < 0.375) return 'under ⅜ beat';
  if (gap < 0.75) return '⅜–¾ beat';
  if (gap < 1.25) return '¾–1¼ beats';
  if (gap < 1.75) return '1¼–1¾ beats';
  return '1¾–2¼ beats';
}

function rhythmicVariety(notes: NoteEvent[]): SoloMeasure {
  const gaps: { previous: NoteEvent; next: NoteEvent; gap: number; bucket: string }[] = [];
  for (let index = 1; index < notes.length; index += 1) {
    const gap = notes[index].startBeat - notes[index - 1].startBeat;
    if (gap >= 0.125 && gap <= 2.25) gaps.push({ previous: notes[index - 1], next: notes[index], gap, bucket: gapBucket(gap) });
  }
  const examples = new Map<string, typeof gaps[number]>();
  for (const item of gaps) if (!examples.has(item.bucket)) examples.set(item.bucket, item);
  const observations = [...examples].map(([bucket, item]) => observation(`rhythm-${item.previous.id}-${item.next.id}`, bucket, `Onsets at ${formatPosition(item.previous.startBeat)} and ${formatPosition(item.next.startBeat)} are ${round(item.gap, 2)} beats apart.`, [item.previous, item.next], item.previous.startBeat));
  return {
    id: 'rhythmic-variety', title: 'Rhythmic variety',
    status: gaps.length >= 6 ? 'available' : gaps.length >= 3 ? 'limited' : 'unavailable',
    value: gaps.length >= 3 ? `${examples.size} of 5 onset-gap ranges` : 'Too few onset gaps',
    definition: 'Count distinct onset-to-onset gap ranges from ⅛ to 2¼ beats: under ⅜, ⅜–¾, ¾–1¼, 1¼–1¾, and 1¾–2¼. Longer gaps belong to phrase space.',
    threshold: 'Available with 6 or more qualifying onset gaps; limited with 3–5; unavailable with fewer than 3. Each range links to one example.',
    sample: `${gaps.length} qualifying onset ${gaps.length === 1 ? 'gap' : 'gaps'}`,
    observations,
  };
}

function phraseSpace(notes: NoteEvent[]): SoloMeasure {
  const observations: MeasureObservation[] = [];
  let space = 0;
  let pauses = 0;
  for (let index = 1; index < notes.length; index += 1) {
    const before = notes[index - 1];
    const after = notes[index];
    const gap = after.startBeat - noteEnd(before);
    if (gap < 0.5) continue;
    pauses += 1;
    space += gap;
    observations.push(observation(`space-${before.id}-${after.id}`, `${round(gap)}-beat pause`, `There are ${round(gap)} beats between ${formatPosition(noteEnd(before))} and ${formatPosition(after.startBeat)}.`, [before, after], noteEnd(before)));
  }
  const span = notes.length ? Math.max(0, Math.max(...notes.map(noteEnd)) - notes[0].startBeat) : 0;
  const status = notes.length >= 6 && span >= 8 ? 'available' : notes.length >= 3 && span >= 4 ? 'limited' : 'unavailable';
  return {
    id: 'phrase-space', title: 'Space between phrases', status,
    value: status === 'unavailable' ? 'Phrase too short to measure' : `${round(space)} beats across ${pauses} ${pauses === 1 ? 'pause' : 'pauses'}${span ? ` · ${Math.round(space / span * 100)}% of span` : ''}`,
    definition: 'Add non-overlapping gaps of at least ½ beat between one note’s end and the next onset; divide by the span from first onset to last note end. These gaps are possible phrase breaks, not confirmed breaths.',
    threshold: 'Available with at least 6 notes across 8 beats; limited with at least 3 notes across 4 beats; otherwise unavailable.',
    sample: `${notes.length} notes · ${round(span)}-beat span`,
    observations,
  };
}

function intervalShape(a: NoteEvent, b: NoteEvent): number { return b.pitch - a.pitch; }
function sameDirection(a: number, b: number): boolean { return Math.sign(a) === Math.sign(b); }

function motifDevelopment(notes: NoteEvent[]): SoloMeasure {
  const observations: MeasureObservation[] = [];
  let repeats = 0;
  let variations = 0;
  const usedStarts = new Set<number>();
  for (let start = 0; start + 5 < notes.length; start += 1) {
    if (usedStarts.has(start)) continue;
    const first = notes.slice(start, start + 3);
    const ia = [intervalShape(first[0], first[1]), intervalShape(first[1], first[2])];
    const ra = [first[1].startBeat - first[0].startBeat, first[2].startBeat - first[1].startBeat];
    for (let later = start + 3; later + 2 < notes.length; later += 1) {
      if (usedStarts.has(later)) continue;
      const second = notes.slice(later, later + 3);
      const ib = [intervalShape(second[0], second[1]), intervalShape(second[1], second[2])];
      const rb = [second[1].startBeat - second[0].startBeat, second[2].startBeat - second[1].startBeat];
      const similar = ia.every((interval, index) => sameDirection(interval, ib[index]) && Math.abs(interval - ib[index]) <= 2) &&
        ra.every((gap, index) => Math.abs(gap - rb[index]) <= 0.5);
      if (!similar) continue;
      const varied = ia.some((interval, index) => interval !== ib[index]) || ra.some((gap, index) => Math.abs(gap - rb[index]) > 0.125);
      if (varied) variations += 1; else repeats += 1;
      usedStarts.add(start);
      usedStarts.add(later);
      observations.push(observation(`motif-${first[0].id}-${second[0].id}`, `Bars ${barAt(first[0].startBeat)} → ${barAt(second[0].startBeat)} · ${varied ? 'variation' : 'return'}`, `A three-note shape at ${formatPosition(first[0].startBeat)} returns at ${formatPosition(second[0].startBeat)} with ${varied ? 'a small interval or timing change' : 'the same interval and timing shape'}.`, [...first, ...second], second[0].startBeat));
      break;
    }
  }
  const span = notes.length ? notes.at(-1)!.startBeat - notes[0].startBeat : 0;
  const status = notes.length >= 8 && span >= 8 ? 'available' : notes.length >= 6 ? 'limited' : 'unavailable';
  return {
    id: 'motif-development', title: 'Motif development', status,
    value: status === 'unavailable' ? 'Too few notes for motif comparison' : `${repeats + variations} related three-note ${repeats + variations === 1 ? 'return' : 'returns'} · ${variations} varied`,
    definition: 'Compare non-overlapping three-note groups. A return keeps both interval directions, changes each interval by no more than two semitones, and changes each onset gap by no more than ½ beat. A variation changes at least one interval or gap.',
    threshold: 'Available with at least 8 notes spanning 8 beats; limited with 6–7 notes or a shorter span; unavailable below 6 notes. Each group is used at most once.',
    sample: `${notes.length} notes · ${round(span)}-beat onset span`,
    observations,
  };
}

const centsFrom = (frequencyHz: number, pitch: number) => 1200 * Math.log2(frequencyHz / (440 * 2 ** ((pitch - 69) / 12)));
const usableFrame = (frame: AudioFrame) => frame.frequencyHz !== null && Number.isFinite(frame.frequencyHz) && frame.frequencyHz > 0 && frame.confidence >= 0.8 && frame.rms >= 0.012 && !frame.clipped;

/** Pure audio-frame analysis, also used when an imported microphone recording is decoded. */
export function analyzeAudioFrames(rawNotes: readonly NoteEvent[], rawFrames: readonly AudioFrame[]): MicAudioAnalysis {
  const notes = cleanNotes(rawNotes);
  const frames = rawFrames.filter((frame) => Number.isFinite(frame.beat) && frame.beat >= 0 && Number.isFinite(frame.rms) && frame.rms >= 0 && Number.isFinite(frame.confidence) && frame.confidence >= 0 && frame.confidence <= 1).slice().sort((a, b) => a.beat - b.beat);
  const eligible = notes.filter((note) => note.durationBeats >= 0.35);
  const during = frames.filter((frame) => eligible.some((note) => frame.beat >= note.startBeat + 0.1 && frame.beat <= noteEnd(note) - 0.08));
  const stable = during.filter(usableFrame);
  const stableConfidence = median(stable.map((frame) => frame.confidence));
  const clipFraction = frames.length ? frames.filter((frame) => frame.clipped).length / frames.length : 1;
  const offNote = frames.filter((frame) => !notes.some((note) => frame.beat >= note.startBeat && frame.beat <= noteEnd(note)));
  const noise = offNote.length >= 5 ? median(offNote.map((frame) => frame.rms)) : null;
  const voice = median(stable.map((frame) => frame.rms));
  const voiceToNoise = noise === null ? null : voice / Math.max(noise, 0.001);
  const coverage = during.length ? stable.length / during.length : 0;
  let reason = '';
  if (eligible.length < 4) reason = `Only ${eligible.length} notes last at least 0.35 beat; 4 are required.`;
  else if (stable.length < 12) reason = `Only ${stable.length} stable audio frames; 12 are required.`;
  else if (coverage < 0.6) reason = `Stable pitch covers ${Math.round(coverage * 100)}% of note frames; 60% is required.`;
  else if (stableConfidence < 0.85) reason = `Median pitch confidence is ${round(stableConfidence, 2)}; 0.85 is required.`;
  else if (clipFraction > 0.01) reason = `${Math.round(clipFraction * 100)}% of frames clip; at most 1% is allowed.`;
  else if (voiceToNoise !== null && voiceToNoise < 3) reason = `Voiced audio is ${round(voiceToNoise)}× the quiet-level audio; 3× is required.`;
  else if (voice < 0.02) reason = `Median voiced level is ${round(voice, 3)} RMS; 0.02 is required.`;
  const reliable = reason === '';
  const intonationObservations: MeasureObservation[] = [];
  const noteCents: number[] = [];
  if (reliable) for (const note of eligible) {
    const cents = stable.filter((frame) => frame.beat >= note.startBeat + 0.1 && frame.beat <= noteEnd(note) - 0.08)
      .map((frame) => centsFrom(frame.frequencyHz!, note.pitch)).filter((value) => Math.abs(value) <= 150);
    if (cents.length < 2) continue;
    const center = median(cents);
    noteCents.push(Math.abs(center));
    intonationObservations.push(observation(`intonation-${note.id}`, `${Math.round(Math.abs(center))} cents from ${note.pitch}`, `Stable audio near ${formatPosition(note.startBeat)} has a median pitch offset of ${Math.round(center)} cents from this note's edited pitch.`, [note], note.startBeat));
  }
  const articulationObservations: MeasureObservation[] = [];
  let articulationStarts = 0;
  let articulationClear = 0;
  if (reliable) for (const [index, note] of notes.entries()) {
    if (index === 0) continue;
    const before = frames.filter((frame) => frame.beat >= note.startBeat - 0.3 && frame.beat < note.startBeat - 0.06);
    const after = frames.filter((frame) => frame.beat >= note.startBeat + 0.02 && frame.beat <= note.startBeat + 0.25);
    if (before.length < 2 || after.length < 2) continue;
    const baseline = median(before.map((frame) => frame.rms));
    const attack = median(after.map((frame) => frame.rms));
    const clear = attack >= 0.02 && attack >= Math.max(0.008, baseline * 1.8);
    articulationStarts += 1;
    if (clear) articulationClear += 1;
    articulationObservations.push(observation(`articulation-${note.id}`, `Bar ${barAt(note.startBeat)} · ${clear ? 'level rise' : 'no clear level rise'}`, `At ${formatPosition(note.startBeat)}, the local audio level ${clear ? 'rises by at least 1.8×' : 'does not rise by 1.8×'} across the note start. This does not identify tonguing technique.`, [note], note.startBeat));
  }
  return {
    reliable, reason: reason || `Audio gate met: ${eligible.length} sustained notes, ${stable.length}/${during.length} stable note frames (${Math.round(coverage * 100)}%), median pitch confidence ${round(stableConfidence, 2)}, ${round(clipFraction * 100, 1)}% clipped${voiceToNoise === null ? ', no quiet baseline available' : `, ${round(voiceToNoise)}× voiced-to-quiet level`}.`,
    stableFrames: stable.length, noteFrames: during.length, confidence: stableConfidence, clipFraction, voiceToNoise,
    intonationCents: noteCents.length >= 3 ? median(noteCents) : null,
    intonationNotes: noteCents.length, intonationObservations,
    articulationClear, articulationStarts, articulationObservations,
  };
}

/** Decodes and analyzes a local Blob only. No network request is made. */
export async function analyzeMicAudio(blob: Blob, notes: readonly NoteEvent[], startBeat: number, rate: number): Promise<MicAudioAnalysis> {
  if (!blob.size || !Number.isFinite(startBeat) || !Number.isFinite(rate) || rate <= 0) throw new Error('Microphone audio is empty or has invalid timing.');
  const Context = globalThis.AudioContext;
  if (!Context) throw new Error('This browser cannot decode microphone audio for feedback.');
  const context = new Context();
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer());
    const sampleRate = decoded.sampleRate;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, index) => decoded.getChannelData(index));
    if (!channels.length || decoded.length < 1024) throw new Error('Microphone audio is too short to analyze.');
    const windowSize = Math.min(8192, decoded.length);
    const hop = Math.max(1, Math.round(sampleRate * 0.08));
    const frames: AudioFrame[] = [];
    for (let offset = 0; offset + windowSize <= decoded.length; offset += hop) {
      const samples = new Float32Array(windowSize);
      let power = 0;
      let peaks = 0;
      for (let i = 0; i < windowSize; i += 1) {
        let value = 0;
        for (const channel of channels) value += channel[offset + i];
        value /= channels.length;
        samples[i] = value;
        power += value * value;
        if (Math.abs(value) >= 0.995) peaks += 1;
      }
      const estimate = detectPitch(samples, sampleRate);
      frames.push({
        beat: startBeat + ((offset + windowSize / 2) / sampleRate) * BPM / 60 * rate,
        frequencyHz: estimate?.frequencyHz ?? null,
        confidence: estimate?.confidence ?? 0,
        rms: Math.sqrt(power / windowSize),
        clipped: peaks / windowSize > 0.005,
      });
      // Keep the controls responsive while longer local recordings are analyzed.
      if (frames.length % 24 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    return analyzeAudioFrames(notes, frames);
  } finally {
    await context.close();
  }
}

export function buildSoloFeedback(rawNotes: readonly NoteEvent[], progression: Progression, source: TakeSource, audio: MicAudioAnalysis | null = null): SoloFeedbackReport {
  const notes = cleanNotes(rawNotes);
  const measures = [chordLandings(notes, progression), tensionResolution(notes, progression), rhythmicVariety(notes), phraseSpace(notes), motifDevelopment(notes)];
  const saxReason = source !== 'mic' ? 'Intonation and articulation use original local sax microphone audio only.' : audio?.reason ?? 'Original microphone audio is unavailable or still being analyzed.';
  const audioReady = source === 'mic' && audio?.reliable;
  measures.push({
    id: 'intonation', title: 'Intonation',
    status: audioReady && audio.intonationCents !== null ? 'available' : 'unavailable',
    value: audioReady && audio.intonationCents !== null ? `Median ${Math.round(audio.intonationCents)} cents from edited notes` : 'Unavailable',
    definition: 'For each sustained note, take the median frequency of stable interior audio frames, compare it with the edited equal-tempered note pitch in cents, then report the median absolute note offset. This measures audio-to-transcription alignment, not musical taste.',
    threshold: 'Audio gate: at least 4 notes ≥0.35 beat, 12 stable frames, ≥60% stable frame coverage, median detector confidence ≥0.85, ≤1% clipped frames, voiced RMS ≥0.02, and voiced-to-quiet level ≥3× when a quiet baseline exists. Intonation also needs ≥3 notes with ≥2 matching frames within ±150 cents.',
    sample: audioReady ? `${audio.intonationNotes} matched notes · ${audio.stableFrames}/${audio.noteFrames} stable frames` : saxReason,
    observations: audioReady ? audio.intonationObservations : [],
  });
  measures.push({
    id: 'articulation', title: 'Articulation',
    status: audioReady && audio.articulationStarts >= 3 ? 'available' : 'unavailable',
    value: audioReady && audio.articulationStarts >= 3 ? `${audio.articulationClear} of ${audio.articulationStarts} starts with a level rise` : 'Unavailable',
    definition: 'Compare median microphone RMS in the 0.3–0.06 beats before each note start with 0.02–0.25 beats after it. Count starts where the level rises at least 1.8× and reaches 0.02 RMS. This describes onset contrast, not tongue or breath technique.',
    threshold: 'The same local audio gate as intonation applies. Articulation also needs ≥3 starts with at least 2 audio frames on each side. Missing or noisy audio stays unavailable.',
    sample: audioReady ? `${audio.articulationStarts} assessable starts · ${audio.stableFrames}/${audio.noteFrames} stable frames${audio.articulationStarts < 3 ? ' · need 3 starts' : ''}` : saxReason,
    observations: audioReady ? audio.articulationObservations : [],
  });
  return { measures };
}
