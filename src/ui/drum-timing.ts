import type { Movement } from '../score/model';
import { rollContactInterval } from '../score/interpret';

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
const SHALLOW_LIFT = 8 / 19.5;
const ACCENT_EXTRA_LIFT = 20;

function rollContact(previous: DrumGesture, next: DrumGesture | undefined, elapsed: number, speed: number, timing: DrumTiming) {
  const press = previous.seconds / speed;
  const interval = rollContactInterval(previous) / speed;
  const end = previous.rollEnd ?? previous.time + previous.seconds;
  const run = (end - previous.time) / speed;
  const rebound = timing.rebound / 1000;
  const lift = SHALLOW_LIFT; // Eight degrees of recovery, about two fifths of a normal lift.
  if (next?.roll && next.time <= end + 1e-8) {
    const gap = (next.time - previous.time) / speed;
    // Adjoining same-hand notes need a little recovery within the last contact
    // interval. Alternating hands have room to recover after their own press.
    const releaseAt = Math.min(press, gap - Math.min(interval, gap / 2));
    if (elapsed >= releaseAt) {
      const available = (gap - releaseAt) / 2;
      const rise = Math.min(rebound, available);
      const fall = Math.min(timing.downstroke / 1000, available);
      const recovery = ease((elapsed - releaseAt) / rise) * (1 - ease((elapsed - gap + fall) / fall));
      return 1 - lift * recovery;
    }
  }
  if (elapsed < press) {
    return 1 - 0.035 * Math.sin(Math.PI * Math.max(0, elapsed / interval)) ** 2;
  }
  if (next?.accent && !next.roll && next.flam !== 'grace') {
    // An accented release needs a full lift once this hand's final press ends,
    // even while the other hand finishes the roll.
    const gap = (next.time - previous.time) / speed;
    const rise = Math.min(rebound, Math.max(0.001, gap - press - timing.downstroke / 1000));
    return 1 - ease((elapsed - press) / rise);
  }
  // Once this hand's final press finishes, relax a little while the other hand
  // finishes the passage. The full rebound starts at the end of the run.
  if (elapsed < run) return 1 - lift * ease((elapsed - press) / rebound);
  const atRelease = 1 - lift * ease((run - press) / rebound);
  const gap = next ? (next.time - previous.time) / speed : Infinity;
  const release = Math.min(rebound, Math.max(0.001, gap - timing.downstroke / 1000 - run));
  return atRelease * (1 - ease((elapsed - run) / release));
}

export function drumFrame(lanes: DrumGesture[][], position: number, speed: number, timing: DrumTiming) {
  // Positive offsets delay a visual. All controls are real milliseconds,
  // independent of playback speed; per-effect offsets add to the global one.
  const shifted = (offset: number) => position - (timing.visualOffset + offset) * speed / 1000;
  return lanes.map(notes => {
    const { previous, next } = neighbours(notes, shifted(timing.stickOffset));
    const at = shifted(timing.stickOffset);
    const gap = previous && next ? (next.time - previous.time) / speed : Infinity;
    const downstroke = Math.min(timing.downstroke / 1000, gap * 0.4);
    const hold = Math.min(timing.contact / 1000, gap * 0.15);
    const rebound = Math.min(timing.rebound / 1000, Math.max(0.001, gap - downstroke - hold));
    const elapsed = previous ? (at - previous.time) / speed : 0;
    let contact = previous ? 1 - ease((elapsed - hold) / rebound) : 0;
    if (previous?.roll) contact = rollContact(previous, next, elapsed, speed, timing);
    const rollHandover = previous?.roll && next?.roll && next.time <= (previous.rollEnd ?? previous.time + previous.seconds) + 1e-8;
    // rollContact already supplies the shallow return to the head. A normal
    // downstroke here would override that recovery just before the next press.
    if (next && !rollHandover) {
      if (next.flam === 'grace') {
        // Settle close to the head first, then use the same eight-degree lift
        // as a roll recovery for the quiet grace stroke's short downstroke.
        const preparation = Math.min(0.12, gap * 0.4);
        const fall = Math.min(0.025, preparation / 2);
        const until = (next.time - at) / speed;
        const ready = (1 - SHALLOW_LIFT) * ease((preparation - until) / (preparation - fall));
        contact = Math.max(contact, ready + SHALLOW_LIFT * ease(1 - until / fall));
      } else contact = Math.max(contact, ease(1 - (next.time - at) / speed / downstroke));
    }
    let extraLift = 0;
    if (next?.accent && next.flam !== 'grace' && !rollHandover) {
      const until = (next.time - at) / speed;
      const preparation = Math.min(downstroke + 0.12, gap * 0.6);
      const lift = ease((preparation - until) / (preparation - downstroke)) * (1 - ease(1 - until / downstroke));
      // Never pull a stick away from a current contact to prepare the next hit.
      extraLift = ACCENT_EXTRA_LIFT * Math.min(1 - contact, lift);
    }
    const effect = (offset: number, duration: number, rollOnly = false) => {
      const effectAt = shifted(offset);
      const { previous, next } = neighbours(notes, effectAt);
      if (!previous || (rollOnly && !previous.roll)) return false;
      const length = Math.min(duration / 1000, next ? (next.time - previous.time) / speed * 0.85 : Infinity);
      return (effectAt - previous.time) / speed < length - 1e-8;
    };
    return { angle: 28 + 19.5 * contact - extraLift, impact: effect(timing.impactOffset, timing.impactDuration), buzz: effect(timing.buzzOffset, timing.buzzDuration, true) };
  });
}
