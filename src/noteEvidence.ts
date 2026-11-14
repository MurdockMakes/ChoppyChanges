import type { CoachEvidence } from './coach';
import type { NoteEvent } from './theory';

/** Keeps each note's evidence in the order supplied by the analysis. */
export function buildNoteEvidenceIndex(
  notes: readonly NoteEvent[],
  evidence: readonly CoachEvidence[],
): Map<string, CoachEvidence[]> {
  const index = new Map<string, CoachEvidence[]>();
  const seen = new Map<string, Set<string>>();

  for (const note of notes) {
    if (!note.id || index.has(note.id)) continue;
    index.set(note.id, []);
    seen.set(note.id, new Set());
  }

  for (const item of evidence) {
    for (const noteId of item.noteIds) {
      const items = index.get(noteId);
      const ids = seen.get(noteId);
      if (!items || !ids || ids.has(item.id)) continue;
      items.push(item);
      ids.add(item.id);
    }
  }

  return index;
}
