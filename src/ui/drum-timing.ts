import type { Movement } from '../score/model';
import { FLAM_GRACE_VELOCITY, rollContactInterval } from '../score/interpret';
import { ACCENT_VELOCITY_MULTIPLIER, DEFAULT_VELOCITY } from '../score/dynamics';

export const DRUM_TIMING_CONTROLS = {
  visualOffset: { label: 'All visuals offset', min: -300, max: 300, initial: 0 },
  stickOffset: { label: 'Stick contact offset', min: -200, max: 200, initial: 0 },
  downstroke: { label: 'Downstroke duration', min: 10, max: 200, initial: 65 },
  contact: { label: 'Time on the head', min: 0, max: 100, initial: 10 },
  rebound: { label: 'Rebound duration', min: 10, max: 300, initial: 90 },
  impactOffset: { label: 'Blue dot offset', min: -200, max: 200, initial: 0 },
  impactDuration: { label: 'Blue dot duration', min: 10, max: 300, initial: 90 },
  buzzOffset: { label: 'Buzz lines offset', min: -200, max: 200, initial: 0 },
  buzzDuration: { label: 'Buzz lines duration', min: 10, max: 400, initial: 140 },
} as const;
export type DrumTimingKey = keyof typeof DRUM_TIMING_CONTROLS;
export type DrumTiming = Record<DrumTimingKey, number>;
export const DEFAULT_DRUM_TIMING = Object.fromEntries(Object.entries(DRUM_TIMING_CONTROLS).map(([key, control]) => [key, control.initial])) as DrumTiming;
export const DRUM_TIMING_STORAGE_KEY = 'band-trainer:drum-timing:v1';

export function parseDrumTiming(raw: string | null): DrumTiming {
  let parsed: Partial<DrumTiming> | null = null;
  try { parsed = raw ? JSON.parse(raw) : null; } catch { /* Use defaults for invalid saved data. */ }
  const result = { ...DEFAULT_DRUM_TIMING };
  for (const key of Object.keys(result) as DrumTimingKey[]) {
    const n = parsed?.[key];
    const control = DRUM_TIMING_CONTROLS[key];
    if (typeof n === 'number' && Number.isFinite(n)) result[key] = Math.round(Math.max(control.min, Math.min(control.max, n)));
  }
  return result;
}

type DrumGesture = Movement & { rollEnd?: number };

export function drumLanes(movements: Movement[]) {
  const notes: DrumGesture[] = movements.map(m => ({ ...m })).sort((a, b) => a.time - b.time);
  let run: DrumGesture[] = [];
  let end = -Infinity;
  const finishRun = () => { for (const note of run) note.rollEnd = end; };
  // Join touching/overlapping roll spans before separating the hands. A stick
  // stays low between its turns while the other hand continues the same roll.
  // This metadata belongs only to the picture; score/audio contacts stay intact.
  for (const note of notes) {
    if (!note.roll) continue;
    if (note.time > end + 1e-8) { finishRun(); run = []; end = note.time; }
    run.push(note);
    end = Math.max(end, note.time + note.seconds);
  }
  finishRun();
  return (['L', 'R', undefined] as const).map(hand => notes.filter(m => m.hand === hand));
}

// Upper-bound lookup keeps frame work small, even in long scores. The score
// clock determines every phase, so pause, seek and speed changes need no timers.
function neighbours(notes: DrumGesture[], position: number) {
  let lo = 0, hi = notes.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (notes[mid].time <= position + 1e-8) lo = mid + 1; else hi = mid;
  }
  return { previous: notes[lo - 1], next: notes[lo] };
}
function ease(n: number) {
  const t = Math.max(0, Math.min(1, n));
  return t * t * (3 - 2 * t);
}
const NORMAL_LIFT = 19.5;
const SHALLOW_LIFT = 8 / NORMAL_LIFT;
const HEAD_ANGLE = 47.5;
const ACCENT_LIFT_MULTIPLIER = 39.5 / NORMAL_LIFT;
const MAX_LIFT = 55;

function normalLift(note: DrumGesture) {
  // The grace velocity already includes its quiet-stroke reduction. Keep even
  // loud flams close to the head (at most ten degrees for the grace downstroke).
  if (note.flam === 'grace') return NORMAL_LIFT * Math.max(0.1, Math.min(1.25,
    note.velocity / (DEFAULT_VELOCITY * FLAM_GRACE_VELOCITY)));
  const velocity = note.dynamicVelocity ?? note.velocity / (note.accent ? ACCENT_VELOCITY_MULTIPLIER : 1);
  return Math.max(2.5, Math.min(32, NORMAL_LIFT * velocity / DEFAULT_VELOCITY));
}

// These are visual teaching approximations. Connected strokes prepare during
// recovery; longer musical gaps relax before a separate, deliberate preparation.
const CONNECTED_GAP_SECONDS = 1.25;
const PREPARATION_SECONDS = 0.2;

function strokeLift(note: DrumGesture) {
  if (note.flam === 'grace') return Math.min(10, SHALLOW_LIFT * normalLift(note));
  return Math.min(MAX_LIFT, normalLift(note) * (note.accent ? ACCENT_LIFT_MULTIPLIER : 1));
}

function downstrokeSeconds(note: DrumGesture, gap: number, timing: DrumTiming) {
  return Math.min(note.flam === 'grace' ? 0.025 : timing.downstroke / 1000, gap * 0.4);
}

