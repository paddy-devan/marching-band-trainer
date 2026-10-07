import type { Movement } from '../score/model';

// A short release before each note's end separates adjacent strikes. Both the
// instrument and bar rows use this same clock-derived state, including at seek.
export function highlightedMovements(movements: Movement[], position: number, speed = 1): Movement[] {
  return movements.filter(m => {
    const elapsed = position - m.time;
    const release = Math.min(0.055 * speed, m.seconds * 0.4);
    const length = m.percussion ? Math.min(0.12 * speed, m.seconds - release) : m.seconds - release;
    return elapsed >= -1e-8 && elapsed < length - 1e-8;
  });
}
