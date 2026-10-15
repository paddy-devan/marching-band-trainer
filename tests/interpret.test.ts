import { describe, expect, it } from 'vitest';
import { add, fraction, value } from '../src/score/fraction';
import { audioContacts, interpretScore, positionAt, secondsAt } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

describe('rolls, ties and shared timing', () => {
  it.each([
    ['32nd', '', 1], ['16th', '', 2], ['eighth', '', 4], ['eighth', '<dots>1</dots>', 6],
    ['quarter', '', 8], ['half', '', 16], ['whole', '', 32],
  ] as const)('uses four contacts per quaver for an r8 %s note (%s)', (duration, dots, count) => {
    const makeTimeline = (mark: string) => interpretScore(parseScore(synthetic([
      measure(time() + tempo(120)),
      measure('<Sticking><text>R</text></Sticking>' + chord(duration, 38, `${dots}<TremoloSingleChord><subtype>${mark}</subtype></TremoloSingleChord>`)),
    ]), 'test'));
    const timeline = makeTimeline('r8');
    expect(timeline.movements).toEqual(makeTimeline('r16').movements);
    expect(timeline.movements).toEqual(makeTimeline('r32').movements);
    expect(timeline.movements.every(m => m.roll)).toBe(true);
    expect(timeline.movements.map(m => m.hand)).toEqual(timeline.movements.map((_, i) => i % 2 ? 'L' : 'R'));
    const contacts = timeline.movements.flatMap(audioContacts);
    expect(contacts).toHaveLength(count);
    contacts.forEach((contact, i) => expect(contact.time).toBeCloseTo(i * 0.0625));
    expect(contacts.at(-1)!.time + contacts.at(-1)!.seconds).toBeCloseTo(count * 0.0625);
    expect(timeline.warnings.some(w => /unsupported or disabled tremolo/.test(w))).toBe(false);
  });
  it.each([
    [4, 'repertoire', 'L'], [6, 'repertoire', 'R'], [4, 'eighth', undefined],
  ] as const)('plays a single-slash semiquaver as one same-hand double stroke (%i, %s, %s)', (numerator, rollProfile, hand) => {
    const score = parseScore(synthetic([
      measure(time(numerator, numerator === 6 ? 8 : 4) + tempo(120)),
      measure((hand ? `<Sticking><text>${hand}</text></Sticking>` : '') + chord('16th', 38, '<TremoloSingleChord><subtype>r8</subtype></TremoloSingleChord>')),
    ]), 'test', { scores: { test: { parts: [{ part: 'Side Drum', rollProfile }] } } });
    const timeline = interpretScore(score);
    expect(timeline.movements).toHaveLength(1);
    const movement = timeline.movements[0];
    expect(movement).toMatchObject({ hand, roll: true, position: fraction(0), duration: fraction(1, 4), seconds: 0.125 });
    const contacts = audioContacts(movement);
    expect(contacts.map(c => c.time)).toEqual([0, 0.0625]);
    expect(contacts.at(-1)!.time + contacts.at(-1)!.seconds).toBeCloseTo(0.125);
    expect(timeline.warnings.some(w => /unsupported or disabled tremolo/.test(w))).toBe(false);
  });
  it('plays every Heart of Oak short roll as two contacts on its written hand, including repeats', () => {
    const timeline = interpretScore(fixture('heart-of-oak'));
    const written = timeline.score.notes.filter(n => n.tremolo === 'r8');
    expect(written.length).toBeGreaterThan(0);
    for (const note of written) {
      expect(note.hand).toBeDefined();
      const movements = timeline.movements.filter(m => m.id.startsWith(`${note.id}:movement:`));
      expect(movements).toHaveLength(1);
      const movement = movements[0];
      expect(movement).toMatchObject({ hand: note.hand, roll: true, position: note.position, duration: note.duration });
      const contacts = audioContacts(movement);
      expect(contacts).toHaveLength(2);
      expect(contacts[0].time).toBe(movement.time);
      expect(contacts[1].time).toBeCloseTo(movement.time + movement.seconds / 2);
      expect(contacts[1].time + contacts[1].seconds).toBeCloseTo(movement.time + movement.seconds);
    }
    expect(timeline.warnings.some(w => /unsupported or disabled tremolo/.test(w))).toBe(false);
  });
  it('keeps disabled and non-snare single-slash marks outside roll support', () => {
    const score = parseScore(synthetic([
      measure(time() + tempo(120) + chord('quarter', 60, '<TremoloSingleChord><subtype>r8</subtype></TremoloSingleChord>')),
      measure(chord('quarter', 38, '<TremoloSingleChord><subtype>r8</subtype></TremoloSingleChord>')),
    ]), 'test', { scores: { test: { parts: [{ part: 'Side Drum', rollProfile: 'disabled' }] } } });
    const disabled = interpretScore(score);
    expect(disabled.movements.every(m => !m.roll && audioContacts(m).length === 1)).toBe(true);
    expect(disabled.warnings.some(w => /unsupported or disabled tremolo/.test(w))).toBe(true);
  });
  it('uses four even contacts per quaver without changing the written hand pattern', () => {
    const timeline = interpretScore(fixture('colonel-bogey'));
    const movement = timeline.movements.find(m => m.roll)!;
    const original = structuredClone(movement);
    const contacts = audioContacts(movement);
    expect(contacts).toHaveLength(2);
    contacts.forEach((contact, i) => {
      expect(contact.time).toBeCloseTo(movement.time + i * movement.seconds / 2);
      expect(contact.seconds).toBeCloseTo(movement.seconds / 2);
      expect(contact.velocity / movement.velocity).toBeCloseTo(0.65);
    });
    expect(contacts.at(-1)!.time + contacts.at(-1)!.seconds).toBeCloseTo(movement.time + movement.seconds);
    expect(movement).toEqual(original);
    const single = timeline.movements.find(m => !m.roll)!;
    expect(audioContacts(single)).toEqual([{ time: single.time, seconds: single.seconds, velocity: single.velocity }]);
  });
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
    const contacts = roll.flatMap(audioContacts);
    expect(contacts).toHaveLength(20);
    contacts.forEach((contact, i) => expect(contact.time).toBeCloseTo(secondsAt(score, fraction(48 + i, 8))));
    expect(roll.at(-1)!.sourceId).toBe(score.ties.find(t => t.from === start.id)!.to);
    expect(timeline.movements.some(m => m.partId === start.partId && value(m.position) === 8.5 && !m.roll)).toBe(true);
  });
  it.each([['quarter', 4], ['half', 8]] as const)('expands an R %s roll to %i semiquaver movements', (type, count) => {
    const score = parseScore(synthetic([measure(time() + tempo(120)), measure('<Sticking><text>R</text></Sticking>' + chord(type, 38, '<TremoloSingleChord><subtype>r16</subtype></TremoloSingleChord>'))]), 'test');
    const timeline = interpretScore(score);
    expect(timeline.movements).toHaveLength(count);
    expect(timeline.movements[0].hand).toBe('R');
  });
  it.each([6, 9, 12])('uses three quaver movements for a dotted crotchet in %i/8', numerator => {
    const score = parseScore(synthetic([measure(time(numerator, 8) + tempo(120)), measure('<Sticking><text>R</text></Sticking>' + chord('quarter', 38, '<dots>1</dots><TremoloSingleChord><subtype>r32</subtype></TremoloSingleChord>'))]), 'test');
    const roll = interpretScore(score).movements;
    expect(roll.map(m => value(m.position))).toEqual([0, 0.5, 1]);
    expect(roll.map(m => m.hand)).toEqual(['R', 'L', 'R']);
    expect(audioContacts(roll[0])).toHaveLength(4);
    expect(audioContacts(roll.at(-1)!).at(-1)!.time).toBeLessThan(secondsAt(score, fraction(3, 2)));
  });
  it('keeps semiquaver roll spacing in simple 3/8', () => {
    const score = parseScore(synthetic([measure(time(3, 8) + tempo(120)), measure('<Sticking><text>L</text></Sticking>' + chord('eighth', 38, '<TremoloSingleChord><subtype>r16</subtype></TremoloSingleChord>'))]), 'test');
    const roll = interpretScore(score).movements;
    expect(roll.map(m => value(m.position))).toEqual([0, 0.25]);
    expect(roll.map(m => m.hand)).toEqual(['L', 'R']);
    expect(roll.flatMap(audioContacts)).toHaveLength(4);
  });
  it('keeps four contacts per quaver with a quaver hand profile in simple time', () => {
    const score = parseScore(synthetic([
      measure(time() + tempo(120)),
      measure(chord('quarter', 38, '<TremoloSingleChord><subtype>r32</subtype></TremoloSingleChord>')),
    ]), 'test', { scores: { test: { parts: [{ part: 'Side Drum', rollProfile: 'eighth' }] } } });
    const roll = interpretScore(score).movements;
    expect(roll).toHaveLength(2);
    expect(roll.flatMap(audioContacts).map(c => c.time)).toEqual([0, 0.0625, 0.125, 0.1875, 0.25, 0.3125, 0.375, 0.4375]);
  });
  it('preserves an explicit semiquaver profile in compound time', () => {
    const score = parseScore(synthetic([measure(time(6, 8) + tempo(120)), measure('<Sticking><text>L</text></Sticking>' + chord('eighth', 38, '<TremoloSingleChord><subtype>r16</subtype></TremoloSingleChord>'))]), 'test', { scores: { test: { parts: [{ part: 'Side Drum', rollProfile: 'sixteenth' }] } } });
    const roll = interpretScore(score).movements;
    expect(roll.map(m => value(m.position))).toEqual([0, 0.25]);
    expect(roll.map(m => m.hand)).toEqual(['L', 'R']);
    expect(roll.flatMap(audioContacts)).toHaveLength(4);
  });
  it('keeps quaver phase through a tied 6/8 roll without another boundary attack', () => {
    const next = '<Spanner type="Tie"><next><location><measures>1</measures></location></next></Spanner>';
    const previous = '<Spanner type="Tie"><prev><location><measures>-1</measures></location></prev></Spanner>';
    const tremolo = '<TremoloSingleChord><subtype>r16</subtype></TremoloSingleChord>';
    const score = parseScore(synthetic([
      measure(time(6, 8) + tempo(120)) + measure(''),
      measure('<Sticking><text>L</text></Sticking>' + chord('half', 38, '<dots>1</dots>' + tremolo, next)) + measure(chord('eighth', 38, tremolo, previous)),
    ]), 'test');
    expect(score.ties).toHaveLength(1);
    const roll = interpretScore(score).movements;
    expect(roll.map(m => value(m.position))).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(roll.map(m => m.hand)).toEqual(['L', 'R', 'L', 'R', 'L', 'R', 'L']);
    expect(value(add(roll.at(-1)!.position, roll.at(-1)!.duration))).toBe(3.5);
    expect(roll.at(-1)!.sourceId).toBe(score.ties[0].to);
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
