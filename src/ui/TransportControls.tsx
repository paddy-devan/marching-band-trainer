import type { Transport, TransportState } from '../audio/transport';
import type { Measure, Timeline } from '../score/model';
import { useMemo, type ReactNode } from 'react';
import { secondsAt } from '../score/interpret';
import { Slider } from './Slider';

export function TransportControls({ transport, state, timeline, measure, bpm, children }: { transport: Transport; state: TransportState; timeline: Timeline; measure: Measure; bpm: number; children: ReactNode }) {
  const barStarts = useMemo(() => timeline.score.measures.map(m => secondsAt(timeline.score, m.start)), [timeline]);
  const bar = (measure.sourceIndex ?? measure.index) + 1;
  const writtenBars = timeline.score.writtenMeasureCount || barStarts.length;
  const barLabel = `Bar ${bar} of ${writtenBars}${barStarts.length !== writtenBars ? `, played bar ${measure.index + 1} of ${barStarts.length}` : ''}`;
  return <section className="transport-controls" aria-label="Playback controls">
    <div className="playback-controls">
    <div className="playback-row">
      <div className="transport-actions"><button className="play-button" aria-label={state.playing ? 'Pause' : 'Play'} onClick={() => state.playing ? transport.pause() : void transport.play()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{state.playing ? <path d="M7 5h4v14H7zM15 5h4v14h-4z" /> : <path d="m7 4 14 8-14 8z" />}</svg><span>{state.playing ? 'Pause' : 'Play'}</span></button>
        <button className="restart-button" aria-label="Restart" title="Restart track" onClick={() => transport.restart()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" /></svg><span>Restart</span></button></div>
      <div className="playback-seek">
        <label className="sr-only" htmlFor="seek">Playback position</label>
        <Slider id="seek" aria-label="Playback position" aria-valuetext={barLabel} min={1} max={barStarts.length} step="1" value={measure.index + 1} disabled={barStarts.length < 2} onChange={e => transport.seek(barStarts[Number(e.target.value) - 1])} />
      </div>
      <div className="bar-readout"><strong>Bar {bar}<span> / {writtenBars}</span></strong></div>
    </div>
    {state.status ? <p className="error" role="status">{state.status}</p> : null}
    </div>
    <div className="practice-settings">
    <div className="tempo-controls">
      <div className="speed-heading"><label htmlFor="speed">Tempo</label><output htmlFor="speed"><span>{Math.round(bpm * state.speed)} BPM</span><span>{Math.round(state.speed * 100)}%</span></output></div>
      <Slider id="speed" min={50} max={125} step="5" value={Math.round(state.speed * 100)} aria-valuetext={`${Math.round(bpm * state.speed)} BPM, ${Math.round(state.speed * 100)} percent`} onChange={e => transport.setSpeed(Number(e.target.value) / 100)} />
      <div className="speed-presets">{[0.5, 0.6, 0.8, 0.9, 1].map(speed => <button key={speed} aria-pressed={state.speed === speed} onClick={() => transport.setSpeed(speed)}>{Math.round(speed * 100)}%</button>)}</div>
    </div>
    <label className="metronome-control">
      <span>Metronome</span>
      <input type="checkbox" role="switch" aria-label="Metronome" checked={state.metronome} onChange={e => transport.setMetronome(e.target.checked)} />
    </label>
    {children}
    </div>
  </section>;
}
