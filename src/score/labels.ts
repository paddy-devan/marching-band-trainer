export type Spelling = 'score' | 'sharps' | 'flats';
const sharps = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B'];
const flats = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];
// MuseScore tonal pitch classes run along the circle of fifths; C natural = 14.
export function pitchLabel(pitch: number, tpc?: number, spelling: Spelling = 'score'): string {
  let name = (spelling === 'flats' ? flats : sharps)[((pitch % 12) + 12) % 12];
  let octave = Math.floor(pitch / 12) - 1;
  if (spelling === 'score' && tpc !== undefined && Number.isInteger(tpc) && tpc >= -1 && tpc <= 33) {
    const letters = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
    const index = ((tpc + 1) % 7 + 7) % 7;
    const accidental = Math.floor((tpc + 1) / 7) - 2;
    name = letters[index] + (accidental < 0 ? '♭'.repeat(-accidental) : '♯'.repeat(accidental));
    const natural: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
    octave = (pitch - natural[letters[index]] - accidental) / 12 - 1;
  }
  return `${name}${octave}`;
}
const majors = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
const minors = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
export function keyLabel(fifths: number, mode?: string) {
  const count = Math.abs(fifths);
  const signature = fifths === 0 ? 'No sharps or flats' : `${count} ${fifths < 0 ? 'flat' : 'sharp'}${count === 1 ? '' : 's'}`;
  const relative = mode === 'major' ? `${majors[fifths + 7]} major` : mode === 'minor' ? `${minors[fifths + 7]} minor` : `${majors[fifths + 7]} major / ${minors[fifths + 7]} minor`;
  return `${signature} · ${relative}`;
}
