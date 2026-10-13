import { describe, expect, it } from 'vitest';
import { Attempt, drumTargets, type Target } from '../src/game/scoring';
import { playableDrums } from '../src/game/parts';
import { interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import type { Hand } from '../src/score/model';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

const target = (at: number, hand?: Hand, id = String(at)): Target => ({ id, time: at, pitch: 38, kind: 'drum', hand, window: 0.15 });

describe('drum challenge', () => {
  it('accepts either hand once for unspecified sticking and penalises a second tap', () => {
    const attempt = new Attempt([target(0), target(1)], 1);
    expect(attempt.tap('L', 0)).toBe('Perfect');
    expect(attempt.tap('R', 0)).toBe('Extra tap');
    expect(attempt.tap('R', 1)).toBe('Perfect');
    expect(attempt.finish()).toMatchObject({ perfect: 2, missed: 0, extras: 1, stars: 9 });
  });

  it('counts a wrong hand as a terminal miss with no double penalty and breaks the streak', () => {
    const attempt = new Attempt([target(0, 'L'), target(1, 'R'), target(2, 'L')], 1);
    attempt.tap('L', 0);
    expect(attempt.tap('L', 1)).toBe('Wrong hand');
    expect(attempt.perfectStreak()).toEqual({ current: 0, longest: 1 });
    expect(attempt.isJudged('1')).toBe(true);
    attempt.tap('L', 2);
    expect(attempt.finish()).toMatchObject({ perfect: 2, missed: 1, extras: 0, stars: 7 });
    expect(attempt.tap('R', 1.02)).toBe('Extra tap');
    expect(attempt.finish()).toMatchObject({ perfect: 2, missed: 1, extras: 1 });
  });

  it('accepts separate simultaneous hands and prefers explicit sticking to an either-hand target', () => {
    const both = new Attempt([target(0, 'L', 'left'), target(0, 'R', 'right')], 1);
    expect(both.tap('L', 0)).toBe('Perfect');
    expect(both.tap('R', 0)).toBe('Perfect');
    expect(both.finish()).toMatchObject({ stars: 10, perfect: 2 });
    const mixed = new Attempt([target(0, undefined, 'either'), target(0, 'L', 'left')], 1);
    mixed.tap('L', 0);
    expect(mixed.isJudged('left')).toBe(true);
    expect(mixed.isJudged('either')).toBe(false);
    expect(mixed.tap('R', 0)).toBe('Perfect');
  });

  it.each([0.5, 1, 1.5])('uses the shared real-time windows at speed %s', speed => {
    const attempt = new Attempt([target(1, 'L'), target(2, 'R'), target(3)], speed);
    expect(attempt.tap('L', 1 + 0.065 * speed)).toBe('Perfect');
    expect(attempt.tap('R', 2 - 0.08 * speed)).toBe('Early');
    expect(attempt.tap('L', 3 + 0.13 * speed)).toBe('Late');
    expect(attempt.finish()).toMatchObject({ perfect: 1, close: 2, missed: 0 });
  });

  it('still credits timely queued hits after provisional expiry', () => {
    const attempt = new Attempt([target(1, 'R')], 1);
    attempt.advance(1.3);
    expect(attempt.tap('R', 1.03)).toBe('Perfect');
    expect(attempt.finish()).toMatchObject({ perfect: 1, missed: 0, stars: 10 });
  });

  it('keeps known and unknown hands from the real score, including repeats and roll skeletons', () => {
    const timeline = interpretScore(fixture('colonel-bogey'));
    const part = playableDrums(timeline)[0];
    const targets = drumTargets(timeline, part, 1);
    const movements = timeline.movements.filter(m => m.partId === part.id);
    expect(targets).toHaveLength(movements.length);
    expect(targets.some(t => t.hand === undefined)).toBe(true);
    expect(targets.some(t => t.hand === 'L')).toBe(true);
    expect(targets.some(t => t.hand === 'R')).toBe(true);
    const attempt = new Attempt(targets, 1);
    targets.forEach(t => attempt.tap(t.hand ?? 'L', t.time));
    expect(attempt.finish()).toMatchObject({ perfect: targets.length, stars: 10 });
  });

  it('deduplicates same-hand voices and keeps simultaneous opposite hands', () => {
    const timeline = interpretScore(fixture('16obr'));
    const part = playableDrums(timeline)[0];
    const first = timeline.movements.find(m => m.partId === part.id)!;
    const original = drumTargets(timeline, part, 1);
    timeline.movements.push({ ...first, id: 'duplicate', pitch: first.pitch + 1 });
    expect(drumTargets(timeline, part, 1)).toHaveLength(original.length);
    timeline.movements.push({ ...first, id: 'opposite', hand: first.hand === 'L' ? 'R' : 'L' });
    expect(drumTargets(timeline, part, 1)).toHaveLength(original.length + 1);
  });

  it('expands unknown rolls without inventing sticking and narrows dense timing windows', () => {
    const timeline = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120)),
      measure(chord('quarter', 38, '<TremoloSingleChord><subtype>r32</subtype></TremoloSingleChord>')),
    ]), 'test'));
    const targets = drumTargets(timeline, playableDrums(timeline)[0], 1.5);
    expect(targets).toHaveLength(4);
    expect(targets.every(t => t.hand === undefined)).toBe(true);
    expect(targets[0].window).toBeCloseTo(0.125 / 1.5 / 2);
    expect(playableDrums(interpretScore(parseScore(synthetic([measure(time() + chord())]), 'test')))).toEqual([]);
  });
});
