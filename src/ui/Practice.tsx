import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Transport, type Mix } from '../audio/transport';
import type { Timeline } from '../score/model';
import { keyLabel } from '../score/labels';
import { positionAt } from '../score/interpret';
import { value } from '../score/fraction';
import { InstrumentView, movementLabel } from './InstrumentView';
import { PartControls } from './PartControls';
import { TransportControls } from './TransportControls';

export function Practice({ timeline }: { timeline: Timeline }) {
  const score = timeline.score;
  const [transport] = useState(() => new Transport(timeline));
  const state = useSyncExternalStore(transport.subscribe, transport.getSnapshot);
  const [selected, setSelected] = useState(score.parts[0].id);
  const [mix, setMix] = useState<Mix>(() => Object.fromEntries(score.parts.map(p => [p.id, { muted: false, solo: false }])));
  useEffect(() => () => transport.dispose(), [transport]);
  const changeMix = (next: Mix) => { transport.setMix(next); setMix(next); };
  const part = score.parts.find(p => p.id === selected)!;
  const partMovements = useMemo(() => timeline.movements.filter(m => m.partId === selected), [timeline, selected]);
  const active = partMovements.filter(m => m.time <= state.position + 1e-8 && m.time + m.seconds > state.position + 1e-8);
  const future = partMovements.filter(m => m.time > state.position + 1e-8);
  const upcoming: { time: number; labels: string[]; roll: boolean }[] = [];
  for (const movement of future) {
    const previous = upcoming.at(-1);
    if (previous && Math.abs(previous.time - movement.time) < 1e-8) previous.labels.push(movementLabel(movement, part));
    else {
      if (upcoming.length >= 6) break;
      upcoming.push({ time: movement.time, labels: [movementLabel(movement, part)], roll: movement.roll });
    }
  }
  const beats = positionAt(score, state.position);
  const measure = score.measures.find(m => beats >= value(m.start) && beats < value(m.start) + value(m.duration)) || score.measures.at(-1)!;
  const beatUnit = measure.signature.numerator > 3 && measure.signature.numerator % 3 === 0 && measure.signature.denominator === 8 ? 1.5 : 4 / measure.signature.denominator;
  const beat = Math.max(1, Math.floor((Math.min(beats, value(measure.start) + value(measure.duration) - 0.001) - value(measure.start)) / beatUnit) + 1);
  const key = score.keys.filter(k => k.partId === part.id && value(k.position) <= beats).at(-1);
  const tempo = score.tempos.filter(t => value(t.position) <= beats).at(-1) || score.tempos[0];
  return <main className="practice">
    <header className="piece-heading"><h1>{score.title}</h1>{score.composer ? <p>{score.composer}</p> : null}
      <div className="piece-meta"><span>{measure.signature.numerator}/{measure.signature.denominator} time</span><span>{score.writtenMeasureCount || score.measures.length} bars</span></div>
    </header>
    <div className="practice-grid">
      <section className="visual-panel" aria-labelledby="visual-title">
        <div className="visual-heading"><h2 id="visual-title">{part.name}</h2></div>
        {key ? <p className="key-signature">{keyLabel(key.fifths, key.mode)}</p> : null}
        <div className="instrument-stage"><InstrumentView part={part} active={active} position={state.position} /></div>
        <div className="current-note"><span>Now</span><strong>{active.length ? [...new Set(active.map(m => movementLabel(m, part)))].join(' + ') : state.position >= timeline.duration ? 'Finished' : 'Rest'}</strong></div>
        <div className="upcoming"><span>Coming up</span><ol>{upcoming.map((group, i) => <li key={`${group.time}:${i}`} className={group.roll ? 'roll-note' : ''}>{group.labels.join(' + ')}</li>)}</ol>{!upcoming.length ? <p>End of part</p> : null}</div>
      </section>
      <div className="control-column">
        <TransportControls transport={transport} state={state} timeline={timeline} bar={(measure.sourceIndex ?? measure.index) + 1} beat={beat} bpm={tempo.bpm}>
          <PartControls parts={score.parts} selected={selected} onSelect={setSelected} mix={mix} onMix={changeMix} />
        </TransportControls>
      </div>
    </div>
  </main>;
}
