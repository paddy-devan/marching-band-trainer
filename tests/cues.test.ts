import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { interpretScore } from '../src/score/interpret';
import { parseScore } from '../src/score/parser';
import { BarNotes, barCues } from '../src/ui/BarNotes';
import { highlightedMovements } from '../src/ui/cues';
import { chord, fixture, measure, synthetic, tempo, time } from './helpers';

const repeated = () => interpretScore(parseScore(synthetic([
  measure(time() + tempo(120) + chord() + chord() + chord('half')) + measure(chord('whole', 62)),
]), 'test'));

describe('bar cues and shared strike highlights', () => {
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
    expect(html).toContain('rest" aria-current="true"><span>Rest');
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
  });

  it('queues the repeated bar after the first ending', () => {
    const { score, movements } = interpretScore(fixture('colonel-bogey'));
    const bar = score.measures.find((m, i) => m.sourceIndex === 9 && score.measures[i + 1].sourceIndex === 2)!;
    const html = renderToStaticMarkup(createElement(BarNotes, { score, part: score.parts[0], movements: movements.filter(m => m.partId === score.parts[0].id), measure: bar, position: 0, active: [] }));
    expect(html).toContain('Current bar 10');
    expect(html).toContain('Next bar 3');
  });
});
