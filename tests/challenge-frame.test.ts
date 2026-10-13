import { describe, expect, it } from 'vitest';
import { countIn } from '../src/audio/beats';
import { Attempt, drumTargets, gameTargets } from '../src/game/scoring';
import { interpretScore, positionAt } from '../src/score/interpret';
import { add, value } from '../src/score/fraction';
import { ChallengeFrames } from '../src/ui/challenge-frame';
import { fixture } from './helpers';

describe('challenge frame snapshots', () => {
  it.each([0.25, 0.75, 1.5])('preserves cues, count-in and repeat bar labels at %s speed', speed => {
    const timeline = interpretScore(fixture('colonel-bogey'));
    const leadIn = countIn(timeline);
    for (const drum of [false, true]) {
      const part = timeline.score.parts.find(p => p.renderer === (drum ? 'snare' : 'lyre'))!;
      const targets = (drum ? drumTargets : gameTargets)(timeline, part, speed);
      const attempt = new Attempt(targets, speed);
      const frames = new ChallengeFrames(timeline, targets, speed, drum, true);
      const positions = [-leadIn.duration, -leadIn.interval, -0.001, 0,
        ...targets.flatMap(t => [t.time - 0.8 * speed, t.time, t.time + 0.151 * speed]), timeline.duration];
      positions.sort((a, b) => a - b);
      for (const position of positions) {
        attempt.advance(position);
        const frame = frames.read(position, attempt);
        const beats = positionAt(timeline.score, Math.max(0, position));
        const measure = timeline.score.measures.find(m => beats >= value(m.start) && beats < value(add(m.start, m.duration))) || timeline.score.measures.at(-1)!;
        expect(frame.bar).toBe((measure.sourceIndex ?? measure.index) + 1);
        expect(frame.count).toBe(position < 0 ? Math.min(leadIn.beats, Math.floor((position + leadIn.duration) / leadIn.interval) + 1) : 0);
        if (drum) {
          expect(frame.upcoming).toEqual(targets.filter(t => (t.time - position) / speed <= 2 && (t.time - position) / speed >= -t.window && !attempt.isJudged(t.id)));
          const next = targets.find(t => t.time + t.window * speed >= position && !attempt.isJudged(t.id));
          expect(frame.eitherHand).toBe(next !== undefined && !next.hand);
        } else {
          const next = targets.find(t => t.time >= position - 0.001 && !attempt.isJudged(t.id));
          expect(frame.cuePitches).toEqual(new Set(next && (next.time - position) / speed <= 0.8
            ? targets.filter(t => t.time === next.time && !attempt.isJudged(t.id)).map(t => t.pitch) : []));
        }
      }
    }
  });
  it('reuses unchanged snapshots and cue collections, and expires feedback on the audible clock', () => {
    const timeline = interpretScore(fixture('colonel-bogey'));
    const frames = new ChallengeFrames(timeline, [], 0.5, false, false);
    const initial = frames.read(0);
    expect(frames.read(0.01)).toBe(initial);
    const feedback = { strike: 84, text: 'Perfect' as const, at: 0.01 };
    const tapped = frames.read(0.01, undefined, feedback);
    expect(tapped.cuePitches).toBe(initial.cuePitches);
    expect(frames.read(0.1, undefined, feedback)).toBe(tapped);
    expect(frames.read(0.211, undefined, feedback).feedback).toBeUndefined();
    expect(tapped.feedback).toBe(feedback); // Published snapshots remain immutable.
  });
  it('removes judged chord pitches and drum cues immediately without advancing the frame clock', () => {
    const timeline = interpretScore(fixture('colonel-bogey'));
    const targets = [
      { id: 'left', time: 1, pitch: 38, kind: 'drum' as const, hand: 'L' as const, window: 0.15 },
      { id: 'right', time: 1, pitch: 40, kind: 'drum' as const, hand: 'R' as const, window: 0.15 },
    ];
    const attempt = new Attempt(targets, 1);
    const frames = new ChallengeFrames(timeline, targets, 1, true, true);
    expect(frames.read(1, attempt).upcoming).toHaveLength(2);
    expect(attempt.tap('L', 1)).toBe('Perfect');
    expect(frames.read(1, attempt).upcoming.map(t => t.id)).toEqual(['right']);
    expect(attempt.tap('R', 1)).toBe('Perfect');
    expect(frames.read(1, attempt).upcoming).toHaveLength(0);
  });
});
