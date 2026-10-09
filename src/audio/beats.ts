import { add, fraction, value } from '../score/fraction';
import { secondsAt } from '../score/interpret';
import type { Timeline } from '../score/model';

export type Click = { time: number; accent: boolean };
export function beatUnit(numerator: number, denominator: number) {
  return numerator > 3 && numerator % 3 === 0 && denominator === 8 ? 1.5 : 4 / denominator;
}
export function countIn(timeline: Timeline) {
  const signature = timeline.score.measures[0].signature;
  const unit = beatUnit(signature.numerator, signature.denominator);
  const beats = signature.numerator * 4 / signature.denominator / unit;
  const interval = unit * 60 / timeline.score.tempos[0].bpm;
  return { beats, interval, duration: beats * interval };
}
export function metronomeClicks(timeline: Timeline): Click[] {
  return timeline.score.measures.flatMap(measure => {
    const step = beatUnit(measure.signature.numerator, measure.signature.denominator);
    const clicks: Click[] = [];
    for (let beat = 0; beat * step < value(measure.duration) - 1e-8; beat++) {
      clicks.push({ time: secondsAt(timeline.score, add(measure.start, fraction(Math.round(beat * step * 1024), 1024))), accent: beat === 0 });
    }
    return clicks;
  });
}
