import { describe, expect, it } from 'vitest';
import type { Movement } from '../src/score/model';
import { ACCENT_VELOCITY_MULTIPLIER, DEFAULT_VELOCITY } from '../src/score/dynamics';
import { FLAM_GRACE_VELOCITY, interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { DEFAULT_DRUM_TIMING as defaults, drumFrame, drumLanes, parseDrumTiming } from '../src/ui/drum-timing';
import { chord, measure, synthetic, tempo, time } from './helpers';

const note = (change: Partial<Movement> = {}): Movement => ({
  id: 'hit', partId: 'snare', time: 1, seconds: 0.5, pitch: 38, hand: 'L', percussion: true,
  position: { n: 0, d: 1 }, duration: { n: 1, d: 1 }, provenance: 'explicit', roll: false,
  velocity: DEFAULT_VELOCITY * (change.flam === 'grace' ? FLAM_GRACE_VELOCITY : change.accent ? ACCENT_VELOCITY_MULTIPLIER : 1),
  dynamicVelocity: DEFAULT_VELOCITY, sourceId: 'hit', sourceIds: ['hit'], ...change,
});

describe('score dynamics in drum gestures', () => {
  const atLevel = (dynamic = '', technique = '') => {
    const timeline = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120)),
      measure((dynamic ? `<Dynamic><subtype>${dynamic}</subtype></Dynamic>` : '') +
        '<Sticking><text>L</text></Sticking>' + chord('quarter', 38, technique) +
        '<Sticking><text>R</text></Sticking>' + chord('quarter', 38, technique) +
        '<Sticking><text>L</text></Sticking>' + chord('quarter', 38, technique)),
    ]), 'gestures'));
    const movements = timeline.movements.filter(m => m.percussion);
    return { movements, lanes: drumLanes(movements) };
  };
  const accent = '<Articulation><subtype>articAccentAbove</subtype></Articulation>';
  const roll = '<TremoloSingleChord><subtype>r32</subtype></TremoloSingleChord>';

  it('defaults unmarked music to the same mf sound and stick height as an explicit mf', () => {
    const implicit = atLevel(), explicit = atLevel('mf');
    expect(implicit.movements.map(m => m.velocity)).toEqual(explicit.movements.map(m => m.velocity));
    for (const at of [-0.2, -0.065, 0, 0.05, 0.25, 0.435, 0.5, 0.6]) {
      expect(drumFrame(implicit.lanes, at, 1, defaults)).toEqual(drumFrame(explicit.lanes, at, 1, defaults));
    }
  });

  it.each([0.25, 1, 1.5])('scales ordinary and accented preparation with dynamics, preserving contact timing at %s speed', speed => {
    let previousNormal = Infinity, previousAccent = Infinity;
    for (const level of ['ppp', 'pp', 'p', 'mp', 'mf', 'f', 'ff', 'fff']) {
      const ordinary = atLevel(level), accented = atLevel(level, accent);
      const at = ordinary.movements[0].time - 0.065 * speed;
      const normalAngle = drumFrame(ordinary.lanes, at, speed, defaults)[0].angle;
      const accentAngle = drumFrame(accented.lanes, at, speed, defaults)[0].angle;
      expect(normalAngle).toBeLessThan(previousNormal);
      expect(accentAngle).toBeLessThanOrEqual(previousAccent);
      expect(accentAngle).toBeLessThan(normalAngle);
      previousNormal = normalAngle; previousAccent = accentAngle;
      for (const [index, { movements, lanes }] of [ordinary, accented].entries()) {
        const hit = movements[0].time;
        expect(drumFrame(lanes, hit - 0.001 * speed, speed, defaults)[0].impact).toBe(false);
        expect(drumFrame(lanes, hit, speed, defaults)[0]).toMatchObject({ angle: 47.5, impact: true });
        // Consecutive accents recover straight to the next accent's height.
        expect(drumFrame(lanes, hit + 0.11 * speed, speed, defaults)[0].angle).toBeCloseTo(index ? accentAngle : normalAngle);
      }
    }
    const quiet = atLevel('p', accent), loud = atLevel('f', accent);
    expect(quiet.movements[0].velocity).toBeLessThan(loud.movements[0].velocity);
    expect(drumFrame(quiet.lanes, -0.065 * speed, speed, defaults)[0].angle)
      .toBeGreaterThan(drumFrame(loud.lanes, -0.065 * speed, speed, defaults)[0].angle);
  });

  it('scales continuous roll recoveries and buzzes without full-height accent lifts between hands', () => {
    const quiet = atLevel('p', roll), loud = atLevel('f', roll);
    const accented = atLevel('f', roll + accent);
    // Midway through a press, the louder roll has a larger tiny buzz bounce.
    expect(drumFrame(quiet.lanes, 0.03125, 1, defaults)[0].angle)
      .toBeGreaterThan(drumFrame(loud.lanes, 0.03125, 1, defaults)[0].angle);
    const recovery = (lanes: ReturnType<typeof drumLanes>) => Math.min(...Array.from({ length: 250 }, (_, i) =>
      drumFrame(lanes, 0.001 * i, 1, defaults)[0].angle));
    expect(recovery(quiet.lanes)).toBeGreaterThan(recovery(loud.lanes));
    for (let at = 0; at < 1; at += 0.001) {
      expect(drumFrame(accented.lanes, at, 1, defaults)[0].angle).toBeGreaterThan(34);
    }
  });

  it('bounds fast, mixed-dynamic gestures and remains deterministic after seeking', () => {
    const notes = [note({ time: 0, dynamicVelocity: 126 / 127, accent: true }),
      note({ time: 0.04, dynamicVelocity: 16 / 127 }),
      note({ time: 0.08, dynamicVelocity: 126 / 127, roll: true, seconds: 0.05 }),
      note({ time: 0.13, dynamicVelocity: 49 / 127, accent: true })];
    const lanes = drumLanes(notes);
    for (const speed of [0.25, 1, 1.5]) for (let at = -0.2; at < 0.5; at += 0.001) {
      const frame = drumFrame(lanes, at, speed, defaults);
      expect(frame[0].angle).toBeGreaterThanOrEqual(-7.5 - 1e-8);
      expect(frame[0].angle).toBeLessThanOrEqual(47.5);
    }
    const frame = drumFrame(lanes, 0.11, 1, defaults);
    drumFrame(lanes, 20, 1, defaults);
    expect(drumFrame(lanes, 0.11, 1, defaults)).toEqual(frame);
  });

  it('scales grace strokes with dynamics and keeps them low after a different dynamic', () => {
    const grace = (midi: number) => note({ flam: 'grace', velocity: midi / 127 * FLAM_GRACE_VELOCITY, dynamicVelocity: midi / 127 });
    const quiet = drumLanes([grace(49)]), loud = drumLanes([grace(96)]);
    const quietAngle = drumFrame(quiet, 0.975, 1, defaults)[0].angle;
    const loudAngle = drumFrame(loud, 0.975, 1, defaults)[0].angle;
    expect(quietAngle).toBeGreaterThan(loudAngle);
    expect(loudAngle).toBeGreaterThanOrEqual(37.5);
    for (const [before, after] of [[126, 16], [16, 126]]) {
      const lanes = drumLanes([note({ time: 0, dynamicVelocity: before / 127 }), grace(after)]);
      for (let at = 0.975; at < 1; at += 0.001) {
        const { angle } = drumFrame(lanes, at, 1, defaults)[0];
        expect(angle).toBeGreaterThanOrEqual(37.5);
        expect(angle).toBeLessThanOrEqual(47.5);
      }
      expect(drumFrame(lanes, 1, 1, defaults)[0].angle).toBe(47.5);
    }
  });
});