// A single trajectory from the last contact to the next preparation, followed
// by its downstroke. The next note is always for this hand, not the other hand.
// releaseAt/startLift also let a roll finish into this same recovery model.
function recoveryLift(previous: DrumGesture, next: DrumGesture | undefined, at: number, speed: number,
  timing: DrumTiming, releaseAt = previous.time, startLift = 0, holdContact = true) {
  const gap = next ? Math.max(0.001, (next.time - releaseAt) / speed) : Infinity;
  const downstroke = next ? downstrokeSeconds(next, gap, timing) : 0;
  const hold = holdContact ? Math.min(timing.contact / 1000, gap * 0.15) : 0;
  const rebound = Math.min(timing.rebound / 1000, Math.max(0.001, gap - downstroke - hold));
  const connected = next && next.time - releaseAt <= CONNECTED_GAP_SECONDS;
  const relaxed = next ? Math.min(NORMAL_LIFT, normalLift(previous)) : normalLift(previous);
  const target = connected ? strokeLift(next) : relaxed;
  const elapsed = (at - releaseAt) / speed;
  let lift = startLift + (target - startLift) * ease((elapsed - hold) / rebound);
  if (next) {
    const until = (next.time - at) / speed;
    if (!connected) {
      // A long rest does not require holding an accent-height stick throughout.
      const prepare = ease((PREPARATION_SECONDS + downstroke - until) / PREPARATION_SECONDS);
      lift += (strokeLift(next) - lift) * prepare;
    }
    lift *= 1 - ease(1 - until / downstroke);
  }
  return lift;
}

function rollLift(previous: DrumGesture, next: DrumGesture | undefined, at: number, speed: number, timing: DrumTiming) {
  const elapsed = (at - previous.time) / speed;
  const press = previous.seconds / speed;
  const interval = rollContactInterval(previous) / speed;
  const end = previous.rollEnd ?? previous.time + previous.seconds;
  const run = (end - previous.time) / speed;
  const rebound = timing.rebound / 1000;
  if (next?.roll && next.time <= end + 1e-8) {
    const gap = (next.time - previous.time) / speed;
    // Continuous rolls always keep a shallow recovery, including accents and
    // dynamic changes. Same-hand adjoining presses recover in their last interval.
    const releaseAt = Math.min(press, gap - Math.min(interval, gap / 2));
    if (elapsed >= releaseAt) {
      const available = (gap - releaseAt) / 2;
      const rise = Math.min(rebound, available);
      const fall = Math.min(timing.downstroke / 1000, available);
      return SHALLOW_LIFT * normalLift(next) * ease((elapsed - releaseAt) / rise) *
        (1 - ease((elapsed - gap + fall) / fall));
    }
  }
  if (elapsed < press) {
    return normalLift(previous) * 0.035 * Math.sin(Math.PI * Math.max(0, elapsed / interval)) ** 2;
  }
  if (next && !next.roll) {
    // Once this hand finishes its final press, prepare its next single stroke
    // directly, even if the other hand is still completing the roll passage.
    return recoveryLift(previous, next, at, speed, timing, previous.time + previous.seconds, 0, false);
  }
  const shallow = SHALLOW_LIFT * normalLift(previous);
  if (elapsed < run) return shallow * ease((elapsed - press) / rebound);
  const atRelease = shallow * ease((run - press) / rebound);
  return recoveryLift(previous, next, at, speed, timing, end, atRelease, false);
}

function stickLift(previous: DrumGesture | undefined, next: DrumGesture | undefined, at: number, speed: number, timing: DrumTiming) {
  if (previous?.roll) return rollLift(previous, next, at, speed, timing);
  if (previous) return recoveryLift(previous, next, at, speed, timing);
  if (!next) return NORMAL_LIFT;
  const downstroke = downstrokeSeconds(next, Infinity, timing);
  const until = (next.time - at) / speed;
  const prepare = ease((PREPARATION_SECONDS + downstroke - until) / PREPARATION_SECONDS);
  const lift = normalLift(next) + (strokeLift(next) - normalLift(next)) * prepare;
  return lift * (1 - ease(1 - until / downstroke));
}

export function drumFrame(lanes: DrumGesture[][], position: number, speed: number, timing: DrumTiming) {
  // Positive offsets delay a visual. All controls are real milliseconds,
  // independent of playback speed; per-effect offsets add to the global one.
  const shifted = (offset: number) => position - (timing.visualOffset + offset) * speed / 1000;
  return lanes.map(notes => {
    const { previous, next } = neighbours(notes, shifted(timing.stickOffset));
    const lift = stickLift(previous, next, shifted(timing.stickOffset), speed, timing);
    const effect = (offset: number, duration: number, rollOnly = false) => {
      const effectAt = shifted(offset);
      const { previous, next } = neighbours(notes, effectAt);
      if (!previous || (rollOnly && !previous.roll)) return false;
      const length = Math.min(duration / 1000, next ? (next.time - previous.time) / speed * 0.85 : Infinity);
      return (effectAt - previous.time) / speed < length - 1e-8;
    };
    return { angle: HEAD_ANGLE - lift, impact: effect(timing.impactOffset, timing.impactDuration), buzz: effect(timing.buzzOffset, timing.buzzDuration, true) };
  });
}
