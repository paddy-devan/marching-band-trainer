import type { Judgement, Strike } from '../game/scoring';

export type Feedback = { strike?: Strike; text: Judgement | ''; at: number };
