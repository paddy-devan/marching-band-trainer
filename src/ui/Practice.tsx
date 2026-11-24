import { useCallback, useEffect, useMemo, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
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
import type { DrumTiming } from './drum-timing';
import { DEFAULT_PRACTICE_SETTINGS, practicePartKeys, type PracticeSettings } from './practice-settings';

type Props = {
  timeline: Timeline;
  onChallenge: (mode: ChallengeMode) => void;
  settings: PracticeSettings;
  setSettings: Dispatch<SetStateAction<PracticeSettings>>;
  drumTiming: DrumTiming;
};

export function Practice({ timeline, onChallenge, settings, setSettings, drumTiming }: Props) {
  const score = timeline.score;
  const partKeys = useMemo(() => practicePartKeys(score.parts), [score.parts]);
  const mix = useMemo<Mix>(() => Object.fromEntries([...partKeys].flatMap(([id, key]) => (
    settings.mix[key] ? [[id, settings.mix[key]]] : []
  ))), [partKeys, settings.mix]);
  const [transport] = useState(() => {
    const transport = new Transport(timeline);
    transport.setSpeed(settings.speed);
    transport.setMetronome(settings.metronome);
    transport.setMetronomeVolume(settings.metronomeVolume);
    transport.setMix(mix);
    return transport;
  });
  const state = useSyncExternalStore(transport.subscribe, transport.getSnapshot);
  const part = score.parts.find(p => partKeys.get(p.id) === settings.partKey) ?? score.parts[0];
  const selectedKey = partKeys.get(part.id)!;
  const hasMultipleParts = score.parts.length > 1;
  const readPosition = useCallback(() => transport.readPosition(), [transport]);
  useEffect(() => () => transport.dispose(), [transport]);
  const preferredKey = settings.partKey;
  useEffect(() => {
    if (preferredKey === undefined || preferredKey === selectedKey) return;
    setSettings(current => current.partKey === preferredKey ? { ...current, partKey: selectedKey } : current);
  }, [preferredKey, selectedKey, setSettings]);
  const changeSpeed = (speed: number) => {
    if (state.speed !== speed) transport.setSpeed(speed);
    setSettings(current => ({ ...current, speed }));
  };
  const changeMetronome = (metronome: boolean) => {
    transport.setMetronome(metronome);
    setSettings(current => ({ ...current, metronome }));
  };
  const changeMetronomeVolume = (metronomeVolume: number) => {
    transport.setMetronomeVolume(metronomeVolume);
    setSettings(current => ({ ...current, metronomeVolume }));
  };
  const changePartMix = (id: string, next: Mix[string]) => {
    transport.setMix({ ...mix, [id]: next });
    setSettings(current => ({ ...current, mix: { ...current.mix, [partKeys.get(id)!]: next } }));
  };
  const resetSettings = () => {
    const { speed, metronome, metronomeVolume, mix } = DEFAULT_PRACTICE_SETTINGS;
    transport.setMix(mix);
    transport.setMetronomeVolume(metronomeVolume);
    if (state.speed !== speed) transport.setSpeed(speed);
    transport.setMetronome(metronome);
    setSettings(current => ({ ...DEFAULT_PRACTICE_SETTINGS, partKey: current.partKey }));
  };
  const partMovements = useMemo(() => timeline.movements.filter(m => m.partId === part.id), [timeline, part.id]);
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
          {hasMultipleParts ? <InstrumentPicker parts={score.parts} selected={part.id} onChange={id => setSettings(current => ({ ...current, partKey: partKeys.get(id)! }))} /> : null}
        </div>
        <div className="instrument-stage"><InstrumentView part={part} active={active} position={state.position} movements={partMovements} speed={state.speed} playing={state.playing} drumTiming={drumTiming} readPosition={readPosition} /></div>
        <BarNotes score={score} part={part} movements={partMovements} measure={measure} position={state.position} active={active} />
      </section>
      <div className="control-column">
        <TransportControls transport={transport} state={state} timeline={timeline} measure={measure} bpm={tempo.bpm}
          onSpeed={changeSpeed} onMetronome={changeMetronome} onReset={resetSettings}>
          <PartControls parts={score.parts} mix={mix} onPartMix={changePartMix}
            metronomeEnabled={state.metronome} metronomeVolume={settings.metronomeVolume} onMetronomeVolume={changeMetronomeVolume} />
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
