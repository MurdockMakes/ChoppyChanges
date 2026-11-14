import type { NoteEvent } from './theory';

export interface MicNoteSegmenterOptions {
  /** Stable pitch needed before a new note starts. */
  onsetBeats?: number;
  /** Stable new pitch needed before the current note changes. */
  transitionBeats?: number;
  /** Silence shorter than this is treated as a detector dropout. */
  dropoutBeats?: number;
  /** Ignore shorter events caused by a noisy attack. */
  minDurationBeats?: number;
  idPrefix?: string;
}

type Candidate = { pitch: number; startBeat: number };

/** Converts frame-level monophonic pitch estimates into editable MIDI-style notes. */
export class MicNoteSegmenter {
  private readonly onsetBeats: number;
  private readonly transitionBeats: number;
  private readonly dropoutBeats: number;
  private readonly minDurationBeats: number;
  private readonly idPrefix: string;
  private active: NoteEvent | null = null;
  private candidate: Candidate | null = null;
  private silenceStart: number | null = null;
  private lastBeat = -1;
  private sequence = 0;

  constructor(options: MicNoteSegmenterOptions = {}) {
    this.onsetBeats = options.onsetBeats ?? 0.1;
    this.transitionBeats = options.transitionBeats ?? 0.09;
    this.dropoutBeats = options.dropoutBeats ?? 0.16;
    this.minDurationBeats = options.minDurationBeats ?? 0.11;
    this.idPrefix = options.idPrefix ?? 'mic';
  }

  /** Confirmed note, with its duration extended to the most recent frame. */
  get currentNote(): NoteEvent | null {
    if (!this.active) return null;
    return { ...this.active, durationBeats: Math.max(0, this.lastBeat - this.active.startBeat) };
  }

  get activePitch(): number | null {
    return this.active?.pitch ?? null;
  }

  /** Includes the short provisional onset so a live guide can respond promptly. */
  get observedPitch(): number | null {
    return this.candidate?.pitch ?? this.active?.pitch ?? null;
  }

  private begin(pitch: number, startBeat: number) {
    this.active = { id: `${this.idPrefix}-${this.sequence++}`, pitch, startBeat, durationBeats: 0 };
  }

  private finish(endBeat: number): NoteEvent[] {
    const active = this.active;
    this.active = null;
    this.silenceStart = null;
    if (!active) return [];
    const durationBeats = Math.max(0, endBeat - active.startBeat);
    return durationBeats >= this.minDurationBeats ? [{ ...active, durationBeats }] : [];
  }

  /** Returns notes completed by this frame. `beat` is absolute transport position. */
  observe(pitch: number | null, beat: number): NoteEvent[] {
    if (!Number.isFinite(beat) || beat < 0 || beat < this.lastBeat) return [];
    this.lastBeat = beat;
    const normalized = pitch !== null && Number.isFinite(pitch) && pitch >= 0 && pitch <= 127
      ? Math.round(pitch)
      : null;

    if (normalized === null) {
      this.candidate = null;
      if (this.active) {
        if (this.silenceStart === null) this.silenceStart = beat;
        else if (beat - this.silenceStart >= this.dropoutBeats) return this.finish(this.silenceStart);
      }
      return [];
    }

    this.silenceStart = null;
    if (this.active?.pitch === normalized) {
      this.candidate = null;
      return [];
    }

    if (this.candidate?.pitch !== normalized) {
      this.candidate = { pitch: normalized, startBeat: beat };
      return [];
    }

    const requiredBeats = this.active ? this.transitionBeats : this.onsetBeats;
    if (beat - this.candidate.startBeat < requiredBeats) return [];
    const started = this.candidate;
    this.candidate = null;
    const completed = this.active ? this.finish(started.startBeat) : [];
    this.begin(started.pitch, started.startBeat);
    return completed;
  }

  /** Finishes a held note when recording stops. */
  finalize(beat: number): NoteEvent[] {
    const endBeat = Number.isFinite(beat) ? Math.max(this.lastBeat, beat) : this.lastBeat;
    const completed = this.finish(this.silenceStart ?? endBeat);
    this.candidate = null;
    return completed;
  }

  reset() {
    this.active = null;
    this.candidate = null;
    this.silenceStart = null;
    this.lastBeat = -1;
    this.sequence = 0;
  }
}