describe('preparation for the next stroke', () => {
  it.each([0.25, 1, 1.5])('recovers directly to the next same-hand height at %s speed', speed => {
    for (const [before, after] of [
      [note({ accent: true }), note({ accent: true })], // full stroke
      [note({ accent: true }), note()], // down stroke
      [note(), note()], // tap stroke
      [note(), note({ accent: true })], // up stroke
      [note({ dynamicVelocity: 49 / 127 }), note({ dynamicVelocity: 96 / 127 })],
      [note({ dynamicVelocity: 96 / 127 }), note({ dynamicVelocity: 49 / 127 })],
    ]) {
      const previous = { ...before, time: 1 }, next = { ...after, time: 2 };
      const lanes = drumLanes([previous, next, note({ time: 1.04, hand: 'R', accent: true })]);
      const target = drumFrame(drumLanes([next]), 2 - 0.065 * speed, speed, defaults)[0].angle;
      const angles = Array.from({ length: 11 }, (_, i) => drumFrame(lanes, 1 + i * 0.01 * speed, speed, defaults)[0].angle);
      expect(angles[0]).toBe(47.5);
      for (let i = 1; i < angles.length; i++) expect(angles[i]).toBeLessThanOrEqual(angles[i - 1]);
      // Preparation is finished during the previous stroke's recovery, well
      // before the old late-lift window, without a second change in height.
      for (const at of [1 + 0.11 * speed, 1.5, 2 - 0.065 * speed]) {
        expect(drumFrame(lanes, at, speed, defaults)[0].angle).toBeCloseTo(target);
      }
      expect(drumFrame(lanes, 2, speed, defaults)[0]).toMatchObject({ angle: 47.5, impact: true });
      const delayed = { ...defaults, visualOffset: 100, stickOffset: -50 };
      expect(drumFrame(lanes, 1.5 + 0.05 * speed, speed, delayed)[0].angle).toBeCloseTo(target);
      drumFrame(lanes, 20, speed, defaults);
      expect(drumFrame(lanes, 1.5, speed, defaults)[0].angle).toBeCloseTo(target);
    }
  });

  it('relaxes through a long rest and prepares near the next stroke instead of holding an accent high', () => {
    const lanes = drumLanes([note({ accent: true }), note({ time: 4, accent: true })]);
    for (const speed of [0.25, 1, 1.5]) {
      expect(drumFrame(lanes, 1 + 0.11 * speed, speed, defaults)[0].angle).toBe(28);
      expect(drumFrame(lanes, 2.5, speed, defaults)[0].angle).toBe(28);
      expect(drumFrame(lanes, 4 - 0.165 * speed, speed, defaults)[0].angle).toBeCloseTo(18);
      expect(drumFrame(lanes, 4 - 0.065 * speed, speed, defaults)[0].angle).toBeCloseTo(8);
      expect(drumFrame(lanes, 4, speed, defaults)[0].angle).toBe(47.5);
    }
  });

  it('prepares a quiet flam grace directly from the preceding stroke', () => {
    const lanes = drumLanes([note({ accent: true }), note({ time: 2, flam: 'grace' })]);
    expect(drumFrame(lanes, 1.11, 1, defaults)[0].angle).toBeCloseTo(39.5);
    expect(drumFrame(lanes, 1.5, 1, defaults)[0].angle).toBeCloseTo(39.5);
    expect(drumFrame(lanes, 1.975, 1, defaults)[0].angle).toBeCloseTo(39.5);
    expect(drumFrame(lanes, 2, 1, defaults)[0].angle).toBe(47.5);
  });

  it.each([false, true])('prepares a %s-accent single stroke from the hand’s final roll press', accent => {
    const lanes = drumLanes([note({ roll: true, seconds: 0.1 }),
      note({ time: 1.1, hand: 'R', roll: true, seconds: 0.3 }), note({ time: 1.3, accent })]);
    const target = accent ? 8 : 28;
    expect(drumFrame(lanes, 1.1, 1, defaults)[0].angle).toBeCloseTo(47.5);
    expect(drumFrame(lanes, 1.19, 1, defaults)[0].angle).toBeCloseTo(target);
    expect(drumFrame(lanes, 1.23, 1, defaults)[0].angle).toBeCloseTo(target);
    expect(drumFrame(lanes, 1.19, 1, defaults)[1].angle).toBeGreaterThan(46.8);
    expect(drumFrame(lanes, 1.3, 1, defaults)[0].angle).toBe(47.5);
  });
});

