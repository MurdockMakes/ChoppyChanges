/** Decisions for one frame of the existing transport clock. */
export function transportFrame(
  mode: 'counting-in' | 'playing' | 'recording' | 'replaying',
  liveBeat: number,
  countInEndBeat: number,
  untilBeat: number | null,
): { phase: 'count-in' | 'start' | 'run' | 'limit'; beat: number } {
  if (mode === 'counting-in') {
    return liveBeat >= countInEndBeat
      ? { phase: 'start', beat: countInEndBeat }
      : { phase: 'count-in', beat: liveBeat };
  }
  return untilBeat !== null && liveBeat >= untilBeat
    ? { phase: 'limit', beat: untilBeat }
    : { phase: 'run', beat: liveBeat };
}

/** Integer count-in beats due by this frame, including the first accented click. */
export function countInPulses(nextPulse: number, liveBeat: number, countInEndBeat: number): number[] {
  const pulses: number[] = [];
  for (let pulse = nextPulse; pulse < countInEndBeat && pulse <= liveBeat; pulse += 1) pulses.push(pulse);
  return pulses;
}
