import { add, compare, nativeFraction, sub, ZERO } from './fraction';
import type { Ending, Repeat, Score, WrittenNote } from './model';
import { child, number, text } from './xml';

// MuseScore repeat signs are measure properties; volta spanners end at an
// exclusive measure boundary (or inside the final included measure).
export function readRepeats(staffMeasures: Element[][]): { repeats: Repeat[]; endings: Ending[] } {
  const count = Math.max(...staffMeasures.map(ms => ms.length));
  const repeats: Repeat[] = [];
  const rawEndings: Omit<Ending, 'repeat'>[] = [];
  const starts: number[] = [];
  let implicitStart = 0;
  for (let i = 0; i < count; i++) {
    const nodes = staffMeasures.flatMap(ms => ms[i] ? [ms[i]] : []);
    if (nodes.some(m => child(m, 'startRepeat'))) starts.push(i);
    const ends = nodes.flatMap(m => child(m, 'endRepeat') ? [child(m, 'endRepeat')!] : []);
    if (ends.length) {
      const times = text(ends[0]) ? Number(text(ends[0])) : 2;
      if (!Number.isInteger(times) || times < 1 || times > 32 || ends.some(e => Number(text(e) || 2) !== times))
        throw new Error(`Bar ${i + 1}: invalid or conflicting repeat count.`);
      repeats.push({ start: starts.pop() ?? implicitStart, end: i, count: times });
      implicitStart = i + 1;
    }
    for (const m of nodes) for (const spanner of Array.from(m.getElementsByTagName('Spanner'))) {
      const volta = child(spanner, 'Volta');
      if (spanner.getAttribute('type') !== 'Volta' || !volta) continue;
      const passes = text(volta, 'endings').split(',').map(v => Number(v.trim()));
      const next = child(spanner, 'next');
      const loc = next && child(next, 'location');
      const delta = loc ? number(loc, 'measures') : 0;
      const inside = loc && text(loc, 'fractions') ? compare(nativeFraction(text(loc, 'fractions')), ZERO) > 0 : false;
      const end = i + delta + (inside ? 1 : 0);
      if (!passes.length || passes.some(p => !Number.isInteger(p) || p < 1 || p > 32) || !Number.isInteger(delta) || end <= i || end > count)
        throw new Error(`Bar ${i + 1}: invalid ending bracket.`);
      const ending = { start: i, end, passes: [...new Set(passes)].sort((a, b) => a - b) };
      if (!rawEndings.some(e => e.start === i && e.end === end && String(e.passes) === String(ending.passes))) rawEndings.push(ending);
    }
  }
  const endings: Ending[] = [];
  for (const ending of rawEndings.sort((a, b) => a.start - b.start)) {
    // Later endings immediately following a repeat belong to the same repeat
    // as its first ending. Prefer the innermost enclosing repeat.
    const regions = repeats.map((r, repeat) => ({ ...r, repeat }));
    const continuation = regions.filter(r => endings.some(e => e.repeat === r.repeat && e.end === ending.start));
    const enclosing = regions.filter(r => ending.start >= r.start && ending.start <= r.end);
    const candidates = continuation.length ? continuation : enclosing.length ? enclosing : regions.filter(r => ending.start === r.end + 1);
    const owner = candidates.sort((a, b) => b.start - a.start || a.end - b.end)[0];
    if (!owner || ending.passes.some(p => p > owner.count)) throw new Error(`Bar ${ending.start + 1}: ending has no matching repeat/pass.`);
    if (endings.some(e => e.repeat === owner.repeat && e.start < ending.end && ending.start < e.end))
      throw new Error(`Bar ${ending.start + 1}: overlapping ending brackets.`);
    endings.push({ ...ending, repeat: owner.repeat });
  }
  return { repeats, endings };
}

export function playbackOrder(score: Score): number[] {
  const passes = score.repeats.map(() => 1);
  const order: number[] = [];
  let steps = 0;
  for (let bar = 0; bar < score.measures.length;) {
    if (++steps > 10000) throw new Error('Repeat expansion exceeds 10,000 bars. Check the score repeat structure.');
    const allowed = score.endings.filter(e => bar >= e.start && bar < e.end).every(e => e.passes.includes(passes[e.repeat]));
    if (allowed) order.push(bar);
    const repeatIndex = score.repeats.findIndex(r => r.end === bar);
    const repeat = score.repeats[repeatIndex];
    if (repeat && passes[repeatIndex] < repeat.count) {
      passes[repeatIndex]++;
      // Every outer pass starts its nested repeats afresh.
      score.repeats.forEach((inner, i) => { if (i !== repeatIndex && inner.start >= repeat.start && inner.end < repeat.end) passes[i] = 1; });
      bar = repeat.start;
    } else bar++;
  }
  return order;
}

