import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { COMPUTER_PIANO_KEYS, ComputerPianoInput, KeyboardPressController, releaseLostPointerCaptures } from './keyboardInput';
import { chordAtBeat, nextChordAtBeat, pitchClass, spellNote, spellNoteWithOctave, type Progression } from './theory';
import './Keyboard.css';

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);
type PianoRange = { start: number; end: number };

function includeReplayPitches(range: PianoRange, pitches: readonly number[]): PianoRange {
  if (pitches.length === 0) return range;
  const lowest = Math.min(...pitches);
  const highest = Math.max(...pitches);
  return {
    start: Math.max(0, Math.min(range.start, Math.floor(lowest / 12) * 12)),
    end: Math.min(127, Math.max(range.end, Math.ceil((highest + 1) / 12) * 12 - 1)),
  };
}

type KeyRole = { className: string; short: string; long: string };

function roleFor(pitch: number, beat: number, progression: Progression): KeyRole {
  const chord = chordAtBeat(beat, progression);
  const pc = pitchClass(pitch);
  if (pc === chord.root) return { className: 'root', short: 'ROOT', long: `root of ${chord.name}` };
  if (pc === chord.third) return { className: 'guide', short: '3RD', long: `third of ${chord.name}` };
  if (pc === chord.seventh) return { className: 'guide', short: '7TH', long: `seventh of ${chord.name}` };
  if (pc === chord.fifth) return { className: 'fifth', short: '5TH', long: `fifth of ${chord.name}` };
  const tension = chord.tensions.find((item) => item.pitchClass === pc);
  if (tension) return { className: 'tension', short: tension.label, long: `${tension.label} tension on ${chord.name}` };
  return { className: 'plain', short: '', long: `outside the named chord colors on ${chord.name}` };
}

export interface KeyboardProps {
  currentBeat: number;
  pressed: number[];
  followPressed?: boolean;
  playbackPaused?: boolean;
  progression: Progression;
  onNoteOn: (pitch: number) => void;
  onNoteOff: (pitch: number) => void;
}

