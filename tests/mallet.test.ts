import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { interpretScore } from '../src/score/interpret';
import { highlightedMovements } from '../src/ui/cues';
import { InstrumentView } from '../src/ui/InstrumentView';
import { malletPose } from '../src/ui/mallet';
import { fixture } from './helpers';

const targets = [
  { time: 0, pitch: 81, x: 282, y: 485 },
  { time: 0.5, pitch: 82, x: 105, y: 470 },
  { time: 1, pitch: 82, x: 105, y: 470 },
];

describe('persistent anticipatory beater', () => {
  it('hovers above the first note at rest, including an opening rest', () => {
    expect(malletPose(targets, 0, 1, false)).toMatchObject({ x: 282, y: 475 });
    expect(malletPose(targets.map(t => ({ ...t, time: t.time + 2 })), 1, 1, true)).toMatchObject({ x: 282, y: 475 });
  });

  it('strikes, rebounds, travels and arrives above the next note before its attack', () => {
    expect(malletPose(targets, 0, 1, true)).toMatchObject({ x: 282, y: 485 });
    const traveling = malletPose(targets, 0.2, 1, true);
    expect(traveling.x).toBeGreaterThan(105);
    expect(traveling.x).toBeLessThan(282);
    expect(malletPose(targets, 0.4, 1, true)).toMatchObject({ x: 105, y: 460 });
    expect(malletPose(targets, 0.5, 1, true)).toMatchObject({ x: 105, y: 470 });
  });

  it('bounces for repeated pitches and remains visible after the last note', () => {
    expect(malletPose(targets, 0.9, 1, true)).toMatchObject({ x: 105, y: 460 });
    expect(malletPose(targets, 1, 1, true)).toMatchObject({ x: 105, y: 470 });
    expect(malletPose(targets, 5, 1, false)).toMatchObject({ x: 105, y: 460 });
  });

  it('freezes on pause, adapts to tempo and seeks without stale animation state', () => {
    expect(malletPose(targets, 0.2, 1, false)).toEqual(malletPose(targets, 0.2, 1, true));
    expect(malletPose(targets, 0.1, 0.5, true)).toEqual(malletPose(targets, 0.2, 1, true));
    // Fast passages compress the travel so the beater reaches the next attack.
    expect(malletPose(targets, 0.3, 1.5, true).x).toBeLessThan(malletPose(targets, 0.2, 1, true).x);
    expect(malletPose(targets, 0.5, 1.5, true)).toMatchObject({ x: 105, y: 470 });
    expect(malletPose(targets, 0, 1, false).y).toBe(475);
    expect(Object.values(malletPose([], 0, 1, false)).every(Number.isFinite)).toBe(true);
  });

  it('keeps the rendered beater during visual note releases', () => {
    const { score, movements: all } = interpretScore(fixture('colonel-bogey'));
    const part = score.parts[0];
    const movements = all.filter(m => m.partId === part.id);
    const position = 2.3; // Release between the adjacent G-sharps in bar 2.
    const active = highlightedMovements(movements, position);
    expect(active).toEqual([]);
    const html = renderToStaticMarkup(createElement(InstrumentView, { part, active, movements, position }));
    expect(html).toContain('class="mallet ');
    expect(html).not.toContain('lyre-bar lit');
    expect(html).not.toContain('NaN');
  });
});
