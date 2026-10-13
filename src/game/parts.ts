import type { Timeline } from '../score/model';
import { drumTargets, gameTargets } from './scoring';

export type ChallengeMode = 'lyre' | 'drum';

export function playableLyres(timeline: Timeline) {
  return timeline.score.parts.filter(part => {
    if (part.renderer !== 'lyre') return false;
    const targets = gameTargets(timeline, part, 1);
    return targets.length > 0 && targets.every(t => t.pitch >= part.register.min && t.pitch <= part.register.max);
  });
}

export function playableDrums(timeline: Timeline) {
  return timeline.score.parts.filter(part => part.renderer === 'snare' && part.percussion && drumTargets(timeline, part, 1).length > 0);
}
