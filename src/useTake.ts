import { useCallback, useRef, useState } from 'react';
import { EXAMPLE_TAKE } from './example';
import { TakeNoteCapture } from './takeRecording';
import type { NoteEvent } from './theory';
import type { useTransport } from './useTransport';

type Transport = ReturnType<typeof useTransport>;
export type TakeSource = 'midi' | 'mic' | 'piano' | 'example' | null;
type LiveNoteSource = 'midi' | 'piano';

export function useTake(transport: Transport) {
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [pending, setPending] = useState<NoteEvent[]>([]);
  const [source, setSource] = useState<TakeSource>(null);
  const sourceRef = useRef<TakeSource>(null);
  const captureRef = useRef(new TakeNoteCapture());

  const addCompleted = useCallback((completed: NoteEvent | null) => {
    if (completed) setNotes((previous) => [...previous, completed].sort((a, b) => a.startBeat - b.startBeat));
  }, []);

  const noteOn = useCallback((pitch: number, input: LiveNoteSource = 'midi') => {
    if (transport.modeRef.current !== 'recording' || sourceRef.current !== input) return;
    const atBeat = transport.getBeat();
    addCompleted(captureRef.current.noteOn(pitch, atBeat));
    setPending(captureRef.current.pending());
  }, [addCompleted, transport]);

  const noteOff = useCallback((pitch: number, input: LiveNoteSource = 'midi') => {
    if (transport.modeRef.current !== 'recording' || sourceRef.current !== input) return;
    addCompleted(captureRef.current.noteOff(pitch, transport.getBeat()));
    setPending(captureRef.current.pending());
  }, [addCompleted, transport]);

  const startTake = useCallback(async (fromBeat = 0, rate = 1, input: 'midi' | 'mic' | 'piano' = 'midi', untilBeat: number | null = null, countInBeats = 0) => {
    captureRef.current.reset();
    setNotes([]);
    setPending([]);
    sourceRef.current = input;
    setSource(input);
    await transport.start('recording', fromBeat, rate, untilBeat, countInBeats);
  }, [transport]);

  const appendNotes = useCallback((incoming: NoteEvent[]) => {
    if (incoming.length === 0) return;
    setNotes((previous) => [...previous, ...incoming].sort((a, b) => a.startBeat - b.startBeat));
  }, []);

  const replaceNotes = useCallback((updated: NoteEvent[]) => {
    setNotes(updated.slice().sort((a, b) => a.startBeat - b.startBeat));
  }, []);

  const setPendingNotes = useCallback((updated: NoteEvent[]) => setPending(updated), []);

  const stopTake = useCallback(() => {
    const atBeat = transport.getBeat();
    const completed = captureRef.current.finishAll(atBeat);
    if (completed.length) setNotes((previous) => [...previous, ...completed].sort((a, b) => a.startBeat - b.startBeat));
    setPending([]);
    transport.stop();
  }, [transport]);

  const loadExample = useCallback((example: readonly NoteEvent[] = EXAMPLE_TAKE) => {
    transport.stop();
    transport.seek(0);
    captureRef.current.reset();
    setPending([]);
    setNotes(example.map((note) => ({ ...note })));
    sourceRef.current = 'example';
    setSource('example');
  }, [transport]);

  const clearTake = useCallback(() => {
    transport.stop();
    transport.seek(0);
    captureRef.current.reset();
    setPending([]);
    setNotes([]);
    sourceRef.current = null;
    setSource(null);
  }, [transport]);

  const restoreTake = useCallback((restoredNotes: readonly NoteEvent[], restoredSource: TakeSource) => {
    transport.stop();
    transport.seek(0);
    captureRef.current.reset();
    setPending([]);
    setNotes(restoredNotes.map((note) => ({ ...note })));
    sourceRef.current = restoredSource;
    setSource(restoredSource);
  }, [transport]);

  return { notes, pending, source, noteOn, noteOff, startTake, stopTake, appendNotes, replaceNotes, setPendingNotes, loadExample, clearTake, restoreTake };
}
