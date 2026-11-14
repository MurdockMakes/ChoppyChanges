import type { NoteEvent } from './theory';

/** Builds note events from the transport beat at each physical note edge. */
export class TakeNoteCapture {
  private held = new Map<number, NoteEvent>();
  private sequence = 0;

  reset() {
    this.held.clear();
  }

  noteOn(pitch: number, atBeat: number): NoteEvent | null {
    const retriggered = this.noteOff(pitch, atBeat);
    this.held.set(pitch, {
      id: `take-${this.sequence++}`,
      pitch,
      startBeat: atBeat,
      durationBeats: 0,
    });
    return retriggered;
  }

  noteOff(pitch: number, atBeat: number): NoteEvent | null {
    const started = this.held.get(pitch);
    if (!started) return null;
    this.held.delete(pitch);
    return { ...started, durationBeats: Math.max(0.08, atBeat - started.startBeat) };
  }

  finishAll(atBeat: number): NoteEvent[] {
    return [...this.held.keys()]
      .map((pitch) => this.noteOff(pitch, atBeat)!)
      .map((note) => ({ ...note, durationBeats: Math.max(0, atBeat - note.startBeat) }))
      .filter((note) => note.durationBeats > 0)
      .sort((a, b) => a.startBeat - b.startBeat);
  }

  pending() {
    return [...this.held.values()];
  }
}
