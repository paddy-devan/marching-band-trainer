import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Attempt, drumTargets } from '../src/game/scoring';
import { fraction, value } from '../src/score/fraction';
import { audioContacts, interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { BarNotes, barCues } from '../src/ui/BarNotes';
import { ChallengeFrames } from '../src/ui/challenge-frame';
import { DEFAULT_DRUM_TIMING, drumFrame, drumLanes } from '../src/ui/drum-timing';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

const grace = (mark = 'acciaccatura') => chord('eighth', 40, `<${mark}/>`);
const namedHands = (xml: string) => xml.replace('<Drum pitch="38"><name>Acoustic Snare</name><line>0</line></Drum>',
  '<Drum pitch="38"><name>Left stick</name><line>1</line></Drum><Drum pitch="40"><name>Right stick</name><line>-1</line></Drum>');
const scoreWith = (body: string, bpm = 120) => parseScore(namedHands(synthetic([
  measure(time(2, 4) + tempo(bpm)), measure(time(2, 4) + tempo(bpm) + body),
])), 'flams');

describe('snare flams', () => {
  it.each(['acciaccatura', 'appoggiatura'])('attaches a single %s without consuming a beat', mark => {
    const score = scoreWith(grace(mark) + chord('quarter', 38) + chord('quarter', 40));
    expect(score.notes.map(n => value(n.position))).toEqual([0, 1]);
    expect(value(score.duration)).toBe(2);
    expect(score.notes[0]).toMatchObject({ hand: 'L', flam: { pitch: 40, hand: 'R', provenance: 'drum-map' } });
    expect(score.notes[1].flam).toBeUndefined();
    expect(score.warnings).toEqual([]);
  });
  it('resolves explicit grace and principal sticking independently', () => {
    const score = scoreWith('<Sticking><text>L</text></Sticking>' + grace() +
      '<Sticking><text>R</text></Sticking>' + chord('half', 38));
    expect(score.notes[0]).toMatchObject({ hand: 'R', provenance: 'explicit', flam: { hand: 'L', provenance: 'explicit' } });
  });
  it('keeps tuplets exact around a grace stroke', () => {
    const score = scoreWith('<Tuplet><actualNotes>3</actualNotes><normalNotes>2</normalNotes></Tuplet>' +
      grace() + chord('eighth', 38).repeat(3) + '<endTuplet/>' + chord('quarter', 40));
    expect(score.notes.map(n => n.position)).toEqual([fraction(0), fraction(1, 3), fraction(2, 3), fraction(1)]);
    expect(score.notes[0].duration).toEqual(fraction(1, 3));
    expect(score.warnings).toEqual([]);
  });
  it('warns and omits unsupported groups, after-graces and unattached grace notes', () => {
    for (const body of [grace() + grace() + chord('half', 38), grace('grace8after') + chord('half', 38),
      grace() + '<Rest><durationType>half</durationType></Rest>', chord('half', 38) + grace()]) {
      const score = scoreWith(body);
      expect(score.notes.every(n => !n.flam)).toBe(true);
      expect(score.warnings.some(w => /Grace notes/.test(w))).toBe(true);
    }
  });
  it('preserves all 18 McAlpine flams and their written hands', () => {
    const score = fixture('mcalpine');
    expect(score.notes).toHaveLength(181);
    const flams = score.notes.filter(n => n.flam);
    expect(flams).toHaveLength(18);
    expect(flams.every(n => n.flam!.hand && n.hand && n.flam!.hand !== n.hand)).toBe(true);
    expect(score.warnings.some(w => /Grace notes/.test(w))).toBe(false);
    const timeline = interpretScore(score);
    expect(timeline.movements.filter(m => m.flam === 'grace')).toHaveLength(18);
    expect(timeline.movements.filter(m => m.flam === 'main')).toHaveLength(18);
    expect(timeline.duration).toBe(32.25);
  });
  it('plays a quieter stroke before the beat while preserving main-note timing and accents', () => {
    const score = scoreWith(grace() + chord('half', 38, '<Articulation><subtype>articAccentAbove</subtype></Articulation>'));
    const timeline = interpretScore(score);
    const [lead, main] = timeline.movements;
    expect(lead).toMatchObject({ flam: 'grace', hand: 'R', roll: false, time: -0.035, seconds: 0.035, duration: fraction(0) });
    expect(main).toMatchObject({ flam: 'main', hand: 'L', time: 0, seconds: 1, velocity: 1, accent: true });
    expect(lead.accent).toBe(false);
    expect(lead.velocity).toBeCloseTo(0.4);
    expect(audioContacts(lead)).toHaveLength(1);
    expect(audioContacts(main)).toHaveLength(1);
    expect(timeline.duration).toBe(1);
  });
  it('shortens dense flam spacing to keep the grace stroke after the previous attack', () => {
    const { movements } = interpretScore(scoreWith(chord('32nd', 38) + grace() + chord('32nd', 38), 480));
    expect(movements.map(m => m.time)).toEqual([0, 0.0078125, 0.015625]);
    expect(movements[1].seconds).toBe(0.0078125);
  });
  it('keeps grace sticking unspecified when the score does not supply it', () => {
    const score = parseScore(synthetic([measure(time() + tempo(120)),
      measure(chord('eighth', 38, '<acciaccatura/>') + '<Sticking><text>R</text></Sticking>' + chord('quarter', 38))]), 'unknown');
    const [lead, main] = interpretScore(score).movements;
    expect(lead.hand).toBeUndefined();
    expect(main.hand).toBe('R');
    expect(score.warnings.some(w => /unspecified sticking/.test(w))).toBe(true);
  });
  it('retains flams on each repeat pass without moving the written bar boundaries', () => {
    const score = scoreWith(grace() + chord('half', 38));
    score.repeats = [{ start: 0, end: 0, count: 2 }];
    const timeline = interpretScore(score);
    expect(timeline.movements.map(m => m.time)).toEqual([-0.035, 0, 0.965, 1]);
    expect(new Set(timeline.movements.map(m => m.id)).size).toBe(4);
    expect(timeline.duration).toBe(2);
    expect(score.notes[0].flam?.hand).toBe('R');
  });
  it.each([0.25, 1, 1.5])('requires both hands in Drum challenge at %s speed', speed => {
    const timeline = interpretScore(scoreWith(grace() + chord('half', 38)));
    const targets = drumTargets(timeline, timeline.score.parts[1], speed);
    expect(targets.map(t => [t.time, t.hand])).toEqual([[-0.035, 'R'], [0, 'L']]);
    const attempt = new Attempt(targets, speed);
    for (const target of targets) expect(attempt.tap(target.hand!, target.time)).toBe('Perfect');
    expect(attempt.finish()).toMatchObject({ stars: 10, perfect: 2, missed: 0 });
    const incomplete = new Attempt(targets, speed);
    incomplete.tap('L', 0);
    expect(incomplete.finish()).toMatchObject({ stars: 5, perfect: 1, missed: 1 });
    const frames = new ChallengeFrames(timeline, targets, speed, true, true);
    expect(frames.read(-0.036).count).toBeGreaterThan(0);
    expect(frames.read(-0.035).count).toBe(0);
    expect(frames.read(-0.035).upcoming).toHaveLength(2);
  });
  it('shows a flam cue and animates the two hands at their respective contacts', () => {
    const { score, movements } = interpretScore(scoreWith(grace() + chord('half', 38)));
    const part = score.parts[1];
    const cues = barCues(score, movements, score.measures[0]);
    expect(cues).toHaveLength(1);
    expect(cues[0].movements[0].flam).toBe('main');
    const html = renderToStaticMarkup(createElement(BarNotes, { score, part, movements, measure: score.measures[0], position: 0, active: [] }));
    expect(html).toContain('L Flam');
    const lanes = drumLanes(movements);
    expect(drumFrame(lanes, -0.035, 1, DEFAULT_DRUM_TIMING)[1]).toMatchObject({ angle: 47.5, impact: true, buzz: false });
    expect(drumFrame(lanes, 0, 1, DEFAULT_DRUM_TIMING)[0]).toMatchObject({ angle: 47.5, impact: true, buzz: false });
  });
});
