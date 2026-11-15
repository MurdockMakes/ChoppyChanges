import { useEffect, useMemo, useRef } from 'react';
import type { CoachEvidence } from './coach';
import {
  BEATS_PER_BAR,
  chordAtBeat,
  formatPosition,
  pitchClass,
  spellNoteWithOctave,
  type NoteEvent,
  type Progression,
} from './theory';
import { buildNoteEvidenceIndex } from './noteEvidence';
import './PianoRoll.css';

interface PianoRollProps {
  notes: NoteEvent[];
  pending: NoteEvent[];
  currentBeat: number;
  evidence: CoachEvidence[];
  selectedEvidenceId: string | null;
  selectedNoteId: string | null;
  onSelectEvidence: (id: string) => void;
  onSelectNote: (id: string) => void;
  onSeekBeat?: (beat: number) => void;
  linearPlayhead?: boolean;
  visible?: boolean;
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

export default function PianoRoll({ notes, pending, currentBeat, evidence, selectedEvidenceId, selectedNoteId, onSelectEvidence, onSelectNote, onSeekBeat, linearPlayhead = false, visible = true, progression }: PianoRollProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const evidenceByNote = useMemo(() => buildNoteEvidenceIndex(notes, evidence), [notes, evidence]);
  const noteById = useMemo(() => new Map(notes.map((note) => [note.id, note])), [notes]);
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
  const playheadBeat = !linearPlayhead && totalBeats === chartBeats && currentBeat >= chartBeats
    ? currentBeat % chartBeats
    : Math.min(currentBeat, totalBeats);
  const selected = evidence.find((item) => item.id === selectedEvidenceId);

  const seekFromPointer = (event: React.PointerEvent<SVGRectElement>) => {
    if (!onSeekBeat) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    onSeekBeat(Math.max(0, Math.min(totalBeats, ((event.clientX - bounds.left) / bounds.width) * totalBeats)));
  };

  useEffect(() => {
    const viewport = scrollRef.current;
    if (!viewport || !visible) return;
    const x = noteX(playheadBeat);
    const margin = Math.min(130, viewport.clientWidth * 0.25);
    if (x < viewport.scrollLeft + margin || x > viewport.scrollLeft + viewport.clientWidth - margin) {
      viewport.scrollTo({ left: Math.max(0, x - viewport.clientWidth * 0.32), behavior: 'auto' });
    }
  }, [Math.floor(playheadBeat * 2), progression.id, totalBeats, visible]);

  return (
    <div className="piano-roll-scroll" aria-label="Piano roll timeline" ref={scrollRef}>
      <svg
        className="piano-roll"
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        role="group"
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

        {evidence.filter((item) => item.kind !== 'no-nearby-resolution' && item.noteIds.length >= 2).map((item) => {
          const from = noteById.get(item.noteIds[0]);
          const to = noteById.get(item.noteIds[1]);
          if (!from || !to) return null;
          const x1 = noteX(from.startBeat + Math.min(from.durationBeats / 2, 0.22));
          const x2 = noteX(to.startBeat + Math.min(to.durationBeats / 2, 0.22));
          const y1 = noteY(from.pitch) + ROW_HEIGHT / 2;
          const y2 = noteY(to.pitch) + ROW_HEIGHT / 2;
          const lift = Math.min(y1, y2) - 22;
          const path = `M ${x1} ${y1} C ${x1 + 8} ${lift}, ${x2 - 8} ${lift}, ${x2} ${y2}`;
          return (
            <g
              key={item.id}
              className={`roll-resolution ${selectedEvidenceId === item.id ? 'roll-resolution--selected' : ''} roll-resolution--${item.kind}`}
              role="button"
              tabIndex={0}
              aria-label={`Select ${item.title}: ${item.explanation}`}
              aria-pressed={selectedEvidenceId === item.id}
              onClick={() => onSelectEvidence(item.id)}
              onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectEvidence(item.id); } }}
            >
              <path d={path} className="roll-resolution-hit" />
              <path d={path} className="roll-resolution-path" markerEnd="url(#resolution-arrowhead)" />
              <title>{item.explanation}</title>
            </g>
          );
        })}

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
          const related = evidenceByNote.get(note.id) ?? [];
          const isOpen = related.some((item) => item.kind === 'no-nearby-resolution');
          const isSelected = selected?.noteIds.includes(note.id);
          const isSelectedNote = selectedNoteId === note.id;
          const description = `${name} on ${chord.name} at ${formatPosition(note.startBeat)}. ${related.length === 0 ? 'No related phrase evidence.' : `${related.length} related evidence ${related.length === 1 ? 'item' : 'items'}: ${related.map((item) => item.title).join('; ')}.`}`;
          return (
            <g
              key={note.id}
              className={`roll-note-group ${isSelected ? 'roll-note-group--selected' : ''} ${isSelectedNote ? 'roll-note-group--selected-note' : ''} ${isOpen ? 'roll-note-group--open' : ''}`}
              role={isPending ? undefined : 'button'}
              tabIndex={isPending ? undefined : 0}
              aria-label={isPending ? undefined : `Select note ${description}`}
              aria-pressed={isPending ? undefined : isSelectedNote}
              onClick={isPending ? undefined : () => onSelectNote(note.id)}
              onKeyDown={isPending ? undefined : (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectNote(note.id); } }}
            >
              <rect
                x={x} y={y} width={noteWidth} height={ROW_HEIGHT - 2} rx={3}
                className={`roll-note roll-note--${noteRole(note, progression)} ${isPending ? 'roll-note--pending' : ''}`}
              />
              {noteWidth >= 17 && <text x={x + 4} y={y + ROW_HEIGHT - 4} className="roll-note-label">{name}</text>}
              {related.length > 0 && !isPending && (
                <g className={`roll-note-badge ${isOpen ? 'roll-note-badge--open' : ''}`} aria-hidden="true">
                  <circle cx={x + noteWidth - 2} cy={y - 2} r={6.5} />
                  <text x={x + noteWidth - 2} y={y + 1.3} textAnchor="middle">{isOpen ? '?' : related.length > 1 ? related.length : '•'}</text>
                </g>
              )}
              <title>{description}</title>
            </g>
          );
        })}

        {onSeekBeat && <rect
          x={LEFT} y={0} width={totalBeats * BEAT_WIDTH} height={TOP}
          className="roll-seek-region"
          aria-hidden="true"
          onPointerDown={(event) => { event.currentTarget.setPointerCapture(event.pointerId); seekFromPointer(event); }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekFromPointer(event); }}
          onPointerUp={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        />}

        <line x1={noteX(playheadBeat)} x2={noteX(playheadBeat)} y1={0} y2={height - BOTTOM} className="roll-playhead" />
        <circle cx={noteX(playheadBeat)} cy={TOP - 2} r={4} className="roll-playhead-dot" />
      </svg>
    </div>
  );
}
