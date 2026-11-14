import { chordAtBeat, formatPosition, spellNoteWithOctave, type NoteEvent, type Progression } from './theory';
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
  if (!visible) return null;

  function updateNote(id: string, change: Partial<NoteEvent>) {
    onChange(notes.map((note) => note.id === id ? { ...note, ...change } : note));
  }

  function addNote() {
    const lastEnd = notes.reduce((maximum, note) => Math.max(maximum, note.startBeat + note.durationBeats), 0);
    onChange([...notes, {
      id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      pitch: 60,
      startBeat: roundHundredth(lastEnd),
      durationBeats: 0.5,
    }]);
  }

  return (
    <section className="transcription-editor" aria-label="Editable microphone transcription">
      <div className="transcription-editor-head">
        <div>
          <p className="eyebrow">{origin === 'mic' ? 'MICROPHONE TRANSCRIPTION' : 'EXAMPLE NOTE EVENTS'}</p>
          <h3>Correct the notes</h3>
        </div>
        <button type="button" onClick={addNote}>+ Add note</button>
      </div>
      <p className="transcription-editor-help">{origin === 'mic' ? 'Detected pitches are in concert pitch.' : 'These example notes are in concert pitch.'} Adjust pitch or timing before using the phrase evidence; uncertain notes can be removed.</p>
      {notes.length === 0 ? (
        <p className="transcription-editor-empty">No notes detected yet. Add one manually or record another phrase.</p>
      ) : (
        <div className="transcription-editor-scroll">
          <table>
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
                    <td className="transcription-index">{String(index + 1).padStart(2, '0')}</td>
                    <td>
                      <select
                        aria-label={`Pitch for note ${index + 1}`}
                        value={note.pitch}
                        onChange={(event) => updateNote(note.id, { pitch: Number(event.target.value) })}
                      >
                        {pitches.map((pitch) => <option value={pitch} key={pitch}>{spellNoteWithOctave(pitch, chord)}</option>)}
                      </select>
                    </td>
                    <td className="transcription-position">{formatPosition(note.startBeat)}<small>{chord.name}</small></td>
                    <td>
                      <input
                        aria-label={`Start beat for note ${index + 1}`}
                        type="number"
                        min="0"
                        step="0.05"
                        value={roundHundredth(note.startBeat)}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          if (Number.isFinite(value) && value >= 0) updateNote(note.id, { startBeat: roundHundredth(value) });
                        }}
                      />
                    </td>
                    <td>
                      <input
                        aria-label={`Length in beats for note ${index + 1}`}
                        type="number"
                        min="0.05"
                        step="0.05"
                        value={roundHundredth(note.durationBeats)}
                        onChange={(event) => {
                          const value = event.target.valueAsNumber;
                          if (Number.isFinite(value) && value >= 0.05) updateNote(note.id, { durationBeats: roundHundredth(value) });
                        }}
                      />
                    </td>
                    <td>
                      <button
                        type="button"
                        className="transcription-delete"
                        aria-label={`Delete note ${index + 1}, ${spellNoteWithOctave(note.pitch, chord)}`}
                        title="Delete note"
                        onClick={() => onChange(notes.filter((item) => item.id !== note.id))}
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
