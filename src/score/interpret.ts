import { add, compare, fraction, mul, sub, value, ZERO, type Fraction } from './fraction';
import type { Movement, Part, Score, Timeline, WrittenNote } from './model';
import { expandRepeats } from './repeats';

export function secondsAt(score: Score, position: Fraction): number {
  let seconds = 0;
  for (let i = 0; i < score.tempos.length; i++) {
    const mark = score.tempos[i];
    if (compare(mark.position, position) >= 0) break;
    const next = score.tempos[i + 1]?.position;
    const end = next && compare(next, position) < 0 ? next : position;
    seconds += value(sub(end, mark.position)) * 60 / mark.bpm;
  }
  return seconds;
}
export function positionAt(score: Score, seconds: number): number {
  for (let i = score.tempos.length - 1; i >= 0; i--) {
    const mark = score.tempos[i];
    const time = secondsAt(score, mark.position);
    if (seconds >= time) return value(mark.position) + (seconds - time) * mark.bpm / 60;
  }
  return 0;
}
export function rollInterval(score: Score, n: WrittenNote, part: Part): Fraction {
  if (part.rollProfile === 'sixteenth') return fraction(1, 4);
  if (part.rollProfile === 'eighth') return fraction(1, 2);
  const sig = score.measures[n.measure].signature;
  return sig.numerator === 12 && sig.denominator === 8 ? fraction(1, 2) : fraction(1, 4);
}
export function interpretScore(score: Score): Timeline {
  score = expandRepeats(score);
  const warnings = [...score.warnings];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const byId = new Map(score.notes.map(n => [n.id, n]));
  const outgoing = new Map(score.ties.map(t => [t.from, t.to]));
  const incoming = new Set(score.ties.map(t => t.to));
  const parts = new Map(score.parts.map(p => [p.id, p]));
  const movements: Movement[] = [];
  for (const note of score.notes) {
    if (incoming.has(note.id)) continue;
    const chain = [note];
    while (outgoing.has(chain.at(-1)!.id)) {
      const next = byId.get(outgoing.get(chain.at(-1)!.id)!);
      if (!next || chain.some(n => n.id === next.id)) { warn('A cyclic or missing tie was ignored.'); break; }
      chain.push(next);
    }
    const part = parts.get(note.partId)!;
    const length = chain.reduce((sum, n) => add(sum, n.duration), ZERO);
    const end = add(note.position, length);
    const marked = chain.some(n => n.tremolo);
    const roll = marked && note.percussion && part.renderer === 'snare' && part.rollProfile !== 'disabled' && chain.every(n => !n.tremolo || ['r16', 'r32'].includes(n.tremolo));
    if (marked && !roll) warn(`${part.name}: unsupported or disabled tremolo markings play as a single sustained event.`);
    const interval = roll ? rollInterval(score, note, part) : length;
    if (roll) {
      if (chain.some(n => !n.tremolo)) warn(`${part.name}: a tied roll continuation lacks a roll mark; the roll spans the full tie.`);
      for (const segment of chain.slice(1)) {
        const step = value(sub(segment.position, note.position)) / value(interval);
        const expected = note.hand ? (Math.round(step) % 2 ? (note.hand === 'R' ? 'L' : 'R') : note.hand) : undefined;
        if ((segment.hand && segment.hand !== expected) || Math.abs(step - Math.round(step)) > 1e-8)
          warn(`${part.name}, bar ${segment.measure + 1}: roll continuation conflicts with the alternating phase; the initial roll phase is preserved.`);
        if (compare(rollInterval(score, segment, part), interval) !== 0) warn(`${part.name}: meter changes within a tied roll are unsupported; the initial skeleton interval is preserved.`);
      }
    }
    for (let i = 0; ; i++) {
      const position = add(note.position, mul(interval, fraction(i)));
      if (compare(position, end) >= 0) break;
      const available = sub(end, position);
      const duration = compare(interval, available) < 0 ? interval : available;
      const source = chain.find(n => compare(position, n.position) >= 0 && compare(position, add(n.position, n.duration)) < 0) || note;
      const time = secondsAt(score, position);
      const hand = note.hand ? (roll && i % 2 ? (note.hand === 'R' ? 'L' : 'R') : note.hand) : undefined;
      movements.push({
        id: `${note.id}:movement:${i}`, partId: note.partId, position, duration, time,
        seconds: secondsAt(score, add(position, duration)) - time,
        pitch: note.pitch, tpc: note.tpc, percussion: note.percussion, hand,
        provenance: note.provenance, roll, velocity: note.velocity,
        sourceIds: chain.map(n => n.sourceId || n.id), sourceId: source.sourceId || source.id,
      });
      if (!roll) break;
    }
  }
  movements.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  return { score, movements, duration: secondsAt(score, score.duration), warnings };
}

// Audio contacts are separate from instructional skeleton movements. The initial
// approximation uses two decaying snare contacts per movement, without changing hands.
export function audioContacts(movement: Movement): { time: number; seconds: number; velocity: number }[] {
  if (!movement.roll) return [{ time: movement.time, seconds: movement.seconds, velocity: movement.velocity }];
  return [
    { time: movement.time, seconds: movement.seconds / 2, velocity: movement.velocity * 0.75 },
    { time: movement.time + movement.seconds / 2, seconds: movement.seconds / 2, velocity: movement.velocity * 0.55 },
  ];
}
