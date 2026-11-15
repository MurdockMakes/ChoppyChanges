import { useEffect, useId, useRef, useState } from 'react';
import { chordAtBeat, formatPosition, spellNoteWithOctave, type NoteEvent, type Progression } from './theory';
import { MAX_PORTABLE_NOTES, MAX_PORTABLE_TAKE_BEATS } from './takeTransfer';
import './TranscriptionEditor.css';

export interface TranscriptionEditorProps {
  notes: NoteEvent[];
  onChange: (notes: NoteEvent[]) => void;
  visible: boolean;
  origin?: 'mic' | 'example';
  progression: Progression;
}

const MIN_PITCH = 36;
const MAX_PITCH = 96;
const PITCH_OPTIONS = Array.from({ length: MAX_PITCH - MIN_PITCH + 1 }, (_, index) => MIN_PITCH + index);

function roundHundredth(value: number) {
  return Math.round(value * 100) / 100;
}

export default function TranscriptionEditor({ notes, onChange, visible, origin = 'mic', progression }: TranscriptionEditorProps) {
  const headingId = useId();
  const helpId = useId();
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const notesRef = useRef<HTMLDivElement>(null);
  const focusAfterChangeRef = useRef<string | 'add' | null>(null);

  useEffect(() => {
    const target = focusAfterChangeRef.current;
    if (!target || !visible) return;
    focusAfterChangeRef.current = null;
    if (target === 'add') addButtonRef.current?.focus();
    else Array.from(notesRef.current?.querySelectorAll<HTMLSelectElement>('select[data-note-id]') ?? [])
      .find((select) => select.dataset.noteId === target)?.focus();
  }, [notes, visible]);

  if (!visible) return null;
  const lastEnd = notes.reduce((maximum, note) => Math.max(maximum, note.startBeat + note.durationBeats), 0);
  const canAdd = notes.length < MAX_PORTABLE_NOTES && lastEnd <= MAX_PORTABLE_TAKE_BEATS - 0.05;

  function announce(text: string, isError = false) {
    setMessage(text);
    setError(isError);
  }

  function clearDraft(key: string) {
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[key];
      return next;
    });
  }

  function commitTiming(note: NoteEvent, index: number, field: 'startBeat' | 'durationBeats') {
    const key = `${note.id}:${field}`;
    const draft = drafts[key];
    if (draft === undefined) return;
    clearDraft(key);
    const value = draft.trim() === '' ? NaN : Number(draft);
    const minimum = field === 'startBeat' ? 0 : 0.05;
    const maximum = field === 'startBeat' ? MAX_PORTABLE_TAKE_BEATS - note.durationBeats : MAX_PORTABLE_TAKE_BEATS - note.startBeat;
    const name = field === 'startBeat' ? 'start beat' : 'length';
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      announce(`Note ${index + 1} ${name} must be between ${roundHundredth(minimum)} and ${roundHundredth(maximum)} beats. The previous value was kept.`, true);
      return;
    }
    const rounded = roundHundredth(value);
    if (rounded !== note[field]) updateNote(note.id, { [field]: rounded });
    announce(`Note ${index + 1} ${name} set to ${rounded} beats.`);
  }

  function updateNote(id: string, change: Partial<NoteEvent>) {
    onChange(notes.map((note) => note.id === id ? { ...note, ...change } : note));
  }

  function addNote() {
    if (!canAdd) return;
    const id = `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    focusAfterChangeRef.current = id;
    onChange([...notes, {
      id,
      pitch: 60,
      startBeat: roundHundredth(lastEnd),
      durationBeats: Math.min(0.5, roundHundredth(MAX_PORTABLE_TAKE_BEATS - lastEnd)),
    }]);
    announce(`Note ${notes.length + 1} added. Pitch is ready to edit.`);
  }

  function deleteNote(note: NoteEvent, index: number) {
    focusAfterChangeRef.current = notes[index + 1]?.id ?? notes[index - 1]?.id ?? 'add';
    onChange(notes.filter((item) => item.id !== note.id));
    announce(`Note ${index + 1} deleted.`);
  }

  return (
    <section className="transcription-editor" aria-labelledby={headingId} aria-describedby={helpId}>
      <div className="transcription-editor-head">
        <div>
          <p className="eyebrow">{origin === 'mic' ? 'MICROPHONE TRANSCRIPTION' : 'EXAMPLE NOTE EVENTS'}</p>
          <h3 id={headingId}>Correct the notes</h3>
          <p className="transcription-editor-count">{notes.length} {notes.length === 1 ? 'note' : 'notes'}</p>
        </div>
        <button ref={addButtonRef} type="button" onClick={addNote} disabled={!canAdd} aria-describedby={!canAdd ? `${helpId}-limit` : undefined}>+ Add note</button>
      </div>
      <p className="transcription-editor-help" id={helpId}>{origin === 'mic' ? 'Detected pitches are in concert pitch.' : 'These example notes are in concert pitch.'} Adjust pitch or timing before using the phrase evidence; uncertain notes can be removed. Timing changes apply when you leave a field or press Enter.</p>
      {!canAdd && <p className="transcription-editor-limit" id={`${helpId}-limit`}>{notes.length >= MAX_PORTABLE_NOTES ? 'The note limit has been reached.' : 'The take has reached its maximum length.'}</p>}
      {message && <p className={`transcription-editor-message${error ? ' is-error' : ''}`} role={error ? 'alert' : 'status'}>{message}</p>}
      {notes.length === 0 ? (
        <p className="transcription-editor-empty">{origin === 'mic' ? 'No notes detected yet. Add one manually or record another phrase.' : 'No notes in this take. Add one manually or load another take.'}</p>
      ) : (
        <div className="transcription-editor-scroll" ref={notesRef} role="region" aria-label="Notes to edit" tabIndex={0}>
          <table>
            <caption className="visually-hidden">Edit pitch, start beat, and length for each note</caption>
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Pitch</th>
                <th scope="col">Position</th>
                <th scope="col">Start beat</th>
                <th scope="col">Length</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {notes.map((note, index) => {
                const chord = chordAtBeat(note.startBeat, progression);
                const pitches = PITCH_OPTIONS.includes(note.pitch) ? PITCH_OPTIONS : [...PITCH_OPTIONS, note.pitch].sort((a, b) => a - b);
                return (
                  <tr key={note.id}>
                    <td className="transcription-index" data-label="Note">{String(index + 1).padStart(2, '0')}</td>
                    <td data-label="Pitch">
                      <select
                        data-note-id={note.id}
                        aria-label={`Pitch for note ${index + 1}`}
                        value={note.pitch}
                        onChange={(event) => updateNote(note.id, { pitch: Number(event.target.value) })}
                      >
                        {pitches.map((pitch) => <option value={pitch} key={pitch}>{spellNoteWithOctave(pitch, chord)}</option>)}
                      </select>
                    </td>
                    <td className="transcription-position" data-label="Position">{formatPosition(note.startBeat)}<small>{chord.name}</small></td>
                    <td data-label="Start beat">
                      <input
                        aria-label={`Start beat for note ${index + 1}`}
                        type="number"
                        min="0"
                        max={MAX_PORTABLE_TAKE_BEATS - note.durationBeats}
                        step="0.01"
                        value={drafts[`${note.id}:startBeat`] ?? roundHundredth(note.startBeat)}
                        onChange={(event) => setDrafts((previous) => ({ ...previous, [`${note.id}:startBeat`]: event.target.value }))}
                        onBlur={() => commitTiming(note, index, 'startBeat')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') { clearDraft(`${note.id}:startBeat`); announce(`Note ${index + 1} start beat change canceled.`); }
                        }}
                      />
                    </td>
                    <td data-label="Length">
                      <input
                        aria-label={`Length in beats for note ${index + 1}`}
                        type="number"
                        min="0.05"
                        max={MAX_PORTABLE_TAKE_BEATS - note.startBeat}
                        step="0.01"
                        value={drafts[`${note.id}:durationBeats`] ?? roundHundredth(note.durationBeats)}
                        onChange={(event) => setDrafts((previous) => ({ ...previous, [`${note.id}:durationBeats`]: event.target.value }))}
                        onBlur={() => commitTiming(note, index, 'durationBeats')}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') event.currentTarget.blur();
                          if (event.key === 'Escape') { clearDraft(`${note.id}:durationBeats`); announce(`Note ${index + 1} length change canceled.`); }
                        }}
                      />
                    </td>
                    <td data-label="Action">
                      <button
                        type="button"
                        className="transcription-delete"
                        aria-label={`Delete note ${index + 1}, ${spellNoteWithOctave(note.pitch, chord)}`}
                        title="Delete note"
                        onClick={() => deleteNote(note, index)}
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