describe('drum animation timing', () => {
  it.each([0.25, 1, 1.5])('prepares accented hits higher and still contacts on the beat at %s speed', speed => {
    const ordinary = drumLanes([note(), note({ time: 2 })]);
    const accented = drumLanes([note(), note({ time: 2, accent: true })]);
    const at = 2 - 0.065 * speed;
    expect(drumFrame(ordinary, at, speed, defaults)[0].angle).toBe(28);
    expect(drumFrame(accented, at, speed, defaults)[0].angle).toBeCloseTo(8);
    expect(drumFrame(accented, 2, speed, defaults)[0]).toEqual({ angle: 47.5, impact: true, buzz: false });
    expect(drumFrame(accented, 2 + 0.11 * speed, speed, defaults)[0].angle).toBe(28);
    const shifted = { ...defaults, visualOffset: 100, stickOffset: -50 };
    expect(drumFrame(accented, at + 0.05 * speed, speed, shifted)[0].angle).toBeCloseTo(8);
    drumFrame(accented, 20, speed, defaults);
    expect(drumFrame(accented, at, speed, defaults)[0].angle).toBeCloseTo(8);
  });
  it('lifts out of a roll for an accented release while continuous rolls keep their shallow motion', () => {
    const movements = [note({ roll: true, seconds: 0.1 }), note({ time: 1.1, hand: 'R', roll: true, seconds: 0.1 }), note({ time: 1.2, accent: true })];
    const lanes = drumLanes(movements);
    expect(drumFrame(lanes, 1.1, 1, defaults)[0].angle).toBeCloseTo(47.5);
    expect(drumFrame(lanes, 1.135, 1, defaults)[0].angle).toBeGreaterThan(8);
    expect(drumFrame(lanes, 1.135, 1, defaults)[0].angle).toBeLessThan(47.5);
    expect(drumFrame(lanes, 1.16, 1, defaults)[0].angle).toBeCloseTo(8);
    expect(drumFrame(lanes, 1.2, 1, defaults)[0]).toMatchObject({ angle: 47.5, impact: true, buzz: false });
    const rolls = drumLanes(movements.map(m => ({ ...m, roll: true, accent: true })));
    for (let at = 1; at < 1.3; at += 0.001) {
      expect(drumFrame(rolls, at, 1, defaults)[0].angle).toBeGreaterThanOrEqual(39.5 - 1e-8);
    }
  });
  it('keeps grace notes low even if an accent flag is present, and bounds dense accent gestures', () => {
    const grace = drumLanes([note({ flam: 'grace', accent: true })]);
    expect(drumFrame(grace, 0.975, 1, defaults)[0].angle).toBeCloseTo(39.5);
    const dense = drumLanes([note(), note({ time: 1.04, accent: true }), note({ time: 1.08 })]);
    for (let at = 0.8; at < 1.5; at += 0.001) {
      const { angle } = drumFrame(dense, at, 1.5, defaults)[0];
      expect(angle).toBeGreaterThanOrEqual(8 - 1e-8);
      expect(angle).toBeLessThanOrEqual(47.5);
    }
  });
  it('prepares a flam grace stroke close to the head with an eight-degree downstroke', () => {
    const lanes = drumLanes([note({ flam: 'grace', seconds: 0.035 }), note({ id: 'main', time: 1.035, hand: 'R', flam: 'main' })]);
    for (const speed of [0.25, 1, 1.5]) {
      const frame = (at: number) => drumFrame(lanes, at, speed, defaults);
      expect(frame(1 - 0.025 * speed)[0].angle).toBeCloseTo(39.5);
      expect(frame(1 - 0.0125 * speed)[0].angle).toBeCloseTo(43.5);
      expect(frame(1)[0]).toMatchObject({ angle: 47.5, impact: true, buzz: false });
      // The opposite hand retains its full-height preparation for the main hit.
      expect(frame(1.035 - 0.065 * speed)[1].angle).toBe(28);
      expect(frame(1.035)[1]).toMatchObject({ angle: 47.5, impact: true, buzz: false });
    }
  });
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
