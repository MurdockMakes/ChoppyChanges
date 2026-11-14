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
import TranscriptionEditor from './TranscriptionEditor';
import { exampleTakeFor } from './example';
import CircleOfFifths, { type CircleForm } from './CircleOfFifths';
import { buildCoachContext, fallbackCoachPlan, passageForExercise, planExercise, planPriority, validateGeminiCoachResponse, type CoachEvidence, type CoachPlan } from './coach';
import { TakeReplay, takeEndBeat } from './takeReplay';

type PassageTarget = Pick<Resolution, 'startBeat' | 'endBeat' | 'title' | 'explanation'>;

export default function App() {
  const [progressionId, setProgressionId] = useState(DEFAULT_PROGRESSION.id);
  const progression = PROGRESSIONS.find((item) => item.id === progressionId) ?? DEFAULT_PROGRESSION;
  const replaySessionRef = useRef<TakeReplay | null>(null);
  const replayKindRef = useRef<'full' | 'passage' | null>(null);
  const replayStartIdRef = useRef(0);
  const fullCursorArmedRef = useRef(false);
  const [replayKind, setReplayKind] = useState<'full' | 'passage' | null>(null);
  const [fullReplayRate, setFullReplayRate] = useState(1);
  const fullReplayRateRef = useRef(1);
  const advanceReplay = useCallback((previousBeat: number, beat: number, mode: TransportMode, _audio: AudioEngine) => {
    if (mode !== 'replaying') return;
    replaySessionRef.current?.advance(previousBeat, beat);
  }, []);
  const transport = useTransport(advanceReplay, progression);
  const take = useTake(transport);
  const takesByProgressionRef = useRef<Record<string, { notes: NoteEvent[]; source: TakeSource }>>({});
  const midi = useMidi((pitch) => take.noteOn(pitch, 'midi'), (pitch) => take.noteOff(pitch, 'midi'));
  const micSegmenterRef = useRef(new MicNoteSegmenter());
  const recordingInputRef = useRef<'midi' | 'mic' | 'piano' | null>(null);
  const [micLivePitch, setMicLivePitch] = useState<number | null>(null);
  const onMicFrame = (frame: MicFrame) => {
    if (transport.modeRef.current !== 'recording' || recordingInputRef.current !== 'mic') return;
    // The analyser window is about 90 ms; place onsets near the middle of it.
    const sampleBeat = Math.max(0, transport.getBeat() - 0.07);
    take.appendNotes(micSegmenterRef.current.observe(frame.pitch, sampleBeat));
    const current = micSegmenterRef.current.currentNote;
    take.setPendingNotes(current ? [current] : []);
    setMicLivePitch(micSegmenterRef.current.observedPitch);
  };
  const onMicEnded = () => {
    if (recordingInputRef.current !== 'mic') return;
    take.appendNotes(micSegmenterRef.current.finalize(transport.getBeat()));
    take.setPendingNotes([]);
    setMicLivePitch(null);
    recordingInputRef.current = null;
    take.stopTake();
  };
  const mic = useMicrophone(onMicFrame, onMicEnded);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [practiceOf, setPracticeOf] = useState<PassageTarget | null>(null);
  const resolutions = useMemo(() => transport.mode === 'recording' ? [] : analyzeTake(take.notes, progression), [take.notes, transport.mode, progression]);
  const coachContext = useMemo(() => buildCoachContext(take.notes, progression, resolutions), [take.notes, progression, resolutions]);
  const [coachPlan, setCoachPlan] = useState<CoachPlan | null>(null);
  const [coachOrigin, setCoachOrigin] = useState<'gemini' | 'local' | null>(null);
  const [coachLoading, setCoachLoading] = useState(false);
  const [coachEvidenceId, setCoachEvidenceId] = useState<string | null>(null);
  const coachRequestRef = useRef<AbortController | null>(null);
  const coachEpochRef = useRef(0);
  const selectedResolution: Resolution | undefined = resolutions.find((resolution) => resolution.id === selectedId);
  const selectedCoachEvidence: CoachEvidence | undefined = coachContext.summary.evidence.find((item) => item.id === coachEvidenceId);
  const selectedPassage: PassageTarget | undefined = selectedResolution ?? selectedCoachEvidence;
  const takeEnd = takeEndBeat(take.notes);

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
    setCoachEvidenceId(null);
  }

  useEffect(() => {
    coachEpochRef.current += 1;
    coachRequestRef.current?.abort();
    coachRequestRef.current = null;
    setCoachLoading(false);
    setCoachPlan(null);
    setCoachOrigin(null);
    setCoachEvidenceId(null);
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
    const session = new TakeReplay(notes, transport.playNote, transport.stopTimed);
    replaySessionRef.current = session;
    replayKindRef.current = kind;
    setReplayKind(kind);
    const startId = replayStartIdRef.current;
    try {
      await transport.start('replaying', fromBeat, rate, untilBeat);
      if (startId !== replayStartIdRef.current || transport.modeRef.current !== 'replaying') return;
      session.start(transport.getBeat(), rate);
    } catch {
      if (startId === replayStartIdRef.current) stopReplay();
    }
  }

  function startFullReplay() {
    if (transport.modeRef.current !== 'stopped' || takeEnd <= 0) return;
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
      if (startId !== replayStartIdRef.current || transport.modeRef.current !== 'replaying') return;
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
    if (transport.modeRef.current !== 'stopped' || mic.requesting || nextId === progression.id) return;
    const next = PROGRESSIONS.find((item) => item.id === nextId);
    if (!next) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    takesByProgressionRef.current[progression.id] = { notes: take.notes.map((note) => ({ ...note })), source: take.source };
    const saved = takesByProgressionRef.current[nextId];
    mic.stop();
    micSegmenterRef.current.reset();
    recordingInputRef.current = null;
    setMicLivePitch(null);
    setSelectedId(null);
    setPracticeOf(null);
    setProgressionId(nextId);
    take.restoreTake(saved?.notes ?? [], saved?.source ?? null);
  }

  function selectCircleKey(keyId: string) {
    const form = progression.form === 'turnaround' ? 'ii-v-i' : progression.form;
    switchProgression(`${form}-${keyId}`);
  }

  function selectCircleForm(form: CircleForm) {
    switchProgression(`${form}-${progression.keyId}`);
  }

  function selectResolution(id: string) {
    if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay();
    fullCursorArmedRef.current = false;
    setSelectedId(id);
    setCoachEvidenceId(null);
    const resolution = resolutions.find((item) => item.id === id);
    if (resolution) transport.seek(resolution.startBeat);
  }

  function selectCoachEvidence(id: string) {
    const evidence = coachContext.summary.evidence.find((item) => item.id === id);
    if (!evidence) return;
    if (resolutions.some((item) => item.id === id)) selectResolution(id);
    else {
      if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay();
      fullCursorArmedRef.current = false;
      setSelectedId(null);
      setCoachEvidenceId(id);
      transport.seek(evidence.startBeat);
    }
    requestAnimationFrame(() => document.getElementById('selected-passage')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }));
  }

  function replaySelected() {
    if (!selectedPassage || transport.modeRef.current !== 'stopped') return;
    const fromBeat = Math.max(0, selectedPassage.startBeat - 0.5);
    const untilBeat = selectedPassage.endBeat + 0.6;
    const notes = take.notes.filter((note) => note.startBeat < untilBeat && note.startBeat + note.durationBeats > fromBeat);
    void startReplay('passage', notes, fromBeat, 0.6, untilBeat);
  }

  function startMidiTake(fromBeat = 0, rate = 1, practiceTarget: PassageTarget | null = null) {
    if (!midi.connected || transport.modeRef.current !== 'stopped') return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    recordingInputRef.current = 'midi';
    setPracticeOf(practiceTarget);
    setSelectedId(null);
    void take.startTake(fromBeat, rate, 'midi');
  }

  function startPianoTake(fromBeat = 0, rate = 1, practiceTarget: PassageTarget | null = null) {
    if (transport.modeRef.current !== 'stopped' || mic.requesting) return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    recordingInputRef.current = 'piano';
    setPracticeOf(practiceTarget);
    setSelectedId(null);
    void take.startTake(fromBeat, rate, 'piano');
  }

  async function startMicTake(fromBeat = 0, rate = 1, practiceTarget: PassageTarget | null = null) {
    if (transport.modeRef.current !== 'stopped') return;
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    const started = await mic.start();
    if (!started) return;
    micSegmenterRef.current.reset();
    recordingInputRef.current = 'mic';
    setMicLivePitch(null);
    setPracticeOf(practiceTarget);
    setSelectedId(null);
    await take.startTake(fromBeat, rate, 'mic');
  }

  function stopRecording() {
    if (recordingInputRef.current === 'mic') {
      take.appendNotes(micSegmenterRef.current.finalize(transport.getBeat()));
      take.setPendingNotes([]);
      setMicLivePitch(null);
      mic.stop();
    }
    recordingInputRef.current = null;
    take.stopTake();
  }

  function discardAndLoadExample() {
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    mic.stop();
    micSegmenterRef.current.reset();
    recordingInputRef.current = null;
    setMicLivePitch(null);
    setPracticeOf(null);
    setSelectedId(null);
    take.loadExample(exampleTakeFor(progression));
  }

  function clearTake() {
    clearReplaySession();
    fullCursorArmedRef.current = false;
    invalidateCoach();
    mic.stop();
    micSegmenterRef.current.reset();
    recordingInputRef.current = null;
    setMicLivePitch(null);
    setPracticeOf(null);
    setSelectedId(null);
    take.clearTake();
  }

  function practiceSelected(input: 'midi' | 'mic' | 'piano') {
    if (!selectedPassage) return;
    const leadInBeat = Math.max(0, Math.floor(selectedPassage.startBeat) - 1);
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
          <span className={`mode-badge mode-${transport.mode}`}><i />{transport.mode === 'stopped' ? 'READY' : transport.mode === 'playing' ? 'LOOPING' : transport.mode === 'recording' ? recordingInputRef.current === 'mic' ? 'SAX TAKE' : recordingInputRef.current === 'piano' ? 'PIANO TAKE' : 'MIDI TAKE' : transport.mode === 'paused' ? 'REPLAY PAUSED' : 'REPLAYING'}</span>
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
              {mic.active && <small>Heard: {micLivePitch !== null ? spellNoteWithOctave(micLivePitch, chord) : mic.rms > 0.02 ? 'sound detected · pitch uncertain' : 'listening…'}</small>}
            </div>
          </div>
          <div className="record-controls">
            <button className="button button-secondary" onClick={midi.connect} disabled={!midi.supported || midi.connected}>Connect MIDI</button>
            <button className="button button-primary" onClick={() => startMidiTake()} disabled={!midi.connected || transport.mode !== 'stopped' || mic.requesting}>Start MIDI take</button>
            <button className="button button-primary" onClick={() => startPianoTake()} disabled={transport.mode !== 'stopped' || mic.requesting}>Start piano take</button>
            <button className="button button-mic" onClick={() => void startMicTake()} disabled={!mic.supported || transport.mode !== 'stopped' || mic.requesting}>{mic.requesting ? 'Requesting mic…' : 'Start sax take'}</button>
            <button className="button button-stop" onClick={stopRecording} disabled={transport.mode !== 'recording'}>Stop take</button>
            <button className="button button-example" onClick={discardAndLoadExample}>Load example take</button>
          </div>
          <div className="transport-controls">
            <button onClick={() => void transport.start('playing')} disabled={transport.mode !== 'stopped'}>▶ &nbsp; Play loop</button>
            <button onClick={() => transport.mode === 'recording' ? stopRecording() : transport.mode === 'replaying' || transport.mode === 'paused' ? replayKindRef.current === 'full' ? stopFullReplay() : stopReplay() : transport.stop()} disabled={transport.mode === 'stopped'}>■ &nbsp; Stop</button>
            <button onClick={clearTake} disabled={take.notes.length === 0 && take.pending.length === 0 && !mic.active}>Clear</button>
          </div>
          <div className="sound-toggles">
            <label><input type="checkbox" checked={transport.metronome} onChange={(event) => transport.setMetronome(event.target.checked)} /> Metronome</label>
            <label><input type="checkbox" checked={transport.chordCues} onChange={(event) => transport.setChordCues(event.target.checked)} /> Chord cues</label>
          </div>
        </section>

        <section className="panel progression-panel" aria-label="Chord progression">
          <div className="panel-heading progression-heading">
            <div><p className="eyebrow">02 / THE CHANGES</p><h2>{progression.label}</h2></div>
            <span className="tempo-pill">4/4 &nbsp; · &nbsp; {BPM} BPM</span>
          </div>
          <div className="progression-canvas">
            <CircleOfFifths
              keys={CIRCLE_KEYS}
              selectedKeyId={progression.keyId}
              selectedForm={progression.form === 'turnaround' ? null : progression.form}
              onSelectKey={selectCircleKey}
              onSelectForm={selectCircleForm}
              disabled={transport.mode !== 'stopped' || mic.requesting}
            />
            <div className={`chart ${progression.form === 'blues' ? 'chart--blues' : ''}`}>
              {progression.chords.map((bar, index) => (
                <div key={index} className={`chart-bar ${progression.form === 'blues' ? 'chart-bar--compact' : ''} ${index === activeBar ? 'active' : ''}`}>
                  <span className="chart-bar-number">BAR {String(index + 1).padStart(2, '0')}</span>
                  <strong>{bar.name}</strong>
                  <span className="chart-bar-beat">{index === activeBar ? `BEAT ${Math.floor(loopBeat % BEATS_PER_BAR) + 1} / 4` : '4 BEATS'}</span>
                  <span className="chart-progress" style={{ width: index === activeBar ? `${((loopBeat % BEATS_PER_BAR) / BEATS_PER_BAR) * 100}%` : '0%' }} />
                </div>
              ))}
            </div>
          </div>
          <div className="progression-meta">
            <p>{progression.description}</p>
            <button type="button" aria-pressed={progression.id === 'turnaround-c'} disabled={transport.mode !== 'stopped' || mic.requesting} onClick={() => switchProgression('turnaround-c')}>C turnaround preset</button>
          </div>
          <div className="chord-context">
            <div><span>NOW PLAYING</span><strong>{chord.name}</strong></div>
            <span className="chord-arrow" aria-hidden="true">→</span>
            <div><span>UP NEXT</span><strong>{nextChord.name}</strong></div>
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
          <p className="take-summary">{transport.mode === 'recording' ? recordingInputRef.current === 'mic' ? 'Listening for a single-note sax phrase…' : recordingInputRef.current === 'piano' ? 'Recording on-screen piano notes…' : 'Recording MIDI notes…' : take.source === 'example' ? 'Example take loaded. Edit its notes or select an evidence card.' : take.source === 'midi' ? 'MIDI take captured. Select an evidence card to inspect a moment.' : take.source === 'piano' ? 'Piano take captured. Select an evidence card to inspect a moment.' : take.source === 'mic' ? 'Sax phrase transcribed in concert pitch. Correct notes below, then inspect the evidence.' : 'Play the piano freely, start a take, or load the example.'}{take.pending.length ? ` ${take.pending.length} held.` : ''}</p>
          {practiceOf && <p className="practice-context"><strong>Practice target:</strong> {practiceOf.explanation} {transport.mode === 'recording' ? 'Play the passage, then stop the take to see fresh evidence.' : 'Your new take is shown below.'}</p>}
          <div className="take-replay" aria-label="Full take replay controls">
            <div className="take-replay-buttons">
              <button type="button" onClick={startFullReplay} disabled={takeEnd <= 0 || transport.mode !== 'stopped'}>▶ Replay full take</button>
              <button type="button" onClick={replayKind === 'full' && transport.mode === 'paused' ? () => void resumeFullReplay() : pauseFullReplay} disabled={replayKind !== 'full' || (transport.mode !== 'replaying' && transport.mode !== 'paused')}>{transport.mode === 'paused' && replayKind === 'full' ? '▶ Resume' : 'Ⅱ Pause'}</button>
              <button type="button" onClick={stopFullReplay} disabled={replayKind !== 'full' || (transport.mode !== 'replaying' && transport.mode !== 'paused')}>■ Stop replay</button>
              <label>Speed <select aria-label="Full take playback speed" value={fullReplayRate} onChange={(event) => changeFullReplayRate(Number(event.target.value))} disabled={transport.mode === 'recording' || transport.mode === 'playing' || replayKind === 'passage'}>
                {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => <option key={rate} value={rate}>{rate}×</option>)}
              </select></label>
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
            resolutions={resolutions}
            selectedId={selectedId}
            onSelectResolution={selectResolution}
            onSeekBeat={takeEnd > 0 && (transport.mode === 'stopped' || replayKind === 'full' && (transport.mode === 'replaying' || transport.mode === 'paused')) ? seekFullReplay : undefined}
            linearPlayhead={take.notes.length > 0 && transport.mode !== 'playing' && transport.mode !== 'recording'}
            progression={progression}
          />
          <TranscriptionEditor notes={take.notes} onChange={(updated) => { if (transport.mode === 'replaying' || transport.mode === 'paused') stopReplay(); fullCursorArmedRef.current = false; invalidateCoach(); take.replaceNotes(updated); }} visible={(take.source === 'mic' || take.source === 'example') && transport.mode !== 'recording'} origin={take.source === 'example' ? 'example' : 'mic'} progression={progression} />
          <p className="roll-caption">Click or drag the timeline header to seek · arrows mark detected moves</p>
        </section>

        <section className="panel analysis-panel" aria-label="Phrase analysis">
          <div className="panel-heading analysis-heading"><p className="eyebrow">04 / WHAT HAPPENED</p><h2>Phrase evidence</h2></div>
          {resolutions.length === 0 ? (
            <p className="analysis-empty">{transport.mode === 'recording' ? 'Stop the take to see resolutions.' : 'Record a piano, MIDI, or sax take, or load the example to see specific resolutions.'}</p>
          ) : (
            <div className="evidence-list">
              {resolutions.map((resolution) => (
                <button
                  key={resolution.id}
                  className={`evidence-card ${resolution.kind === 'none' ? 'neutral' : resolution.kind} ${selectedId === resolution.id ? 'selected' : ''}`}
                  aria-pressed={selectedId === resolution.id}
                  onClick={() => selectResolution(resolution.id)}
                >
                  <span>{resolution.kind === 'none' ? 'OPEN QUESTION' : 'RESOLUTION FOUND'}</span>
                  <strong>{resolution.title}</strong>
                  <small>{resolution.explanation}</small>
                </button>
              ))}
            </div>
          )}
          {selectedPassage && (
            <div className="selected-passage" id="selected-passage">
              <p className="eyebrow">SELECTED PASSAGE · {formatPosition(selectedPassage.startBeat)}</p>
              <strong>{selectedPassage.title}</strong>
              <p>{selectedPassage.explanation}</p>
              <div className="selected-actions">
                <button onClick={replaySelected} disabled={transport.mode !== 'stopped'}>Replay at 60% speed</button>
                <button onClick={() => practiceSelected('piano')} disabled={transport.mode !== 'stopped' || mic.requesting}>Try with piano</button>
                <button onClick={() => practiceSelected('midi')} disabled={!midi.connected || transport.mode !== 'stopped'}>Try with MIDI</button>
                <button onClick={() => practiceSelected('mic')} disabled={!mic.supported || transport.mode !== 'stopped' || mic.requesting}>Try with mic</button>
              </div>
              {!midi.connected && <small>Use the on-screen piano, connect MIDI, or record with the sax microphone.</small>}
            </div>
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
