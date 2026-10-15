import { describe, expect, it } from 'vitest';
import { add, fraction, sub, value } from '../src/score/fraction';
import { audioContacts, interpretScore, secondsAt } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

const tuplet = (actual = 3, normal = 2) => `<Tuplet><normalNotes>${normal}</normalNotes><actualNotes>${actual}</actualNotes><baseNote>eighth</baseNote></Tuplet>`;
const end = '<endTuplet/>';
const rest = '<Rest><durationType>half</durationType></Rest>';
const parse = (content: string) => parseScore(synthetic([measure(time() + tempo(120) + content)]), 'tuplets');

describe('tuplet timing', () => {
  it.each([[3, 2], [5, 4], [2, 3]])('scales %i notes into %i written durations and releases the ratio afterwards', (actual, normal) => {
    const score = parse(tuplet(actual, normal) + chord('eighth').repeat(actual) + end + chord('quarter'));
    expect(score.notes.slice(0, actual).map(n => n.duration)).toEqual(Array.from({ length: actual }, () => fraction(normal, actual * 2)));
    expect(score.notes.at(-1)!.offset).toEqual(fraction(normal, 2));
    expect(score.notes.at(-1)!.duration).toEqual(fraction(1));
  });

  it('scales dotted notes, chords and rests without counting chord pitches as separate durations', () => {
    const score = parse(tuplet() + chord('eighth', 60, '<dots>1</dots><Note><pitch>64</pitch></Note>') +
      '<Rest><durationType>16th</durationType></Rest>' + chord('eighth', 67) + end + chord('quarter', 72));
    expect(score.notes.map(n => n.offset)).toEqual([fraction(0), fraction(0), fraction(2, 3), fraction(1)]);
    expect(score.notes.slice(0, 2).map(n => n.duration)).toEqual([fraction(1, 2), fraction(1, 2)]);
    expect(score.rests[0]).toMatchObject({ position: fraction(1, 2), duration: fraction(1, 6) });
  });

  it('composes nested ratios and restores the enclosing rhythm', () => {
    const score = parse(tuplet() + chord() + tuplet() + chord('eighth').repeat(3) + end + chord() + end + rest + chord());
    expect(score.notes.map(n => n.offset)).toEqual([
      fraction(0), fraction(2, 3), fraction(8, 9), fraction(10, 9), fraction(4, 3), fraction(4),
    ]);
    expect(score.notes.slice(1, 4).map(n => n.duration)).toEqual(Array.from({ length: 3 }, () => fraction(2, 9)));
    expect(score.notes[4].duration).toEqual(fraction(2, 3));
    expect(score.notes[5].duration).toEqual(fraction(1));
  });

  it('keeps independent voices, staffs and following bars aligned', () => {
    const triplets = tuplet() + chord('eighth').repeat(3) + end + chord('half', 62, '<dots>1</dots>');
    const first = measure(time() + tempo(120) + triplets).replace('</Measure>', `<voice>${rest}${chord('half', 64)}</voice></Measure>`);
    const score = parseScore(synthetic([first + measure(chord('whole', 65)), measure(chord('whole', 38)) + measure(chord('whole', 38))]), 'tuplets');
    expect(score.notes.find(n => n.pitch === 62)!.offset).toEqual(fraction(1));
    expect(score.notes.find(n => n.pitch === 64)!.offset).toEqual(fraction(2));
    expect(score.notes.find(n => n.pitch === 65)!.position).toEqual(fraction(4));
    expect(score.notes.filter(n => n.pitch === 38).map(n => n.position)).toEqual([fraction(0), fraction(4)]);
    expect(score.warnings.some(w => /exceeds the measure/.test(w))).toBe(false);
  });

  it('keeps Sarie Marais bar 9 audio, rolls and accompaniment in time on every repeat pass', () => {
    const timeline = interpretScore(fixture('sarie-marais'));
    const score = timeline.score;
    const drum = score.parts.find(p => p.name === 'Side Drum')!;
    const bars = score.measures.filter(m => (m.sourceIndex ?? m.index) === 8);
    expect(bars.length).toBeGreaterThan(0);
    for (const bar of bars) {
      const notes = score.notes.filter(n => n.partId === drum.id && n.measure === bar.index);
      const movements = timeline.movements.filter(m => m.partId === drum.id && notes.some(n => m.sourceIds.includes(n.sourceId || n.id)) &&
        value(sub(m.position, bar.start)) >= 0 && value(sub(m.position, bar.start)) < 4);
      const offsets = [fraction(0), fraction(2, 3), fraction(1), fraction(4, 3), fraction(5, 3), fraction(2), fraction(3), fraction(13, 4), fraction(7, 2), fraction(15, 4)];
      expect(movements.map(m => sub(m.position, bar.start))).toEqual(offsets);
      movements.forEach((m, i) => expect(m.time).toBeCloseTo(secondsAt(score, add(bar.start, offsets[i]))));
      const thirdBeat = timeline.movements.filter(m => value(sub(m.position, bar.start)) === 2);
      expect(thirdBeat.some(m => m.partId !== drum.id)).toBe(true);
      expect(new Set(thirdBeat.map(m => m.time)).size).toBe(1);
      const roll = movements.filter(m => m.roll).flatMap(audioContacts);
      expect(roll).toHaveLength(8);
      expect(roll.at(-1)!.time + roll.at(-1)!.seconds).toBeCloseTo(secondsAt(score, add(bar.start, fraction(4))));
    }
  });

  it.each([[0, 2], [3, 0], [-3, 2], [3, 1.5], [NaN, 2]])('rejects invalid tuplet ratios %s:%s', (actual, normal) => {
    expect(() => parse(tuplet(actual, normal) + chord() + end)).toThrow(/bar 1: invalid tuplet ratio/);
  });

  it('reports missing ratios and unbalanced boundaries rather than silently playing straight notes', () => {
    expect(() => parse('<Tuplet><actualNotes>3</actualNotes></Tuplet>' + chord() + end)).toThrow(/invalid tuplet ratio/);
    expect(() => parse(tuplet() + chord())).toThrow(/tuplet is missing its end/);
    expect(() => parse(chord() + end)).toThrow(/tuplet end has no matching start/);
  });
});
