import { useCallback, useEffect, useRef, useState } from 'react';
import { detectPitch } from './pitchDetection';
import { SaxPitchTracker } from './sax';

export interface MicFrame {
  pitch: number | null;
  frequencyHz: number | null;
  confidence: number;
  rms: number;
  windowSeconds: number;
}

export interface MicrophoneState extends MicFrame {
  supported: boolean;
  active: boolean;
  requesting: boolean;
  status: string;
}

const MIC_UNAVAILABLE = 'Microphone input is unavailable. Open this app on localhost or HTTPS in a browser with microphone access.';
const MIC_READY = 'Ready for a single-note sax phrase. Use headphones so the chord cues stay out of the microphone.';

/** Opens a microphone only for a take; raw audio never leaves the browser. */
export function useMicrophone(onFrame: (frame: MicFrame) => void, onEnded?: () => void) {
  const callbackRef = useRef(onFrame);
  const endedRef = useRef(onEnded);
  callbackRef.current = onFrame;
  endedRef.current = onEnded;
  const tokenRef = useRef(0);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const frameRef = useRef(0);
  const activeRef = useRef(false);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const captureRef = useRef<Promise<Blob | null> | null>(null);
  const supported = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && typeof AudioContext !== 'undefined';
  const [state, setState] = useState<MicrophoneState>({
    supported, active: false, requesting: false, status: supported ? MIC_READY : MIC_UNAVAILABLE,
    pitch: null, frequencyHz: null, confidence: 0, rms: 0, windowSeconds: 0,
  });

  const finishCapture = useCallback((): Promise<Blob | null> => {
    const recorder = recorderRef.current;
    if (recorder?.state === 'recording') recorder.stop();
    return captureRef.current ?? Promise.resolve(null);
  }, []);

  const startCapture = useCallback((): boolean => {
    const stream = streamRef.current;
    if (!stream || typeof MediaRecorder === 'undefined') return false;
    try {
      const recorder = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      captureRef.current = new Promise((resolve) => {
        recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
        recorder.onerror = () => resolve(null);
        recorder.onstop = () => resolve(chunks.length ? new Blob(chunks, { type: recorder.mimeType || chunks[0].type }) : null);
      });
      recorderRef.current = recorder;
      recorder.start();
      return true;
    } catch {
      recorderRef.current = null;
      captureRef.current = null;
      return false;
    }
  }, []);

  const stop = useCallback((message = supported ? MIC_READY : MIC_UNAVAILABLE) => {
    tokenRef.current += 1;
    activeRef.current = false;
    void finishCapture();
    cancelAnimationFrame(frameRef.current);
    frameRef.current = 0;
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    sourceRef.current = null;
    analyserRef.current = null;
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    streamRef.current = null;
    if (contextRef.current) void contextRef.current.close();
    contextRef.current = null;
    setState((previous) => ({ ...previous, active: false, requesting: false, pitch: null, frequencyHz: null, confidence: 0, rms: 0, status: message }));
  }, [finishCapture, supported]);

  const start = useCallback(async (): Promise<boolean> => {
    if (!supported) {
      setState((previous) => ({ ...previous, status: MIC_UNAVAILABLE }));
      return false;
    }
    if (activeRef.current) return true;
    const token = ++tokenRef.current;
    setState((previous) => ({ ...previous, requesting: true, status: 'Requesting microphone permission…' }));
    let stream: MediaStream | null = null;
    let context: AudioContext | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: false,
      });
      if (token !== tokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      context = new AudioContext();
      await context.resume();
      if (token !== tokenRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        void context.close();
        return false;
      }
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 8192;
      analyser.smoothingTimeConstant = 0;
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      streamRef.current = stream;
      contextRef.current = context;
      sourceRef.current = source;
      analyserRef.current = analyser;
      activeRef.current = true;
      setState((previous) => ({ ...previous, active: true, requesting: false, status: 'Microphone listening. Play one note at a time in concert pitch.' }));

      let lastSampleMs = -Infinity;
      let lastUiMs = -Infinity;
      let lastPitch: number | null = null;
      const tracker = new SaxPitchTracker();
      const poll = (timeMs: number) => {
        if (token !== tokenRef.current || !activeRef.current) return;
        if (timeMs - lastSampleMs >= 34) {
          lastSampleMs = timeMs;
          analyser.getFloatTimeDomainData(samples);
          let power = 0;
          for (const sample of samples) power += sample * sample;
          const rms = Math.sqrt(power / samples.length);
          const estimate = detectPitch(samples, context!.sampleRate);
          const estimatedPitch = estimate ? Math.max(0, Math.min(127, Math.round(69 + 12 * Math.log2(estimate.frequencyHz / 440)))) : null;
          const pitch = tracker.observe(estimatedPitch);
          const frame: MicFrame = {
            pitch,
            frequencyHz: estimate?.frequencyHz ?? null,
            confidence: estimate?.confidence ?? 0,
            rms,
            windowSeconds: samples.length / context!.sampleRate,
          };
          callbackRef.current(frame);
          if (pitch !== lastPitch || timeMs - lastUiMs >= 130) {
            lastPitch = pitch;
            lastUiMs = timeMs;
            setState((previous) => ({ ...previous, ...frame }));
          }
        }
        frameRef.current = requestAnimationFrame(poll);
      };
      frameRef.current = requestAnimationFrame(poll);

      for (const track of stream.getAudioTracks()) {
        track.onended = () => {
          if (token !== tokenRef.current) return;
          stop('Microphone disconnected. Reconnect it and start another take.');
          endedRef.current?.();
        };
      }
      return true;
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      if (context) void context.close();
      const name = error instanceof DOMException ? error.name : '';
      const message = name === 'NotAllowedError' || name === 'PermissionDeniedError'
        ? 'Microphone access was denied. Allow it in your browser to record sax, or use the example take.'
        : name === 'NotFoundError'
          ? 'No microphone was found. Connect one and try again.'
          : 'Microphone could not start. Check the input device and browser permission.';
      setState((previous) => ({ ...previous, requesting: false, active: false, status: message }));
      return false;
    }
  }, [stop, supported]);

  useEffect(() => () => {
    tokenRef.current += 1;
    void finishCapture();
    cancelAnimationFrame(frameRef.current);
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    for (const track of streamRef.current?.getTracks() ?? []) {
      track.onended = null;
      track.stop();
    }
    if (contextRef.current) void contextRef.current.close();
  }, [finishCapture]);

  return { ...state, start, stop, startCapture, finishCapture };
}
