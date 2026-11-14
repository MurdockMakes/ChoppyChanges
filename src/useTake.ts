import { useCallback, useRef, useState } from 'react';
import { EXAMPLE_TAKE } from './example';
import type { NoteEvent } from './theory';
import type { useTransport } from './useTransport';

type Transport = ReturnType<typeof useTransport>;
export type TakeSource = 'midi' | 'mic' | 'example' | null;

export function useTake(transport: Transport) {
  const [notes, setNotes] = useState<NoteEvent[]>([]);
  const [pending, setPending] = useState<NoteEvent[]>([]);
  const [source, setSource] = useState<TakeSource>(null);
  const sourceRef = useRef<TakeSource>(null);
  const heldRef = useRef(new Map<number, NoteEvent>());
  const sequenceRef = useRef(0);

  const finishNote = useCallback((pitch: number, atBeat: number) => {
    const started = heldRef.current.get(pitch);
    if (!started) return;
    heldRef.current.delete(pitch);
    const completed = { ...started, durationBeats: Math.max(0.08, atBeat - started.startBeat) };
    setNotes((previous) => [...previous, completed].sort((a, b) => a.startBeat - b.startBeat));
    setPending([...heldRef.current.values()]);
  }, []);

  const noteOn = useCallback((pitch: number) => {
    if (transport.modeRef.current !== 'recording' || sourceRef.current !== 'midi') return;
    const atBeat = transport.getBeat();
    finishNote(pitch, atBeat);
    heldRef.current.set(pitch, {
      id: `take-${sequenceRef.current++}`,
      pitch,
      startBeat: atBeat,
      durationBeats: 0,
    });
    setPending([...heldRef.current.values()]);
  }, [finishNote, transport]);

  const noteOff = useCallback((pitch: number) => {
    if (transport.modeRef.current !== 'recording' || sourceRef.current !== 'midi') return;
    finishNote(pitch, transport.getBeat());
  }, [finishNote, transport]);

  const startTake = useCallback(async (fromBeat = 0, rate = 1, input: 'midi' | 'mic' = 'midi') => {
    heldRef.current.clear();
    setNotes([]);
    setPending([]);
    sourceRef.current = input;
    setSource(input);
    await transport.start('recording', fromBeat, rate);
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
    for (const pitch of [...heldRef.current.keys()]) finishNote(pitch, atBeat);
    transport.stop();
  }, [finishNote, transport]);

  const loadExample = useCallback((example: readonly NoteEvent[] = EXAMPLE_TAKE) => {
    transport.stop();
    transport.seek(0);
    heldRef.current.clear();
    setPending([]);
    setNotes(example.map((note) => ({ ...note })));
    sourceRef.current = 'example';
    setSource('example');
  }, [transport]);

  const clearTake = useCallback(() => {
    transport.stop();
    transport.seek(0);
    heldRef.current.clear();
    setPending([]);
    setNotes([]);
    sourceRef.current = null;
    setSource(null);
  }, [transport]);

  const restoreTake = useCallback((restoredNotes: readonly NoteEvent[], restoredSource: TakeSource) => {
    transport.stop();
    transport.seek(0);
    heldRef.current.clear();
    setPending([]);
    setNotes(restoredNotes.map((note) => ({ ...note })));
    sourceRef.current = restoredSource;
    setSource(restoredSource);
  }, [transport]);

  return { notes, pending, source, noteOn, noteOff, startTake, stopTake, appendNotes, replaceNotes, setPendingNotes, loadExample, clearTake, restoreTake };
}
