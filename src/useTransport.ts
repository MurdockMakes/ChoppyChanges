import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio';
import { BEATS_PER_BAR, BPM, chordAtBeat, DEFAULT_PROGRESSION, type Progression } from './theory';

export type TransportMode = 'stopped' | 'playing' | 'recording' | 'replaying';
const MS_PER_BEAT = 60_000 / BPM;

export function useTransport(onAdvance?: (previousBeat: number, beat: number, mode: TransportMode, audio: AudioEngine) => void, progression: Progression = DEFAULT_PROGRESSION) {
  const [mode, setMode] = useState<TransportMode>('stopped');
  const [beat, setBeat] = useState(0);
  const [metronome, setMetronome] = useState(true);
  const [chordCues, setChordCues] = useState(true);
  const engineRef = useRef(new AudioEngine());
  const advanceRef = useRef(onAdvance);
  const modeRef = useRef<TransportMode>('stopped');
  const originRef = useRef(0);
  const rateRef = useRef(1);
  const untilRef = useRef<number | null>(null);
  const beatRef = useRef(0);
  const metronomeRef = useRef(true);
  const cuesRef = useRef(true);
  const progressionRef = useRef(progression);
  advanceRef.current = onAdvance;
  metronomeRef.current = metronome;
  cuesRef.current = chordCues;
  progressionRef.current = progression;

  const getBeat = useCallback(() => {
    if (modeRef.current === 'stopped') return beatRef.current;
    return Math.max(0, ((performance.now() - originRef.current) / MS_PER_BEAT) * rateRef.current);
  }, []);

  const stop = useCallback((atBeat?: number) => {
    beatRef.current = atBeat ?? getBeat();
    modeRef.current = 'stopped';
    untilRef.current = null;
    setBeat(beatRef.current);
    setMode('stopped');
    engineRef.current.stopAll();
  }, [getBeat]);

  const seek = useCallback((toBeat: number) => {
    if (modeRef.current !== 'stopped') return;
    beatRef.current = Math.max(0, toBeat);
    setBeat(beatRef.current);
  }, []);

  const start = useCallback(async (nextMode: Exclude<TransportMode, 'stopped'>, fromBeat = 0, rate = 1, untilBeat: number | null = null) => {
    engineRef.current.stopAll();
    const audioReady = engineRef.current.resume();
    rateRef.current = rate;
    originRef.current = performance.now() - (fromBeat * MS_PER_BEAT) / rate;
    beatRef.current = fromBeat;
    untilRef.current = untilBeat;
    modeRef.current = nextMode;
    setBeat(fromBeat);
    setMode(nextMode);
    await audioReady;
  }, []);

  useEffect(() => {
    if (mode === 'stopped') return;
    let frame = 0;
    let previousBeat = beatRef.current;
    let nextPulse = Math.ceil(previousBeat);
    const tick = () => {
      if (modeRef.current === 'stopped') return;
      const nowBeat = getBeat();
      const until = untilRef.current;
      if (until !== null && nowBeat >= until) {
        advanceRef.current?.(previousBeat, until, mode, engineRef.current);
        beatRef.current = until;
        stop(until);
        return;
      }
      for (; nextPulse <= Math.floor(nowBeat); nextPulse += 1) {
        if (metronomeRef.current) engineRef.current.click(nextPulse % BEATS_PER_BAR === 0);
        if (cuesRef.current && nextPulse % BEATS_PER_BAR === 0) engineRef.current.chordCue(chordAtBeat(nextPulse, progressionRef.current));
      }
      advanceRef.current?.(previousBeat, nowBeat, mode, engineRef.current);
      previousBeat = nowBeat;
      beatRef.current = nowBeat;
      setBeat(nowBeat);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getBeat, mode, stop]);

  return {
    mode, modeRef, beat, beatRef, getBeat, start, stop, seek,
    metronome, setMetronome, chordCues, setChordCues,
    playNote: (pitch: number, seconds: number) => engineRef.current.playNote(pitch, seconds),
  };
}
