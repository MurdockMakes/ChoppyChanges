import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMidi } from './useMidi';
import { BEATS_PER_BAR, BPM, CIRCLE_KEYS, DEFAULT_PROGRESSION, PROGRESSIONS, analyzeTake, chordAtBeat, formatPosition, nextChordAtBeat, spellNoteWithOctave, type NoteEvent, type Resolution } from './theory';
import { useTransport, type TransportMode } from './useTransport';
import { useTake, type TakeSource } from './useTake';
import Keyboard from './Keyboard';
import PianoRoll from './PianoRoll';
import type { AudioEngine } from './audio';
import { MicNoteSegmenter } from './micSegmentation';
import { useMicrophone, type MicFrame } from './useMicrophone';
import { saxChordReference, saxWrittenChord, saxWrittenKey, saxWrittenPitch, type SaxKey } from './sax';
import { MAX_PASSES, normalizePassCount, passAtBeat, practiceRunStartBeat, progressionEndBeat } from './loopControl';
import TranscriptionEditor from './TranscriptionEditor';
import { exampleTakeFor } from './example';
import CircleOfFifths, { type CircleForm } from './CircleOfFifths';
import { buildCoachContext, fallbackCoachPlan, passageForExercise, planExercise, planPriority, validateGeminiCoachResponse, type CoachEvidence, type CoachPlan } from './coach';
import { RecordedAudioReplay, TakeReplay, takeEndBeat } from './takeReplay';
import { deleteBankedTake, diffNoteEdits, listBankedTakes, loadAllBankedTakes, loadBankedTake, saveBankedTake, type BankedTakeSummary, type MicAudioTake, type NoteEdit } from './takeBank';
import { createTakeTransferFile, importTakeTransferFile, TAKE_FILE_EXTENSION } from './takeTransfer';
import { buildNoteEvidenceIndex } from './noteEvidence';

type PassageTarget = Pick<Resolution, 'startBeat' | 'endBeat' | 'title' | 'explanation'>;

