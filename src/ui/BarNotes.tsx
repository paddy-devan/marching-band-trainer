import { useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { add, value } from '../score/fraction';
import { positionAt, secondsAt } from '../score/interpret';
import type { Measure, Movement, Part, Score } from '../score/model';
import { beatUnit } from '../audio/beats';
import { movementLabel } from './InstrumentView';

export type NoteCue = { start: number; end: number; movements: Movement[] };

// Keep every contact in the bar visible, group simultaneous pitches, carry held
// ties into the next bar, and show silence without conflicting per-voice rests.
export function barCues(score: Score, movements: Movement[], measure: Measure): NoteCue[] {
  const start = secondsAt(score, measure.start);
  const end = secondsAt(score, add(measure.start, measure.duration));
  const groups: NoteCue[] = [];
  for (const m of movements) {
    if (m.flam === 'grace') continue; // The principal cue labels the complete flam.
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

type RhythmCue = NoteCue & { offset: number; span: number; labels: string[]; held: boolean };
type BeatMark = { offset: number; label?: string; major: boolean; inactive: boolean };
export type BarRhythm = { cues: RhythmCue[]; beats: BeatMark[]; pickup: boolean; start: number; span: number };

// Horizontal space represents musical beats, not elapsed seconds: a tempo
// change within the bar must not distort the written rhythm.
export function barRhythm(score: Score, part: Part, movements: Movement[], bar: Measure): BarRhythm {
  const start = value(bar.start);
  const length = value(bar.duration);
  const { numerator, denominator } = bar.signature;
  const unit = beatUnit(numerator, denominator);
  const nominal = numerator * 4 / denominator;
  const width = Math.max(nominal, length);
  const pickup = (bar.sourceIndex ?? bar.index) === 0 && length < nominal - 1e-8;
  const origin = pickup ? nominal - length : 0;
  const cues = barCues(score, movements, bar).map(cue => ({
    ...cue,
    offset: Math.max(0, (origin + positionAt(score, cue.start) - start) / width),
    span: Math.min(1, (positionAt(score, cue.end) - positionAt(score, cue.start)) / width),
    labels: [...new Set(cue.movements.map(m => movementLabel(m, part)))],
    held: cue.movements.length > 0 && cue.movements.every(m => m.time < cue.start - 1e-8),
  }));
  const compound = unit === 1.5 && denominator === 8;
  const step = unit / (compound ? 3 : 2);
  const beats: BeatMark[] = [];
  for (let at = 0; at < width - 1e-8; at += step) {
    const count = at / unit;
    const major = Math.abs(count - Math.round(count)) < 1e-8;
    beats.push({ offset: at / width, major, label: major ? String(Math.round(count) + 1) : undefined, inactive: at < origin - 1e-8 || at > origin + length - 1e-8 });
  }
  beats.push({ offset: 1, major: true, inactive: false });
  return { cues, beats, pickup, start: origin / width, span: length / width };
}

function labelSize(cue: RhythmCue) {
  const width = Math.max(1, ...cue.labels.map(label => /^[A-G]/.test(label) ? (label.includes('♯') ? 29 : 21) : label === 'Strike' ? 44 : / (Roll|Flam)$/.test(label) ? 19 : 16));
  const height = 22 * cue.labels.length + (cue.held || cue.labels.some(label => / (Roll|Flam)$/.test(label)) ? 8 : 0);
  return { width, height };
}

// Keep label centres at their exact onsets and keep their text at full size.
// Only use another row when labels collide; row height carries no pitch meaning.
export function fitRhythmLabels(cues: BarRhythm['cues'], width: number) {
  const rows: { right: number; height: number }[] = [];
  const labels = cues.filter(cue => cue.movements.length).map(cue => {
    const size = labelSize(cue);
    const x = cue.offset * width;
    const left = x - size.width / 2;
    let row = rows.findIndex(previous => previous.right + 0.5 <= left + 1e-8);
    if (row === -1) {
      row = rows.length;
      rows.push({ right: x + size.width / 2, height: size.height });
    } else {
      rows[row].right = x + size.width / 2;
      rows[row].height = Math.max(rows[row].height, size.height);
    }
    return { cue, x, row, ...size };
  });
  let y = 0;
  const offsets = rows.map(row => { const top = y; y += row.height + 4; return top; });
  return labels.map(label => ({ ...label, y: offsets[label.row] }));
}

type RowProps = { rhythm: BarRhythm; bar: Measure; queued?: boolean; progress: number; position: number; lit: Set<string> };
function RhythmRow({ rhythm, bar, queued = false, progress, position, lit }: RowProps) {
  const track = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = track.current;
    if (!el) return;
    const resize = () => setWidth(el.clientWidth);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const labels = useMemo(() => width > 0 ? fitRhythmLabels(rhythm.cues, width) : [], [rhythm, width]);
  const labelPositions = useMemo(() => new Map(labels.map(label => [label.cue, label])), [labels]);
  const height = Math.max(32, ...labels.map(label => label.y + label.height + 10));
  const beatsPerBar = Math.max(value(bar.duration), bar.signature.numerator * 4 / bar.signature.denominator) / beatUnit(bar.signature.numerator, bar.signature.denominator);
  return <div className={`bar-notes-row ${queued ? 'queued' : 'current'}`} aria-label={`${queued ? 'Next' : 'Current'} bar ${(bar.sourceIndex ?? bar.index) + 1}`}>
    <span className="bar-notes-number" aria-hidden="true">{(bar.sourceIndex ?? bar.index) + 1}</span>
    <div className="rhythm-strip" style={{ '--rhythm-height': `${height}px` } as CSSProperties}>
    <div className="rhythm-track" ref={track}>
      <div className="beat-grid" aria-hidden="true">{rhythm.beats.map(beat => <div key={beat.offset} className={`beat-mark${beat.major ? ' major' : ''}${beat.inactive ? ' inactive' : ''}`} style={{ left: `${beat.offset * 100}%` }}><span>{beat.label}</span></div>)}</div>
      <ol className="note-line">
      {rhythm.cues.map((cue, index) => {
        const sounding = !queued && cue.movements.some(m => lit.has(m.id));
        const resting = !queued && !cue.movements.length && position >= cue.start && position < cue.end;
        const played = !queued && position >= cue.end;
        const description = `${cue.held ? 'Hold ' : ''}${cue.labels.join(', ') || 'Rest'}, beat ${Number((1 + cue.offset * beatsPerBar).toFixed(2))}, ${Number((cue.span * beatsPerBar).toFixed(2))} beats long`;
        return <li key={`${cue.start}:${index}`} className={`note-cue ${sounding || resting ? 'lit' : ''} ${played ? 'played' : ''} ${!cue.movements.length ? 'rest' : ''}${cue.held ? ' held' : ''}`} style={{ left: `${cue.offset * 100}%`, width: `${cue.span * 100}%` }} aria-label={description} aria-current={sounding || resting ? 'true' : undefined}>
          <span className="cue-duration" aria-hidden="true" />
          {cue.labels.length ? (() => {
            const { width: labelWidth, height: labelHeight } = labelSize(cue);
            const fitted = labelPositions.get(cue);
            return <span className="note-label" style={{ top: fitted?.y ?? 0, width: labelWidth, height: labelHeight }}>
            <svg viewBox={`0 0 ${labelWidth} ${labelHeight}`} aria-hidden="true">
              <rect className="note-highlight" x="0" y="0" width={labelWidth} height={labelHeight} rx="3" />
              {cue.labels.map((label, row) => {
            const pitch = label.match(/^([A-G][♯♭]?)(-?\d+)$/);
            const technique = label.match(/^(.+) (Roll|Flam)$/);
            return <text key={label} x={labelWidth / 2} y={16 + row * 22} textAnchor="middle">{pitch ? <>{pitch[1]}<tspan className="note-octave" dy="3">{pitch[2]}</tspan></> : technique ? <>{technique[1]}<tspan x={labelWidth / 2} dy="10" className="note-technique"> {technique[2]}</tspan></> : label}</text>;
          })}{cue.held ? <text x={labelWidth / 2} y={labelHeight - 2} textAnchor="middle" className="note-hold">Hold</text> : null}
            </svg>
            </span>;
          })() : <span className={rhythm.cues.length === 1 ? 'bar-rest' : 'sr-only'}>Rest</span>}
        </li>;
      })}
      </ol>
      {!queued ? <div className="rhythm-playhead" style={{ left: `${progress * 100}%` }} aria-hidden="true" /> : null}
    </div>
    </div>
  </div>;
}

type Props = { score: Score; part: Part; movements: Movement[]; measure: Measure; position: number; active: Movement[] };
export function BarNotes({ score, part, movements, measure, position, active }: Props) {
  const next = score.measures[measure.index + 1];
  const currentRhythm = useMemo(() => barRhythm(score, part, movements, measure), [score, part, movements, measure]);
  const nextRhythm = useMemo(() => next ? barRhythm(score, part, movements, next) : undefined, [score, part, movements, next]);
  const progress = currentRhythm.start + currentRhythm.span * Math.max(0, Math.min(1, (positionAt(score, position) - value(measure.start)) / value(measure.duration)));
  const lit = new Set(active.map(m => m.id));
  return <section className="bar-notes" aria-label="Bar notes">
    <RhythmRow rhythm={currentRhythm} bar={measure} progress={progress} position={position} lit={lit} />
    {next && nextRhythm ? <RhythmRow rhythm={nextRhythm} bar={next} queued progress={0} position={position} lit={lit} /> : <div className="bar-notes-end">End of score</div>}
  </section>;
}
