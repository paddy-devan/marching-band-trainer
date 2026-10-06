import type { Fraction } from './fraction';

export type Hand = 'R' | 'L';
export type Provenance = 'explicit' | 'drum-map' | 'configured' | 'unknown';
export type Renderer = 'lyre' | 'snare' | 'pulse';
export type Drum = { pitch: number; name: string; line?: number; hand?: Hand };
export type Part = {
  id: string; name: string; instrument: string; staffIds: string[];
  percussion: boolean; drums: Record<number, Drum>; renderer: Renderer;
  register: { min: number; max: number; transpose: number; provisional?: boolean };
  rollProfile: 'repertoire' | 'sixteenth' | 'eighth' | 'disabled';
  positionHands?: { upper: Hand; lower: Hand };
};
export type Signature = { numerator: number; denominator: number };
export type Measure = { index: number; start: Fraction; duration: Fraction; signature: Signature };
export type TieLocation = { measures: number; fraction: Fraction; voices: number; staves: number };
export type WrittenNote = {
  id: string; partId: string; staffId: string; voice: number; measure: number;
  offset: Fraction; position: Fraction; duration: Fraction;
  pitch: number; tpc?: number; percussion: boolean;
  hand?: Hand; provenance: Provenance; tremolo?: string; velocity: number;
  tieNext?: TieLocation; tiePrev?: TieLocation;
};
export type Score = {
  id: string; version: string; title: string; composer?: string; parts: Part[]; measures: Measure[];
  notes: WrittenNote[]; rests: { partId: string; position: Fraction; duration: Fraction; voice: number }[];
  ties: { from: string; to: string }[];
  tempos: { position: Fraction; bpm: number }[];
  keys: { partId: string; position: Fraction; fifths: number; mode?: string }[];
  signatures: { position: Fraction; signature: Signature }[];
  warnings: string[]; duration: Fraction;
};
export type Movement = {
  id: string; partId: string; position: Fraction; duration: Fraction;
  time: number; seconds: number; pitch: number; tpc?: number; percussion: boolean;
  hand?: Hand; provenance: Provenance; roll: boolean; velocity: number;
  sourceIds: string[]; sourceId: string;
};
export type Timeline = { score: Score; movements: Movement[]; duration: number; warnings: string[] };
export type CatalogueEntry = { id: string; filename: string; url: string };
