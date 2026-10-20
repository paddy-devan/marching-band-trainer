import type { Transport, TransportState } from '../audio/transport';
import type { Timeline } from '../score/model';
import type { ReactNode } from 'react';
import { Slider } from './Slider';

export const clockLabel = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, '0')}`;
export function TransportControls({ transport, state, timeline, bar, beat, bpm, children }: { transport: Transport; state: TransportState; timeline: Timeline; bar: number; beat: number; bpm: number; children: ReactNode }) {
  return <section className="transport-controls" aria-label="Playback controls">
    <div className="playback-controls">
    <div className="transport-top">
      <div className="transport-actions"><button className="play-button" aria-label={state.playing ? 'Pause' : 'Play'} onClick={() => state.playing ? transport.pause() : void transport.play()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{state.playing ? <path d="M7 5h4v14H7zM15 5h4v14h-4z" /> : <path d="m7 4 14 8-14 8z" />}</svg>{state.playing ? 'Pause' : 'Play'}</button>
        <button className="restart-button" aria-label="Restart" title="Restart track" onClick={() => transport.restart()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 11a9 9 0 1 1 2.6 7.4M3 4v7h7" /></svg><span>Restart</span></button></div>
      <div className="bar-readout"><strong>Bar {bar}<span> / {timeline.score.writtenMeasureCount || timeline.score.measures.length}</span></strong><small>Beat {beat}</small></div>
    </div>
    <label className="sr-only" htmlFor="seek">Playback position</label>
    <Slider id="seek" aria-label="Playback position" min={0} max={timeline.duration} step="0.01" value={Math.max(0, state.position)} onChange={e => transport.seek(Number(e.target.value))} />
    <div className="time-readout"><span>{clockLabel(state.position)}</span><span>{clockLabel(timeline.duration)}</span></div>
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
