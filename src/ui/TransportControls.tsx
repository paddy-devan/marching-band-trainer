import type { Transport, TransportState } from '../audio/transport';
import type { Timeline } from '../score/model';

export const clockLabel = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
export function TransportControls({ transport, state, timeline, bar, beat }: { transport: Transport; state: TransportState; timeline: Timeline; bar: number; beat: number }) {
  return <section className="transport-controls" aria-label="Playback controls">
    <div className="transport-top">
      <div className="transport-actions"><button className="play-button" aria-label={state.playing ? 'Pause' : 'Play'} onClick={() => state.playing ? transport.pause() : void transport.play()}>
        <svg viewBox="0 0 24 24" aria-hidden="true">{state.playing ? <path d="M7 5h4v14H7zM15 5h4v14h-4z" /> : <path d="m7 4 14 8-14 8z" />}</svg>{state.playing ? 'Pause' : 'Play'}</button>
        <button className="restart-button" aria-label="Restart" onClick={() => transport.restart()}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 7a8 8 0 1 1-2 7M6 2v6H0" /></svg><span>Restart</span></button></div>
      <div className="bar-readout"><strong>Bar {bar}<span> / {timeline.score.measures.length}</span></strong><small>Beat {beat}</small></div>
    </div>
    <label className="sr-only" htmlFor="seek">Playback position</label>
    <input id="seek" aria-label="Playback position" type="range" min="0" max={timeline.duration} step="0.01" value={state.position} onChange={e => transport.seek(Number(e.target.value))} />
    <div className="time-readout"><span>{clockLabel(state.position)}</span><span>{clockLabel(timeline.duration)}</span></div>
    <div className="speed-heading"><label htmlFor="speed">Practice speed</label><output htmlFor="speed">{Math.round(state.speed * 100)}%</output></div>
    <input id="speed" type="range" min="25" max="150" step="5" value={Math.round(state.speed * 100)} onChange={e => transport.setSpeed(Number(e.target.value) / 100)} />
    <div className="speed-presets">{[0.5, 0.75, 1, 1.25].map(speed => <button key={speed} aria-pressed={state.speed === speed} onClick={() => transport.setSpeed(speed)}>{Math.round(speed * 100)}%</button>)}</div>
    {state.status ? <p className="error" role="status">{state.status}</p> : null}
  </section>;
}
