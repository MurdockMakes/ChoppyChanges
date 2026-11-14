import { BPM, type NoteEvent } from './theory.ts';

/** The take ends when its longest-sounding note ends, not at its last onset. */
export function takeEndBeat(notes: readonly NoteEvent[]): number {
  return notes.reduce((end, note) => Math.max(end, note.startBeat + note.durationBeats), 0);
}

/** Schedules recorded notes from an advancing beat clock. */
export class TakeReplay {
  private playing = false;
  private rate = 1;
  private started = new Set<number>();
  private readonly notes: readonly NoteEvent[];
  private readonly playNote: (pitch: number, seconds: number) => void;
  private readonly stopVoices: () => void;

  constructor(
    notes: readonly NoteEvent[],
    playNote: (pitch: number, seconds: number) => void,
    stopVoices: () => void,
  ) {
    this.notes = notes;
    this.playNote = playNote;
    this.stopVoices = stopVoices;
  }

  private playRemaining(index: number, atBeat: number) {
    if (this.started.has(index)) return;
    const note = this.notes[index];
    const remainingBeats = note.startBeat + note.durationBeats - atBeat;
    if (remainingBeats <= 0) return;
    this.started.add(index);
    this.playNote(note.pitch, remainingBeats * (60 / BPM) / this.rate);
  }

  private prime(atBeat: number) {
    this.notes.forEach((note, index) => {
      if (note.startBeat <= atBeat && atBeat < note.startBeat + note.durationBeats) {
        this.playRemaining(index, atBeat);
      }
    });
  }

  start(atBeat: number, rate: number) {
    this.stopVoices();
    this.started.clear();
    this.rate = rate > 0 ? rate : 1;
    this.playing = true;
    this.prime(atBeat);
  }

  advance(previousBeat: number, beat: number) {
    if (!this.playing || beat < previousBeat) return;
    this.notes.forEach((note, index) => {
      if (note.startBeat >= previousBeat && note.startBeat <= beat) {
        this.playRemaining(index, beat);
      }
    });
  }

  pause() {
    this.playing = false;
    this.stopVoices();
    this.started.clear();
  }

  seek(atBeat: number, rate: number) {
    this.stopVoices();
    this.started.clear();
    this.rate = rate > 0 ? rate : 1;
    if (this.playing) this.prime(atBeat);
  }

  stop() {
    this.playing = false;
    this.stopVoices();
    this.started.clear();
  }
}
