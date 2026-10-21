import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { interpretScore, secondsAt } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { BarNotes, barCues, barRhythm, fitRhythmLabels } from '../src/ui/BarNotes';
import { highlightedMovements } from '../src/ui/cues';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

const repeated = () => interpretScore(parseScore(synthetic([
  measure(time() + tempo(120) + chord() + chord() + chord('half')) + measure(chord('whole', 62)),
]), 'test'));

describe('bar cues and shared strike highlights', () => {
  it('shows only L Roll for the Ready Aye Ready quaver pickup in 6/8', () => {
    const { score, movements } = interpretScore(fixture('ready-aye-ready'));
    const part = score.parts.find(p => p.renderer === 'snare')!;
    const partMovements = movements.filter(m => m.partId === part.id);
    const html = renderToStaticMarkup(createElement(BarNotes, { score, part, movements: partMovements, measure: score.measures[0], position: 0, active: highlightedMovements(partMovements, 0) }));
    const notes = document.createElement('div');
    notes.innerHTML = html;
    expect([...notes.querySelectorAll('.current .note-cue')].map(note => note.textContent)).toEqual(['L Roll']);
    expect(barCues(score, partMovements, score.measures[0])[0].end).toBe(secondsAt(score, score.measures[1].start));
  });
  it('releases a repeated pitch briefly before lighting the next strike', () => {
    const { movements } = repeated();
    expect(highlightedMovements(movements, 0.4)).toEqual([movements[0]]);
    expect(highlightedMovements(movements, 0.48)).toEqual([]);
    expect(highlightedMovements(movements, 0.5)).toEqual([movements[1]]);
    // The release lasts 55 ms in real time at each playback speed.
    expect(highlightedMovements(movements, 0.46, 0.5)).toEqual([movements[0]]);
    expect(highlightedMovements(movements, 0.48, 0.5)).toEqual([]);
    expect(highlightedMovements(movements, 0.42, 1.5)).toEqual([]);
    // Semiquavers still release for longer than the 25 ms transport update.
    const short = { ...movements[0], seconds: 60 / 116 / 4 };
    expect(highlightedMovements([short], short.seconds - 0.03 * 1.5, 1.5)).toEqual([]);
  });

  it('pulses drum contacts and separates even short roll movements', () => {
    const { movements } = repeated();
    const note = { ...movements[0], percussion: true, seconds: 0.05 };
    expect(highlightedMovements([note], 0.02)).toEqual([note]);
    expect(highlightedMovements([note], 0.045)).toEqual([]);
    expect(highlightedMovements([{ ...note, seconds: 1 }], 0.2)).toEqual([]);
  });

  it('keeps the whole bar and next bar visible with only the active contact highlighted', () => {
    const { score, movements } = repeated();
    const props = { score, part: score.parts[0], movements, measure: score.measures[0], position: 0.5, active: highlightedMovements(movements, 0.5) };
    const html = renderToStaticMarkup(createElement(BarNotes, props));
    expect(html).toContain('Current bar 1');
    expect(html).toContain('Next bar 2');
    const notes = document.createElement('div');
    notes.innerHTML = html;
    expect([...notes.querySelectorAll('.current .note-cue')].map(note => note.textContent)).toEqual(['C4', 'C4', 'C4']);
    expect(notes.querySelector('.queued .note-cue')?.textContent).toBe('D4');
    expect([...notes.querySelectorAll('.note-octave')].map(octave => octave.textContent)).toEqual(['4', '4', '4', '4']);
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
    const gap = renderToStaticMarkup(createElement(BarNotes, { ...props, position: 0.48, active: [] }));
    expect(gap).not.toContain('aria-current="true"');
  });

  it('groups chord pitches and includes rests between notes', () => {
    const pair = chord('quarter').replace('</Chord>', '<Note><pitch>64</pitch><tpc>18</tpc></Note></Chord>');
    const { score, movements } = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120) + pair + '<Rest><durationType>quarter</durationType></Rest>' + chord('half', 67)),
    ]), 'test'));
    const cues = barCues(score, movements, score.measures[0]);
    expect(cues.map(c => c.movements.map(m => m.pitch))).toEqual([[60, 64], [], [67]]);
    expect(cues.map(c => [c.start, c.end])).toEqual([[0, 0.5], [0.5, 1], [1, 2]]);
    const html = renderToStaticMarkup(createElement(BarNotes, { score, part: score.parts[0], movements, measure: score.measures[0], position: 0.75, active: [] }));
    const notes = document.createElement('div');
    notes.innerHTML = html;
    expect(notes.querySelector('.rest[aria-current="true"]')?.textContent).toBe('Rest');
    expect(html).toContain('End of score');
  });

  it('carries a tied pitch across a bar without a false release or another attack', () => {
    const next = '<Spanner type="Tie"><next><location><measures>1</measures><fractions>0/1</fractions></location></next></Spanner>';
    const prev = '<Spanner type="Tie"><prev><location><measures>-1</measures><fractions>0/1</fractions></location></prev></Spanner>';
    const { score, movements } = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120) + chord('whole', 60, '', next)) + measure(chord('whole', 60, '', prev)),
    ]), 'test'));
    expect(highlightedMovements(movements, 1.99)).toEqual(movements);
    expect(highlightedMovements(movements, 2)).toEqual(movements);
    expect(barCues(score, movements, score.measures[1])).toEqual([{ start: 2, end: 4, movements }]);
    const notes = document.createElement('div');
    notes.innerHTML = renderToStaticMarkup(createElement(BarNotes, { score, part: score.parts[0], movements, measure: score.measures[1], position: 2, active: movements }));
    expect(notes.querySelector('.held .note-label')?.textContent).toBe('C4Hold');
    expect(notes.querySelector('.held')?.getAttribute('aria-label')).toContain('Hold C4, beat 1');
  });

  it('queues the repeated bar after the first ending', () => {
    const { score, movements } = interpretScore(fixture('colonel-bogey'));
    const bar = score.measures.find((m, i) => m.sourceIndex === 9 && score.measures[i + 1].sourceIndex === 2)!;
    const html = renderToStaticMarkup(createElement(BarNotes, { score, part: score.parts[0], movements: movements.filter(m => m.partId === score.parts[0].id), measure: bar, position: 0, active: [] }));
    expect(html).toContain('Current bar 10');
    expect(html).toContain('Next bar 3');
  });
});

