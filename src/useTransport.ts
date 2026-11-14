import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from './audio';
import { BEATS_PER_BAR, BPM, chordAtBeat, DEFAULT_PROGRESSION, type Progression } from './theory';
import { countInPulses, transportFrame } from './transportTiming';

export type TransportMode = 'stopped' | 'counting-in' | 'playing' | 'recording' | 'replaying' | 'paused';
type RunningMode = 'playing' | 'recording' | 'replaying';
const MS_PER_BEAT = 60_000 / BPM;

export function useTransport(
  onAdvance?: (previousBeat: number, beat: number, mode: TransportMode, audio: AudioEngine) => void,
  progression: Progression = DEFAULT_PROGRESSION,
  onCountInEnd?: (mode: RunningMode, beat: number) => void,
  onLimit?: (mode: RunningMode, beat: number) => void,
) {
  const [mode, setMode] = useState<TransportMode>('stopped');
  const [beat, setBeat] = useState(0);
  const [countInRemaining, setCountInRemaining] = useState(0);
  const [metronome, setMetronome] = useState(true);
  const [chordCues, setChordCues] = useState(true);
  const [clockVersion, setClockVersion] = useState(0);
  const engineRef = useRef(new AudioEngine());
  const advanceRef = useRef(onAdvance);
  const countInEndCallbackRef = useRef(onCountInEnd);
  const limitCallbackRef = useRef(onLimit);
  const modeRef = useRef<TransportMode>('stopped');
  const targetModeRef = useRef<RunningMode>('playing');
  const countInEndBeatRef = useRef(0);
  const countInBeatsRef = useRef(0);
  const originRef = useRef(0);
  const rateRef = useRef(1);
  const clockVersionRef = useRef(0);
  const startIdRef = useRef(0);
  const audioReadyRef = useRef(true);
  const untilRef = useRef<number | null>(null);
  const beatRef = useRef(0);
  const metronomeRef = useRef(true);
  const cuesRef = useRef(true);
  const progressionRef = useRef(progression);
  advanceRef.current = onAdvance;
  countInEndCallbackRef.current = onCountInEnd;
  limitCallbackRef.current = onLimit;
  metronomeRef.current = metronome;
  cuesRef.current = chordCues;
  progressionRef.current = progression;

  const getBeat = useCallback(() => {
    if (modeRef.current === 'stopped' || modeRef.current === 'paused') return beatRef.current;
    if (!audioReadyRef.current) return beatRef.current;
    const liveBeat = ((performance.now() - originRef.current) / MS_PER_BEAT) * rateRef.current;
    return modeRef.current === 'counting-in' ? liveBeat : Math.min(untilRef.current ?? Infinity, Math.max(0, liveBeat));
  }, []);

  const isAtLimit = useCallback(() => untilRef.current !== null && getBeat() >= untilRef.current, [getBeat]);
  const getLimitBeat = useCallback(() => untilRef.current, []);

  const restartClock = useCallback(() => {
    clockVersionRef.current += 1;
    setClockVersion(clockVersionRef.current);
  }, []);

  const stop = useCallback((atBeat?: number) => {
    const finalBeat = modeRef.current === 'counting-in' ? countInEndBeatRef.current : atBeat ?? getBeat();
    startIdRef.current += 1;
    audioReadyRef.current = true;
    beatRef.current = finalBeat;
    modeRef.current = 'stopped';
    untilRef.current = null;
    setCountInRemaining(0);
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

  const start = useCallback(async (nextMode: RunningMode, fromBeat = 0, rate = 1, untilBeat: number | null = null, countInBeats = 0) => {
    const startId = ++startIdRef.current;
    engineRef.current.stopTimed();
    const audioReady = engineRef.current.resume();
    audioReadyRef.current = false;
    rateRef.current = rate;
    const lead = Math.max(0, Math.floor(countInBeats));
    originRef.current = performance.now() - ((fromBeat - lead) * MS_PER_BEAT) / rate;
    beatRef.current = fromBeat - lead;
    countInEndBeatRef.current = fromBeat;
    countInBeatsRef.current = lead;
    targetModeRef.current = nextMode;
    untilRef.current = untilBeat;
    modeRef.current = lead > 0 ? 'counting-in' : nextMode;
    restartClock();
    setBeat(fromBeat);
    setCountInRemaining(lead);
    setMode(modeRef.current);
    try {
      await audioReady;
      if (startId !== startIdRef.current) return;
      // The four clicks start from a fresh origin after the output is audible.
      originRef.current = performance.now() - ((fromBeat - lead) * MS_PER_BEAT) / rate;
      audioReadyRef.current = true;
      restartClock();
    } catch {
      if (startId === startIdRef.current) stop();
    }
  }, [restartClock, stop]);

  useEffect(() => {
    if (mode === 'stopped' || mode === 'paused' || !audioReadyRef.current) return;
    let frame = 0;
    const version = clockVersionRef.current;
    let previousBeat = beatRef.current;
    let nextPulse = Math.ceil(previousBeat);
    const tick = () => {
      if (modeRef.current !== mode || version !== clockVersionRef.current) return;
      const nowBeat = getBeat();
      const currentFrame = transportFrame(mode, nowBeat, countInEndBeatRef.current, untilRef.current);
      if (currentFrame.phase === 'count-in' || currentFrame.phase === 'start') {
        const startBeat = countInEndBeatRef.current;
        for (const pulse of countInPulses(nextPulse, nowBeat, startBeat)) {
          engineRef.current.click(pulse === startBeat - countInBeatsRef.current);
          nextPulse = pulse + 1;
        }
        if (currentFrame.phase === 'start') {
          const targetMode = targetModeRef.current;
          beatRef.current = startBeat;
          modeRef.current = targetMode;
          restartClock();
          setBeat(startBeat);
          setCountInRemaining(0);
          setMode(targetMode);
          countInEndCallbackRef.current?.(targetMode, startBeat);
          return;
        }
        setCountInRemaining(Math.ceil(startBeat - nowBeat));
        frame = requestAnimationFrame(tick);
        return;
      }
      if (currentFrame.phase === 'limit') {
        advanceRef.current?.(previousBeat, currentFrame.beat, mode, engineRef.current);
        beatRef.current = currentFrame.beat;
        stop(currentFrame.beat);
        limitCallbackRef.current?.(mode as RunningMode, currentFrame.beat);
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
    mode, modeRef, beat, beatRef, countInRemaining, getBeat, getLimitBeat, isAtLimit, start, stop, seek, pauseReplay, resumeReplay, changeReplayRate,
    metronome, setMetronome, chordCues, setChordCues,
    playNote: (pitch: number, seconds: number) => engineRef.current.playNote(pitch, seconds),
    prepareAudio: () => engineRef.current.resume(),
    pianoNoteOn: (pitch: number) => {
      void engineRef.current.resume();
      engineRef.current.noteOn(pitch);
    },
    pianoNoteOff: (pitch: number) => engineRef.current.noteOff(pitch),
    stopTimed: () => engineRef.current.stopTimed(),
  };
}
