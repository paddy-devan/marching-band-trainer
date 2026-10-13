import { countIn } from '../audio/beats';
import type { Attempt, Target } from '../game/scoring';
import { TargetIndex } from '../game/target-index';
import { secondsAt } from '../score/interpret';
import { add, value } from '../score/fraction';
import type { Timeline } from '../score/model';
import type { Feedback } from './game-types';

export const DRUM_LOOK_AHEAD = 2;
export type ChallengeFrame = {
  bar: number; count: number; cuePitches: Set<number>; upcoming: Target[];
  eitherHand: boolean; feedback?: Feedback; perfectStreak: number;
};

// Only publish a React snapshot when visible content changes. Continuous audio
// position belongs to the animation loop, not the component tree.
export class ChallengeFrames {
  private index: TargetIndex;
  private measures: { start: number; end: number; bar: number }[];
  private tempos: { time: number; position: number; bpm: number }[];
  private leadIn;
  private previous?: ChallengeFrame;
  private cuePitches = new Set<number>();
  private upcoming: Target[] = [];
  constructor(timeline: Timeline, private targets: Target[], private speed: number, private drum: boolean, private preview: boolean) {
    this.index = new TargetIndex(targets);
    this.measures = timeline.score.measures.map(m => ({ start: value(m.start), end: value(add(m.start, m.duration)), bar: (m.sourceIndex ?? m.index) + 1 }));
    this.tempos = timeline.score.tempos.map(t => ({ time: secondsAt(timeline.score, t.position), position: value(t.position), bpm: t.bpm }));
    this.leadIn = countIn(timeline);
  }
  read(position: number, attempt?: Attempt, feedback?: Feedback): ChallengeFrame {
    const seconds = Math.max(0, position);
    let low = 0;
    let high = this.tempos.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.tempos[middle].time <= seconds) low = middle + 1;
      else high = middle;
    }
    const tempo = this.tempos[low - 1];
    // Keep the same arithmetic as positionAt, including boundary rounding.
    const beats = tempo ? tempo.position + (seconds - tempo.time) * tempo.bpm / 60 : 0;
    low = 0;
    high = this.measures.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.measures[middle].start <= beats) low = middle + 1;
      else high = middle;
    }
    const measure = this.measures[low - 1];
    const bar = (measure && beats < measure.end ? measure : this.measures.at(-1))?.bar ?? 1;
    const count = position < 0 ? Math.min(this.leadIn.beats, Math.floor((position + this.leadIn.duration) / this.leadIn.interval) + 1) : 0;
    const visibleFeedback = feedback && (position - feedback.at) / this.speed < 0.4 ? feedback : undefined;
    const perfectStreak = attempt?.perfectStreak().current ?? 0;
    const cuePitches = this.cuePitches;
    const upcoming = this.upcoming;
    cuePitches.clear();
    upcoming.length = 0;
    let eitherHand = false;
    if (this.preview) {
      if (this.drum) {
        let next: Target | undefined;
        for (let i = this.index.lowerBound(position - this.index.maxWindow * this.speed - 1e-8); i < this.targets.length; i++) {
          const target = this.targets[i];
          if (attempt?.isJudged(target.id)) continue;
          if (target.time + target.window * this.speed >= position) next ??= target;
          const remaining = (target.time - position) / this.speed;
          if (remaining > DRUM_LOOK_AHEAD) break;
          if (remaining >= -target.window) upcoming.push(target);
        }
        eitherHand = next !== undefined && !next.hand;
      } else {
        let nextTime: number | undefined;
        for (let i = this.index.lowerBound(position - 0.001); i < this.targets.length; i++) {
          const target = this.targets[i];
          if (attempt?.isJudged(target.id)) continue;
          nextTime ??= target.time;
          if (target.time !== nextTime || (target.time - position) / this.speed > 0.8) break;
          cuePitches.add(target.pitch);
        }
      }
    }
    const previous = this.previous;
    const sameUpcoming = previous && previous.upcoming.length === upcoming.length && upcoming.every((t, i) => t === previous.upcoming[i]);
    const samePitches = previous && previous.cuePitches.size === cuePitches.size && this.samePitches(previous.cuePitches);
    if (previous && previous.bar === bar && previous.count === count && previous.feedback === visibleFeedback
      && previous.perfectStreak === perfectStreak && previous.eitherHand === eitherHand
      && sameUpcoming && samePitches) return previous;
    return this.previous = { bar, count, cuePitches: samePitches ? previous!.cuePitches : new Set(cuePitches),
      upcoming: sameUpcoming ? previous!.upcoming : upcoming.slice(), eitherHand, feedback: visibleFeedback, perfectStreak };
  }
  private samePitches(previous: Set<number>) {
    for (const pitch of this.cuePitches) if (!previous.has(pitch)) return false;
    return true;
  }
}
