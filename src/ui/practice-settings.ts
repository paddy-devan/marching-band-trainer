import type { Mix } from '../audio/transport';
import type { Part } from '../score/model';

export type PracticeSettings = {
  speed: number;
  metronome: boolean;
  partKey?: string;
  mix: Mix;
};

const STORAGE_KEY = 'band-trainer:practice-settings:v1';
export const DEFAULT_PRACTICE_SETTINGS: PracticeSettings = { speed: 1, metronome: true, mix: {} };

export function loadPracticeSettings(): PracticeSettings {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Partial<PracticeSettings> | null;
    const speed = saved?.speed;
    const mix = Object.fromEntries(Object.entries(saved?.mix ?? {}).flatMap(([key, part]) => {
      if (!part || typeof part !== 'object') return [];
      const volume = part.volume;
      return [[key, {
        muted: part.muted === true,
        solo: part.solo === true,
        volume: typeof volume === 'number' && volume >= 0 && volume <= 1 ? volume : undefined,
      }]];
    }));
    return {
      speed: typeof speed === 'number' && speed >= 0.5 && speed <= 1.25 ? speed : DEFAULT_PRACTICE_SETTINGS.speed,
      metronome: typeof saved?.metronome === 'boolean' ? saved.metronome : DEFAULT_PRACTICE_SETTINGS.metronome,
      partKey: typeof saved?.partKey === 'string' ? saved.partKey : undefined,
      mix,
    };
  } catch {
    return DEFAULT_PRACTICE_SETTINGS;
  }
}

export function savePracticeSettings(settings: PracticeSettings) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)); }
  catch { /* Keep settings in memory when storage is unavailable. */ }
}

export function practicePartKeys(parts: Part[]) {
  const names = new Set<string>();
  const duplicates = new Set<string>();
  for (const { name } of parts) {
    if (names.has(name)) duplicates.add(name);
    names.add(name);
  }
  // A duplicate name is ambiguous across scores, so use its score-local ID too.
  return new Map(parts.map(part => [part.id, JSON.stringify(duplicates.has(part.name) ? [part.name, part.id] : [part.name])]));
}
