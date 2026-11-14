import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio';
import { BEATS_PER_BAR, BPM, chordAtBeat, DEFAULT_PROGRESSION, type Progression } from './theory';

export type TransportMode = 'stopped' | 'playing' | 'recording' | 'replaying' | 'paused';
const MS_PER_BEAT = 60_000 / BPM;

export function useTransport(onAdvance?: (previousBeat: number, beat: number, mode: TransportMode, audio: AudioEngine) => void, progression: Progression = DEFAULT_PROGRESSION) {
  const [mode, setMode] = useState<TransportMode>('stopped');
  const [beat, setBeat] = useState(0);
  const [metronome, setMetronome] = useState(true);
  const [chordCues, setChordCues] = useState(true);
  const [clockVersion, setClockVersion] = useState(0);
  const engineRef = useRef(new AudioEngine());
  const advanceRef = useRef(onAdvance);
  const modeRef = useRef<TransportMode>('stopped');
  const originRef = useRef(0);
  const rateRef = useRef(1);
  const clockVersionRef = useRef(0);
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
    if (modeRef.current === 'stopped' || modeRef.current === 'paused') return beatRef.current;
    return Math.max(0, ((performance.now() - originRef.current) / MS_PER_BEAT) * rateRef.current);
  }, []);

  const restartClock = useCallback(() => {
    clockVersionRef.current += 1;
    setClockVersion(clockVersionRef.current);
  }, []);

  const stop = useCallback((atBeat?: number) => {
    beatRef.current = atBeat ?? getBeat();
    modeRef.current = 'stopped';
    untilRef.current = null;
    restartClock();
    setBeat(beatRef.current);
    setMode('stopped');
    engineRef.current.stopTimed();
  }, [getBeat, restartClock]);

  const seek = useCallback((toBeat: number) => {
    if (!['stopped', 'paused', 'replaying'].includes(modeRef.current)) return;
    if (modeRef.current === 'replaying') {
      engineRef.current.stopTimed();
      originRef.current = performance.now() - (Math.max(0, toBeat) * MS_PER_BEAT) / rateRef.current;
      restartClock();
    }
    beatRef.current = Math.max(0, toBeat);
    setBeat(beatRef.current);
  }, [restartClock]);

  const pauseReplay = useCallback(() => {
    if (modeRef.current !== 'replaying') return;
    beatRef.current = getBeat();
    modeRef.current = 'paused';
    restartClock();
    setBeat(beatRef.current);
    setMode('paused');
    engineRef.current.stopTimed();
  }, [getBeat, restartClock]);

  const resumeReplay = useCallback(async () => {
    if (modeRef.current !== 'paused') return;
    const audioReady = engineRef.current.resume();
    originRef.current = performance.now() - (beatRef.current * MS_PER_BEAT) / rateRef.current;
    modeRef.current = 'replaying';
    restartClock();
    setMode('replaying');
    await audioReady;
  }, [restartClock]);

  const changeReplayRate = useCallback((rate: number) => {
    if (rate <= 0 || !Number.isFinite(rate)) return;
    if (modeRef.current === 'replaying') {
      beatRef.current = getBeat();
      engineRef.current.stopTimed();
    }
    rateRef.current = rate;
    if (modeRef.current === 'replaying') {
      originRef.current = performance.now() - (beatRef.current * MS_PER_BEAT) / rate;
      setBeat(beatRef.current);
      restartClock();
    }
  }, [getBeat, restartClock]);

  const start = useCallback(async (nextMode: Exclude<TransportMode, 'stopped'>, fromBeat = 0, rate = 1, untilBeat: number | null = null) => {
    engineRef.current.stopTimed();
    const audioReady = engineRef.current.resume();
    rateRef.current = rate;
    originRef.current = performance.now() - (fromBeat * MS_PER_BEAT) / rate;
    beatRef.current = fromBeat;
    untilRef.current = untilBeat;
    modeRef.current = nextMode;
    restartClock();
    setBeat(fromBeat);
    setMode(nextMode);
    await audioReady;
  }, [restartClock]);

  useEffect(() => {
    if (mode === 'stopped' || mode === 'paused') return;
    let frame = 0;
    const version = clockVersionRef.current;
    let previousBeat = beatRef.current;
    let nextPulse = Math.ceil(previousBeat);
    const tick = () => {
      if (modeRef.current !== mode || version !== clockVersionRef.current) return;
      const nowBeat = getBeat();
      const until = untilRef.current;
      if (until !== null && nowBeat >= until) {
        advanceRef.current?.(previousBeat, until, mode, engineRef.current);
        beatRef.current = until;
        stop(until);
        return;
      }
      for (; nextPulse <= Math.floor(nowBeat); nextPulse += 1) {
        const beatInBar = nextPulse % BEATS_PER_BAR;
        if (metronomeRef.current) engineRef.current.click(beatInBar === 0);
        if (cuesRef.current && (beatInBar === 0 || beatInBar === 2)) engineRef.current.chordCue(chordAtBeat(nextPulse, progressionRef.current));
      }
      advanceRef.current?.(previousBeat, nowBeat, mode, engineRef.current);
      previousBeat = nowBeat;
      beatRef.current = nowBeat;
      setBeat(nowBeat);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [clockVersion, getBeat, mode, stop]);

  useEffect(() => {
    const engine = engineRef.current;
    return () => engine.stopAll();
  }, []);

  return {
    mode, modeRef, beat, beatRef, getBeat, start, stop, seek, pauseReplay, resumeReplay, changeReplayRate,
    metronome, setMetronome, chordCues, setChordCues,
    playNote: (pitch: number, seconds: number) => engineRef.current.playNote(pitch, seconds),
    pianoNoteOn: (pitch: number) => {
      void engineRef.current.resume();
      engineRef.current.noteOn(pitch);
    },
    pianoNoteOff: (pitch: number) => engineRef.current.noteOff(pitch),
    stopTimed: () => engineRef.current.stopTimed(),
  };
}
