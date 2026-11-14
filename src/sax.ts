import { CIRCLE_KEYS, spellNoteWithOctave, type ChordInfo } from './theory.ts';

export type SaxKey = 'concert' | 'alto' | 'tenor';

// Written C sounds E-flat on alto and B-flat an octave lower on tenor.
const WRITTEN_OFFSET: Record<SaxKey, number> = { concert: 0, alto: 9, tenor: 14 };

export function saxWrittenPitch(concertPitch: number, key: SaxKey): number {
  return concertPitch + WRITTEN_OFFSET[key];
}

export function saxWrittenKey(concertRoot: number, key: SaxKey): string {
  const root = ((concertRoot + WRITTEN_OFFSET[key]) % 12 + 12) % 12;
  return CIRCLE_KEYS.find((item) => item.root === root)?.label ?? spellNoteWithOctave(root + 60).replace(/\d+$/, '');
}

export function saxWrittenChord(chord: ChordInfo, key: SaxKey): string {
  if (key === 'concert') return chord.name;
  const suffix = chord.quality === 'minor7' ? 'm7' : chord.quality === 'major7' ? 'maj7' : '7';
  return `${saxWrittenKey(chord.root, key)}${suffix}`;
}

/** Smooth one-frame pitch errors before they reach note segmentation. */
export class SaxPitchTracker {
  private recent: number[] = [];
  private last: number | null = null;

  observe(pitch: number | null): number | null {
    if (pitch === null) {
      this.recent = [];
      this.last = null;
      return null;
    }
    this.recent.push(pitch);
    if (this.recent.length > 3) this.recent.shift();
    const sorted = [...this.recent].sort((a, b) => a - b);
    const candidate = sorted[Math.floor(sorted.length / 2)];
    if (sorted.length === 3 && sorted[2] - sorted[0] > 2 && new Set(sorted).size === 3 && this.last !== null) return this.last;
    this.last = candidate;
    return candidate;
  }

  reset() { this.recent = []; this.last = null; }
}
