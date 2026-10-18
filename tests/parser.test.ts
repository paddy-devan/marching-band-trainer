import { describe, expect, it } from 'vitest';
import { add, fraction, sub, value } from '../src/score/fraction';
import { pitchLabel, keyLabel } from '../src/score/labels';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

describe('written dynamics', () => {
  const dynamic = (name: string, velocity = 0) => `<Dynamic><subtype>${name}</subtype><velocity>${velocity}</velocity></Dynamic>`;
  it('carries part dynamics through rests and bars, respects saved velocities, and keeps accents relative', () => {
    const bars = measure(time() + tempo(120) + chord() + dynamic('pp') + chord() +
      dynamic('mp') + chord('quarter', 60, '<Articulation><subtype>articAccentAbove</subtype></Articulation>') + chord()) +
      measure('<Rest><durationType>quarter</durationType></Rest>' + chord() + dynamic('pp', 49) + chord('half'));
    const score = parseScore(synthetic([bars, measure(chord('whole', 38)) + measure(chord('whole', 38))]), 'dynamics');
    expect(score.notes.filter(n => n.partId === score.parts[0].id).map(n => n.velocity)).toEqual([
      0.72, 33 / 127, 64 / 127 / 0.72, 64 / 127, 64 / 127, 49 / 127,
    ].map(value => expect.closeTo(value, 8)));
    expect(score.notes.filter(n => n.partId === score.parts[1].id).every(n => n.velocity === 0.72)).toBe(true);
  });
  it('applies a dynamic to simultaneous notes in another voice regardless of XML traversal order', () => {
    const bars = `<Measure><voice>${time()}${tempo(120)}${chord('half')}${chord('half')}</voice>` +
      `<voice>${dynamic('pp')}${chord('half', 67)}${dynamic('f')}${chord('half', 67)}</voice></Measure>`;
    const score = parseScore(synthetic([bars]), 'voices');
    expect(score.notes.filter(n => value(n.position) === 0).map(n => n.velocity)).toEqual([33 / 127, 33 / 127]);
    expect(score.notes.filter(n => value(n.position) === 2).map(n => n.velocity)).toEqual([96 / 127, 96 / 127]);
  });
  it('reads the Captain General cymbal levels and saved pp overrides', () => {
    const score = fixture('the-captain-general');
    const part = score.parts.find(p => /cymbal/i.test(p.name))!;
    const notes = score.notes.filter(n => n.partId === part.id);
    expect(notes.find(n => n.measure === 0)?.velocity).toBeCloseTo(64 / 127);
    expect(notes.find(n => n.measure === 3)?.velocity).toBeCloseTo(49 / 127);
    expect(notes.find(n => n.measure === 4)?.velocity).toBeCloseTo(64 / 127 / 0.72);
    expect(notes.some(n => Math.abs(n.velocity - 33 / 127) < 1e-6)).toBe(true);
  });
  it('does not turn an unsupported special attack into a persistent dynamic', () => {
    const score = parseScore(synthetic([measure(time() + tempo(120) + dynamic('pp') + chord() + dynamic('sfz', 112) + chord('half'))]), 'special');
    expect(score.notes.map(n => n.velocity)).toEqual([33 / 127, 33 / 127]);
    expect(score.warnings.some(w => /sfz.*unsupported/.test(w))).toBe(true);
  });
});

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
  it('prefers visible Colonel Bogey metadata and resolves drum notes through the named stick mapping', () => {
    const score = fixture('colonel-bogey');
    expect(score.title).toBe('Colonel Bogey');
    expect(score.composer).toBe('Kenneth J. Alford');
    expect(score.measures).toHaveLength(14);
    expect(value(score.duration)).toBe(56);
    expect(score.measures[0].signature).toEqual({ numerator: 4, denominator: 4 });
    const snare = score.notes.filter(n => n.partId === score.parts[1].id);
    expect(snare).toHaveLength(123);
    expect(snare.every(n => n.provenance === 'drum-map')).toBe(true);
    expect(snare.every(n => (n.pitch === 38 && n.hand === 'L') || (n.pitch === 40 && n.hand === 'R'))).toBe(true);
    expect(score.parts[1].drums).toMatchObject({
      38: { name: 'Left stick', hand: 'L', line: 1 },
      40: { name: 'Right stick', hand: 'R', line: -1 },
    });
    expect(snare.filter(n => n.tremolo)).toHaveLength(24);
    expect(score.keys[0].fifths).toBe(-5);
    expect(score.keys[0].mode).toBeUndefined();
    expect(keyLabel(-5)).toBe('5 flats · D♭ major / B♭ minor');
    expect(score.parts[0].renderer).toBe('lyre');
    expect(score.parts[0].register).toMatchObject({ min: 81, max: 105, transpose: 24 });
    expect(score.repeats).toEqual([{ start: 2, end: 9, count: 2 }]);
    expect(score.endings.map(e => [e.start, e.end, e.passes])).toEqual([[6, 10, [1]], [10, 11, [2]]]);
    expect(score.warnings.some(w => /Repeats/.test(w))).toBe(false);
    expect(score.warnings.filter(w => /sticking/.test(w))).toHaveLength(0);
  });
  it('also loads the extra 12/8 score from the source directory', () => {
    const score = fixture('hollyrood');
    expect(score.parts).toHaveLength(2);
    expect(score.measures).toHaveLength(18);
    expect(score.measures[0].signature).toEqual({ numerator: 12, denominator: 8 });
    expect(score.tempos[0].bpm).toBe(174);
    expect(value(score.duration)).toBe(108);
  });
  it('fits Sarie Marais bar 9 triplets and their rest into two beats', () => {
    const score = fixture('sarie-marais');
    const drum = score.parts.find(p => p.name === 'Side Drum')!;
    const bar = score.measures[8];
    const notes = score.notes.filter(n => n.partId === drum.id && n.measure === 8);
    expect(bar.signature).toEqual({ numerator: 4, denominator: 4 });
    expect(notes.map(n => n.offset)).toEqual([
      fraction(0), fraction(2, 3), fraction(1), fraction(4, 3), fraction(5, 3), fraction(2), fraction(3),
    ]);
    expect(notes.map(n => n.duration)).toEqual([
      ...Array.from({ length: 5 }, () => fraction(1, 3)), fraction(1), fraction(1),
    ]);
    const rest = score.rests.find(r => r.partId === drum.id && value(sub(r.position, bar.start)) === 1 / 3)!;
    expect(rest.duration).toEqual(fraction(1, 3));
    expect(add(notes.at(-1)!.position, notes.at(-1)!.duration)).toEqual(add(bar.start, bar.duration));
    expect(score.warnings.some(w => /tuplet|exceeds the measure/i.test(w))).toBe(false);
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
    const score = parseScore(synthetic([measure(time() + tempo(120) + chord('eighth', 60, '<acciaccatura/>') + chord())]), 'test');
    expect(score.notes).toHaveLength(1);
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
