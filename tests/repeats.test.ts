import { describe, expect, it } from 'vitest';
import { fraction, value } from '../src/score/fraction';
import { interpretScore, positionAt, secondsAt } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { expandRepeats, playbackOrder } from '../src/score/repeats';
import { chord, fixture, measure as voiceMeasure, synthetic, tempo, time } from './helpers';

const start = '<startRepeat/>';
const end = (count = 2) => `<endRepeat>${count}</endRepeat>`;
const volta = (passes: string, span = 1) => `<Spanner type="Volta"><Volta><endings>${passes}</endings></Volta><next><location><measures>${span}</measures></location></next></Spanner>`;
const measure = (content: string, attrs = '') => {
  const signs = content.match(/<startRepeat\s*\/>|<endRepeat>\d+<\/endRepeat>/g) || [];
  return voiceMeasure(content.replace(/<startRepeat\s*\/>|<endRepeat>\d+<\/endRepeat>/g, ''), attrs)
    .replace('</Measure>', `${signs.join('')}</Measure>`);
};
const bar = (pitch: number, marks = '') => measure(marks + chord('whole', pitch));
const parse = (bars: string) => parseScore(synthetic([bars]), 'repeat-test');

describe('repeat and ending playback', () => {
  it('takes Colonel Bogey through both endings and repeats every part in sync', () => {
    const source = fixture('colonel-bogey');
    const order = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 2, 3, 4, 5, 10, 11, 12, 13];
    expect(playbackOrder(source)).toEqual(order);
    const timeline = interpretScore(source);
    expect(timeline.score.measures.map(m => m.sourceIndex)).toEqual(order);
    expect(value(timeline.score.duration)).toBe(72);
    expect(timeline.score.writtenMeasureCount).toBe(14);
    expect(timeline.score.notes.filter(n => n.measure === 10).map(n => [n.partId, n.pitch, n.offset, n.hand]))
      .toEqual(source.notes.filter(n => n.measure === 2).map(n => [n.partId, n.pitch, n.offset, n.hand]));
    expect(source.measures).toHaveLength(14);
    expect(source.notes.some(n => n.sourceId)).toBe(false);
    expect(new Set(timeline.movements.map(m => m.id)).size).toBe(timeline.movements.length);
  });
  it('handles implicit starts, multiple sections and explicit repeat counts', () => {
    const source = parse(bar(60, time() + tempo(120)) + bar(61, end(3)) + bar(62, start) + bar(63, end()));
    expect(playbackOrder(source)).toEqual([0, 1, 0, 1, 0, 1, 2, 3, 2, 3]);
    expect(interpretScore(source).movements.map(m => m.pitch)).toEqual([60, 61, 60, 61, 60, 61, 62, 63, 62, 63]);
  });
  it('supports multi-bar and multi-pass endings without playing the skipped ending', () => {
    const source = parse(bar(60, time() + tempo(120) + start) + bar(61, volta('1, 2', 2)) + bar(62, end(3)) + bar(63, volta('3')) + bar(64));
    expect(playbackOrder(source)).toEqual([0, 1, 2, 0, 1, 2, 0, 3, 4]);
  });
  it('restarts nested repeat counters on each outer pass', () => {
    const source = parse(bar(60, time() + tempo(120) + start) + bar(61, start) + bar(62, end()) + bar(63, end()));
    expect(playbackOrder(source)).toEqual([0, 1, 2, 1, 2, 3, 0, 1, 2, 1, 2, 3]);
  });
  it('deduplicates repeat signs and ending brackets stored on multiple staffs', () => {
    const bars = bar(60, time() + tempo(120) + start) + bar(61, volta('1') + end()) + bar(62, volta('2'));
    const source = parseScore(synthetic([bars, bars]), 'multi-staff');
    expect(source.repeats).toHaveLength(1);
    expect(source.endings).toHaveLength(2);
    expect(playbackOrder(source)).toEqual([0, 1, 0, 2]);
  });
  it('restores tempo and key at repeat returns and includes mid-bar tempo changes', () => {
    const bars = measure(time() + tempo(120) + start + '<KeySig><accidental>2</accidental></KeySig>' + chord('half', 60) + tempo(60) + chord('half', 62)) +
      bar(64, '<KeySig><accidental>-2</accidental></KeySig>' + end());
    const score = expandRepeats(parse(bars));
    expect(score.tempos.map(t => [value(t.position), t.bpm])).toEqual([[0, 120], [2, 60], [8, 120], [10, 60]]);
    expect(score.keys.filter(k => value(k.position) === 8).at(-1)?.fifths).toBe(2);
    expect(secondsAt(score, score.duration)).toBe(14);
    expect(positionAt(score, 8)).toBe(10);
  });
  it('does not apply tempo marks or rests from an omitted first ending', () => {
    const source = parse(bar(60, time() + tempo(120) + start) + measure(volta('1') + tempo(60) + '<Rest><durationType>measure</durationType></Rest>' + end()) + bar(62, volta('2')));
    const expanded = expandRepeats(source);
    expect(expanded.rests.map(r => value(r.position))).toEqual([4]);
    expect(expanded.tempos.map(t => [value(t.position), t.bpm])).toEqual([[0, 120], [4, 60], [8, 120]]);
    expect(secondsAt(expanded, expanded.duration)).toBe(10);
  });
  it('preserves ties inside each pass and breaks a tie across a repeat jump', () => {
    const next = '<Spanner type="Tie"><next><location><measures>1</measures></location></next></Spanner>';
    const prev = '<Spanner type="Tie"><prev><location><measures>-1</measures></location></prev></Spanner>';
    const source = parse(measure(time() + tempo(120) + start + chord('whole', 60, '', next) + end()) + measure(chord('whole', 60, '', prev)));
    const timeline = interpretScore(source);
    expect(timeline.score.ties).toHaveLength(1);
    expect(timeline.movements.map(m => [m.time, m.seconds])).toEqual([[0, 2], [2, 4]]);
    const repeatedTie = parse(measure(time() + tempo(120) + start + chord('whole', 60, '', next)) + measure(chord('whole', 60, '', prev) + end()));
    expect(interpretScore(repeatedTie).movements.map(m => [m.time, m.seconds])).toEqual([[0, 4], [4, 4]]);
  });
  it('keeps exact pickup lengths and guards malformed or excessive expansion', () => {
    const pickup = measure(time() + tempo(120) + start + chord(), 'len="1/4"') + bar(62, end());
    expect(expandRepeats(parse(pickup)).measures.map(m => value(m.start))).toEqual([0, 1, 5, 6]);
    expect(expandRepeats(parse(pickup)).duration).toEqual(fraction(10));
    expect(() => parse(bar(60, end(0)))).toThrow(/repeat count/);
    expect(() => parse(bar(60, volta('1', 4)))).toThrow(/ending bracket/);
    const excessive = parse(bar(60, time() + tempo(120)));
    excessive.repeats = [{ start: 0, end: 0, count: 10001 }];
    expect(() => playbackOrder(excessive)).toThrow(/10,000/);
  });
});
