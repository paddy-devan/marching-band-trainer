import { describe, expect, it } from 'vitest';
import { fraction, value } from '../src/score/fraction';
import { pitchLabel, keyLabel } from '../src/score/labels';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

describe('actual source scores', () => {
  it('uses visible titles and accurately resolves every 16 OBR hand', () => {
    const score = fixture('16obr');
    expect(score.title).toBe('16 Bar Off Beat Routine (16 OBR)');
    expect(score.parts.map(p => p.name)).toEqual(['Side Drum', 'Bass Drum']);
    expect(score.measures).toHaveLength(16);
    expect(score.measures[0].signature).toEqual({ numerator: 2, denominator: 4 });
    expect(score.tempos[0].bpm).toBeCloseTo(116, 2);
    expect(value(score.duration)).toBe(32);
    const snare = score.notes.filter(n => n.partId === score.parts[0].id);
    expect(snare).toHaveLength(43);
    expect(snare.filter(n => n.hand === 'R')).toHaveLength(23);
    expect(snare.filter(n => n.hand === 'L')).toHaveLength(20);
    expect(snare.every(n => n.provenance === 'drum-map')).toBe(true);
    expect(snare.every(n => !n.tremolo)).toBe(true);
    expect(snare.some((n, i) => i > 0 && n.hand === snare[i - 1].hand)).toBe(true);
  });
  it('prefers visible Colonel Bogey metadata and keeps missing sticking unknown', () => {
    const score = fixture('colonel-bogey');
    expect(score.title).toBe('Colonel Bogey');
    expect(score.composer).toBe('Kenneth J. Alford');
    expect(score.measures).toHaveLength(14);
    expect(value(score.duration)).toBe(56);
    expect(score.measures[0].signature).toEqual({ numerator: 4, denominator: 4 });
    const snare = score.notes.filter(n => n.partId === score.parts[1].id);
    expect(snare).toHaveLength(123);
    expect(snare.filter(n => n.provenance === 'explicit')).toHaveLength(12);
    expect(snare.slice(0, 12).map(n => n.hand)).toEqual(['R', 'R', 'R', 'L', 'R', 'L', 'R', 'R', 'L', 'R', 'L', 'R']);
    expect(snare.slice(12).every(n => !n.hand)).toBe(true);
    expect(snare.filter(n => n.tremolo)).toHaveLength(24);
    expect(score.keys[0].fifths).toBe(-5);
    expect(score.keys[0].mode).toBeUndefined();
    expect(keyLabel(-5)).toBe('5 flats · D♭ major / B♭ minor');
    expect(score.parts[0].renderer).toBe('lyre');
    expect(score.parts[0].register).toMatchObject({ min: 81, max: 105, transpose: 24 });
    expect(score.warnings.some(w => /Repeats/.test(w))).toBe(true);
    expect(score.warnings.filter(w => /unspecified sticking/.test(w))).toHaveLength(1);
  });
  it('also loads the extra 12/8 score from the source directory', () => {
    const score = fixture('hollyrood');
    expect(score.parts).toHaveLength(2);
    expect(score.measures).toHaveLength(18);
    expect(score.measures[0].signature).toEqual({ numerator: 12, denominator: 8 });
    expect(score.tempos[0].bpm).toBe(174);
    expect(value(score.duration)).toBe(108);
  });
});

describe('notation and validation', () => {
  it('aligns multiple voices and multi-staff parts without collapsing rests', () => {
    const xml = `<museScore version="4.70"><Score><Division>480</Division><Part><trackName>Piano</trackName><Staff id="1"><StaffType group="pitched" /></Staff><Staff id="2"><StaffType group="pitched" /></Staff><Instrument id="piano" /></Part><Staff id="1"><Measure><voice>${time()}${tempo(120)}${chord('half', 60, '<dots>1</dots>')}<Rest><durationType>quarter</durationType></Rest></voice><voice><Rest><durationType>half</durationType></Rest>${chord('half', 67)}</voice></Measure></Staff><Staff id="2">${measure(time() + chord('whole', 48))}</Staff></Score></museScore>`;
    const score = parseScore(xml, 'test');
    expect(score.parts).toHaveLength(1);
    expect(score.parts[0].staffIds).toEqual(['1', '2']);
    expect(score.notes.find(n => n.pitch === 67)?.position).toEqual(fraction(2));
    expect(score.notes.find(n => n.pitch === 60)?.duration).toEqual(fraction(3));
    expect(score.notes.find(n => n.pitch === 48)?.position).toEqual(fraction(0));
    expect(score.rests).toHaveLength(2);
  });
  it('uses explicit sticking over a contradictory drum definition', () => {
    const xml = synthetic([measure(time() + tempo(120)), measure('<Sticking><text>R</text></Sticking>' + chord('quarter', 38))]).replace('Acoustic Snare', 'Left stick');
    const score = parseScore(xml, 'test');
    expect(score.notes[0]).toMatchObject({ hand: 'R', provenance: 'explicit' });
    expect(score.warnings.some(w => /conflicting named drum mapping/.test(w))).toBe(true);
  });
  it('detects stale and ambiguous configuration', () => {
    const score = parseScore(synthetic([measure(time() + tempo(120) + chord())]), 'test', { scores: { test: { parts: [{ part: 'Old name', renderer: 'lyre' }] } } });
    expect(score.warnings.some(w => /matched 0 parts/.test(w))).toBe(true);
  });
  it('detects unsupported notation instead of claiming faithful playback', () => {
    const score = parseScore(synthetic([measure(time() + tempo(120) + '<Tuplet><actualNotes>3</actualNotes></Tuplet>' + chord('eighth', 60, '<acciaccatura/>') + chord())]), 'test');
    expect(score.notes).toHaveLength(1);
    expect(score.warnings.some(w => /Tuplets/.test(w))).toBe(true);
    expect(score.warnings.some(w => /Grace notes/.test(w))).toBe(true);
  });
  it('keeps nested visible text as plain text and rejects malformed formats', () => {
    const xml = synthetic([measure(time() + tempo(120) + chord())]).replace('<Division>', '<VBox><Text><style>title</style><text>Hello <b>Band</b><br/>!</text></Text></VBox><Division>');
    expect(parseScore(xml, 'test').title).toBe('Hello Band!');
    expect(() => parseScore('<museScore>', 'test')).toThrow(/Malformed/);
    expect(() => parseScore(xml.replace('4.70', '3.02'), 'test')).toThrow(/unsupported/);
    expect(() => parseScore(xml.replace('<pitch>60</pitch>', '<pitch>invalid</pitch>'), 'test')).toThrow(/invalid note pitch/);
  });
  it('labels score spelling, enharmonics and octaves separately', () => {
    expect(pitchLabel(73, 9)).toBe('D♭5');
    expect(pitchLabel(73, 9, 'sharps')).toBe('C♯5');
    expect(pitchLabel(85, 9)).toBe('D♭6');
    expect(pitchLabel(60, 26)).toBe('B♯3');
    expect(pitchLabel(59, 7)).toBe('C♭4');
  });
});
