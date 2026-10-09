import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Transport, type Mix } from '../audio/transport';
import { countIn } from '../audio/beats';
import { Attempt, gameTargets, type Judgement, type Result } from '../game/scoring';
import type { Part, Timeline } from '../score/model';
import { positionAt } from '../score/interpret';
import { value, add } from '../score/fraction';
import { pitchLabel } from '../score/labels';
import { lyreBars } from './InstrumentView';

export function playableLyres(timeline: Timeline) {
  return timeline.score.parts.filter(part => {
    if (part.renderer !== 'lyre') return false;
    const targets = gameTargets(timeline, part, 1);
    return targets.length > 0 && targets.every(t => t.pitch >= part.register.min && t.pitch <= part.register.max);
  });
}

type Settings = { speed: number; preview: boolean; metronome: boolean; backing: boolean };
type Phase = 'setup' | 'running' | 'results';
type Feedback = { pitch?: number; text: Judgement | ''; at: number };

function Star({ filled }: { filled: boolean }) {
  return <span className={`game-star${filled ? ' filled' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.76l-6.18 3.25L7 14.13 2 9.26l6.91-1Z" /></svg></span>;
}

function GameResult({ result, transport, settings, onRetry, onExit }: {
  result: Result; transport: Transport; settings: Settings; onRetry: () => void; onExit: () => void;
}) {
  const [revealed, setRevealed] = useState(0);
  const [sound, setSound] = useState(true);
  const soundRef = useRef(true);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
    const timers = Array.from({ length: result.stars }, (_, index) => window.setTimeout(() => {
      setRevealed(index + 1);
      if (soundRef.current) transport.revealStar(index);
    }, 400 + index * 330));
    return () => timers.forEach(clearTimeout);
  }, [result.stars, transport]);
  return <section className="game-result game-card" aria-labelledby="game-result-title">
    <span className="game-eyebrow">Piece complete</span>
    <h1 id="game-result-title" tabIndex={-1} ref={heading}>{result.stars === 10 ? 'A perfect ten!' : result.stars >= 7 ? 'Nicely played!' : 'Keep finding your rhythm'}</h1>
    <p className="sr-only" role="status">You earned {result.stars} stars out of 10.</p>
    <div className="game-stars" aria-label={`${result.stars} out of 10 stars`} role="img">
      {Array.from({ length: 10 }, (_, index) => <Star key={index} filled={index < revealed} />)}
    </div>
    <p className="game-result-score" aria-hidden="true">{revealed}<span> / 10</span></p>
    <p className="game-result-caption">{revealed < result.stars ? 'Finding your stars…' : result.stars === 10 ? 'All ten stars. Take a bow.' : 'Every attempt is a step forward.'}</p>
    <p className="game-best-streak"><span>Longest perfect streak</span><strong>{result.longestPerfectStreak}</strong></p>
    <dl className="game-result-stats">
      <div><dt>Perfect</dt><dd>{result.perfect}</dd></div><div><dt>Early / late</dt><dd>{result.close}</dd></div>
      <div><dt>Missed</dt><dd>{result.missed}</dd></div><div><dt>Extra / wrong</dt><dd>{result.extras}</dd></div>
    </dl>
    <p className="game-aids">{Math.round(settings.speed * 100)}% speed · Cues {settings.preview ? 'on' : 'off'} · Click {settings.metronome ? 'on' : 'off'} · Lyre backing {settings.backing ? 'on' : 'off'}</p>
    <div className="game-result-actions"><button className="game-primary" onClick={onRetry}>Try again</button><button onClick={onExit}>Back to score</button></div>
    <button className="game-sound-toggle" aria-pressed={sound} onClick={() => { soundRef.current = !sound; setSound(!sound); }}>Star sounds {sound ? 'on' : 'off'}</button>
  </section>;
}

export function LyreGame({ timeline, onExit }: { timeline: Timeline; onExit: () => void }) {
  const parts = useMemo(() => playableLyres(timeline), [timeline]);
  const [partId, setPartId] = useState(parts[0]?.id);
  const part = parts.find(p => p.id === partId);
  const [transport] = useState(() => new Transport(timeline));
  const [settings, setSettings] = useState<Settings>({ speed: 0.75, preview: true, metronome: false, backing: false });
  const [phase, setPhase] = useState<Phase>('setup');
  const phaseRef = useRef<Phase>('setup');
  const [position, setPosition] = useState(0);
  const [result, setResult] = useState<Result>();
  const [message, setMessage] = useState('');
  const [feedback, setFeedback] = useState<Feedback>({ text: '', at: -Infinity });
  const attempt = useRef<Attempt | undefined>(undefined);
  const request = useRef(0);
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const targets = useMemo(() => part ? gameTargets(timeline, part, settings.speed) : [], [timeline, part, settings.speed]);
  const leadIn = useMemo(() => countIn(timeline), [timeline]);
  const beats = positionAt(timeline.score, Math.max(0, position));
  const measure = timeline.score.measures.find(m => beats >= value(m.start) && beats < value(add(m.start, m.duration))) || timeline.score.measures.at(-1)!;
  useEffect(() => { if (phase === 'setup') heading.current?.focus(); }, [phase]);

  const changePhase = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const stop = (reason = '') => {
    request.current++;
    started.current = false;
    transport.pause();
    transport.restart();
    attempt.current = undefined;
    setPosition(0);
    setFeedback({ text: '', at: -Infinity });
    setMessage(reason);
    changePhase('setup');
  };
  useEffect(() => {
    heading.current?.focus();
    return () => { request.current++; transport.dispose(); };
  }, [transport]);
  useEffect(() => {
    if (phase !== 'running') return;
    let frame = 0;
    const update = () => {
      if (phaseRef.current !== 'running') return;
      if (started.current) {
        const state = transport.getSnapshot();
        const at = transport.readPosition();
        setPosition(at);
        if (at >= 0) attempt.current?.advance(at);
        if (!state.playing) {
          if (state.position >= timeline.duration && attempt.current) {
            setResult(attempt.current.finish());
            changePhase('results');
          } else stop(state.status || 'Attempt interrupted. Start again when you’re ready.');
          return;
        }
      }
      frame = requestAnimationFrame(update);
    };
    frame = requestAnimationFrame(update);
    const interrupt = () => { if (document.hidden && phaseRef.current === 'running') stop('Attempt interrupted. Start again when you’re ready.'); };
    document.addEventListener('visibilitychange', interrupt);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('visibilitychange', interrupt); };
  // Settings cannot change during an attempt; the transport and timeline are stable.
  }, [phase, transport, timeline]);

  const start = async () => {
    if (!part || phaseRef.current !== 'setup') return;
    const revision = ++request.current;
    setMessage('');
    setResult(undefined);
    setFeedback({ text: '', at: -Infinity });
    attempt.current = new Attempt(targets, settings.speed);
    const mix: Mix = Object.fromEntries(timeline.score.parts.map(p => [p.id, {
      muted: p.id === part.id ? !settings.backing : !p.percussion, solo: false, volume: p.id === part.id ? 0.45 : 1,
    }]));
    transport.pause();
    transport.restart();
    transport.setSpeed(settings.speed);
    transport.setMix(mix);
    setPosition(-leadIn.duration);
    changePhase('running');
    await transport.play({ countIn: true, metronome: settings.metronome, outputTiming: true });
    if (request.current !== revision) return;
    if (!transport.getSnapshot().playing) { stop(transport.getSnapshot().status || 'Audio could not start. Please try again.'); return; }
    started.current = true;
  };
  const tap = (pitch: number, timestamp: number) => {
    if (phaseRef.current !== 'running' || !started.current || !part || !transport.getSnapshot().playing) return;
    const at = transport.readPosition(timestamp);
    transport.strike(part.id, pitch);
    // Count-in taps let the player find the bars without losing points.
    if (at < 0) { setFeedback({ pitch, text: '', at }); return; }
    const text = attempt.current!.tap(pitch, at);
    setFeedback({ pitch, text, at });
  };

  if (!part) return <main className="lyre-game"><div className="game-card"><h1>Bell lyre challenge unavailable</h1><p>This piece needs a bell lyre part with notes inside its playable range.</p><button onClick={onExit}>Back to score</button></div></main>;
  const next = targets.find(t => t.time >= position - 0.001 && !attempt.current?.isJudged(t.id));
  const cuePitches = new Set(settings.preview && next && (next.time - position) / settings.speed <= 0.8
    ? targets.filter(t => t.time === next.time && !attempt.current?.isJudged(t.id)).map(t => t.pitch) : []);
  const visibleFeedback = (position - feedback.at) / settings.speed < 0.4 ? feedback : undefined;
  const perfectStreak = attempt.current?.perfectStreak().current ?? 0;
  const count = position < 0 ? Math.min(leadIn.beats, Math.floor((position + leadIn.duration) / leadIn.interval) + 1) : 0;
  return <main className={`lyre-game game-${phase}`}>
    <header className="game-header"><button onClick={() => { stop(); onExit(); }} aria-label="Back to score">← <span>Score</span></button><div><span className="game-eyebrow">Bell lyre challenge</span><h1 ref={heading} tabIndex={-1}>{timeline.score.title}</h1></div>{phase === 'running' ? <button onClick={() => stop()}>Stop</button> : <span className="game-header-star" aria-hidden="true">✦</span>}</header>
    {phase === 'setup' ? <section className="game-card game-setup" aria-labelledby="game-setup-title">
      <span className="game-eyebrow">Find your rhythm</span><h2 id="game-setup-title">Play for ten stars</h2>
      <p>Tap the right bars in time with the drums. Hear every note you play, and see how many stars you earn.</p>
      {parts.length > 1 ? <label className="game-part-picker">Bell lyre part<select value={partId} onChange={e => setPartId(e.target.value)}>{parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}
      <div className="game-speed"><label htmlFor="game-speed">Practice speed <strong>{Math.round(settings.speed * 100)}%</strong></label><input id="game-speed" type="range" min="25" max="150" step="5" value={Math.round(settings.speed * 100)} onChange={e => setSettings(s => ({ ...s, speed: Number(e.target.value) / 100 }))} />
        <div className="speed-presets">{[0.5, 0.75, 1, 1.25].map(speed => <button key={speed} aria-pressed={settings.speed === speed} onClick={() => setSettings(s => ({ ...s, speed }))}>{speed * 100}%</button>)}</div>
      </div>
      <div className="game-options">
        <label><span><strong>Advance note cues</strong><small>Outline the next bars a little ahead of the strike.</small></span><input type="checkbox" checked={settings.preview} onChange={e => setSettings(s => ({ ...s, preview: e.target.checked }))} /></label>
        <label><span><strong>Metronome</strong><small>A steady click alongside the drums.</small></span><input type="checkbox" checked={settings.metronome} onChange={e => setSettings(s => ({ ...s, metronome: e.target.checked }))} /></label>
        <label><span><strong>Bell lyre backing</strong><small>Hear the written melody as you play.</small></span><input type="checkbox" checked={settings.backing} onChange={e => setSettings(s => ({ ...s, backing: e.target.checked }))} /></label>
      </div>
      <p className="game-setup-note">Drums always play · One-bar count-in · Results aren’t saved</p>
      {message ? <p className="game-message" role="status">{message}</p> : null}
      <button className="game-primary game-start" onClick={() => void start()}>Start attempt <span aria-hidden="true">→</span></button>
    </section> : phase === 'results' && result ? <GameResult result={result} settings={settings} transport={transport} onRetry={() => stop()} onExit={onExit} /> : <>
      <div className="game-progress"><progress aria-label="Piece progress" max={timeline.duration} value={Math.max(0, position)} /><span>{Math.round(settings.speed * 100)}% · {position < 0 ? 'Count-in' : `Bar ${(measure.sourceIndex ?? measure.index) + 1}`}</span></div>
      <div className="game-playing-status" aria-live="off">
        {position < 0 ? <span className="game-count-in">Count in {count} / {leadIn.beats}</span> : <>
          {visibleFeedback?.text === 'Perfect' ? <span className="game-perfect" key={feedback.at}>Perfect!</span> : null}
          {perfectStreak >= 3 ? <span className="game-perfect-streak">✦ Perfect streak · {perfectStreak}</span> : null}
        </>}
      </div>
      <GameBoard part={part} cuePitches={cuePitches} feedback={visibleFeedback} onTap={tap} />
    </>}
  </main>;
}

function GameBoard({ part, cuePitches, feedback, onTap }: { part: Part; cuePitches: Set<number>; feedback?: Feedback; onTap: (pitch: number, timestamp: number) => void }) {
  const bars = useMemo(() => lyreBars(part), [part]);
  const naturals = bars.filter(b => !b.accidental);
  const minY = Math.min(...bars.map(b => b.y));
  const maxY = Math.max(...bars.map(b => b.y));
  const height = 100 / naturals.length;
  return <div className="game-board" aria-label="Playable bell lyre">
    {bars.map(bar => {
      const label = pitchLabel(bar.pitch, undefined, 'sharps');
      const tapped = feedback?.pitch === bar.pitch;
      const wrong = tapped && (feedback.text === 'Wrong note' || feedback.text === 'Extra tap');
      const top = (bar.y - minY) / Math.max(1, maxY - minY) * (100 - height);
      return <button key={bar.pitch} className={`game-bar ${bar.accidental ? 'accidental' : 'natural'}${cuePitches.has(bar.pitch) ? ' cued' : ''}${tapped ? wrong ? ' wrong' : ' tapped' : ''}`} style={{ top: `${top}%`, height: `${height}%` } as CSSProperties}
        aria-label={`Play ${label}`} data-pitch={bar.pitch}
        onPointerDown={event => { if (event.pointerType === 'mouse' && event.button !== 0) return; event.preventDefault(); onTap(bar.pitch, event.timeStamp); }}
        onClick={event => { if (event.detail === 0) onTap(bar.pitch, event.timeStamp); }}
        onContextMenu={event => event.preventDefault()}>
        <span>{label.replace(/-?\d+$/, '')}<sub>{Math.floor(bar.pitch / 12) - 1}</sub></span><span className="game-bar-dot" aria-hidden="true" />
      </button>;
    })}
  </div>;
}
