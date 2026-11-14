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

/** Replays the microphone recording while the transport drives the visual playhead. */
export class RecordedAudioReplay {
  private playing = false;
  private disposed = false;
  private readonly audio: HTMLAudioElement;
  private readonly recordedFromBeat: number;
  private readonly recordedRate: number;
  private readonly release: () => void;
  private readonly onPlaybackError?: (error: unknown) => void;

  constructor(
    audio: HTMLAudioElement,
    recordedFromBeat: number,
    recordedRate: number,
    release: () => void,
    onPlaybackError?: (error: unknown) => void,
  ) {
    this.audio = audio;
    this.recordedFromBeat = recordedFromBeat;
    this.recordedRate = recordedRate;
    this.release = release;
    this.onPlaybackError = onPlaybackError;
    this.audio.preload = 'auto';
    this.audio.preservesPitch = true;
  }

  private sync(beat: number, rate: number) {
    this.audio.playbackRate = rate / this.recordedRate;
    this.audio.currentTime = Math.max(0, (beat - this.recordedFromBeat) * (60 / BPM) / this.recordedRate);
    if (this.playing) {
      this.audio.muted = beat < this.recordedFromBeat;
      try {
        void this.audio.play().catch((error: unknown) => {
          if (this.playing && !this.disposed) this.onPlaybackError?.(error);
        });
      } catch (error) {
        if (this.playing && !this.disposed) this.onPlaybackError?.(error);
      }
    } else this.audio.pause();
  }

  start(beat: number, rate: number) {
    this.playing = true;
    this.sync(beat, rate);
  }

  advance(previousBeat: number, beat: number) {
    if (this.playing && previousBeat < this.recordedFromBeat && beat >= this.recordedFromBeat) {
      this.sync(beat, this.audio.playbackRate * this.recordedRate);
    }
  }

  pause() {
    this.playing = false;
    this.audio.pause();
  }

  seek(beat: number, rate: number) { this.sync(beat, rate); }

  stop() {
    this.playing = false;
    this.audio.pause();
    if (!this.disposed) {
      this.disposed = true;
      this.release();
    }
  }
}
