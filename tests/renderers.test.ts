import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { InstrumentView, lyreBars, movementLabel } from '../src/ui/InstrumentView';
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

it('widens bars towards the base while keeping the two inner edges aligned', () => {
  const part = fixture('colonel-bogey').parts[0];
  const bars = lyreBars(part);
  const container = document.createElement('div');
  container.innerHTML = renderToStaticMarkup(createElement(InstrumentView, { part, active: [], position: 0 }));
  const height = Number(container.querySelector('.lyre-bar')!.getAttribute('height'));
  for (const accidental of [false, true]) {
    const column = bars.filter(bar => bar.accidental === accidental);
    const innerEdge = (bar: typeof bars[number]) => accidental ? bar.x + bar.width : bar.x;
    expect(new Set(column.map(innerEdge)).size).toBe(1);
    expect(column[0].width).toBeGreaterThan(column.at(-1)!.width);
    for (let i = 1; i < column.length; i++) {
      expect(column[i].width).toBeLessThan(column[i - 1].width);
      expect(column[i - 1].y - column[i].y).toBeGreaterThan(height);
    }
  }
  const sharpEdge = bars.find(bar => bar.accidental)!;
  expect(sharpEdge.x + sharpEdge.width).toBeLessThan(bars[0].x);
});

it('keeps the beater centred on repositioned bars when hovering and striking', () => {
  const score = fixture('colonel-bogey');
  const part = score.parts[0];
  const note = interpretScore(score).movements.find(m => m.partId === part.id)!;
  const bars = lyreBars(part);
  for (const pitch of [81, 82, 104, 105]) {
    const movement = { ...note, pitch: pitch - part.register.transpose, time: 0 };
    const bar = bars.find(b => b.pitch === pitch)!;
    for (const playing of [false, true]) {
      const container = document.createElement('div');
      container.innerHTML = renderToStaticMarkup(createElement(InstrumentView, {
        part, active: [movement], movements: [movement], position: 0, playing,
      }));
      const lit = container.querySelector('.lyre-bar.lit')!;
      expect(Number(lit.getAttribute('x'))).toBe(bar.x);
      expect(Number(lit.getAttribute('y'))).toBe(bar.y);
      const transform = (container.querySelector('.mallet') as SVGGElement).style.transform;
      const [, x, y] = transform.match(/translate\(([-\d.]+)px, ([-\d.]+)px\)/)!;
      expect(Number(x)).toBeCloseTo(bar.x + bar.width / 2);
      expect(Number(y)).toBeCloseTo(bar.y + (playing ? 7 : 1));
    }
  }
});

it('flags out-of-range notes without highlighting a different octave', () => {
  const score = fixture('colonel-bogey');
  const part = score.parts[0];
  const note = interpretScore(score).movements.find(m => m.partId === part.id)!;
  const html = renderToStaticMarkup(createElement(InstrumentView, { part, active: [{ ...note, pitch: 100 }], position: 0 }));
  expect(html).toContain('Out of range:');
  expect(html).not.toContain('lyre-bar lit');
});

it('uses a neutral strike without animated hand indicators for unspecified sticking', () => {
  const score = fixture('colonel-bogey');
  const part = score.parts[1];
  const note = interpretScore(score).movements.find(m => m.partId === part.id && !m.hand)!;
  const html = renderToStaticMarkup(createElement(InstrumentView, { part, active: [note], position: note.time }));
  expect(html).toContain('strike lit neutral');
  expect(html).not.toContain('left-stick down');
  expect(html).not.toContain('right-stick down');
});

it('uses sharp labels for bars and movements even when the score spells a flat', () => {
  const score = fixture('colonel-bogey');
  const part = score.parts[0];
  const note = interpretScore(score).movements.find(m => m.partId === part.id)!;
  expect(movementLabel({ ...note, pitch: 61, tpc: 9 }, part)).toBe('C♯6');
  const html = renderToStaticMarkup(createElement(InstrumentView, { part, active: [], position: 0 }));
  const container = document.createElement('div');
  container.innerHTML = html;
  expect(container.querySelector('.lyre')!.textContent).toContain('C♯6');
  expect(html).not.toContain('♭');
});
