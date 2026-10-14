import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Transport, type Mix } from '../audio/transport';
import type { Timeline } from '../score/model';
import { positionAt } from '../score/interpret';
import { value } from '../score/fraction';
import { InstrumentView } from './InstrumentView';
import { BarNotes } from './BarNotes';
import { highlightedMovements } from './cues';
import { PartControls } from './PartControls';
import { TransportControls } from './TransportControls';
import { playableDrums, playableLyres, type ChallengeMode } from '../game/parts';
import { DEFAULT_DRUM_TIMING, DRUM_TIMING_STORAGE_KEY, parseDrumTiming } from './drum-timing';

export function Practice({ timeline, onChallenge }: { timeline: Timeline; onChallenge: (mode: ChallengeMode) => void }) {
  const score = timeline.score;
  const [transport] = useState(() => new Transport(timeline));
  const state = useSyncExternalStore(transport.subscribe, transport.getSnapshot);
  const [selected, setSelected] = useState(score.parts[0].id);
  const [mix, setMix] = useState<Mix>(() => Object.fromEntries(score.parts.map(p => [p.id, { muted: false, solo: false }])));
  const [timing] = useState(() => {
    try { return parseDrumTiming(localStorage.getItem(DRUM_TIMING_STORAGE_KEY)); }
    catch { return { ...DEFAULT_DRUM_TIMING }; }
  });
  const readPosition = useCallback(() => transport.readPosition(), [transport]);
  useEffect(() => () => transport.dispose(), [transport]);
  const changeMix = (next: Mix) => { transport.setMix(next); setMix(next); };
  const part = score.parts.find(p => p.id === selected)!;
  const partMovements = useMemo(() => timeline.movements.filter(m => m.partId === selected), [timeline, selected]);
  const active = highlightedMovements(partMovements, state.position, state.speed);
  const beats = positionAt(score, state.position);
  const measure = score.measures.find(m => beats >= value(m.start) && beats < value(m.start) + value(m.duration)) || score.measures.at(-1)!;
  const beatUnit = measure.signature.numerator > 3 && measure.signature.numerator % 3 === 0 && measure.signature.denominator === 8 ? 1.5 : 4 / measure.signature.denominator;
  const beat = Math.max(1, Math.floor((Math.min(beats, value(measure.start) + value(measure.duration) - 0.001) - value(measure.start)) / beatUnit) + 1);
  const tempo = score.tempos.filter(t => value(t.position) <= beats).at(-1) || score.tempos[0];
  const hasLyre = useMemo(() => playableLyres(timeline).length > 0, [timeline]);
  const hasDrum = useMemo(() => playableDrums(timeline).length > 0, [timeline]);
  return <main className="practice">
    <header className="piece-heading"><h1>{score.title}</h1>{score.composer ? <p>{score.composer}</p> : null}</header>
    <div className="practice-grid">
      <section className="visual-panel" aria-labelledby="visual-title">
        <div className="visual-heading"><h2 id="visual-title">{part.name}</h2><div className="challenge-actions">
          {hasLyre ? <button className="challenge-button" onClick={() => { transport.pause(); onChallenge('lyre'); }}><span aria-hidden="true">✦</span> Bell lyre challenge</button> : null}
          {hasDrum ? <button className="challenge-button" onClick={() => { transport.pause(); onChallenge('drum'); }}><span aria-hidden="true">✦</span> Drum challenge</button> : null}
        </div></div>
        <div className="instrument-stage"><InstrumentView part={part} active={active} position={state.position} movements={partMovements} speed={state.speed} playing={state.playing} drumTiming={timing} readPosition={readPosition} /></div>
        <BarNotes score={score} part={part} movements={partMovements} measure={measure} position={state.position} active={active} />
      </section>
      <div className="control-column">
        <TransportControls transport={transport} state={state} timeline={timeline} bar={(measure.sourceIndex ?? measure.index) + 1} beat={beat} bpm={tempo.bpm}>
          <PartControls parts={score.parts} selected={selected} onSelect={setSelected} mix={mix} onMix={changeMix} />
        </TransportControls>
      </div>
    </div>
  </main>;
}
