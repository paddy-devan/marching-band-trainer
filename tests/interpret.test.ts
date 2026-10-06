import { describe, expect, it } from 'vitest';
import { add, fraction, value } from '../src/score/fraction';
import { audioContacts, interpretScore, positionAt, secondsAt } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

describe('rolls, ties and shared timing', () => {
  it('joins the real minim-plus-quaver roll into exactly ten movements', () => {
    const score = fixture('colonel-bogey');
    const start = score.notes.find(n => n.tremolo && n.tieNext)!;
    expect(start.hand).toBe('R');
    const timeline = interpretScore(score);
    const roll = timeline.movements.filter(m => m.sourceIds.includes(start.id));
    expect(roll).toHaveLength(10);
    expect(roll.map(m => m.hand)).toEqual(['R', 'L', 'R', 'L', 'R', 'L', 'R', 'L', 'R', 'L']);
    expect(roll.map(m => value(m.position))).toEqual([6, 6.25, 6.5, 6.75, 7, 7.25, 7.5, 7.75, 8, 8.25]);
    expect(new Set(roll.map(m => value(m.position))).size).toBe(10);
    expect(roll.at(-1)!.sourceId).toBe(score.ties.find(t => t.from === start.id)!.to);
    expect(timeline.movements.some(m => m.partId === start.partId && value(m.position) === 8.5 && !m.roll)).toBe(true);
  });
  it.each([['quarter', 4], ['half', 8]] as const)('expands an R %s roll to %i semiquaver movements', (type, count) => {
    const score = parseScore(synthetic([measure(time() + tempo(120)), measure('<Sticking><text>R</text></Sticking>' + chord(type, 38, '<TremoloSingleChord><subtype>r16</subtype></TremoloSingleChord>'))]), 'test');
    const timeline = interpretScore(score);
    expect(timeline.movements).toHaveLength(count);
    expect(timeline.movements[0].hand).toBe('R');
  });
  it('uses three quaver movements for a dotted crotchet in 12/8', () => {
    const score = parseScore(synthetic([measure(time(12, 8) + tempo(120)), measure('<Sticking><text>R</text></Sticking>' + chord('quarter', 38, '<dots>1</dots><TremoloSingleChord><subtype>r32</subtype></TremoloSingleChord>'))]), 'test');
    const roll = interpretScore(score).movements;
    expect(roll.map(m => value(m.position))).toEqual([0, 0.5, 1]);
    expect(roll.map(m => m.hand)).toEqual(['R', 'L', 'R']);
    expect(audioContacts(roll[0])).toHaveLength(2);
    expect(audioContacts(roll.at(-1)!)[1].time).toBeLessThan(secondsAt(score, fraction(3, 2)));
  });
  it('does not invent hands for unknown rolls or ties between adjacent identical notes', () => {
    const score = parseScore(synthetic([measure(time() + tempo(120)), measure(chord('quarter', 38, '<TremoloSingleChord><subtype>r32</subtype></TremoloSingleChord>') + chord('quarter', 38))]), 'test');
    const timeline = interpretScore(score);
    expect(timeline.movements.filter(m => m.roll)).toHaveLength(4);
    expect(timeline.movements.every(m => m.hand === undefined)).toBe(true);
    expect(score.ties).toHaveLength(0);
    expect(timeline.movements.at(-1)!.roll).toBe(false);
  });
  it('sustains ordinary tied notes and rejects broken endpoints', () => {
    const next = '<Spanner type="Tie"><next><location><measures>1</measures><fractions>0/1</fractions></location></next></Spanner>';
    const prev = '<Spanner type="Tie"><prev><location><measures>-1</measures><fractions>0/1</fractions></location></prev></Spanner>';
    const xml = synthetic([measure(time() + tempo(120) + chord('whole', 60, '', next)) + measure(chord('whole', 60, '', prev))]);
    const score = parseScore(xml, 'test');
    expect(score.ties).toHaveLength(1);
    const timeline = interpretScore(score);
    expect(timeline.movements).toHaveLength(1);
    expect(timeline.movements[0].seconds).toBe(4);
    const broken = parseScore(xml.replace('<measures>1</measures>', '<measures>3</measures>'), 'test');
    expect(broken.ties).toHaveLength(0);
    expect(broken.warnings.some(w => /unresolved/.test(w))).toBe(true);
  });
  it('applies a tempo mark on another staff to all parts', () => {
    const score = parseScore(synthetic([
      measure(time() + chord('whole')) + measure(chord('whole')),
      measure(tempo(120) + chord('whole', 38)) + measure(tempo(60) + chord('whole', 38)),
    ]), 'test');
    const timeline = interpretScore(score);
    expect(timeline.duration).toBe(6);
    expect(timeline.movements.filter(m => value(m.position) === 4).map(m => m.time)).toEqual([2, 2]);
    expect(timeline.movements.filter(m => value(m.position) === 4).map(m => m.seconds)).toEqual([4, 4]);
    expect(positionAt(score, 3)).toBe(5);
    expect(secondsAt(score, fraction(5))).toBe(3);
    expect(add(fraction(1, 3), fraction(1, 6))).toEqual(fraction(1, 2));
  });
  it('joins a three-note tie chain with separate incoming and outgoing spanners', () => {
    const next = '<Spanner type="Tie"><next><location><measures>1</measures></location></next></Spanner>';
    const previous = '<Spanner type="Tie"><prev><location><measures>-1</measures></location></prev></Spanner>';
    const score = parseScore(synthetic([
      measure(time() + tempo(120) + chord('whole', 60, '', next)) +
      measure(chord('whole', 60, '', previous + next)) +
      measure(chord('whole', 60, '', previous)),
    ]), 'test');
    expect(score.ties).toHaveLength(2);
    const movements = interpretScore(score).movements;
    expect(movements).toHaveLength(1);
    expect(movements[0].sourceIds).toHaveLength(3);
    expect(movements[0].seconds).toBe(6);
  });
});