export function expandRepeats(score: Score): Score {
  if (!score.repeats.length && !score.endings.length) return score;
  const order = playbackOrder(score);
  const notes: Score['notes'] = [];
  const rests: Score['rests'] = [];
  const measures: Score['measures'] = [];
  const tempos: Score['tempos'] = [];
  const keys: Score['keys'] = [];
  const signatures: Score['signatures'] = [];
  const visits: Map<string, WrittenNote>[] = [];
  const writtenNotes = score.measures.map(() => [] as WrittenNote[]);
  score.notes.forEach(n => writtenNotes[n.measure].push(n));
  let start = ZERO;
  for (const [index, sourceIndex] of order.entries()) {
    const source = score.measures[sourceIndex];
    const end = add(source.start, source.duration);
    const translate = (position: Score['duration']) => add(start, sub(position, source.start));
    measures.push({ ...source, index, sourceIndex, start });
    if (!index || JSON.stringify(measures[index - 1].signature) !== JSON.stringify(source.signature)) signatures.push({ position: start, signature: source.signature });
    const reset = !index || sourceIndex <= order[index - 1];
    if (reset) {
      const tempo = score.tempos.filter(t => compare(t.position, source.start) <= 0).at(-1)!;
      if (!tempos.length || tempos.at(-1)!.bpm !== tempo.bpm) tempos.push({ position: start, bpm: tempo.bpm });
      for (const part of score.parts.filter(p => !p.percussion && score.keys.some(k => k.partId === p.id))) {
        const key = score.keys.filter(k => k.partId === part.id && compare(k.position, source.start) <= 0).at(-1);
        // No written key mark means C at the start of the piece.
        keys.push({ partId: part.id, position: start, fifths: key?.fifths ?? 0, mode: key?.mode });
      }
    }
    for (const t of score.tempos.filter(t => compare(t.position, source.start) >= 0 && compare(t.position, end) < 0)) {
      const position = translate(t.position);
      if (tempos.at(-1)?.bpm !== t.bpm) tempos.push({ ...t, position });
    }
    for (const k of score.keys.filter(k => compare(k.position, source.start) >= 0 && compare(k.position, end) < 0)) keys.push({ ...k, position: translate(k.position) });
    const visit = new Map<string, WrittenNote>();
    for (const n of writtenNotes[sourceIndex]) {
      if (notes.length >= 200000) throw new Error('Repeat expansion exceeds 200,000 notes.');
      const copy = { ...n, id: `${n.id}:visit:${index}`, sourceId: n.id, measure: index, position: translate(n.position) };
      visit.set(n.id, copy);
      notes.push(copy);
    }
    visits.push(visit);
    for (const r of score.rests.filter(r => compare(r.position, source.start) >= 0 && compare(r.position, end) < 0)) rests.push({ ...r, position: translate(r.position) });
    start = add(start, source.duration);
  }
  // A tie survives only when its actual endpoints are adjacent on this pass.
  // Repeat jumps and skipped endings must never join unrelated occurrences.
  const ties: Score['ties'] = [];
  const original = new Map(score.notes.map(n => [n.id, n]));
  for (const [i, visit] of visits.entries()) for (const t of score.ties) {
    const from = visit.get(t.from);
    if (!from) continue;
    const target = original.get(t.to)!;
    const delta = target.measure - order[i];
    const targetVisit = delta === 0 ? visit : delta === 1 && order[i + 1] === target.measure ? visits[i + 1] : undefined;
    const to = targetVisit?.get(t.to);
    if (to && compare(add(from.position, from.duration), to.position) === 0) ties.push({ from: from.id, to: to.id });
  }
  const duration = notes.reduce((end, n) => compare(add(n.position, n.duration), end) > 0 ? add(n.position, n.duration) : end, start);
  return { ...score, measures, notes, rests, ties, tempos, keys, signatures, duration, writtenMeasureCount: score.measures.length, repeats: [], endings: [] };
}
