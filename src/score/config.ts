import type { Hand, Part, Renderer } from './model';
import settings from '../../trainer.config.json';

export type PartOverride = {
  part: string; instrument?: string; renderer?: Renderer;
  register?: Part['register']; rollProfile?: Part['rollProfile'];
  positionHands?: { upper: Hand; lower: Hand };
};
export type TrainerConfig = { scores: Record<string, { parts: PartOverride[] }> };
export const config = settings as TrainerConfig;

export function applyConfig(scoreId: string, parts: Part[], warnings: string[], custom: TrainerConfig = config) {
  for (const override of custom.scores[scoreId]?.parts || []) {
    const matches = parts.filter(p => p.name === override.part && (!override.instrument || p.instrument === override.instrument));
    if (matches.length !== 1) {
      warnings.push(`Configuration for “${override.part}” matched ${matches.length} parts. Update trainer.config.json to match the edited score.`);
      continue;
    }
    const part = matches[0];
    if (override.renderer && ['lyre', 'snare', 'pulse'].includes(override.renderer)) part.renderer = override.renderer;
    if (override.register) {
      const r = override.register;
      if ([r.min, r.max, r.transpose].every(Number.isInteger) && r.min >= 0 && r.max <= 127 && r.min <= r.max) part.register = r;
      else warnings.push(`${part.name}: invalid register override; using default mapping.`);
    }
    if (override.rollProfile && ['repertoire', 'sixteenth', 'eighth', 'disabled'].includes(override.rollProfile)) part.rollProfile = override.rollProfile;
    if (override.positionHands && ['R', 'L'].includes(override.positionHands.upper) && ['R', 'L'].includes(override.positionHands.lower)) part.positionHands = override.positionHands;
  }
}
