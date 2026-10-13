import type { Target } from './scoring';

// Targets are ordered by onset. Bound lookups to the local timing window rather
// than scanning the entire piece, including when an input timestamp goes back.
export class TargetIndex {
  readonly maxWindow: number;
  constructor(readonly targets: Target[]) {
    this.maxWindow = targets.reduce((max, target) => Math.max(max, target.window), 0);
  }
  lowerBound(time: number) {
    let low = 0;
    let high = this.targets.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.targets[middle].time < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
