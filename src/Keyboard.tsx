import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { KeyboardPressController, releaseLostPointerCaptures } from './keyboardInput';
import { chordAtBeat, nextChordAtBeat, pitchClass, spellNote, spellNoteWithOctave, type Progression } from './theory';
import './Keyboard.css';

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

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
  progression: Progression;
  onNoteOn: (pitch: number) => void;
  onNoteOff: (pitch: number) => void;
}

export default function Keyboard({ currentBeat, pressed, progression, onNoteOn, onNoteOff }: KeyboardProps) {
  const [localPressed, setLocalPressed] = useState<number[]>([]);
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
  const pointerTargetsRef = useRef(new Map<number, HTMLButtonElement>());
  const captureWatchRef = useRef<number | null>(null);

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
      controller.releaseAll();
    };
    window.addEventListener('pointerup', releasePointer);
    window.addEventListener('pointercancel', releasePointer);
    window.addEventListener('blur', releaseAll);
    return () => {
      window.removeEventListener('pointerup', releasePointer);
      window.removeEventListener('pointercancel', releasePointer);
      window.removeEventListener('blur', releaseAll);
      if (captureWatchRef.current !== null) cancelAnimationFrame(captureWatchRef.current);
      captureWatchRef.current = null;
      releaseAll();
    };
  }, [controller]);

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
  const startPitch = lowest < 60 ? Math.max(24, Math.floor(lowest / 12) * 12)
    : highest > 83 ? Math.min(96, Math.floor(highest / 12) * 12) : 60;
  const endPitch = startPitch + 23;
  const pitches = useMemo(() => Array.from({ length: 24 }, (_, index) => startPitch + index), [startPitch]);
  const whites = useMemo(() => pitches.filter((pitch) => !BLACK_KEYS.has(pitchClass(pitch))), [pitches]);
  const nextTargets = useMemo(() => [next.third, next.seventh].map((pc) => {
    const pitch = pitches.find((candidate) => pitchClass(candidate) === pc) ?? pc;
    return spellNote(pitch, next);
  }), [next, pitches]);
  const whiteWidth = 100 / whites.length;

  const key = (pitch: number, black: boolean) => {
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
        className={`piano-key ${black ? 'black' : 'white'} ${role.className}${nextTarget ? ' next-target' : ''}${isPressed ? ' is-pressed' : ''}`}
        style={{ left: `${left}%`, width: `${width}%` }}
        title={`${spellNoteWithOctave(pitch, chord)}: ${role.long}${nextRole ? `; ${nextRole} of ${next.name}` : ''}`}
        aria-label={`${spellNoteWithOctave(pitch, chord)}, ${role.long}${nextRole ? `, ${nextRole} of ${next.name}` : ''}${isPressed ? ', being played' : ''}`}
        aria-pressed={isPressed}
        onPointerDown={(event) => pointerDown(event, pitch)}
        onPointerUp={pointerEnd}
        onPointerCancel={pointerEnd}
        onLostPointerCapture={pointerEnd}
        onKeyDown={(event) => keyDown(event, pitch)}
        onKeyUp={(event) => keyUp(event, pitch)}
        onBlur={() => controller.release(`keyboard:${pitch}`)}
      >
        <span className="piano-key-name">{spellNoteWithOctave(pitch, chord)}</span>
        {role.short && <span className="piano-key-role">{role.short}</span>}
        {nextTarget && <span className="piano-key-next">NEXT</span>}
      </button>
    );
  };

  return (
    <section className="keyboard-card" aria-label="Live note guide">
      <div className="keyboard-card-head">
        <div>
          <p className="eyebrow">PLAYABLE NOTE GUIDE · {spellNoteWithOctave(startPitch)}–{spellNoteWithOctave(endPitch)}</p>
          <h2>Play over <span>{chord.name}</span></h2>
        </div>
        <div className="next-hint">Next <strong>{next.name}</strong> targets <strong>{nextTargets.join(' · ')}</strong> (outlined)</div>
      </div>
      <div className="keyboard-scroll">
        <div className="piano-keys" role="group" aria-label={`Playable keyboard for ${chord.name}; outlined keys are third and seventh of ${next.name}`}>
          {whites.map((pitch) => key(pitch, false))}
          {pitches.filter((pitch) => BLACK_KEYS.has(pitchClass(pitch))).map((pitch) => key(pitch, true))}
        </div>
      </div>
      <p className="keyboard-help">Click or touch to play freely. Tab to a key, then hold Space or Enter. Start piano take to record.</p>
      <div className="keyboard-legend" aria-label="Key color legend">
        <span><i className="legend-root" />Root</span>
        <span><i className="legend-guide" />3rd / 7th</span>
        <span><i className="legend-fifth" />5th</span>
        <span><i className="legend-tension" />Named tension</span>
        <span><i className="legend-next" />Next chord target</span>
        <span><i className="legend-pressed" />Played key</span>
      </div>
    </section>
  );
}