export default function Keyboard({ currentBeat, pressed, followPressed = false, playbackPaused = false, progression, onNoteOn, onNoteOff }: KeyboardProps) {
  const [localPressed, setLocalPressed] = useState<number[]>([]);
  const [computerActive, setComputerActive] = useState(false);
  const [followRange, setFollowRange] = useState<PianoRange | null>(null);
  const handlersRef = useRef({ onNoteOn, onNoteOff });
  handlersRef.current = { onNoteOn, onNoteOff };
  const controllerRef = useRef<KeyboardPressController | null>(null);
  if (!controllerRef.current) {
    controllerRef.current = new KeyboardPressController(
      (pitch) => handlersRef.current.onNoteOn(pitch),
      (pitch) => handlersRef.current.onNoteOff(pitch),
      setLocalPressed,
    );
  }
  const controller = controllerRef.current;
  const startPitchRef = useRef(60);
  const computerRef = useRef<ComputerPianoInput | null>(null);
  if (!computerRef.current) computerRef.current = new ComputerPianoInput(controller, () => startPitchRef.current);
  const computer = computerRef.current;
  const pointerTargetsRef = useRef(new Map<number, HTMLButtonElement>());
  const captureWatchRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  function watchPointerCaptures() {
    if (captureWatchRef.current !== null) return;
    const tick = () => {
      captureWatchRef.current = null;
      releaseLostPointerCaptures(pointerTargetsRef.current, (pointerId) => controller.release(`pointer:${pointerId}`));
      if (pointerTargetsRef.current.size) captureWatchRef.current = requestAnimationFrame(tick);
    };
    captureWatchRef.current = requestAnimationFrame(tick);
  }

  useEffect(() => {
    const releasePointer = (event: globalThis.PointerEvent) => {
      pointerTargetsRef.current.delete(event.pointerId);
      controller.release(`pointer:${event.pointerId}`);
    };
    const releaseAll = () => {
      pointerTargetsRef.current.clear();
      computer.releaseHeld();
      controller.releaseAll();
    };
    const computerKeyDown = (event: globalThis.KeyboardEvent) => computer.keyDown(event);
    const computerKeyUp = (event: globalThis.KeyboardEvent) => computer.keyUp(event);
    const releaseOnVisibilityLoss = () => {
      if (document.hidden) releaseAll();
    };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('keydown', computerKeyDown);
    window.addEventListener('keyup', computerKeyUp);
    window.addEventListener('blur', releaseAll);
    document.addEventListener('visibilitychange', releaseOnVisibilityLoss);
    return () => {
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('keydown', computerKeyDown);
      window.removeEventListener('keyup', computerKeyUp);
      window.removeEventListener('blur', releaseAll);
      document.removeEventListener('visibilitychange', releaseOnVisibilityLoss);
      if (captureWatchRef.current !== null) cancelAnimationFrame(captureWatchRef.current);
      captureWatchRef.current = null;
      computer.setActive(false);
      releaseAll();
    };
  }, [computer, controller]);

  function toggleComputerKeys() {
    const active = !computer.isActive;
    computer.setActive(active);
    setComputerActive(active);
  }

  function pointerDown(event: PointerEvent<HTMLButtonElement>, pitch: number) {
    event.preventDefault();
    controller.press(`pointer:${event.pointerId}`, pitch);
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
      pointerTargetsRef.current.set(event.pointerId, event.currentTarget);
      watchPointerCaptures();
    } catch { /* window fallback handles release */ }
  }

  function pointerEnd(event: PointerEvent<HTMLButtonElement>) {
    pointerTargetsRef.current.delete(event.pointerId);
    controller.release(`pointer:${event.pointerId}`);
  }

  function keyDown(event: KeyboardEvent<HTMLButtonElement>, pitch: number) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    controller.press(`keyboard:${pitch}`, pitch);
  }

  function keyUp(event: KeyboardEvent<HTMLButtonElement>, pitch: number) {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    controller.release(`keyboard:${pitch}`);
  }

  const chord = chordAtBeat(currentBeat, progression);
  const next = nextChordAtBeat(currentBeat, progression);
  const allPressed = [...new Set([...pressed, ...localPressed])];
  const lowest = allPressed.length ? Math.min(...allPressed) : 60;
  const highest = allPressed.length ? Math.max(...allPressed) : 83;
  const normalStartPitch = lowest < 60 ? Math.max(24, Math.floor(lowest / 12) * 12)
    : highest > 83 ? Math.min(96, Math.floor(highest / 12) * 12) : 60;
  // Replay keeps the computer-key octaves stable and grows the visible range
  // only when notes demand it. This keeps focused keys mounted while replaying.
  const replayPitchKey = followPressed ? pressed.join(',') : '';
  const replayRange = includeReplayPitches(followRange ?? { start: 60, end: 83 }, pressed);
  const startPitch = followPressed ? replayRange.start : normalStartPitch;
  const endPitch = followPressed ? replayRange.end : normalStartPitch + 23;
  const computerStartPitch = followPressed ? 60 : startPitch;
  startPitchRef.current = computerStartPitch;
  const pitches = useMemo(() => Array.from({ length: endPitch - startPitch + 1 }, (_, index) => startPitch + index), [startPitch, endPitch]);
  const whites = useMemo(() => pitches.filter((pitch) => !BLACK_KEYS.has(pitchClass(pitch))), [pitches]);

  useLayoutEffect(() => {
    if (!followPressed) {
      setFollowRange(null);
      return;
    }
    setFollowRange((previous) => {
      const next = includeReplayPitches(previous ?? { start: 60, end: 83 }, pressed);
      return previous?.start === next.start && previous.end === next.end ? previous : next;
    });
  }, [followPressed, replayPitchKey]);

  useLayoutEffect(() => {
    if (!followPressed || pressed.length === 0) return;
    const viewport = scrollRef.current;
    if (!viewport) return;
    const activeKeys = pressed.map((pitch) => viewport.querySelector<HTMLButtonElement>(`[data-pitch="${pitch}"]`)).filter((key): key is HTMLButtonElement => key !== null);
    if (activeKeys.length === 0) return;
    const left = Math.min(...activeKeys.map((key) => key.offsetLeft));
    const right = Math.max(...activeKeys.map((key) => key.offsetLeft + key.offsetWidth));
    const padding = 12;
    if (left >= viewport.scrollLeft + padding && right <= viewport.scrollLeft + viewport.clientWidth - padding) return;
    const span = right - left;
    const target = span <= viewport.clientWidth - padding * 2
      ? left - (viewport.clientWidth - span) / 2
      : activeKeys[0].offsetLeft - padding;
    viewport.scrollTo({ left: Math.max(0, target), behavior: 'auto' });
  }, [replayPitchKey, startPitch, endPitch, followPressed]);
  const nextTargets = useMemo(() => [next.third, next.seventh].map((pc) => {
    const pitch = pitches.find((candidate) => candidate >= computerStartPitch && candidate < computerStartPitch + 24 && pitchClass(candidate) === pc) ?? pc;
    return spellNote(pitch, next);
  }), [next, pitches, computerStartPitch]);
  const whiteWidth = 100 / whites.length;

  const key = (pitch: number, black: boolean) => {
    const computerKey = COMPUTER_PIANO_KEYS[pitch - computerStartPitch];
    const role = roleFor(pitch, currentBeat, progression);
    const nextRole = pitchClass(pitch) === next.third ? 'next 3rd' : pitchClass(pitch) === next.seventh ? 'next 7th' : '';
    const nextTarget = Boolean(nextRole);
    const isPressed = allPressed.includes(pitch);
    const left = black
      ? whites.filter((candidate) => candidate < pitch).length * whiteWidth - whiteWidth * 0.31
      : whites.indexOf(pitch) * whiteWidth;
    const width = black ? whiteWidth * 0.62 : whiteWidth;
    return (
      <button
        key={pitch}
        type="button"
        data-pitch={pitch}
        className={`piano-key ${black ? 'black' : 'white'} ${role.className}${nextTarget ? ' next-target' : ''}${isPressed ? ' is-pressed' : ''}`}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${spellNoteWithOctave(pitch, chord)}${computerKey ? ` · computer key ${computerKey.label}` : ''}: ${role.long}${nextRole ? `; ${nextRole} of ${next.name}` : ''}`}
        aria-label={`${spellNoteWithOctave(pitch, chord)}${computerKey ? `, computer key ${computerKey.label}` : ''}, ${role.long}${nextRole ? `, ${nextRole} of ${next.name}` : ''}${isPressed ? ', being played' : ''}`}
        aria-pressed={isPressed}
        onPointerDown={(event) => pointerDown(event, pitch)}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onKeyDown={(event) => keyDown(event, pitch)}
        onKeyUp={(event) => keyUp(event, pitch)}
        onBlur={() => controller.release(`keyboard:${pitch}`)}
      >
        {computerKey && <span className="piano-key-binding" aria-hidden="true">{computerKey.label}</span>}
        <span className="piano-key-name">{spellNoteWithOctave(pitch, chord)}</span>
        {role.short && <span className="piano-key-role">{role.short}</span>}
        {nextTarget && <span className="piano-key-next">NEXT</span>}
      </button>
    );
  };

  return (
    <section className={`keyboard-card${computerActive ? ' computer-active' : ''}`} aria-label="Live note guide">
      <div className="keyboard-card-head">
        <div>
          <p className="eyebrow">PLAYABLE NOTE GUIDE · {spellNoteWithOctave(startPitch)}–{spellNoteWithOctave(endPitch)}</p>
          <h2>Play over <span>{chord.name}</span></h2>
        </div>
        <div className="keyboard-head-aside">
          {followPressed && <p className="replay-active-notes" role="status" aria-atomic="true">{playbackPaused ? 'At playhead' : 'Now sounding'}: {pressed.length ? [...new Set(pressed)].map((pitch) => spellNoteWithOctave(pitch, chord)).join(' · ') : '—'}</p>}
          <div className="next-hint">Next <strong>{next.name}</strong> targets <strong>{nextTargets.join(' · ')}</strong> (outlined)</div>
        </div>
      </div>
      <div className="computer-keys-control">
        <button type="button" className={`computer-keys-toggle${computerActive ? ' is-active' : ''}`} aria-pressed={computerActive} onClick={toggleComputerKeys}>
          {computerActive ? 'Computer keys on' : 'Activate computer keys'}
        </button>
        <span className="computer-keys-status" role="status">{computerActive ? 'Active · hold keys for notes and chords' : 'Off · click to play from your computer keyboard'}</span>
      </div>
      <div className="keyboard-scroll" ref={scrollRef}>
        <div className="piano-keys" style={{ minWidth: Math.max(655, whites.length * 44) }} role="group" aria-label={`Playable keyboard for ${chord.name}; outlined keys are third and seventh of ${next.name}`}>
          {whites.map((pitch) => key(pitch, false))}
          {pitches.filter((pitch) => BLACK_KEYS.has(pitchClass(pitch))).map((pitch) => key(pitch, true))}
        </div>
      </div>
      <details className="keyboard-guide-details">
        <summary>Keyboard help &amp; key colors</summary>
        <p className="keyboard-help">Labeled piano notes show their computer keys. Most white notes use the home row; the highest three use comma, period, and slash. Sharps use the row above. Click or touch to play freely, or Tab to a piano key and hold Space or Enter. Start piano take to record.</p>
        <div className="keyboard-legend" aria-label="Key color legend">
          <span><i className="legend-root" />Root</span>
          <span><i className="legend-guide" />3rd / 7th</span>
          <span><i className="legend-fifth" />5th</span>
          <span><i className="legend-tension" />Named tension</span>
          <span><i className="legend-next" />Next chord target</span>
          <span><i className="legend-pressed" />Played key</span>
        </div>
      </details>
    </section>
  );
}
