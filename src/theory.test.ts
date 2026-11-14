import assert from "node:assert/strict";
import test from "node:test";
import { analyzeTake, chordAtBeat, CIRCLE_KEYS, PROGRESSIONS, spellNote, spellNoteWithOctave, type NoteEvent } from "./theory.ts";

function pair(fromPitch: number, fromBeat: number, toPitch: number, toBeat: number): NoteEvent[] {
  return [
    { id: "from", pitch: fromPitch, startBeat: fromBeat, durationBeats: 0.4 },
    { id: "to", pitch: toPitch, startBeat: toBeat, durationBeats: 0.4 },
  ];
}

test("C on Dm7 resolves to B, the third of G7", () => {
  const result = analyzeTake(pair(60, 3.5, 59, 4));
  assert.equal(result[0].kind, "guide-tone");
  assert.match(result[0].explanation, /C on Dm7 at bar 1, beat 4\.5/);
  assert.match(result[0].explanation, /B on G7 at bar 2, beat 1/);
  assert.equal(result[0].to?.id, "to");
});

test("F on G7 resolves to E, the third of Cmaj7", () => {
  const result = analyzeTake(pair(65, 7.5, 64, 8));
  assert.equal(result[0].kind, "guide-tone");
  assert.match(result[0].explanation, /F on G7 at bar 2, beat 4\.5/);
  assert.match(result[0].explanation, /E on Cmaj7 at bar 3, beat 1/);
});

test("G7 flat nine is spelled A-flat and resolves to its root", () => {
  const result = analyzeTake(pair(68, 5, 67, 5.75));
  assert.equal(result[0].kind, "flat-nine");
  assert.match(result[0].explanation, /A♭ on G7 at bar 2, beat 2/);
  assert.match(result[0].explanation, /G on G7 at bar 2, beat 2\.75/);
  assert.doesNotMatch(result[0].explanation, /G♯/);
});

test("other semitone approaches into chord tones are detected", () => {
  const result = analyzeTake(pair(66, 9, 67, 9.75));
  assert.equal(result[0].kind, "chromatic");
  assert.match(result[0].explanation, /F♯ on Cmaj7 at bar 3, beat 2/);
  assert.match(result[0].explanation, /G on Cmaj7 at bar 3, beat 2\.75/);
});

test("an ambiguous G7 tension gets neutral feedback", () => {
  const result = analyzeTake(pair(68, 5, 70, 5.5));
  assert.equal(result[0].kind, "none");
  assert.match(result[0].explanation, /A♭ on G7 at bar 2, beat 2/);
  assert.match(result[0].explanation, /B♭ on G7 at bar 2, beat 2\.5/);
  assert.match(result[0].explanation, /No nearby resolution detected/);
  assert.doesNotMatch(result[0].explanation, /wrong|correctness/i);
});

test("F major ii–V–I carries guide-tone evidence into each new chord", () => {
  const progression = PROGRESSIONS.find((item) => item.id === "ii-v-i-f")!;
  assert.equal(chordAtBeat(0, progression).name, "Gm7");
  assert.equal(chordAtBeat(4, progression).name, "C7");
  assert.equal(chordAtBeat(8, progression).name, "Fmaj7");
  assert.equal(chordAtBeat(16, progression).name, "Gm7");

  const first = analyzeTake(pair(65, 3.5, 64, 4), progression);
  assert.equal(first[0].kind, "guide-tone");
  assert.match(first[0].explanation, /F on Gm7.*E on C7/);
  const second = analyzeTake(pair(70, 7.5, 69, 8), progression);
  assert.equal(second[0].kind, "guide-tone");
  assert.match(second[0].explanation, /B♭ on C7.*A on Fmaj7/);
});

test("C7 flat nine is spelled D-flat and resolves to its root", () => {
  const progression = PROGRESSIONS.find((item) => item.id === "ii-v-i-f")!;
  const result = analyzeTake(pair(73, 5, 72, 5.7), progression);
  assert.equal(result[0].kind, "flat-nine");
  assert.match(result[0].explanation, /D♭ on C7.*C on C7/);
  assert.doesNotMatch(result[0].explanation, /C♯/);
});

test("turnaround supports whole-tone guide tones and A7 flat nine", () => {
  const progression = PROGRESSIONS.find((item) => item.id === "turnaround-c")!;
  const first = analyzeTake(pair(71, 3.5, 73, 4), progression);
  assert.equal(first[0].kind, "guide-tone");
  assert.match(first[0].explanation, /B on Cmaj7.*C♯ on A7/);
  const second = analyzeTake(pair(67, 7.5, 65, 8), progression);
  assert.equal(second[0].kind, "guide-tone");
  assert.match(second[0].explanation, /G on A7.*F on Dm7/);
  const flatNine = analyzeTake(pair(70, 5, 69, 5.7), progression);
  assert.equal(flatNine[0].kind, "flat-nine");
  assert.match(flatNine[0].explanation, /B♭ on A7.*A on A7/);
  assert.equal(spellNote(63, chordAtBeat(5, progression)), "D♯");
});

