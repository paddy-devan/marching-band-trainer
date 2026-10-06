import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InstrumentView, lyreBars } from '../src/ui/InstrumentView';
import { interpretScore } from '../src/score/interpret';
import { fixture } from './helpers';

it('maps all 25 chromatic pitches to distinct bars and staggers accidentals between naturals', () => {
  const part = fixture('colonel-bogey').parts[0];
  const bars = lyreBars(part);
  expect(bars).toHaveLength(25);
  expect(bars.filter(b => !b.accidental)).toHaveLength(15);
  expect(bars.filter(b => b.accidental)).toHaveLength(10);
  expect(new Set(bars.map(b => b.pitch)).size).toBe(25);
  expect(bars[0].pitch).toBe(81);
  expect(bars.at(-1)!.pitch).toBe(105);
  expect(bars[0].y).toBeGreaterThan(bars.at(-1)!.y);
  const [a, asharp, b] = bars;
  expect(asharp.y).toBeCloseTo((a.y + b.y) / 2);
  expect(a.x).toBeGreaterThan(asharp.x);
});

it('flags out-of-range notes without highlighting a different octave', () => {
  const score = fixture('colonel-bogey');
  const part = score.parts[0];
  const note = interpretScore(score).movements.find(m => m.partId === part.id)!;
  const html = renderToStaticMarkup(createElement(InstrumentView, { part, active: [{ ...note, pitch: 100 }], spelling: 'sharps', position: 0 }));
  expect(html).toContain('Out of range:');
  expect(html).not.toContain('lyre-bar lit');
});

it('uses a neutral strike without animated hand indicators for unspecified sticking', () => {
  const score = fixture('colonel-bogey');
  const part = score.parts[1];
  const note = interpretScore(score).movements.find(m => m.partId === part.id && !m.hand)!;
  const html = renderToStaticMarkup(createElement(InstrumentView, { part, active: [note], spelling: 'score', position: note.time }));
  expect(html).toContain('strike lit neutral');
  expect(html).not.toContain('left-stick down');
  expect(html).not.toContain('right-stick down');
});
