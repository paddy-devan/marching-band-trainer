import { compare } from './fraction';
import type { Dynamic, WrittenNote } from './model';

// MuseScore's normal MIDI velocities; an explicitly saved velocity takes priority.
export const dynamicVelocities: Record<string, number> = {
  ppp: 16, pp: 33, p: 49, mp: 64, mf: 80, f: 96, ff: 112, fff: 126,
};

export function applyDynamics(notes: WrittenNote[], dynamics: Dynamic[]) {
  // Resolve by musical position, rather than XML voice/staff traversal order.
  // Reapply after repeat expansion so skipped endings cannot leak their dynamics.
  for (const partId of new Set(dynamics.map(d => d.partId))) {
    const marks = dynamics.filter(d => d.partId === partId).sort((a, b) => compare(a.position, b.position));
    const partNotes = notes.filter(n => n.partId === partId).sort((a, b) => compare(a.position, b.position));
    let index = 0, velocity = 0.72;
    for (const note of partNotes) {
      while (index < marks.length && compare(marks[index].position, note.position) <= 0) velocity = marks[index++].velocity;
      // An accent remains relative to the prevailing dynamic, rather than
      // turning a quiet accompaniment note into a full-volume crash.
      note.velocity = Math.min(1, velocity * (note.accent ? 1 / 0.72 : 1));
    }
  }
}
