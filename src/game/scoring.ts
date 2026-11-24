import type { Hand, Part, Timeline } from '../score/model';
import { TargetIndex } from './target-index';

export type Target = { id: string; time: number; pitch: number; window: number; kind?: 'drum'; hand?: Hand };
export type Strike = number | Hand;
export type Judgement = 'Perfect' | 'Early' | 'Late' | 'Wrong note' | 'Wrong hand' | 'Extra tap';
const hitCredit = { perfect: 1, good: 0.7, okay: 0.3 };
export type HitGrade = keyof typeof hitCredit;
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
  return withTimingWindows(targets, speed);
}

// Score the instructional roll movements, not the doubled audio contacts.
// Duplicate voices needing the same hand/onset take one physical strike.
export function drumTargets(timeline: Timeline, part: Part, speed: number): Target[] {
  const unique = new Map<string, Target>();
  for (const movement of timeline.movements) {
    if (movement.partId !== part.id || !movement.percussion) continue;
    const key = `${movement.time}:${movement.hand ?? 'either'}`;
    if (!unique.has(key)) unique.set(key, {
      id: movement.id, time: movement.time, pitch: movement.pitch, window: 0.15,
      kind: 'drum', hand: movement.hand,
    });
  }
  return withTimingWindows([...unique.values()].sort((a, b) => a.time - b.time), speed);
}

function withTimingWindows(targets: Target[], speed: number): Target[] {
  const onsets = [...new Set(targets.map(t => t.time))];
  const windows = new Map(onsets.map((time, index) => [time, Math.min(0.15,
    index > 0 ? (time - onsets[index - 1]) / speed / 2 : Infinity,
    index < onsets.length - 1 ? (onsets[index + 1] - time) / speed / 2 : Infinity,
  )]));
  for (const target of targets) target.window = windows.get(target.time)!;
  return targets;
}

export class Attempt {
  private judged = new Map<string, HitGrade | 'missed'>();
  private wrongHands = new Set<string>();
  private extras = 0;
  private hitEvents = new Map<string, { time: number; order: number }>();
  private extraEvents: { time: number; order: number }[] = [];
  private eventOrder = 0;
  private streakDirty = false;
  private streak = { current: 0, longest: 0 };
  private nextExpiry = 0;
  private index: TargetIndex;
  constructor(readonly targets: Target[], readonly speed: number) { this.index = new TargetIndex(targets); }

  advance(position: number) {
    let missed = 0;
    while (this.nextExpiry < this.targets.length) {
      const target = this.targets[this.nextExpiry];
      if (target.time + target.window * this.speed >= position) break;
      this.nextExpiry++;
      if (!this.judged.has(target.id)) { this.judged.set(target.id, 'missed'); this.streakDirty = true; missed++; }
    }
    return missed;
  }

  tap(strike: Strike, position: number): Judgement {
    this.advance(position);
    // A queued input can arrive after a render frame has expired the note. Its
    // original event timestamp still earns credit; successful hits stay claimed.
    const available: Target[] = [];
    const radius = (this.index.maxWindow + 1e-8) * this.speed;
    for (let i = this.index.lowerBound(position - radius); i < this.targets.length; i++) {
      const t = this.targets[i];
      if (t.time > position + radius) break;
      if (!this.wrongHands.has(t.id) && !this.hitGrade(t.id) && Math.abs(position - t.time) / this.speed <= t.window + 1e-8) available.push(t);
    }
    const target = available.filter(t => t.kind === 'drum'
      ? typeof strike === 'string' && (!t.hand || t.hand === strike)
      : t.pitch === strike).sort((a, b) => Math.abs(position - a.time) - Math.abs(position - b.time)
        || Number(!a.hand) - Number(!b.hand))[0];
    if (!target) {
      const wrongHand = typeof strike === 'string'
        ? available.filter(t => t.kind === 'drum').sort((a, b) => Math.abs(position - a.time) - Math.abs(position - b.time))[0]
        : undefined;
      if (wrongHand) {
        // A wrong hand consumes the target as a miss, with no extra-tap penalty.
        // Unlike a provisional expired miss, it cannot later be corrected.
        this.judged.set(wrongHand.id, 'missed');
        this.wrongHands.add(wrongHand.id);
        this.hitEvents.set(wrongHand.id, { time: position, order: this.eventOrder++ });
        this.streakDirty = true;
        return 'Wrong hand';
      }
      this.extras++;
      this.extraEvents.push({ time: position, order: this.eventOrder++ });
      this.streakDirty = true;
      return available.length ? 'Wrong note' : 'Extra tap';
    }
    const error = (position - target.time) / this.speed;
    const distance = Math.abs(error);
    const perfect = distance <= Math.min(0.065, target.window * 0.65) + 1e-8;
    const grade = perfect ? 'perfect' : distance <= Math.min(0.1, target.window * 0.8) ? 'good' : 'okay';
    this.judged.set(target.id, grade);
    this.hitEvents.set(target.id, { time: position, order: this.eventOrder++ });
    this.streakDirty = true;
    return perfect ? 'Perfect' : error < 0 ? 'Early' : 'Late';
  }

  isJudged(id: string) { return this.judged.has(id); }

  private hitGrade(id: string) {
    const grade = this.judged.get(id);
    return grade === 'missed' ? undefined : grade;
  }

  hit(id: string) {
    const grade = this.hitGrade(id);
    if (grade) return { grade, at: this.hitEvents.get(id)!.time };
  }

  perfectStreak() {
    if (!this.streakDirty) return this.streak;
    // Use event times so a valid queued input can replace a provisional miss
    // without permanently breaking the streak. Wrong/extra taps break it too.
    const events = this.targets.filter(t => this.judged.has(t.id)).map(t => ({
      time: this.hitEvents.get(t.id)?.time ?? t.time + t.window * this.speed,
      order: this.hitEvents.get(t.id)?.order ?? -1,
      perfect: this.hitGrade(t.id) === 'perfect',
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
    for (const target of this.targets) if (!this.judged.has(target.id)) { this.judged.set(target.id, 'missed'); this.streakDirty = true; }
    const values = [...this.judged.values()];
    const points = values.reduce((sum, grade) => sum + (grade === 'missed' ? 0 : hitCredit[grade]), 0) - this.extras * 0.25;
    const perfect = values.filter(grade => grade === 'perfect').length;
    const missed = values.filter(grade => grade === 'missed').length;
    return {
      stars: this.targets.length ? Math.round(10 * Math.max(0, points) / this.targets.length) : 0,
      perfect, missed, close: values.length - perfect - missed,
      extras: this.extras, total: this.targets.length,
      longestPerfectStreak: this.perfectStreak().longest,
    };
  }
}
