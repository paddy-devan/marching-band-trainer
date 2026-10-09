import { describe, expect, it } from 'vitest';
import { Attempt, gameTargets, type Target } from '../src/game/scoring';
import { countIn, metronomeClicks } from '../src/audio/beats';
import { interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

const target = (time: number, pitch = 84, id = String(time), window = 0.15): Target => ({ id, time, pitch, window });

describe('bell lyre challenge scoring', () => {
  it('scores all expected notes, with missed notes in the denominator, as integer stars', () => {
    const attempt = new Attempt([target(0), target(1), target(2), target(3)], 1);
    expect(attempt.tap(84, 0.025)).toBe('Perfect');
    expect(attempt.tap(84, 0.92)).toBe('Early');
    expect(attempt.tap(84, 2.13)).toBe('Late');
    expect(attempt.finish()).toEqual({ stars: 5, perfect: 1, close: 2, missed: 1, extras: 0, total: 4, longestPerfectStreak: 1 });
  });
  it('claims each repeated note once, penalises extra/wrong taps, and cannot claim future notes', () => {
    const attempt = new Attempt([target(0), target(1), target(2, 86)], 1);
    expect(attempt.tap(84, 0)).toBe('Perfect');
    expect(attempt.tap(84, 0.01)).toBe('Extra tap');
    expect(attempt.tap(84, 0.5)).toBe('Extra tap');
    expect(attempt.tap(84, 1)).toBe('Perfect');
    expect(attempt.tap(84, 2)).toBe('Wrong note');
    expect(attempt.tap(86, 2.03)).toBe('Perfect');
    expect(attempt.finish()).toMatchObject({ stars: 8, perfect: 3, missed: 0, extras: 3 });
  });
  it('judges chords with separate strikes and expires misses even without input', () => {
    const attempt = new Attempt([target(0, 84, 'c'), target(0, 88, 'e'), target(1)], 1);
    attempt.tap(84, 0);
    attempt.tap(88, 0.02);
    expect(attempt.advance(1.2)).toBe(1);
    expect(attempt.advance(1.3)).toBe(0);
    expect(attempt.finish()).toMatchObject({ stars: 7, perfect: 2, missed: 1 });
  });
  it('uses real-time timing windows at different practice speeds', () => {
    const slow = new Attempt([target(1)], 0.5);
    expect(slow.tap(84, 1.04)).toBe('Late'); // 80 ms late in real time
    const fast = new Attempt([target(1)], 1.5);
    expect(fast.tap(84, 1.06)).toBe('Perfect'); // 40 ms late in real time
    const missed = new Attempt([target(1)], 0.5);
    expect(missed.tap(84, 1.08)).toBe('Extra tap');
    expect(missed.finish()).toMatchObject({ stars: 0, missed: 1 });
  });
  it('credits queued inputs by their original timestamp after a render frame expires the target', () => {
    const attempt = new Attempt([target(1)], 1);
    expect(attempt.advance(1.2)).toBe(1);
    expect(attempt.tap(84, 1.03)).toBe('Perfect');
    expect(attempt.tap(84, 1.04)).toBe('Extra tap');
    expect(attempt.finish()).toMatchObject({ perfect: 1, missed: 0, extras: 1 });
  });
  it('deduplicates unisons, preserves chords, and narrows windows between fast notes', () => {
    const timeline = interpretScore(parseScore(synthetic([measure(time() + tempo(120) + chord('16th') + chord('16th'))]), 'test'));
    const part = timeline.score.parts[0];
    part.register.transpose = 24;
    timeline.movements.push({ ...timeline.movements[0], id: 'unison' }, { ...timeline.movements[0], id: 'chord', pitch: 64 });
    const targets = gameTargets(timeline, part, 1.5);
    expect(targets.map(t => t.pitch)).toEqual([84, 88, 84]);
    expect(targets[0].window).toBeCloseTo(0.125 / 1.5 / 2);
    const attempt = new Attempt(targets, 1.5);
    targets.forEach(t => attempt.tap(t.pitch, t.time));
    expect(attempt.finish()).toMatchObject({ stars: 10, perfect: 3 });
  });
  it('uses the interpreted repertoire, including repeat passes', () => {
    const timeline = interpretScore(fixture('colonel-bogey'));
    const part = timeline.score.parts.find(p => p.renderer === 'lyre')!;
    const targets = gameTargets(timeline, part, 1);
    expect(timeline.score.measures.length).toBeGreaterThan(timeline.score.writtenMeasureCount!);
    expect(targets.length).toBe(timeline.movements.filter(m => m.partId === part.id).length);
    const attempt = new Attempt(targets, 1);
    targets.forEach(t => attempt.tap(t.pitch, t.time));
    expect(attempt.finish()).toMatchObject({ stars: 10, missed: 0, extras: 0 });
  });
  it('clamps button-mashing to zero and handles an empty part', () => {
    const attempt = new Attempt([target(1)], 1);
    for (let i = 0; i < 50; i++) attempt.tap(84, 0);
    expect(attempt.finish().stars).toBe(0);
    expect(new Attempt([], 1).finish().stars).toBe(0);
  });
  it('requires one attack for a tie spanning two bars', () => {
    const next = '<Spanner type="Tie"><next><location><measures>1</measures></location></next></Spanner>';
    const previous = '<Spanner type="Tie"><prev><location><measures>-1</measures></location></prev></Spanner>';
    const timeline = interpretScore(parseScore(synthetic([measure(time() + tempo(120) + chord('whole', 60, '', next)) + measure(chord('whole', 60, '', previous))]), 'test'));
    const targets = gameTargets(timeline, timeline.score.parts[0], 1);
    expect(targets).toHaveLength(1);
    const attempt = new Attempt(targets, 1);
    attempt.tap(targets[0].pitch, 0);
    attempt.advance(timeline.duration);
    expect(attempt.finish()).toMatchObject({ stars: 10, perfect: 1, missed: 0 });
  });
  it('tracks consecutive perfect attacks, resets on timing errors, and retains the longest streak', () => {
    const attempt = new Attempt(Array.from({ length: 8 }, (_, i) => target(i)), 1);
    attempt.tap(84, 0);
    attempt.tap(84, 1);
    expect(attempt.perfectStreak()).toEqual({ current: 2, longest: 2 });
    attempt.tap(84, 2);
    expect(attempt.perfectStreak()).toEqual({ current: 3, longest: 3 });
    attempt.tap(84, 3.08);
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 3 });
    for (let time = 4; time < 8; time++) attempt.tap(84, time);
    expect(attempt.perfectStreak()).toEqual({ current: 4, longest: 4 });
    expect(attempt.finish().longestPerfectStreak).toBe(4);
    expect(new Attempt([target(0)], 1).finish().longestPerfectStreak).toBe(0);
  });
  it('breaks perfect streaks on missed notes, wrong notes, and extra taps, including during rests', () => {
    const attempt = new Attempt(Array.from({ length: 9 }, (_, i) => target(i)), 1);
    for (let time = 0; time < 3; time++) attempt.tap(84, time);
    attempt.tap(84, 2.5); // extra tap during a rest
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 3 });
    attempt.tap(84, 3);
    attempt.tap(84, 4);
    attempt.advance(5.2);
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 3 });
    attempt.tap(84, 6);
    attempt.tap(86, 7);
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 3 });
    attempt.tap(84, 7.03);
    attempt.tap(84, 8);
    expect(attempt.finish()).toMatchObject({ longestPerfectStreak: 3, missed: 1, extras: 2 });
  });
  it('restores a streak for timely queued inputs and counts simultaneous pitches once each', () => {
    const attempt = new Attempt([target(0, 84, 'a'), target(0, 88, 'b'), target(1)], 1);
    attempt.tap(84, 0);
    attempt.tap(88, 0);
    attempt.advance(1.2);
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 2 });
    attempt.tap(84, 1.02);
    expect(attempt.perfectStreak()).toEqual({ current: 3, longest: 3 });
    expect(attempt.finish().longestPerfectStreak).toBe(3);
    attempt.tap(84, 1.02);
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 3 });
  });
});

describe('challenge count-in and metronome', () => {
  it('counts compound beats and follows tempo changes', () => {
    const timeline = interpretScore(parseScore(synthetic([measure(time(12, 8) + tempo(120) + chord('whole')) + measure(tempo(60) + chord('whole'))]), 'test'));
    expect(countIn(timeline)).toEqual({ beats: 4, interval: 0.75, duration: 3 });
    expect(metronomeClicks(timeline).map(c => c.time)).toEqual([0, 0.75, 1.5, 2.25, 3, 4.5, 6, 7.5]);
    expect(metronomeClicks(timeline).filter(c => c.accent).map(c => c.time)).toEqual([0, 3]);
  });
  it('gives a full count-in even when the piece starts with a pickup', () => {
    const timeline = interpretScore(parseScore(synthetic([measure(time() + tempo(120) + chord(), 'len="1/4"')]), 'test'));
    expect(countIn(timeline).duration).toBe(2);
    expect(metronomeClicks(timeline)).toEqual([{ time: 0, accent: true }]);
  });
});
