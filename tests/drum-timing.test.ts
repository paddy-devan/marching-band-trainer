import { describe, expect, it } from 'vitest';
import type { Movement } from '../src/score/model';
import { DEFAULT_DRUM_TIMING as defaults, drumFrame, drumLanes, parseDrumTiming } from '../src/ui/drum-timing';

const note = (change: Partial<Movement> = {}): Movement => ({
  id: 'hit', partId: 'snare', time: 1, seconds: 0.5, pitch: 38, hand: 'L', percussion: true,
  position: { n: 0, d: 1 }, duration: { n: 1, d: 1 }, provenance: 'explicit', roll: false,
  velocity: 0.8, sourceId: 'hit', sourceIds: ['hit'], ...change,
});

describe('drum animation timing', () => {
  it('approaches the head before the attack, contacts on the attack, and rebounds afterwards', () => {
    const lanes = drumLanes([note()]);
    const frame = (at: number) => drumFrame(lanes, at, 1, defaults)[0];
    expect(frame(0.8).angle).toBe(28);
    expect(frame(0.97).angle).toBeGreaterThan(28);
    expect(frame(0.97).angle).toBeLessThan(47.5);
    expect(frame(0.97).impact).toBe(false);
    expect(frame(1)).toEqual({ angle: 47.5, impact: true, buzz: false });
    expect(frame(1.05).angle).toBeLessThan(47.5);
    expect(frame(1.11)).toEqual({ angle: 28, impact: false, buzz: false });
  });

  it('adds global and individual delays in real milliseconds at every speed', () => {
    const lanes = drumLanes([note({ roll: true })]);
    const timing = { ...defaults, visualOffset: 100, stickOffset: -50, impactOffset: 50, buzzOffset: 100 };
    for (const speed of [0.25, 1, 1.5]) {
      const frame = (ms: number) => drumFrame(lanes, 1 + ms * speed / 1000, speed, timing)[0];
      expect(frame(50).angle).toBe(47.5);
      expect(frame(149).impact).toBe(false);
      expect(frame(150).impact).toBe(true);
      expect(frame(239).impact).toBe(true);
      expect(frame(241).impact).toBe(false);
      expect(frame(199).buzz).toBe(false);
      expect(frame(200).buzz).toBe(true);
      expect(frame(341).buzz).toBe(false);
    }
  });

  it('supports visuals before the audio and separates densely repeated strokes', () => {
    const lanes = drumLanes([note(), note({ time: 1.04 }), note({ time: 1.08 })]);
    expect(drumFrame(lanes, 0.95, 1, { ...defaults, impactOffset: -60 })[0].impact).toBe(true);
    const timing = { ...defaults, downstroke: 200, contact: 100, rebound: 300, impactDuration: 300 };
    expect(drumFrame(lanes, 1.038, 1, timing)[0].impact).toBe(false);
    expect(drumFrame(lanes, 1.04, 1, timing)[0]).toMatchObject({ angle: 47.5, impact: true });
    for (let at = 0.8; at < 1.5; at += 0.001) {
      const { angle } = drumFrame(lanes, at, 1.5, timing)[0];
      expect(angle).toBeGreaterThanOrEqual(28);
      expect(angle).toBeLessThanOrEqual(47.5);
    }
  });

  it('keeps unspecified hands neutral and shows buzz lines only for rolls', () => {
    const lanes = drumLanes([note({ hand: undefined, roll: true })]);
    const frame = drumFrame(lanes, 1, 1, defaults);
    expect(frame[0]).toEqual({ angle: 28, impact: false, buzz: false });
    expect(frame[1]).toEqual(frame[0]);
    expect(frame[2]).toMatchObject({ impact: true, buzz: true });
    expect(drumFrame(drumLanes([note()]), 1, 1, defaults)[0].buzz).toBe(false);
  });

  it('produces the same frame on a seek back and after changing duration controls', () => {
    const lanes = drumLanes([note(), note({ time: 2, hand: 'R' })]);
    const first = drumFrame(lanes, 1.05, 1, defaults);
    drumFrame(lanes, 20, 1, defaults);
    expect(drumFrame(lanes, 1.05, 1, defaults)).toEqual(first);
    const changed = drumFrame(lanes, 1.05, 1, { ...defaults, rebound: 20, impactDuration: 20 });
    expect(changed[0]).toEqual({ angle: 28, impact: false, buzz: false });
  });

  it('holds a roll near the head for its entire movement, then releases into the rebound', () => {
    const lanes = drumLanes([note({ roll: true })]);
    for (const speed of [0.25, 1, 1.5]) {
      for (let at = 1; at < 1.5; at += 0.005) {
        const angle = drumFrame(lanes, at, speed, defaults)[0].angle;
        expect(angle).toBeGreaterThanOrEqual(46.8);
        expect(angle).toBeLessThanOrEqual(47.5);
      }
      expect(drumFrame(lanes, 1.5, speed, defaults)[0].angle).toBe(47.5);
      const releasing = drumFrame(lanes, 1.5 + 0.045 * speed, speed, defaults)[0].angle;
      expect(releasing).toBeGreaterThan(28);
      expect(releasing).toBeLessThan(47.5);
      expect(drumFrame(lanes, 1.5 + 0.1 * speed, speed, defaults)[0].angle).toBe(28);
    }
    // Ordinary strokes continue to lift immediately after their short hold.
    expect(drumFrame(drumLanes([note()]), 1.11, 1, defaults)[0].angle).toBe(28);
  });

  it('phases the tiny buzz bounces with four contacts per quaver, including offsets and seeks', () => {
    const lanes = drumLanes([note({ roll: true, duration: { n: 1, d: 2 } })]);
    const timing = { ...defaults, visualOffset: 100, stickOffset: -50 };
    for (const speed of [0.5, 1, 1.5]) {
      for (let i = 0; i < 4; i++) {
        const at = 1 + 0.05 * speed + i * 0.125;
        expect(drumFrame(lanes, at, speed, timing)[0].angle).toBeCloseTo(47.5);
        expect(drumFrame(lanes, at + 0.0625, speed, timing)[0].angle).toBeCloseTo(46.8175);
      }
    }
    const press = drumFrame(lanes, 1.3, 1, defaults);
    drumFrame(lanes, 20, 1, defaults);
    expect(drumFrame(lanes, 1.3, 1, defaults)).toEqual(press);
  });

  it('hands over a roll and resumes ordinary strokes without sticking or invalid angles', () => {
    const lanes = drumLanes([note({ roll: true, seconds: 0.1 }), note({ time: 1.1, hand: 'R', roll: true, seconds: 0.1 }), note({ time: 1.2 })]);
    expect(drumFrame(lanes, 1.09, 1, defaults)[0].angle).toBeGreaterThan(46.8);
    expect(drumFrame(lanes, 1.19, 1, defaults)[1].angle).toBeGreaterThan(46.8);
    expect(drumFrame(lanes, 1.2, 1, defaults)[0].angle).toBe(47.5);
    for (let at = 0.9; at < 1.6; at += 0.001) for (const { angle } of drumFrame(lanes, at, 1.5, defaults)) {
      expect(angle).toBeGreaterThanOrEqual(28);
      expect(angle).toBeLessThanOrEqual(47.5);
    }
    expect(drumFrame(lanes, 1.5, 1, defaults).every(lane => lane.angle === 28)).toBe(true);
  });

  it('uses a shallow recovery between a hand’s turns in a continuous alternating roll passage', () => {
    const movements = [note({ roll: true, seconds: 0.1 }), note({ time: 1.1, hand: 'R', roll: true, seconds: 0.1 }), note({ time: 1.2, roll: true, seconds: 0.1 })];
    const original = structuredClone(movements);
    const lanes = drumLanes(movements);
    for (const speed of [0.25, 1, 1.5]) {
      const timing = { ...defaults, visualOffset: 75, stickOffset: -25 };
      const angles: number[] = [];
      for (let at = 1; at < 1.3; at += 0.001) {
        const frame = drumFrame(lanes, at + 0.05 * speed, speed, timing);
        angles.push(frame[0].angle);
        expect(frame[0].angle).toBeGreaterThanOrEqual(39.5 - 1e-8);
        expect(frame[0].angle).toBeLessThanOrEqual(47.5);
        if (at >= 1.1) expect(frame[1].angle).toBeGreaterThanOrEqual(39.5 - 1e-8);
      }
      expect(Math.min(...angles)).toBeLessThan(41);
      expect(drumFrame(lanes, 1.3 + 0.15 * speed, speed, timing).every(lane => lane.angle === 28)).toBe(true);
    }
    expect(movements).toEqual(original);
  });

  it('keeps adjoining same-hand rolls low, but releases across a real gap or a single stroke', () => {
    const adjoining = drumLanes([note({ roll: true, seconds: 0.1 }), note({ time: 1.1, roll: true, seconds: 0.1 })]);
    for (let at = 1; at < 1.2; at += 0.001) expect(drumFrame(adjoining, at, 1, defaults)[0].angle).toBeGreaterThanOrEqual(39.5 - 1e-8);
    expect(drumFrame(adjoining, 1.09375, 1, defaults)[0].angle).toBeCloseTo(39.5);
    expect(drumFrame(adjoining, 1.1, 1, defaults)[0].angle).toBeCloseTo(47.5);
    const separated = drumLanes([note({ roll: true, seconds: 0.1 }), note({ time: 1.6, roll: true, seconds: 0.1 })]);
    expect(drumFrame(separated, 1.3, 1, defaults)[0].angle).toBe(28);
    const single = drumLanes([note({ roll: true, seconds: 0.1 }), note({ time: 1.1, roll: false, seconds: 0.1 })]);
    expect(drumFrame(single, 1.21, 1, defaults)[0].angle).toBe(28);
  });

  it('recovers from invalid saved settings and clamps stored values', () => {
    for (const raw of [null, 'broken', 'null', 'false', '42', '[]']) expect(parseDrumTiming(raw)).toEqual(defaults);
    expect(parseDrumTiming('{"visualOffset":999,"downstroke":-1,"buzzOffset":"20","contact":5.7}'))
      .toEqual({ ...defaults, visualOffset: 300, downstroke: 10, contact: 6 });
  });
});