export default function App() {
  const [progressionId, setProgressionId] = useState(DEFAULT_PROGRESSION.id);
  const progression = PROGRESSIONS.find((item) => item.id === progressionId) ?? DEFAULT_PROGRESSION;
  const replaySessionRef = useRef<TakeReplay | RecordedAudioReplay | null>(null);
  const replayKindRef = useRef<'full' | 'passage' | null>(null);
  const replayStartIdRef = useRef(0);
  const fullCursorArmedRef = useRef(false);
  const [replayKind, setReplayKind] = useState<'full' | 'passage' | null>(null);
  const [fullReplayRate, setFullReplayRate] = useState(1);
  const [replaySound, setReplaySound] = useState<'original' | 'notes'>('original');
  const [saxKey, setSaxKey] = useState<SaxKey>('concert');
  const [passCount, setPassCount] = useState('1');
  const [runStartBeat, setRunStartBeat] = useState(0);
  const [runPasses, setRunPasses] = useState(1);
  const [micAudio, setMicAudio] = useState<MicAudioTake | null>(null);
  const [micAudioFinalizing, setMicAudioFinalizing] = useState(false);
  const [bankedTakes, setBankedTakes] = useState<BankedTakeSummary[]>([]);
  const [bankName, setBankName] = useState('');
  const [bankStatus, setBankStatus] = useState('');
  const [bankError, setBankError] = useState(false);
  const [bankBusy, setBankBusy] = useState(false);
  const [bankLoading, setBankLoading] = useState(true);
  const [bankAvailable, setBankAvailable] = useState(true);
  const [noteEdits, setNoteEdits] = useState<NoteEdit[]>([]);
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const micCaptureEpochRef = useRef(0);
  const micCaptureStartRef = useRef(0);
  const micCaptureRateRef = useRef(1);
  const fullReplayRateRef = useRef(1);
  const advanceReplay = useCallback((previousBeat: number, beat: number, mode: TransportMode, _audio: AudioEngine) => {
    if (mode !== 'replaying') return;
    replaySessionRef.current?.advance(previousBeat, beat);
  }, []);
  const transport = useTransport(advanceReplay, progression,
    (mode, beat) => { if (mode === 'recording') beginMicCapture(beat); },
    (mode, beat) => { if (mode === 'recording') stopRecording(beat); },
  );
  const take = useTake(transport);
  const takesByProgressionRef = useRef<Record<string, { notes: NoteEvent[]; source: TakeSource; audio: MicAudioTake | null; edits: NoteEdit[] }>>({});
  const midi = useMidi((pitch) => take.noteOn(pitch, 'midi'), (pitch) => take.noteOff(pitch, 'midi'));
  const micSegmenterRef = useRef(new MicNoteSegmenter());
  const recordingInputRef = useRef<'midi' | 'mic' | 'piano' | null>(null);
  const [micLivePitch, setMicLivePitch] = useState<number | null>(null);
  const onMicFrame = (frame: MicFrame) => {
    if (transport.modeRef.current !== 'recording' || recordingInputRef.current !== 'mic' || transport.isAtLimit()) return;
    // Timestamp the center of the analyser window, including slower practice takes.
    const sampleBeat = Math.max(0, transport.getBeat() - frame.windowSeconds * (BPM / 120) * micCaptureRateRef.current);
    take.appendNotes(micSegmenterRef.current.observe(frame.pitch, sampleBeat));
    const current = micSegmenterRef.current.currentNote;
    take.setPendingNotes(current ? [current] : []);
    setMicLivePitch(micSegmenterRef.current.observedPitch);
  };
  const onMicEnded = () => {
    if (recordingInputRef.current !== 'mic') return;
    if (transport.modeRef.current === 'counting-in') {
      recordingInputRef.current = null;
      setPracticeOf(null);
      take.clearTake();
      return;
    }
    const endBeat = transport.getBeat();
    commitMicAudio(endBeat);
    take.appendNotes(micSegmenterRef.current.finalize(endBeat));
    take.setPendingNotes([]);
    setMicLivePitch(null);
    recordingInputRef.current = null;
    take.stopTake();
  };
  const mic = useMicrophone(onMicFrame, onMicEnded);
  function commitMicAudio(endBeat: number) {
    const epoch = micCaptureEpochRef.current;
    const startBeat = micCaptureStartRef.current;
    const rate = micCaptureRateRef.current;
    setMicAudioFinalizing(true);
    void mic.finishCapture().then((blob) => {
      if (epoch === micCaptureEpochRef.current && blob) setMicAudio({ blob, startBeat, endBeat, rate });
    }).finally(() => {
      if (epoch === micCaptureEpochRef.current) setMicAudioFinalizing(false);
    });
  }
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(null);
  const [practiceOf, setPracticeOf] = useState<PassageTarget | null>(null);
  const resolutions = useMemo(() => transport.mode === 'recording' ? [] : analyzeTake(take.notes, progression), [take.notes, transport.mode, progression]);
  const coachContext = useMemo(() => buildCoachContext(take.notes, progression, resolutions), [take.notes, progression, resolutions]);
  const phraseEvidence = useMemo(() => transport.mode === 'recording' ? [] : coachContext.summary.evidence, [coachContext, transport.mode]);
  const noteEvidenceIndex = useMemo(() => buildNoteEvidenceIndex(take.notes, phraseEvidence), [take.notes, phraseEvidence]);
  const [coachPlan, setCoachPlan] = useState<CoachPlan | null>(null);
  const [coachOrigin, setCoachOrigin] = useState<'gemini' | 'local' | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const coachRequestRef = useRef<AbortController | null>(null);
  const coachEpochRef = useRef(0);
  const selectedPassage: CoachEvidence | undefined = phraseEvidence.find((item) => item.id === selectedEvidenceId);
  const selectedNote = take.notes.find((note) => note.id === selectedNoteId);
  const selectedNoteEvidence = selectedNote ? noteEvidenceIndex.get(selectedNote.id) ?? [] : [];
  const takeEnd = Math.max(takeEndBeat(take.notes), micAudio?.endBeat ?? 0);
  const saxConcertRoot = CIRCLE_KEYS.find((key) => key.id === progression.keyId)?.root ?? 0;
  const saxConcertKey = CIRCLE_KEYS.find((key) => key.id === progression.keyId)?.label ?? 'C';
  const writtenProgressionLabel = saxKey === 'concert' ? progression.label : progression.label.replace(saxConcertKey, saxWrittenKey(saxConcertRoot, saxKey));

  useEffect(() => {
    let active = true;
    void listBankedTakes().then((saved) => {
      if (active) setBankedTakes(saved);
    }).catch(() => {
      if (active) {
        setBankAvailable(false);
        setBankStatus('Saved takes are unavailable in this browser.');
      }
    }).finally(() => {
      if (active) setBankLoading(false);
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (transport.mode !== 'stopped' || !replayKindRef.current) return;
    replaySessionRef.current?.stop();
    replaySessionRef.current = null;
    replayKindRef.current = null;
    setReplayKind(null);
  }, [transport.mode]);

  useEffect(() => () => {
    replayStartIdRef.current += 1;
    replaySessionRef.current?.stop();
  }, []);

  function invalidateCoach() {
    coachEpochRef.current += 1;
    coachRequestRef.current?.abort();
    coachRequestRef.current = null;
    setCoachLoading(false);
    setCoachPlan(null);
    setCoachOrigin(null);
  }

  useEffect(() => {
    coachEpochRef.current += 1;
    coachRequestRef.current?.abort();
    coachRequestRef.current = null;
    setCoachLoading(false);
    setCoachPlan(null);
    setCoachOrigin(null);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
  }, [take.notes, progression.id, transport.mode === 'recording']);

  async function makePracticePlan() {
    if (transport.mode !== 'stopped' || take.source === null) return;
    invalidateCoach();
    const requestEpoch = coachEpochRef.current;
    if (!coachContext.summary.reliableForPersonalization) {
      setCoachPlan(fallbackCoachPlan(coachContext));
      setCoachOrigin('local');
      return;
    }
    const controller = new AbortController();
    coachRequestRef.current = controller;
    setCoachLoading(true);
    try {
      const response = await fetch('/api/coach', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(coachContext),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Coach API unavailable');
      const raw: unknown = await response.json();
      const validated = validateGeminiCoachResponse(raw, coachContext);
      if (coachEpochRef.current !== requestEpoch) return;
      setCoachPlan(validated);
      setCoachOrigin('gemini');
    } catch {
      if (coachEpochRef.current !== requestEpoch || controller.signal.aborted) return;
      setCoachPlan(fallbackCoachPlan(coachContext));
      setCoachOrigin('local');
    } finally {
      if (coachEpochRef.current === requestEpoch) {
        coachRequestRef.current = null;
        setCoachLoading(false);
      }
    }
  }
  const replayPressed = transport.mode === 'replaying'
    ? take.notes.filter((note) => transport.beat >= note.startBeat && transport.beat < note.startBeat + note.durationBeats).map((note) => note.pitch)
    : [];
  const pressed = [...new Set([...midi.pressed, ...replayPressed, ...(transport.mode === 'recording' && micLivePitch !== null ? [micLivePitch] : [])])];
  const loopBeat = transport.beat % (progression.chords.length * BEATS_PER_BAR);
  const activeBar = Math.floor(loopBeat / BEATS_PER_BAR);
  const chord = chordAtBeat(transport.beat, progression);
  const nextChord = nextChordAtBeat(transport.beat, progression);
  const chordReference = saxChordReference(chord, saxKey);

  function prepareRun(fromBeat = 0) {
    const passes = normalizePassCount(Number(passCount));
    setRunStartBeat(fromBeat);
    setRunPasses(passes);
    return progressionEndBeat(progression, fromBeat, passes);
  }

  function startChanges() {
    if (transport.modeRef.current !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy) return;
    void transport.start('playing', 0, 1, prepareRun(), 4);
  }

  async function saveCurrentToBank() {
    const source = take.source;
    if (!source || (take.notes.length === 0 && !micAudio) || transport.modeRef.current !== 'stopped' || micAudioFinalizing || bankBusy || !bankAvailable) return;
    const name = bankName.trim().slice(0, 80) || `${progression.label} ${source === 'mic' ? 'sax' : source} take ${bankedTakes.length + 1}`;
    setBankBusy(true);
    setBankStatus('Saving take…');
    try {
      await saveBankedTake({
        id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
        name, progressionId: progression.id, source, saxKey,
        notes: take.notes.map((note) => ({ ...note })), audio: micAudio, savedAt: Date.now(),
      });
      setBankedTakes(await listBankedTakes());
      setBankName('');
      setBankStatus(`Saved “${name}” to this browser.`);
    } catch (error) {
      setBankStatus(error instanceof Error ? error.message : 'Could not save this take.');
    } finally {
      setBankBusy(false);
    }
  }

  async function loadFromBank(id: string) {
    if (transport.modeRef.current !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy) return;
    setBankBusy(true);
    setBankStatus('Loading take…');
    try {
      const saved = await loadBankedTake(id);
      if (!saved) throw new Error('That saved take is no longer available.');
      if (!PROGRESSIONS.some((item) => item.id === saved.progressionId)) throw new Error('The saved chord progression is unavailable.');
      clearReplaySession();
      fullCursorArmedRef.current = false;
      invalidateCoach();
      if (saved.progressionId !== progression.id) {
        takesByProgressionRef.current[progression.id] = { notes: take.notes.map((note) => ({ ...note })), source: take.source, audio: micAudio };
        setProgressionId(saved.progressionId);
        setRunStartBeat(0);
        setRunPasses(1);
      }
      micCaptureEpochRef.current += 1;
      mic.stop();
      micSegmenterRef.current.reset();
      recordingInputRef.current = null;
      setMicLivePitch(null);
      setMicAudio(saved.audio);
      setReplaySound('original');
      setSaxKey(saved.saxKey);
      setSelectedEvidenceId(null);
      setSelectedNoteId(null);
      setPracticeOf(null);
      take.restoreTake(saved.notes, saved.source);
      setBankStatus(`Loaded “${saved.name}”.`);
    } catch (error) {
      setBankStatus(error instanceof Error ? error.message : 'Could not load this take.');
    } finally {
      setBankBusy(false);
    }
  }

  async function removeFromBank(item: BankedTakeSummary) {
    if (bankBusy || !window.confirm(`Delete “${item.name}” from the take bank?`)) return;
    setBankBusy(true);
    try {
      await deleteBankedTake(item.id);
      setBankedTakes(await listBankedTakes());
      setBankStatus(`Deleted “${item.name}”.`);
    } catch (error) {
      setBankStatus(error instanceof Error ? error.message : 'Could not delete this take.');
    } finally {
      setBankBusy(false);
    }
  }

  function clearReplaySession() {
    replayStartIdRef.current += 1;
    replaySessionRef.current?.stop();
    replaySessionRef.current = null;
    replayKindRef.current = null;
    setReplayKind(null);
  }

  function stopReplay(atBeat?: number) {
    clearReplaySession();
    transport.stop(atBeat);
  }

  async function startReplay(kind: 'full' | 'passage', notes: NoteEvent[], fromBeat: number, rate: number, untilBeat: number) {
    clearReplaySession();
    const session = take.source === 'mic' && micAudio && replaySound === 'original'
      ? (() => {
          const url = URL.createObjectURL(micAudio.blob);
          return new RecordedAudioReplay(new Audio(url), micAudio.startBeat, micAudio.rate, () => URL.revokeObjectURL(url));
        })()
      : new TakeReplay(notes, transport.playNote, transport.stopTimed);
    replaySessionRef.current = session;
    replayKindRef.current = kind;
    setReplayKind(kind);
    const startId = replayStartIdRef.current;
    try {
      // Start the recorded element inside the click gesture for browser autoplay rules.
      if (session instanceof RecordedAudioReplay) session.start(fromBeat, rate);
      await transport.prepareAudio();
      if (startId !== replayStartIdRef.current || transport.modeRef.current !== 'stopped') return;
      await transport.start('replaying', fromBeat, rate, untilBeat);
      if (startId !== replayStartIdRef.current || !['replaying'].includes(transport.modeRef.current)) return;
      if (session instanceof RecordedAudioReplay) session.seek(transport.getBeat(), rate);
      else session.start(transport.getBeat(), rate);
    } catch {
      if (startId === replayStartIdRef.current) stopReplay();
    }
  }

  function startFullReplay() {
    if (transport.modeRef.current !== 'stopped' || takeEnd <= 0 || micAudioFinalizing || bankBusy) return;
    const fromBeat = fullCursorArmedRef.current && transport.beat < takeEnd ? transport.beat : 0;
    fullCursorArmedRef.current = false;
    void startReplay('full', take.notes.slice(), fromBeat, fullReplayRateRef.current, takeEnd);
  }

  function pauseFullReplay() {
    if (replayKindRef.current !== 'full' || transport.modeRef.current !== 'replaying') return;
    replayStartIdRef.current += 1;
    transport.pauseReplay();
    replaySessionRef.current?.pause();
  }

  async function resumeFullReplay() {
    if (replayKindRef.current !== 'full' || transport.modeRef.current !== 'paused') return;
    const startId = ++replayStartIdRef.current;
    try {
      await transport.resumeReplay();
      if (startId !== replayStartIdRef.current || !['replaying'].includes(transport.modeRef.current)) return;
      replaySessionRef.current?.start(transport.getBeat(), fullReplayRateRef.current);
    } catch {
      if (startId === replayStartIdRef.current) stopReplay();
    }
  }

  function seekFullReplay(toBeat: number) {
    if (takeEnd <= 0 || !Number.isFinite(toBeat)) return;
    if (transport.modeRef.current === 'replaying' && replayKindRef.current !== 'full') return;
    if (transport.modeRef.current === 'paused' && replayKindRef.current !== 'full') return;
    if (!['stopped', 'paused', 'replaying'].includes(transport.modeRef.current)) return;
    const atBeat = Math.max(0, Math.min(takeEnd, toBeat));
    fullCursorArmedRef.current = true;
    transport.seek(atBeat);
    if (replayKindRef.current === 'full') replaySessionRef.current?.seek(atBeat, fullReplayRateRef.current);
  }

  function changeFullReplayRate(rate: number) {
    if (!Number.isFinite(rate) || rate <= 0) return;
    fullReplayRateRef.current = rate;
    setFullReplayRate(rate);
    if (replayKindRef.current === 'full' && (transport.modeRef.current === 'replaying' || transport.modeRef.current === 'paused')) {
      const atBeat = transport.getBeat();
      transport.changeReplayRate(rate);
      replaySessionRef.current?.seek(atBeat, rate);
    }
  }

  function stopFullReplay() {
    fullCursorArmedRef.current = false;
    stopReplay(0);
  }

  useEffect(() => {
    const onBlur = () => {
      if (transport.modeRef.current !== 'replaying') return;
      if (replayKindRef.current === 'full') pauseFullReplay();
      else stopReplay();
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  function switchProgression(nextId: string) {
    if (transport.modeRef.current !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy || nextId === progression.id) return;
    const next = PROGRESSIONS.find((item) => item.id === nextId);
    if (!next) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    takesByProgressionRef.current[progression.id] = { notes: take.notes.map((note) => ({ ...note })), source: take.source, audio: micAudio };
    const saved = takesByProgressionRef.current[nextId];
    micCaptureEpochRef.current += 1;
    setMicAudio(saved?.audio ?? null);
    mic.stop();
    micSegmenterRef.current.reset();
    recordingInputRef.current = null;
    setMicLivePitch(null);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
    setPracticeOf(null);
    setProgressionId(nextId);
    setRunStartBeat(0);
    setRunPasses(1);
    take.restoreTake(saved?.notes ?? [], saved?.source ?? null);
  }

  function selectCircleKey(keyId: string) {
    const form = progression.form === 'turnaround' ? 'ii-v-i' : progression.form;
    switchProgression(`${form}-${keyId}`);
  }

  function selectCircleForm(form: CircleForm) {
    switchProgression(`${form}-${progression.keyId}`);
  }

  function selectEvidence(id: string, noteId: string | null = null, scrollToDetails = false) {
    const evidence = phraseEvidence.find((item) => item.id === id);
    if (!evidence) return;
    if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay();
    fullCursorArmedRef.current = false;
    setSelectedEvidenceId(id);
    setSelectedNoteId(noteId);
    transport.seek(evidence.startBeat);
    if (scrollToDetails) requestAnimationFrame(() => document.getElementById('selected-passage')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  function selectNote(id: string) {
    const note = take.notes.find((item) => item.id === id);
    if (!note) return;
    if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay();
    fullCursorArmedRef.current = false;
    const related = noteEvidenceIndex.get(id) ?? [];
    setSelectedNoteId(id);
    setSelectedEvidenceId(related.find((item) => item.id === selectedEvidenceId)?.id ?? related[0]?.id ?? null);
    transport.seek(note.startBeat);
  }

  function selectCoachEvidence(id: string) {
    selectEvidence(id, null, true);
  }

  function replaySelected() {
    if (!selectedPassage || transport.modeRef.current !== 'stopped' || micAudioFinalizing || bankBusy) return;
    const fromBeat = Math.max(0, selectedPassage.startBeat - 0.5);
    const untilBeat = selectedPassage.endBeat + 0.6;
    const notes = take.notes.filter((note) => note.startBeat < untilBeat && note.startBeat + note.durationBeats > fromBeat);
    void startReplay('passage', notes, fromBeat, 0.6, untilBeat);
  }

  function startMidiTake(fromBeat = 0, rate = 1, practiceTarget: PassageTarget | null = null) {
    if (!midi.connected || transport.modeRef.current !== 'stopped' || micAudioFinalizing || bankBusy) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    micCaptureEpochRef.current += 1;
    setMicAudio(null);
    recordingInputRef.current = 'midi';
    setPracticeOf(practiceTarget);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
    void take.startTake(fromBeat, rate, 'midi', prepareRun(fromBeat), 4);
  }

  function startPianoTake(fromBeat = 0, rate = 1, practiceTarget: PassageTarget | null = null) {
    if (transport.modeRef.current !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    micCaptureEpochRef.current += 1;
    setMicAudio(null);
    recordingInputRef.current = 'piano';
    setPracticeOf(practiceTarget);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
    void take.startTake(fromBeat, rate, 'piano', prepareRun(fromBeat), 4);
  }

  async function startMicTake(fromBeat = 0, rate = 1, practiceTarget: PassageTarget | null = null) {
    if (transport.modeRef.current !== 'stopped' || micAudioFinalizing || bankBusy) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    const started = await mic.start();
    if (!started) return;
    micCaptureEpochRef.current += 1;
    setMicAudio(null);
    setReplaySound('original');
    micSegmenterRef.current.reset();
    recordingInputRef.current = 'mic';
    setMicLivePitch(null);
    setPracticeOf(practiceTarget);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
    micCaptureRateRef.current = rate;
    await take.startTake(fromBeat, rate, 'mic', prepareRun(fromBeat), 4);
  }

  function beginMicCapture(beat: number) {
    if (recordingInputRef.current !== 'mic') return;
    micCaptureStartRef.current = beat;
    mic.startCapture();
  }

  function stopRecording(atBeat?: number) {
    if (transport.modeRef.current === 'counting-in') {
      if (recordingInputRef.current === 'mic') mic.stop();
      recordingInputRef.current = null;
      setPracticeOf(null);
      take.clearTake();
      return;
    }
    if (recordingInputRef.current === 'mic') {
      const endBeat = atBeat ?? transport.getBeat();
      commitMicAudio(endBeat);
      take.appendNotes(micSegmenterRef.current.finalize(endBeat));
      take.setPendingNotes([]);
      setMicLivePitch(null);
      mic.stop();
    }
    recordingInputRef.current = null;
    take.stopTake(atBeat);
  }

  function stopTransport() {
    const mode = transport.modeRef.current;
    if (mode === 'recording' || mode === 'counting-in' && recordingInputRef.current !== null) stopRecording();
    else if (mode === 'replaying' || mode === 'paused') {
      if (replayKindRef.current === 'full') stopFullReplay();
      else stopReplay();
    } else transport.stop();
  }

  function discardAndLoadExample() {
    if (bankBusy) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    micCaptureEpochRef.current += 1;
    setMicAudioFinalizing(false);
    setMicAudio(null);
    mic.stop();
    micSegmenterRef.current.reset();
    recordingInputRef.current = null;
    setMicLivePitch(null);
    setPracticeOf(null);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
    take.loadExample(exampleTakeFor(progression));
  }

  function clearTake() {
    if (bankBusy) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    micCaptureEpochRef.current += 1;
    setMicAudioFinalizing(false);
    setMicAudio(null);
    mic.stop();
    micSegmenterRef.current.reset();
    recordingInputRef.current = null;
    setMicLivePitch(null);
    setPracticeOf(null);
    setSelectedEvidenceId(null);
    setSelectedNoteId(null);
    take.clearTake();
  }

  function practiceSelected(input: 'midi' | 'mic' | 'piano') {
    if (!selectedPassage) return;
    const leadInBeat = practiceRunStartBeat(selectedPassage.startBeat);
    if (input === 'mic') void startMicTake(leadInBeat, 0.75, selectedPassage);
    else if (input === 'piano') startPianoTake(leadInBeat, 0.75, selectedPassage);
    else startMidiTake(leadInBeat, 0.75, selectedPassage);
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden="true">♬</div>
          <div>
            <p className="eyebrow">JAZZ PRACTICE LAB</p>
            <h1>Changes Coach<span className="brand-period">.</span></h1>
          </div>
        </div>
        <div className="header-right">
          <span className={`mode-badge mode-${transport.mode}`}><i />{transport.mode === 'stopped' ? 'READY' : transport.mode === 'counting-in' ? `COUNT IN ${transport.countInRemaining}` : transport.mode === 'playing' ? 'PLAYING' : transport.mode === 'recording' ? recordingInputRef.current === 'mic' ? 'SAX TAKE' : recordingInputRef.current === 'piano' ? 'PIANO TAKE' : 'MIDI TAKE' : transport.mode === 'paused' ? 'REPLAY PAUSED' : 'REPLAYING'}</span>
          <span className="header-subtitle">Hear the changes. See the resolution.</span>
        </div>
      </header>

      <div className="setup-grid">
        <section className="panel control-panel" aria-label="MIDI and transport">
          <div className="panel-heading">
            <p className="eyebrow">01 / SETUP</p>
            <h2>Play a phrase</h2>
          </div>
          <div className={`midi-status ${midi.connected ? 'is-connected' : ''}`}>
            <span className="status-light" aria-hidden="true" />
            <div>
              <strong>{midi.connected ? 'MIDI connected' : 'MIDI connection'}</strong>
              <p role="status">{midi.status}</p>
              {midi.connected && <small>Keys down: {midi.pressed.length ? midi.pressed.map((pitch) => spellNoteWithOctave(pitch, chord)).join(' · ') : 'none'}</small>}
            </div>
          </div>
          <div className={`mic-status ${mic.active ? 'is-connected' : ''}`}>
            <span className="status-light" aria-hidden="true" />
            <div>
              <strong>Sax microphone</strong>
              <p role="status">{mic.status}</p>
              {mic.active && <small>Heard: {micLivePitch !== null ? `${spellNoteWithOctave(micLivePitch, chord)} concert${saxKey === 'concert' ? '' : ` · ${spellNoteWithOctave(saxWrittenPitch(micLivePitch, saxKey))} written`}` : mic.rms > 0.02 ? 'sound detected · pitch uncertain' : 'listening…'}</small>}
            </div>
          </div>
          <fieldset className="sax-key-toggle">
            <legend>Saxophone key</legend>
            {([['concert', 'Concert'], ['alto', 'Alto E♭'], ['tenor', 'Tenor B♭']] as const).map(([key, label]) => (
              <button key={key} type="button" aria-pressed={saxKey === key} onClick={() => setSaxKey(key)}>{label}</button>
            ))}
            <small>{saxKey === 'concert' ? 'Chart and notes use concert pitch.' : `Circle selects concert ${saxConcertKey}; chart shows written ${saxWrittenKey(saxConcertRoot, saxKey)} for ${saxKey === 'alto' ? 'alto' : 'tenor'}. Transcription and analysis use concert pitch.`}</small>
          </fieldset>
          <div className="record-controls">
            <button className="button button-secondary" onClick={midi.connect} disabled={!midi.supported || midi.connected}>Connect MIDI</button>
            <button className="button button-primary" onClick={() => startMidiTake()} disabled={!midi.connected || transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy}>Start MIDI take</button>
            <button className="button button-primary" onClick={() => startPianoTake()} disabled={transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy}>Start piano take</button>
            <button className="button button-mic" onClick={() => void startMicTake()} disabled={!mic.supported || transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy}>{mic.requesting ? 'Requesting mic…' : 'Start sax take'}</button>
            <button className="button button-stop" onClick={() => stopRecording()} disabled={transport.mode !== 'recording' && !(transport.mode === 'counting-in' && recordingInputRef.current !== null)}>Stop take</button>
            <button className="button button-example" onClick={discardAndLoadExample} disabled={bankBusy}>Load example take</button>
          </div>
          <div className="transport-controls">
            <button onClick={startChanges} disabled={transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy}>▶ &nbsp; Play changes</button>
            <button onClick={stopTransport} disabled={transport.mode === 'stopped'}>■ &nbsp; Stop</button>
            <button onClick={clearTake} disabled={bankBusy || take.notes.length === 0 && take.pending.length === 0 && !mic.active && !micAudio && !micAudioFinalizing}>Clear</button>
          </div>
          <div className="repeat-controls">
            <label htmlFor="changes-pass-count">Changes passes</label>
            <input id="changes-pass-count" aria-label="Number of changes passes" type="number" inputMode="numeric" min="1" max={MAX_PASSES} step="1" value={passCount} onChange={(event) => setPassCount(event.target.value)} onBlur={() => setPassCount(String(normalizePassCount(Number(passCount))))} disabled={transport.mode !== 'stopped' || mic.requesting || bankBusy} />
            <small>Each pass plays all {progression.chords.length} bars. Four audible count-in beats play before the first pass.</small>
            {(transport.mode === 'counting-in' || transport.mode === 'playing' || transport.mode === 'recording') && <p className="pass-progress" role="status" aria-live="polite">{transport.mode === 'counting-in' ? `Count in ${transport.countInRemaining}` : `Pass ${passAtBeat(progression, runStartBeat, transport.beat, runPasses)} of ${runPasses}`}</p>}
          </div>
          <div className="sound-toggles">
            <label><input type="checkbox" checked={transport.metronome} onChange={(event) => transport.setMetronome(event.target.checked)} /> Metronome</label>
            <label><input type="checkbox" checked={transport.chordCues} onChange={(event) => transport.setChordCues(event.target.checked)} /> Chord cues</label>
          </div>
        </section>

        <section className="panel progression-panel" aria-label="Chord progression">
          <div className="panel-heading progression-heading">
            <div><p className="eyebrow">02 / THE CHANGES{saxKey === 'concert' ? '' : ` · ${saxKey === 'alto' ? 'ALTO E♭' : 'TENOR B♭'} WRITTEN`}</p><h2>{writtenProgressionLabel}</h2></div>
            <span className="tempo-pill">4/4 &nbsp; · &nbsp; {BPM} BPM</span>
          </div>
          <div className={`progression-canvas ${transport.mode === 'stopped' ? '' : 'has-reference'}`}>
            {transport.mode === 'stopped' ? <CircleOfFifths
              keys={CIRCLE_KEYS}
              selectedKeyId={progression.keyId}
              selectedForm={progression.form === 'turnaround' ? null : progression.form}
              onSelectKey={selectCircleKey}
              onSelectForm={selectCircleForm}
              disabled={mic.requesting || micAudioFinalizing || bankBusy}
            /> : <div className="chord-reference" aria-label="Current chord notes">
              <p className="eyebrow">{transport.mode === 'counting-in' ? 'COMING UP' : 'PLAY THESE NOTES'}</p>
              <h3 aria-live="polite">{saxWrittenChord(chord, saxKey)}</h3>
              <div className="chord-reference-tones">
                {chordReference.slice(0, 4).map(({ role, note }) => <div key={role} className={role === '3rd' || role === '7th' ? 'guide-tone' : ''}><small>{role}</small><strong>{note}</strong></div>)}
              </div>
              <p className="chord-reference-label">Optional color notes</p>
              <div className="chord-reference-tensions">
                {chordReference.slice(4).map(({ role, note }) => <span key={role}><small>{role}</small> {note}</span>)}
              </div>
              <p className="chord-reference-key">{saxKey === 'concert' ? 'Concert pitch' : `${saxKey === 'alto' ? 'Alto E♭' : 'Tenor B♭'} written notes`}</p>
            </div>}
            <div className={`chart ${progression.form === 'blues' ? 'chart--blues' : ''}`}>
              {progression.chords.map((bar, index) => (
                <div key={index} className={`chart-bar ${progression.form === 'blues' ? 'chart-bar--compact' : ''} ${index === activeBar ? 'active' : ''}`}>
                  <span className="chart-bar-number">BAR {String(index + 1).padStart(2, '0')}</span>
                  <strong>{saxWrittenChord(bar, saxKey)}</strong>
                  <span className="chart-bar-beat">{index === activeBar ? `BEAT ${Math.floor(loopBeat % BEATS_PER_BAR) + 1} / 4` : '4 BEATS'}</span>
                  <span className="chart-progress" style={{ width: index === activeBar ? `${((loopBeat % BEATS_PER_BAR) / BEATS_PER_BAR) * 100}%` : '0%' }} />
                </div>
              ))}
            </div>
          </div>
          <div className="progression-meta">
            <p>{progression.chords.map((bar) => saxWrittenChord(bar, saxKey)).join(' | ')}</p>
            <button type="button" aria-pressed={progression.id === 'turnaround-c'} disabled={transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy} onClick={() => switchProgression('turnaround-c')}>C turnaround preset</button>
          </div>
          <div className="chord-context">
            <div><span>NOW PLAYING</span><strong>{saxWrittenChord(chord, saxKey)}</strong></div>
            <span className="chord-arrow" aria-hidden="true">→</span>
            <div><span>UP NEXT</span><strong>{saxWrittenChord(nextChord, saxKey)}</strong></div>
            <p>Guide tones and tensions update with each chord.</p>
          </div>
        </section>
      </div>

      <Keyboard
        currentBeat={transport.beat}
        pressed={pressed}
        progression={progression}
        onNoteOn={(pitch) => { transport.pianoNoteOn(pitch); take.noteOn(pitch, 'piano'); }}
        onNoteOff={(pitch) => { transport.pianoNoteOff(pitch); take.noteOff(pitch, 'piano'); }}
      />

      <div className="results-grid">
        <section className="panel take-panel" aria-label="Recorded take">
          <div className="panel-heading take-heading">
            <div><p className="eyebrow">03 / YOUR TAKE</p><h2>Piano roll</h2></div>
            <span className="note-count">{take.notes.length} {take.notes.length === 1 ? 'NOTE' : 'NOTES'}</span>
          </div>
          <p className="take-summary">{transport.mode === 'recording' ? recordingInputRef.current === 'mic' ? 'Listening for a single-note sax phrase…' : recordingInputRef.current === 'piano' ? 'Recording on-screen piano notes…' : 'Recording MIDI notes…' : micAudioFinalizing ? 'Saving your microphone audio…' : take.source === 'example' ? 'Example take loaded. Select a note on the roll to inspect its evidence.' : take.source === 'midi' ? 'MIDI take captured. Select a note on the roll to inspect its evidence.' : take.source === 'piano' ? 'Piano take captured. Select a note on the roll to inspect its evidence.' : take.source === 'mic' ? 'Sax phrase transcribed in concert pitch. Replay uses your microphone audio when available; note edits affect the transcription only.' : 'Play the piano freely, start a take, or load the example.'}{take.pending.length ? ` ${take.pending.length} held.` : ''}</p>
          {practiceOf && <p className="practice-context"><strong>Practice target:</strong> {practiceOf.explanation} {transport.mode === 'recording' ? 'Play the passage, then stop the take to see fresh evidence.' : 'Your new take is shown below.'}</p>}
          <section className="take-bank" aria-label="Take bank">
            <div className="take-bank-heading"><div><strong>Take bank</strong><small>Saved in this browser for this site</small></div><span>{bankedTakes.length} saved</span></div>
            <div className="take-bank-save">
              <input aria-label="Name this take" type="text" maxLength={80} placeholder="Name this take (optional)" value={bankName} onChange={(event) => setBankName(event.target.value)} disabled={bankBusy || !bankAvailable} />
              <button type="button" onClick={() => void saveCurrentToBank()} disabled={!bankAvailable || bankLoading || bankBusy || transport.mode !== 'stopped' || micAudioFinalizing || !take.source || take.notes.length === 0 && !micAudio}>Save current take</button>
            </div>
            {bankStatus && <p className="take-bank-status" role="status">{bankStatus}</p>}
            {bankLoading ? <p className="take-bank-empty">Loading saved takes…</p> : bankedTakes.length === 0 ? <p className="take-bank-empty">Record a sax phrase, then save it here for quick replay later.</p> : <ul className="take-bank-list">
              {bankedTakes.map((item) => <li key={item.id}>
                <div><strong>{item.name}</strong><small>{PROGRESSIONS.find((entry) => entry.id === item.progressionId)?.label ?? item.progressionId} · {item.source === 'mic' ? 'Sax' : item.source} · {item.noteCount} notes{item.hasAudio ? ' · original audio' : ''}</small></div>
                <button type="button" onClick={() => void loadFromBank(item.id)} disabled={bankBusy || transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing}>Load</button>
                <button type="button" className="take-bank-delete" aria-label={`Delete ${item.name}`} onClick={() => void removeFromBank(item)} disabled={bankBusy}>Delete</button>
              </li>)}
            </ul>}
          </section>
          <div className="take-replay" aria-label="Full take replay controls">
            <div className="take-replay-buttons">
              <button type="button" onClick={startFullReplay} disabled={takeEnd <= 0 || transport.mode !== 'stopped' || micAudioFinalizing || bankBusy}>▶ Replay full take</button>
              <button type="button" onClick={replayKind === 'full' && transport.mode === 'paused' ? () => void resumeFullReplay() : pauseFullReplay} disabled={replayKind !== 'full' || (transport.mode !== 'replaying' && transport.mode !== 'paused')}>{transport.mode === 'paused' && replayKind === 'full' ? '▶ Resume' : 'Ⅱ Pause'}</button>
              <button type="button" onClick={stopFullReplay} disabled={replayKind !== 'full' || (transport.mode !== 'replaying' && transport.mode !== 'paused')}>■ Stop replay</button>
              <label>Speed <select aria-label="Full take playback speed" value={fullReplayRate} onChange={(event) => changeFullReplayRate(Number(event.target.value))} disabled={transport.mode === 'recording' || transport.mode === 'playing' || replayKind === 'passage'}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
              </select></label>
              {take.source === 'mic' && micAudio && <label>Sound <select aria-label="Replay sound" value={replaySound} onChange={(event) => { if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay(); setReplaySound(event.target.value as 'original' | 'notes'); }}>
                <option value="original">Original audio</option><option value="notes">Note preview</option>
              </select></label>}
            </div>
            <div className="take-replay-position">
              <label htmlFor="take-replay-seek">Playhead</label>
              <input id="take-replay-seek" aria-label="Seek full take" type="range" min="0" max={takeEnd || 1} step="0.01" value={Math.min(transport.beat, takeEnd || 1)} onChange={(event) => seekFullReplay(Number(event.target.value))} disabled={takeEnd <= 0 || transport.mode === 'recording' || transport.mode === 'playing' || replayKind === 'passage'} />
              <output htmlFor="take-replay-seek">{formatPosition(Math.min(transport.beat, takeEnd))} · {Math.min(transport.beat, takeEnd).toFixed(2)} / {takeEnd.toFixed(2)} beats</output>
            </div>
          </div>
          <PianoRoll
            notes={take.notes}
            pending={take.pending}
            currentBeat={transport.beat}
            evidence={phraseEvidence}
            selectedEvidenceId={selectedEvidenceId}
            selectedNoteId={selectedNoteId}
            onSelectEvidence={(id) => selectEvidence(id)}
            onSelectNote={selectNote}
            onSeekBeat={takeEnd > 0 && (transport.mode === 'stopped' || replayKind === 'full' && (transport.mode === 'replaying' || transport.mode === 'paused')) ? seekFullReplay : undefined}
            linearPlayhead={take.notes.length > 0 && transport.mode !== 'playing' && transport.mode !== 'recording'}
            progression={progression}
          />
          <TranscriptionEditor notes={take.notes} onChange={(updated) => { if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay(); fullCursorArmedRef.current = false; invalidateCoach(); take.replaceNotes(updated); }} visible={(take.source === 'mic' || take.source === 'example') && transport.mode !== 'recording'} origin={take.source === 'example' ? 'example' : 'mic'} progression={progression} />
          <p className="roll-caption">Select a note for its phrase evidence · ? marks a passage with no nearby resolution detected · arrows mark detected moves</p>
        </section>

        <section className="panel analysis-panel" aria-label="Phrase analysis">
          <div className="panel-heading analysis-heading"><p className="eyebrow">04 / WHAT HAPPENED</p><h2>Phrase evidence</h2></div>
          {phraseEvidence.length === 0 ? (
            <p className="analysis-empty">{transport.mode === 'recording' ? 'Stop the take to see phrase evidence.' : 'Record a piano, MIDI, or sax take, or load the example to inspect phrase evidence.'}</p>
          ) : (
            <>
              {selectedNote || selectedPassage ? (
                <div className="selected-passage" id="selected-passage">
                  {selectedNote ? (
                    <>
                      <p className="eyebrow">SELECTED NOTE · {formatPosition(selectedNote.startBeat)}</p>
                      <strong>{spellNoteWithOctave(selectedNote.pitch, chordAtBeat(selectedNote.startBeat, progression))} on {chordAtBeat(selectedNote.startBeat, progression).name}</strong>
                      <p className="selected-note-count">{selectedNoteEvidence.length} related {selectedNoteEvidence.length === 1 ? 'observation' : 'observations'}</p>
                      {selectedNoteEvidence.length > 1 && (
                        <div className="selected-note-evidence" aria-label="Related evidence for selected note">
                          {selectedNoteEvidence.map((item) => (
                            <button key={item.id} type="button" className={item.kind === 'no-nearby-resolution' ? 'neutral' : ''} aria-pressed={selectedEvidenceId === item.id} onClick={() => selectEvidence(item.id, selectedNote.id)}>{item.title}</button>
                          ))}
                        </div>
                      )}
                    </>
                  ) : <p className="eyebrow">SELECTED PASSAGE · {formatPosition(selectedPassage!.startBeat)}</p>}
                  {selectedPassage ? (
                    <>
                      <div className="selected-evidence-detail">
                        <span>{selectedPassage.kind === 'no-nearby-resolution' ? 'NEUTRAL OBSERVATION' : selectedPassage.kind === 'change-landing' ? 'CHORD CHANGE' : 'DETECTED MOVE'}</span>
                        <h3>{selectedPassage.title}</h3>
                        <p>{selectedPassage.explanation}</p>
                      </div>
                      <div className="selected-actions">
                        <button onClick={replaySelected} disabled={transport.mode !== 'stopped' || micAudioFinalizing || bankBusy}>Replay at 60% speed</button>
                        <button onClick={() => practiceSelected('piano')} disabled={transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy}>Try with piano</button>
                        <button onClick={() => practiceSelected('midi')} disabled={!midi.connected || transport.mode !== 'stopped' || micAudioFinalizing || bankBusy}>Try with MIDI</button>
                        <button onClick={() => practiceSelected('mic')} disabled={!mic.supported || transport.mode !== 'stopped' || mic.requesting || micAudioFinalizing || bankBusy}>Try with mic</button>
                      </div>
                      {!midi.connected && <small>Use the on-screen piano, connect MIDI, or record with the sax microphone.</small>}
                    </>
                  ) : <p>No phrase evidence is linked to this note.</p>}
                </div>
              ) : <p className="analysis-prompt">Select a note or arrow on the piano roll to inspect a passage.</p>}
              <details className="evidence-overview">
                <summary>All phrase evidence <span>{phraseEvidence.length}</span></summary>
                <div className="evidence-list">
                  {phraseEvidence.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`evidence-row ${item.kind === 'no-nearby-resolution' ? 'neutral' : item.kind} ${selectedEvidenceId === item.id ? 'selected' : ''}`}
                      aria-pressed={selectedEvidenceId === item.id}
                      onClick={() => selectEvidence(item.id)}
                    >
                      <strong>{item.title}</strong><small>{formatPosition(item.startBeat)}</small>
                    </button>
                  ))}
                </div>
              </details>
            </>
          )}
          <section className="coach-section" aria-label="Practice plan">
            <div className="coach-heading">
              <div><p className="eyebrow">05 / NEXT PRACTICE</p><h3>Practice plan</h3></div>
              <button type="button" onClick={() => void makePracticePlan()} disabled={take.source === null || transport.mode !== 'stopped' || coachLoading}>
                {coachLoading ? 'Making plan…' : coachPlan ? 'Refresh plan' : 'Make practice plan'}
              </button>
            </div>
            {!coachPlan && !coachLoading && <p className="coach-intro">After a take, choose one focused step for the next attempt.</p>}
            {coachLoading && <p className="coach-intro" role="status">Reviewing the note and resolution evidence…</p>}
            {coachPlan && (() => {
              const priority = planPriority(coachContext, coachPlan);
              return (
                <div className="coach-plan" role="status">
                  <p className="coach-source">{coachOrigin === 'gemini' ? 'GEMINI PLAN · CHECKED AGAINST YOUR TAKE' : coachPlan.priorityNeedId === 'general-warmup' ? 'GENERAL WARMUP · LOCAL PLAN' : 'LOCAL PLAN · GEMINI UNAVAILABLE OR RESPONSE NOT VERIFIED'}</p>
                  <h4>{priority.title}</h4>
                  <p className="coach-priority">{priority.explanation}</p>
                  <div className="coach-exercises">
                    {coachPlan.exercises.map((item, index) => {
                      const exercise = planExercise(coachContext, item);
                      const passage = passageForExercise(coachContext, item);
                      const note = item.reference ? coachContext.summary.notes.find((entry) => entry.id === item.reference?.noteId) : null;
                      return (
                        <article className="coach-exercise" key={item.catalogId}>
                          <p className="coach-exercise-index">{String(index + 1).padStart(2, '0')} · {exercise.minutes} MIN · START AT {exercise.startingBpm} BPM</p>
                          <h5>{exercise.title}</h5>
                          {note && <p className="coach-anchor">From your take: {note.name} on {note.chordName} at {note.position}.</p>}
                          <p><strong>Why:</strong> {exercise.purpose}</p>
                          <p><strong>Do:</strong> {exercise.action} {item.instruction}</p>
                          <p><strong>Next take:</strong> {exercise.improvement}</p>
                          {passage && <button type="button" className="coach-jump" onClick={() => selectCoachEvidence(passage.id)}>Open passage replay &amp; retry</button>}
                        </article>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </section>
        </section>
      </div>
      <footer>Client-side piano, MIDI, and microphone analysis · Fixed chord cues · No generated solos</footer>
    </main>
  );
}
