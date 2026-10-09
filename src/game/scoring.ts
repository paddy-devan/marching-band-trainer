import type { Part, Timeline } from '../score/model';

export type Target = { id: string; time: number; pitch: number; window: number };
export type Judgement = 'Perfect' | 'Early' | 'Late' | 'Wrong note' | 'Extra tap';
export type Result = { stars: number; perfect: number; close: number; missed: number; extras: number; total: number; longestPerfectStreak: number };

// Movements already contain expanded repeats and joined ties. Duplicate voices
// at the same pitch/onset need one physical strike; chords keep separate pitches.
export function gameTargets(timeline: Timeline, part: Part, speed: number): Target[] {
  const unique = new Map<string, Target>();
  for (const movement of timeline.movements) {
    if (movement.partId !== part.id || movement.percussion) continue;
    const pitch = movement.pitch + part.register.transpose;
    unique.set(`${movement.time}:${pitch}`, { id: movement.id, time: movement.time, pitch, window: 0.15 });
  }
  const targets = [...unique.values()].sort((a, b) => a.time - b.time || a.pitch - b.pitch);
  const onsets = [...new Set(targets.map(t => t.time))];
  const windows = new Map(onsets.map((time, index) => [time, Math.min(0.15,
    index > 0 ? (time - onsets[index - 1]) / speed / 2 : Infinity,
    index < onsets.length - 1 ? (onsets[index + 1] - time) / speed / 2 : Infinity,
  )]));
  for (const target of targets) target.window = windows.get(target.time)!;
  return targets;
}

export class Attempt {
  private judged = new Map<string, number>();
  private extras = 0;
  private hitEvents = new Map<string, { time: number; order: number }>();
  private extraEvents: { time: number; order: number }[] = [];
  private eventOrder = 0;
  private streakDirty = false;
  private streak = { current: 0, longest: 0 };
  constructor(readonly targets: Target[], readonly speed: number) {}

  advance(position: number) {
    let missed = 0;
    for (const target of this.targets) {
      if (target.time + target.window * this.speed >= position) break;
      if (!this.judged.has(target.id)) { this.judged.set(target.id, 0); this.streakDirty = true; missed++; }
    }
    return missed;
  }

  tap(pitch: number, position: number): Judgement {
    this.advance(position);
    // A queued input can arrive after a render frame has expired the note. Its
    // original event timestamp still earns credit; successful hits stay claimed.
    const available = this.targets.filter(t => (this.judged.get(t.id) ?? 0) === 0 && Math.abs(position - t.time) / this.speed <= t.window + 1e-8);
    const target = available.filter(t => t.pitch === pitch).sort((a, b) => Math.abs(position - a.time) - Math.abs(position - b.time))[0];
    if (!target) {
      this.extras++;
      this.extraEvents.push({ time: position, order: this.eventOrder++ });
      this.streakDirty = true;
      return available.length ? 'Wrong note' : 'Extra tap';
    }
    const error = (position - target.time) / this.speed;
    const distance = Math.abs(error);
    const perfect = distance <= Math.min(0.065, target.window * 0.65) + 1e-8;
    const weight = perfect ? 1 : distance <= Math.min(0.1, target.window * 0.8) ? 0.7 : 0.3;
    this.judged.set(target.id, weight);
    this.hitEvents.set(target.id, { time: position, order: this.eventOrder++ });
    this.streakDirty = true;
    return perfect ? 'Perfect' : error < 0 ? 'Early' : 'Late';
  }

  isJudged(id: string) { return this.judged.has(id); }

  perfectStreak() {
    if (!this.streakDirty) return this.streak;
    // Use event times so a valid queued input can replace a provisional miss
    // without permanently breaking the streak. Wrong/extra taps break it too.
    const events = this.targets.filter(t => this.judged.has(t.id)).map(t => ({
      time: this.hitEvents.get(t.id)?.time ?? t.time + t.window * this.speed,
      order: this.hitEvents.get(t.id)?.order ?? -1,
      perfect: this.judged.get(t.id) === 1,
    }));
    events.push(...this.extraEvents.map(e => ({ ...e, perfect: false })));
    events.sort((a, b) => a.time - b.time || a.order - b.order);
    let current = 0;
    let longest = 0;
    for (const event of events) { current = event.perfect ? current + 1 : 0; longest = Math.max(longest, current); }
    this.streak = { current, longest };
    this.streakDirty = false;
    return this.streak;
  }

  finish(): Result {
    for (const target of this.targets) if (!this.judged.has(target.id)) { this.judged.set(target.id, 0); this.streakDirty = true; }
    const values = [...this.judged.values()];
    const points = values.reduce((sum, n) => sum + n, 0) - this.extras * 0.25;
    return {
      stars: this.targets.length ? Math.round(10 * Math.max(0, points) / this.targets.length) : 0,
      perfect: values.filter(n => n === 1).length,
      close: values.filter(n => n > 0 && n < 1).length,
      missed: values.filter(n => n === 0).length,
      extras: this.extras, total: this.targets.length,
      longestPerfectStreak: this.perfectStreak().longest,
    };
  }
}
