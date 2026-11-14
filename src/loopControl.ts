import { BEATS_PER_BAR, type Progression } from './theory.ts';

export type BluesRepeatMode = 'once' | 'count' | 'continuous';

/** Absolute transport beat where a finite blues practice run ends. */
export function bluesEndBeat(progression: Progression, fromBeat: number, mode: BluesRepeatMode, count: number): number | null {
  if (progression.form !== 'blues' || mode === 'continuous') return null;
  const cycleBeats = progression.chords.length * BEATS_PER_BAR;
  const passes = mode === 'once' ? 1 : Math.max(2, Math.min(16, Math.floor(Number.isFinite(count) ? count : 2)));
  const currentCycle = Math.floor(Math.max(0, fromBeat) / cycleBeats);
  return (currentCycle + passes) * cycleBeats;
}