test("circle of fifths offers ii–V–I and 12-bar blues in all twelve keys", () => {
  const expected: Array<[string, string, string, string, string, string]> = [
    ["c", "Dm7", "G7", "Cmaj7", "F7", "G7"],
    ["g", "Am7", "D7", "Gmaj7", "C7", "D7"],
    ["d", "Em7", "A7", "Dmaj7", "G7", "A7"],
    ["a", "Bm7", "E7", "Amaj7", "D7", "E7"],
    ["e", "F♯m7", "B7", "Emaj7", "A7", "B7"],
    ["b", "C♯m7", "F♯7", "Bmaj7", "E7", "F♯7"],
    ["f-sharp", "G♯m7", "C♯7", "F♯maj7", "B7", "C♯7"],
    ["d-flat", "E♭m7", "A♭7", "D♭maj7", "G♭7", "A♭7"],
    ["a-flat", "B♭m7", "E♭7", "A♭maj7", "D♭7", "E♭7"],
    ["e-flat", "Fm7", "B♭7", "E♭maj7", "A♭7", "B♭7"],
    ["b-flat", "Cm7", "F7", "B♭maj7", "E♭7", "F7"],
    ["f", "Gm7", "C7", "Fmaj7", "B♭7", "C7"],
  ];
  assert.deepEqual(CIRCLE_KEYS.map((key) => key.id), expected.map(([id]) => id));
  assert.equal(PROGRESSIONS.length, 25); // 12 keys × 2 forms plus the preserved turnaround
  for (const [id, ii, v, tonic, iv7, v7] of expected) {
    const iiVi = PROGRESSIONS.find((item) => item.id === `ii-v-i-${id}`)!;
    const blues = PROGRESSIONS.find((item) => item.id === `blues-${id}`)!;
    assert.equal(iiVi.form, "ii-v-i");
    assert.equal(blues.form, "blues");
    assert.deepEqual(iiVi.chords.map((chord) => chord.name), [ii, v, tonic, tonic]);
    assert.deepEqual(blues.chords.map((chord) => chord.name), [
      `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`, `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`,
      `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`, `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`,
      iv7, iv7, `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`, `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`,
      v7, iv7, `${CIRCLE_KEYS.find((key) => key.id === id)!.label}7`, v7,
    ]);
  }
});

test("12-bar blues loops and resolves guide tones across bar changes", () => {
  const blues = PROGRESSIONS.find((item) => item.id === "blues-c")!;
  assert.equal(chordAtBeat(0, blues).name, "C7");
  assert.equal(chordAtBeat(4, blues).name, "C7");
  assert.equal(chordAtBeat(12, blues).name, "C7");
  assert.equal(chordAtBeat(16, blues).name, "F7");
  assert.equal(chordAtBeat(32, blues).name, "G7");
  assert.equal(chordAtBeat(44, blues).name, "G7");
  assert.equal(chordAtBeat(48, blues).name, "C7");
  const ivMove = analyzeTake(pair(70, 15.5, 69, 16), blues);
  assert.equal(ivMove[0].kind, "guide-tone");
  assert.match(ivMove[0].explanation, /B♭ on C7.*A on F7/);
  const vMove = analyzeTake(pair(70, 31.5, 71, 32), blues);
  assert.equal(vMove[0].kind, "guide-tone");
  assert.match(vMove[0].explanation, /B♭ on C7.*B on G7/);
});

test("sharp and flat keys keep their chord-tone spellings and octave labels", () => {
  const sharp = PROGRESSIONS.find((item) => item.id === "ii-v-i-f-sharp")!;
  const tonic = chordAtBeat(8, sharp);
  assert.equal(spellNote(65, tonic), "E♯");
  assert.equal(spellNoteWithOctave(65, tonic), "E♯4");
  assert.equal(spellNoteWithOctave(72, tonic), "B♯4");
  const flat = PROGRESSIONS.find((item) => item.id === "ii-v-i-d-flat")!;
  assert.equal(spellNote(61, chordAtBeat(8, flat)), "D♭");
  const aFlatBlues = PROGRESSIONS.find((item) => item.id === "blues-a-flat")!;
  const b9 = analyzeTake(pair(69, 1, 68, 1.6), aFlatBlues);
  assert.equal(b9[0].kind, "flat-nine");
  assert.match(b9[0].explanation, /B♭♭ on A♭7.*A♭ on A♭7/);
});
