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
  const compound = sig.denominator === 8 && sig.numerator > 3 && sig.numerator % 3 === 0;
  return compound ? fraction(1, 2) : fraction(1, 4);
}
function isSnareRoll(note: WrittenNote, part: Part): boolean {
  return note.percussion && part.renderer === 'snare' && part.rollProfile !== 'disabled' &&
    ['r8', 'r16', 'r32'].includes(note.tremolo || '');
}
// A performance approximation, in score seconds: practice speed also slows the flam.
export const FLAM_LEAD_SECONDS = 0.035;
export const FLAM_GRACE_VELOCITY = 0.4;
export function interpretScore(score: Score): Timeline {
  score = expandRepeats(score);
  const warnings = [...score.warnings];
  const warn = (message: string) => { if (!warnings.includes(message)) warnings.push(message); };
  const byId = new Map(score.notes.map(n => [n.id, n]));
  const parts = new Map(score.parts.map(p => [p.id, p]));
  // A snare tie into a plain note connects the roll to its release tap.
  // Split at changes of technique for playback, retaining the written ties.
  const playbackTies = score.ties.filter(t => {
    const from = byId.get(t.from), to = byId.get(t.to);
    if (to?.flam) return false; // A written flam requires a fresh principal attack.
    if (!from || !to || Boolean(from.tremolo) === Boolean(to.tremolo)) return true;
    const marked = from.tremolo ? from : to;
    return !isSnareRoll(marked, parts.get(marked.partId)!);
  });
  const outgoing = new Map(playbackTies.map(t => [t.from, t.to]));
  const incoming = new Set(playbackTies.map(t => t.to));
  const movements: Movement[] = [];
  const flams = new Map<string, NonNullable<WrittenNote['flam']>>();
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
    const roll = marked && chain.every(n => isSnareRoll(n, part));
    if (marked && !roll) warn(`${part.name}: unsupported or disabled tremolo markings play as a single sustained event.`);
    const interval = roll ? rollInterval(score, note, part) : length;
    if (roll) {
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
        ...(note.accent ? { accent: true } : {}),
        sourceIds: chain.map(n => n.sourceId || n.id), sourceId: source.sourceId || source.id,
        ...(i === 0 && note.flam ? { flam: 'main' as const } : {}),
      });
      if (i === 0 && note.flam) flams.set(movements.at(-1)!.id, note.flam);
      if (!roll) break;
    }
  }
  movements.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  if (flams.size) {
    const previous = new Map<string, number>();
    const graceMovements: Movement[] = [];
    for (const main of movements) {
      const grace = flams.get(main.id);
      if (grace) {
        const before = previous.get(main.partId);
        const gap = Math.min(FLAM_LEAD_SECONDS, before !== undefined && before < main.time ? (main.time - before) / 2 : Infinity);
        graceMovements.push({
          ...main, id: `${main.id}:grace`, pitch: grace.pitch, tpc: grace.tpc,
          hand: grace.hand, provenance: grace.provenance, flam: 'grace', roll: false, accent: false,
          time: main.time - gap, seconds: gap, duration: ZERO, velocity: main.velocity * FLAM_GRACE_VELOCITY,
          sourceId: `${main.sourceId}:grace`, sourceIds: [`${main.sourceId}:grace`],
        });
      }
      previous.set(main.partId, main.time);
    }
    movements.push(...graceMovements);
    movements.sort((a, b) => a.time - b.time || a.id.localeCompare(b.id));
  }
  return { score, movements, duration: secondsAt(score, score.duration), warnings };
}

export const ROLL_CONTACTS_PER_QUAVER = 4;
export function rollContactInterval(movement: Movement) {
  return movement.seconds / (value(movement.duration) * 2 * ROLL_CONTACTS_PER_QUAVER);
}
// The audio rate is independent of the instructional hand-change profile:
// four contacts per quaver, in either simple or compound time.
export function audioContacts(movement: Movement): { time: number; seconds: number; velocity: number }[] {
  if (!movement.roll) return [{ time: movement.time, seconds: movement.seconds, velocity: movement.velocity }];
  const seconds = rollContactInterval(movement);
  const count = Math.ceil(value(movement.duration) * 2 * ROLL_CONTACTS_PER_QUAVER - 1e-8);
  return Array.from({ length: count }, (_, i) => ({
    time: movement.time + i * seconds,
    seconds: Math.min(seconds, movement.seconds - i * seconds),
    velocity: movement.velocity * 0.65,
  }));
}
