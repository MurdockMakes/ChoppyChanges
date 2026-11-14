import { BEATS_PER_BAR, type Progression } from './theory.ts';

export const MAX_PASSES = 16;

export function normalizePassCount(value: number): number {
  return Number.isFinite(value) ? Math.max(1, Math.min(MAX_PASSES, Math.floor(value))) : 1;
}

/** Begin a coached retry on a bar line, with at least one beat before the target. */
export function practiceRunStartBeat(passageStartBeat: number): number {
  return Math.floor(Math.max(0, passageStartBeat - 1) / BEATS_PER_BAR) * BEATS_PER_BAR;
}

/** Absolute transport beat after a complete traversal for each selected pass. */
export function progressionEndBeat(progression: Progression, fromBeat: number, passes: number): number {
  return Math.max(0, fromBeat) + progression.chords.length * BEATS_PER_BAR * normalizePassCount(passes);
}

export function passAtBeat(progression: Progression, fromBeat: number, beat: number, passes: number): number {
  const cycleBeats = progression.chords.length * BEATS_PER_BAR;
  return Math.min(normalizePassCount(passes), Math.floor(Math.max(0, beat - fromBeat) / cycleBeats) + 1);
}
