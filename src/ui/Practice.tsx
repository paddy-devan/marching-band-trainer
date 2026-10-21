import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Transport, type Mix } from '../audio/transport';
import type { Timeline } from '../score/model';
import { positionAt } from '../score/interpret';
import { value } from '../score/fraction';
import { InstrumentView } from './InstrumentView';
import { InstrumentPicker } from './InstrumentPicker';
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
  const hasMultipleParts = score.parts.length > 1;
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
  const measure = score.measures.find(m => beats >= value(m.start) - 1e-8 && beats < value(m.start) + value(m.duration) - 1e-8) || score.measures.at(-1)!;
  const tempo = score.tempos.filter(t => value(t.position) <= beats).at(-1) || score.tempos[0];
  const hasLyre = useMemo(() => playableLyres(timeline).length > 0, [timeline]);
  const hasDrum = useMemo(() => playableDrums(timeline).length > 0, [timeline]);
  return <main className="practice">
    <header className="piece-heading"><h1>{score.title}</h1>{score.composer ? <p>{score.composer}</p> : null}</header>
    <div className="practice-grid">
      <section className="visual-panel" aria-labelledby="visual-title">
        <div className="visual-heading">
          <h2 id="visual-title" className={hasMultipleParts ? 'sr-only' : 'instrument-name'}>{part.name}</h2>
          {hasMultipleParts ? <InstrumentPicker parts={score.parts} selected={selected} onChange={setSelected} /> : null}
        </div>
        <div className="instrument-stage"><InstrumentView part={part} active={active} position={state.position} movements={partMovements} speed={state.speed} playing={state.playing} drumTiming={timing} readPosition={readPosition} /></div>
        <BarNotes score={score} part={part} movements={partMovements} measure={measure} position={state.position} active={active} />
      </section>
      <div className="control-column">
        <TransportControls transport={transport} state={state} timeline={timeline} measure={measure} bpm={tempo.bpm}>
          <PartControls parts={score.parts} mix={mix} onMix={changeMix} />
        </TransportControls>
        {hasLyre || hasDrum ? <section className="challenge-launcher" aria-labelledby="challenges-title">
          <h2 id="challenges-title">Challenges</h2>
          <div className="challenge-actions">
            {hasLyre ? <button className="challenge-button" onClick={() => { transport.pause(); onChallenge('lyre'); }}>Bell lyre challenge<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button> : null}
            {hasDrum ? <button className="challenge-button" onClick={() => { transport.pause(); onChallenge('drum'); }}>Drum challenge<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg></button> : null}
          </div>
        </section> : null}
      </div>
    </div>
  </main>;
}
