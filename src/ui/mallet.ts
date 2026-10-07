export type MalletTarget = { time: number; pitch: number; x: number; y: number };
// Keep the lifted head close to its target: a larger vertical lift can put it
// over the neighbouring bar in this tightly spaced, front-facing instrument.
const HOVER = 10;
const ease = (n: number) => {
  const t = Math.max(0, Math.min(1, n));
  return t * t * (3 - 2 * t);
};

// Derive the gesture from the score clock, rather than starting timers on each
// note. Rests, ties, pauses, repeat jumps and seeks all use the same trajectory.
export function malletPose(targets: MalletTarget[], position: number, speed: number, playing: boolean) {
  const first = targets[0];
  if (!first) return { x: 230, y: 500, previewX: 230, previewY: 500 };
  if (position < first.time || (!playing && position <= first.time)) {
    return { x: first.x, y: first.y - HOVER, previewX: first.x, previewY: first.y - HOVER };
  }
  const nextIndex = targets.findIndex(t => t.time > position + 1e-8);
  const previous = targets[nextIndex < 0 ? targets.length - 1 : nextIndex - 1] || first;
  const next = nextIndex < 0 ? undefined : targets[nextIndex];
  const elapsed = Math.max(0, (position - previous.time) / speed);
  const interval = next ? (next.time - previous.time) / speed : Infinity;
  const rebound = Math.min(0.09, interval * 0.3);
  const downstroke = Math.min(0.045, interval * 0.2);
  const travel = Math.min(0.24, interval - rebound - downstroke);
  const progress = next ? ease((elapsed - rebound) / travel) : 0;
  const destination = next || previous;
  let lift = HOVER * ease(elapsed / rebound);
  if (next && elapsed > interval - downstroke) lift = HOVER * (1 - ease((elapsed - interval + downstroke) / downstroke));
  return {
    x: previous.x + (destination.x - previous.x) * progress,
    y: previous.y + (destination.y - previous.y) * progress - lift - Math.sin(progress * Math.PI) * 6,
    previewX: destination.x,
    previewY: destination.y - HOVER,
  };
}
