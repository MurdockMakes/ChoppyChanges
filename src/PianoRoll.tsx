import { useEffect, useMemo, useRef } from 'react';
import {
  BEATS_PER_BAR,
  chordAtBeat,
  formatPosition,
  pitchClass,
  spellNoteWithOctave,
  type NoteEvent,
  type Progression,
  type Resolution,
} from './theory';
import './PianoRoll.css';

interface PianoRollProps {
  notes: NoteEvent[];
  pending: NoteEvent[];
  currentBeat: number;
  resolutions: Resolution[];
  selectedId: string | null;
  onSelectResolution: (id: string) => void;
  progression: Progression;
}

const BEAT_WIDTH = 52;
const ROW_HEIGHT = 14;
const LEFT = 54;
const TOP = 68;
const BOTTOM = 16;
function noteRole(note: NoteEvent, progression: Progression) {
  const chord = chordAtBeat(note.startBeat, progression);
  const pc = pitchClass(note.pitch);
  if (pc === chord.root) return 'root';
  if (pc === chord.third || pc === chord.seventh) return 'guide';
  if (pc === chord.fifth) return 'fifth';
  if (chord.tensions.some((tension) => tension.pitchClass === pc)) return 'tension';
  return 'other';
}

export default function PianoRoll({ notes, pending, currentBeat, resolutions, selectedId, onSelectResolution, progression }: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const chartBeats = progression.chords.length * BEATS_PER_BAR;
  const allNotes = useMemo(() => [...notes, ...pending], [notes, pending]);
  const recordedEnd = Math.max(chartBeats, ...notes.map((note) => note.startBeat + note.durationBeats), ...pending.map(() => currentBeat));
  const totalBeats = Math.ceil(recordedEnd / chartBeats) * chartBeats;
  const minObserved = Math.min(60, ...allNotes.map((note) => note.pitch));
  const maxObserved = Math.max(83, ...allNotes.map((note) => note.pitch));
  const minPitch = Math.floor(minObserved / 12) * 12;
  const maxPitch = Math.ceil((maxObserved + 1) / 12) * 12 - 1;
  const rows = maxPitch - minPitch + 1;
  const width = LEFT + totalBeats * BEAT_WIDTH + 16;
  const height = TOP + rows * ROW_HEIGHT + BOTTOM;
  const noteY = (pitch: number) => TOP + (maxPitch - pitch) * ROW_HEIGHT;
  const noteX = (beat: number) => LEFT + beat * BEAT_WIDTH;
  const playheadBeat = totalBeats === chartBeats && currentBeat >= chartBeats
    ? currentBeat % chartBeats
    : Math.min(currentBeat, totalBeats);
  const selected = resolutions.find((resolution) => resolution.id === selectedId);

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport) return;
    const x = noteX(playheadBeat);
    const margin = Math.min(130, viewport.clientWidth * 0.25);
    if (x < viewport.scrollLeft + margin || x > viewport.scrollLeft + viewport.clientWidth - margin) {
      viewport.scrollTo({ left: Math.max(0, x - viewport.clientWidth * 0.32), behavior: 'auto' });
    }
  }, [Math.floor(playheadBeat * 2), progression.id, totalBeats]);

  return (
    <div className="piano-roll-scroll" aria-label="Piano roll timeline" ref={scrollRef}>
      <svg
        className="piano-roll"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label={`Piano roll with ${notes.length} recorded notes across ${totalBeats / BEATS_PER_BAR} bars`}
      >
        <defs>
          <marker id="resolution-arrowhead" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto" markerUnits="userSpaceOnUse">
            <path d="M 1 1 L 7 4 L 1 7 Z" fill="context-stroke" />
          </marker>
        </defs>

        <rect x={0} y={0} width={width} height={height} className="roll-surface" />
        {Array.from({ length: totalBeats / BEATS_PER_BAR }, (_, bar) => {
          const x = noteX(bar * BEATS_PER_BAR);
          const chord = progression.chords[bar % progression.chords.length];
          return (
            <g key={`bar-${bar}`}>
              <rect x={x} y={0} width={BEATS_PER_BAR * BEAT_WIDTH} height={TOP} className={`roll-bar-head roll-bar-head--${bar % progression.chords.length}`} />
              <text x={x + 10} y={20} className="roll-bar-number">BAR {bar + 1}</text>
              <text x={x + 10} y={39} className="roll-bar-chord">{chord.name}</text>
            </g>
          );
        })}
        {Array.from({ length: rows }, (_, row) => {
          const pitch = maxPitch - row;
          const y = TOP + row * ROW_HEIGHT;
          return (
            <g key={`row-${pitch}`}>
              <rect x={0} y={y} width={width} height={ROW_HEIGHT} className={`roll-row ${[1, 3, 6, 8, 10].includes(pitchClass(pitch)) ? 'roll-row--black' : ''}`} />
              {pitchClass(pitch) === 0 && <text x={LEFT - 7} y={y + 10} textAnchor="end" className="roll-pitch-label">{spellNoteWithOctave(pitch)}</text>}
            </g>
          );
        })}
        {Array.from({ length: totalBeats + 1 }, (_, gridBeat) => {
          const x = noteX(gridBeat);
          const barLine = gridBeat % BEATS_PER_BAR === 0;
          return (
            <g key={`grid-${gridBeat}`}>
              <line x1={x} x2={x} y1={TOP} y2={height - BOTTOM} className={barLine ? 'roll-grid roll-grid--bar' : 'roll-grid'} />
              {gridBeat < totalBeats && <text x={x + 5} y={57} className="roll-beat-label">{gridBeat % BEATS_PER_BAR + 1}</text>}
            </g>
          );
        })}

        {selected && (
          <rect
            x={noteX(selected.startBeat) - 3}
            y={TOP}
            width={Math.max(12, (selected.endBeat - selected.startBeat) * BEAT_WIDTH + 6)}
            height={rows * ROW_HEIGHT}
            className="roll-selected-band"
          />
        )}

        {allNotes.map((note) => {
          const chord = chordAtBeat(note.startBeat, progression);
          const duration = pending.some((held) => held.id === note.id)
            ? Math.max(0.12, currentBeat - note.startBeat)
            : Math.max(0.12, note.durationBeats);
          const x = noteX(note.startBeat) + 2;
          const y = noteY(note.pitch) + 1;
          const noteWidth = Math.max(10, duration * BEAT_WIDTH - 3);
          const name = spellNoteWithOctave(note.pitch, chord);
          const isPending = pending.some((held) => held.id === note.id);
          const isSelected = selected && (selected.from.id === note.id || selected.to?.id === note.id);
          return (
            <g key={note.id} className={`roll-note-group ${isSelected ? 'roll-note-group--selected' : ''}`}>
              <rect
                x={x} y={y} width={noteWidth} height={ROW_HEIGHT - 2} rx={3}
                className={`roll-note roll-note--${noteRole(note, progression)} ${isPending ? 'roll-note--pending' : ''}`}
              />
              {noteWidth >= 17 && <text x={x + 4} y={y + ROW_HEIGHT - 4} className="roll-note-label">{name}</text>}
              <title>{`${name} on ${chord.name} at ${formatPosition(note.startBeat)}`}</title>
            </g>
          );
        })}

        {resolutions.filter((resolution) => resolution.kind !== 'none' && resolution.to).map((resolution) => {
          const from = resolution.from;
          const to = resolution.to!;
          const x1 = noteX(from.startBeat + Math.min(from.durationBeats / 2, 0.22));
          const x2 = noteX(to.startBeat + Math.min(to.durationBeats / 2, 0.22));
          const y1 = noteY(from.pitch) + ROW_HEIGHT / 2;
          const y2 = noteY(to.pitch) + ROW_HEIGHT / 2;
          const lift = Math.min(y1, y2) - 22;
          const path = `M ${x1} ${y1} C ${x1 + 8} ${lift}, ${x2 - 8} ${lift}, ${x2} ${y2}`;
          return (
            <g
              key={resolution.id}
              className={`roll-resolution ${selectedId === resolution.id ? 'roll-resolution--selected' : ''} roll-resolution--${resolution.kind}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${resolution.title}: ${resolution.explanation}`}
              onClick={() => onSelectResolution(resolution.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectResolution(resolution.id); } }}
            >
              <path d={path} className="roll-resolution-hit" />
              <path d={path} className="roll-resolution-path" markerEnd="url(#resolution-arrowhead)" />
              <title>{resolution.explanation}</title>
            </g>
          );
        })}

        <line x1={noteX(playheadBeat)} x2={noteX(playheadBeat)} y1={0} y2={height - BOTTOM} className="roll-playhead" />
        <circle cx={noteX(playheadBeat)} cy={TOP - 2} r={4} className="roll-playhead-dot" />
      </svg>
    </div>
  );
}