describe('beat-proportional bar layout', () => {
  it('keeps sparse lyre letters level regardless of pitch', () => {
    const { score, movements } = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120) + chord('quarter', 57) + chord('quarter', 69) + chord('half', 81)) + measure(chord('whole', 69)),
    ], ['Bell Lyre']), 'contour'));
    const part = score.parts[0];
    const current = barRhythm(score, part, movements, score.measures[0]);
    const next = barRhythm(score, part, movements, score.measures[1]);
    const currentLabels = fitRhythmLabels(current.cues, 400);
    expect(new Set(currentLabels.map(label => label.y)).size).toBe(1);
    expect(fitRhythmLabels(next.cues, 400)[0].y).toBe(currentLabels[0].y);
  });

  it.each([
    ['the-captain-general', 0, 238, 2],
    ['the-captain-general', 1, 238, 2],
    ['colonel-bogey', 1, 206, 3],
  ] as const)('keeps %s bar %i at exact onsets with readable staggered labels', (name, bar, width, rows) => {
    const { score, movements } = interpretScore(fixture(name));
    const part = score.parts.find(part => part.renderer === 'lyre')!;
    const rhythm = barRhythm(score, part, movements.filter(movement => movement.partId === part.id), score.measures[bar]);
    const onsets = rhythm.cues.map(cue => cue.offset);
    const fitted = fitRhythmLabels(rhythm.cues, width);
    expect(new Set(fitted.map(label => label.y)).size).toBe(rows);
    for (const [index, label] of fitted.entries()) {
      expect(label.x).toBeCloseTo(label.cue.offset * width, 8);
      expect(label.height).toBe(22);
      for (const previous of fitted.slice(0, index)) {
        const overlapX = label.x - label.width / 2 < previous.x + previous.width / 2;
        if (label.row === previous.row) expect(overlapX).toBe(false);
        else if (overlapX) {
          const overlapY = Math.min(label.y + label.height, previous.y + previous.height) - Math.max(label.y, previous.y);
          expect(overlapY).toBeLessThanOrEqual(2);
        }
      }
    }
    expect(rhythm.cues.map(cue => cue.offset)).toEqual(onsets);
  });

  it('keeps beat spacing uniform through a tempo change inside a bar', () => {
    const { score, movements } = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120) + chord() + tempo(60) + chord() + chord('half')),
    ]), 'rhythm'));
    const rhythm = barRhythm(score, score.parts[0], movements, score.measures[0]);
    expect(rhythm.cues.map(cue => cue.start)).toEqual([0, 0.5, 1.5]);
    expect(rhythm.cues.map(cue => cue.offset)).toEqual([0, 0.25, 0.5]);
    expect(rhythm.cues.map(cue => cue.span)).toEqual([0.25, 0.25, 0.5]);
    expect(rhythm.beats.filter(beat => beat.label).map(beat => [beat.label, beat.offset])).toEqual([
      ['1', 0], ['2', 0.25], ['3', 0.5], ['4', 0.75],
    ]);
  });

  it('preserves dotted durations, silent gaps and a fractional playhead position', () => {
    const { score, movements } = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120) + chord('quarter', 60, '<dots>1</dots>') + '<Rest><durationType>eighth</durationType></Rest>' + chord('half')),
    ]), 'rhythm'));
    const rhythm = barRhythm(score, score.parts[0], movements, score.measures[0]);
    expect(rhythm.cues.map(cue => [cue.offset, cue.span, cue.labels.length])).toEqual([
      [0, 0.375, 1], [0.375, 0.125, 0], [0.5, 0.5, 1],
    ]);
    const notes = document.createElement('div');
    notes.innerHTML = renderToStaticMarkup(createElement(BarNotes, { score, part: score.parts[0], movements, measure: score.measures[0], position: 0.875, active: [] }));
    expect((notes.querySelector('.rhythm-playhead') as HTMLElement).style.left).toBe('43.75%');
  });

  it('spaces triplets evenly within their beat without quantizing to the subdivision grid', () => {
    const tuplet = '<Tuplet><normalNotes>2</normalNotes><actualNotes>3</actualNotes><baseNote>eighth</baseNote></Tuplet>';
    const { score, movements } = interpretScore(parseScore(synthetic([
      measure(time() + tempo(120) + tuplet + chord('eighth').repeat(3) + '<endTuplet/>' + chord('half', 62, '<dots>1</dots>')),
    ]), 'rhythm'));
    const rhythm = barRhythm(score, score.parts[0], movements, score.measures[0]);
    [0, 1 / 12, 1 / 6, 0.25].forEach((offset, i) => expect(rhythm.cues[i].offset).toBeCloseTo(offset, 10));
  });

  it('places a compound-meter pickup at the end of the bar without inventing rests', () => {
    const { score, movements } = interpretScore(fixture('ready-aye-ready'));
    const part = score.parts.find(part => part.renderer === 'snare')!;
    const notes = movements.filter(m => m.partId === part.id);
    const pickup = barRhythm(score, part, notes, score.measures[0]);
    expect(pickup.pickup).toBe(true);
    expect(pickup.cues).toHaveLength(1);
    expect(pickup.cues[0].offset).toBeCloseTo(5 / 6, 10);
    expect(pickup.cues[0].span).toBeCloseTo(1 / 6, 10);
    const fullBar = barRhythm(score, part, notes, score.measures[1]);
    expect(fullBar.beats.filter(beat => beat.label).map(beat => [beat.label, beat.offset])).toEqual([['1', 0], ['2', 0.5]]);
    expect(fullBar.beats.some(beat => Math.abs(beat.offset - 1 / 6) < 1e-8 && !beat.major)).toBe(true);
  });
});
