import { useMemo } from 'react';
import { add } from '../score/fraction';
import { secondsAt } from '../score/interpret';
import type { Measure, Movement, Part, Score } from '../score/model';
import { movementLabel } from './InstrumentView';

export type NoteCue = { start: number; end: number; movements: Movement[] };

// Keep every contact in the bar visible, group simultaneous pitches, carry held
// ties into the next bar, and show silence without conflicting per-voice rests.
export function barCues(score: Score, movements: Movement[], measure: Measure): NoteCue[] {
  const start = secondsAt(score, measure.start);
  const end = secondsAt(score, add(measure.start, measure.duration));
  const groups: NoteCue[] = [];
  for (const m of movements) {
    if (m.time >= end - 1e-8 || m.time + m.seconds <= start + 1e-8) continue;
    const at = Math.max(m.time, start);
    const until = Math.min(m.time + m.seconds, end);
    const previous = groups.at(-1);
    if (previous && Math.abs(previous.start - at) < 1e-8) {
      previous.movements.push(m);
      previous.end = Math.max(previous.end, until);
    } else groups.push({ start: at, end: until, movements: [m] });
  }
  const cues: NoteCue[] = [];
  let cursor = start;
  for (const group of groups) {
    if (group.start > cursor + 1e-8) cues.push({ start: cursor, end: group.start, movements: [] });
    cues.push(group);
    cursor = Math.max(cursor, group.end);
  }
  if (cursor < end - 1e-8) cues.push({ start: cursor, end, movements: [] });
  return cues;
}

type Props = { score: Score; part: Part; movements: Movement[]; measure: Measure; position: number; active: Movement[] };
export function BarNotes({ score, part, movements, measure, position, active }: Props) {
  const next = score.measures[measure.index + 1];
  const currentCues = useMemo(() => barCues(score, movements, measure), [score, movements, measure]);
  const nextCues = useMemo(() => next ? barCues(score, movements, next) : [], [score, movements, next]);
  const lit = new Set(active.map(m => m.id));
  const currentEnd = secondsAt(score, add(measure.start, measure.duration));
  const renderRow = (cues: NoteCue[], bar: Measure, queued: boolean) => <div className={`bar-notes-row ${queued ? 'queued' : 'current'}`} aria-label={`${queued ? 'Next' : 'Current'} bar ${(bar.sourceIndex ?? bar.index) + 1}`}>
    <div className="bar-notes-label"><span>{queued ? 'Next' : 'Bar'} {(bar.sourceIndex ?? bar.index) + 1}</span></div>
    <ol className="note-line">
      {cues.map((cue, index) => {
        const sounding = !queued && cue.movements.some(m => lit.has(m.id));
        const resting = !queued && !cue.movements.length && position >= cue.start && position < cue.end && position < currentEnd;
        const played = !queued && position >= cue.end;
        const labels = [...new Set(cue.movements.map(m => movementLabel(m, part)))];
        return <li key={`${cue.start}:${index}`} className={`note-cue ${sounding || resting ? 'lit' : ''} ${played ? 'played' : ''} ${!cue.movements.length ? 'rest' : ''}`} aria-current={sounding || resting ? 'true' : undefined}>
          {labels.length ? labels.map(label => <span key={label}>{label}</span>) : <span>Rest</span>}
        </li>;
      })}
    </ol>
  </div>;
  return <section className="bar-notes" aria-label="Bar notes">
    {renderRow(currentCues, measure, false)}
    {next ? renderRow(nextCues, next, true) : <div className="bar-notes-end">End of score</div>}
  </section>;
}
