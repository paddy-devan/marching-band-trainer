import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Transport, type Mix } from '../audio/transport';
import { countIn } from '../audio/beats';
import { Attempt, drumTargets, gameTargets, type Result, type Strike } from '../game/scoring';
import type { Timeline } from '../score/model';
import { playableDrums, playableLyres, type ChallengeMode } from '../game/parts';
import { LyreBoard } from './LyreBoard';
import { DrumBoard, type DrumAnimation } from './DrumBoard';
import { ChallengeFrames } from './challenge-frame';
import type { Feedback } from './game-types';

type Settings = { speed: number; preview: boolean; metronome: boolean; backing: boolean };
type Phase = 'setup' | 'running' | 'results';

function Star({ filled }: { filled: boolean }) {
  return <span className={`game-star${filled ? ' filled' : ''}`} aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2 3.09 6.26 6.91 1-5 4.87 1.18 6.88L12 17.76l-6.18 3.25L7 14.13 2 9.26l6.91-1Z" /></svg></span>;
}

function GameResult({ result, transport, settings, backingLabel, onRetry, onExit }: {
  result: Result; transport: Transport; settings: Settings; backingLabel: string; onRetry: () => void; onExit: () => void;
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
    }, 300 + index * 240));
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
    <p className="game-aids">{Math.round(settings.speed * 100)}% speed · Cues {settings.preview ? 'on' : 'off'} · Click {settings.metronome ? 'on' : 'off'} · {backingLabel} {settings.backing ? 'on' : 'off'}</p>
    <div className="game-result-actions"><button className="game-primary" onClick={onRetry}>Try again</button><button onClick={onExit}>Back to score</button></div>
    <button className="game-sound-toggle" aria-pressed={sound} onClick={() => { soundRef.current = !sound; setSound(!sound); }}>Star sounds {sound ? 'on' : 'off'}</button>
  </section>;
}

export function Challenge({ timeline, mode, onExit }: { timeline: Timeline; mode: ChallengeMode; onExit: () => void }) {
  const drum = mode === 'drum';
  const title = drum ? 'Drum challenge' : 'Bell lyre challenge';
  const backingLabel = drum ? 'Drum backing' : 'Bell lyre backing';
  const parts = useMemo(() => drum ? playableDrums(timeline) : playableLyres(timeline), [timeline, drum]);
  const [partId, setPartId] = useState(parts[0]?.id);
  const part = parts.find(p => p.id === partId);
  const [transport] = useState(() => new Transport(timeline));
  const [settings, setSettings] = useState<Settings>({ speed: 0.75, preview: true, metronome: false, backing: false });
  const [phase, setPhase] = useState<Phase>('setup');
  const phaseRef = useRef<Phase>('setup');
  const position = useRef(0);
  const progress = useRef<HTMLProgressElement>(null);
  const drumAnimation = useRef<DrumAnimation>(null);
  const attachProgress = useCallback((node: HTMLProgressElement | null) => {
    progress.current = node;
    if (node) node.value = Math.max(0, position.current);
  }, []);
  const [result, setResult] = useState<Result>();
  const [message, setMessage] = useState('');
  const feedback = useRef<Feedback | undefined>(undefined);
  const attempt = useRef<Attempt | undefined>(undefined);
  const request = useRef(0);
  const started = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const targets = useMemo(() => part ? (drum ? drumTargets : gameTargets)(timeline, part, settings.speed) : [], [timeline, part, settings.speed, drum]);
  const leadIn = useMemo(() => countIn(timeline), [timeline]);
  const frames = useMemo(() => new ChallengeFrames(timeline, targets, settings.speed, drum, settings.preview), [timeline, targets, settings.speed, drum, settings.preview]);
  const [view, setView] = useState(() => frames.read(0));
  const published = useRef(view);
  const publish = useCallback((at: number) => {
    const next = frames.read(at, attempt.current, feedback.current);
    if (next !== published.current) { published.current = next; setView(next); }
  }, [frames]);
  const drumPitches = useMemo(() => ({
    L: targets.find(t => t.hand === 'L')?.pitch ?? targets[0]?.pitch,
    R: targets.find(t => t.hand === 'R')?.pitch ?? targets[0]?.pitch,
  }), [targets]);
  useEffect(() => { if (phase === 'setup') heading.current?.focus(); }, [phase]);

  const changePhase = (next: Phase) => { phaseRef.current = next; setPhase(next); };
  const stop = (reason = '') => {
    request.current++;
    started.current = false;
    transport.pause();
    transport.restart();
    attempt.current = undefined;
    position.current = 0;
    feedback.current = undefined;
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
    let lastProgress = -Infinity;
    const update = () => {
      if (phaseRef.current !== 'running') return;
      if (started.current) {
        const state = transport.getSnapshot();
        const at = transport.readPosition();
        position.current = at;
        if (at >= 0) attempt.current?.advance(at);
        drumAnimation.current?.update(at);
        // Progress is informational; it need not trigger layout on every frame.
        const now = performance.now();
        if (progress.current && now - lastProgress >= 100) {
          const value = Math.max(0, at);
          if (progress.current.value !== value) progress.current.value = value;
          lastProgress = now;
        }
        publish(at);
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
  }, [phase, transport, timeline, publish]);

  const start = async () => {
    if (!part || phaseRef.current !== 'setup') return;
    const revision = ++request.current;
    setMessage('');
    setResult(undefined);
    feedback.current = undefined;
    attempt.current = new Attempt(targets, settings.speed);
    const mix: Mix = Object.fromEntries(timeline.score.parts.map(p => [p.id, {
      muted: p.id === part.id ? !settings.backing : drum ? false : !p.percussion, solo: false, volume: p.id === part.id ? 0.45 : 1,
    }]));
    transport.pause();
    transport.restart();
    transport.setSpeed(settings.speed);
    transport.setMix(mix);
    position.current = -leadIn.duration;
    publish(position.current);
    changePhase('running');
    await transport.play({ countIn: true, metronome: settings.metronome, outputTiming: true, skipMuted: true });
    if (request.current !== revision) return;
    if (!transport.getSnapshot().playing) { stop(transport.getSnapshot().status || 'Audio could not start. Please try again.'); return; }
    started.current = true;
  };
  const tap = useCallback((strike: Strike, timestamp: number) => {
    if (phaseRef.current !== 'running' || !started.current || !part || !transport.getSnapshot().playing) return;
    const at = transport.readPosition(timestamp);
    const pitch = typeof strike === 'number' ? strike : drumPitches[strike];
    if (pitch === undefined) return;
    transport.strike(part.id, pitch);
    // Count-in taps are free. Clock conversion can put an exact first attack a
    // fraction of a nanosecond below zero; treat that as the score boundary.
    const text = at < -1e-8 ? '' : attempt.current!.tap(strike, Math.max(0, at));
    feedback.current = { strike, text, at };
    publish(position.current);
  }, [transport, part, drumPitches, publish]);

  if (!part) return <main className="challenge"><div className="game-card"><h1>{title} unavailable</h1><p>{drum ? 'This piece needs a side or snare drum part with playable notes.' : 'This piece needs a bell lyre part with notes inside its playable range.'}</p><button onClick={onExit}>Back to score</button></div></main>;
  const { cuePitches, feedback: visibleFeedback, perfectStreak, count } = view;
  const streakTier = perfectStreak >= 30 ? 'spark' : perfectStreak >= 20 ? 'glow' : perfectStreak >= 10 ? 'bright' : 'calm';
  return <main className={`challenge game-${mode} game-${phase}`}>
    <header className="game-header"><button onClick={() => { stop(); onExit(); }} aria-label="Back to score">← <span>Score</span></button><div><span className="game-eyebrow">{title}</span><h1 ref={heading} tabIndex={-1}>{timeline.score.title}</h1></div>{phase === 'running' ? <button onClick={() => stop()}>Stop</button> : <span className="game-header-star" aria-hidden="true">✦</span>}</header>
    {phase === 'setup' ? <section className="game-card game-setup" aria-labelledby="game-setup-title">
      <span className="game-eyebrow">Find your rhythm</span><h2 id="game-setup-title">Play for ten stars</h2>
      <p>{drum ? 'Tap the left and right sticks in time with the score. Follow the sticking when shown; either hand counts when it is unspecified. Use F for left and J for right on a keyboard.' : 'Tap the right bars in time with the drums. Hear every note you play, and see how many stars you earn.'}</p>
      {parts.length > 1 ? <label className="game-part-picker">{drum ? 'Drum part' : 'Bell lyre part'}<select value={partId} onChange={e => setPartId(e.target.value)}>{parts.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label> : null}
      <div className="game-speed"><label htmlFor="game-speed">Practice speed <strong>{Math.round(settings.speed * 100)}%</strong></label><input id="game-speed" type="range" min="25" max="150" step="5" value={Math.round(settings.speed * 100)} onChange={e => setSettings(s => ({ ...s, speed: Number(e.target.value) / 100 }))} />
        <div className="speed-presets">{[0.5, 0.75, 1, 1.25].map(speed => <button key={speed} aria-pressed={settings.speed === speed} onClick={() => setSettings(s => ({ ...s, speed }))}>{speed * 100}%</button>)}</div>
      </div>
      <div className="game-options">
        <label><span><strong>Advance note cues</strong><small>{drum ? 'Tap when each falling bar overlaps its outline. Turn off to play from memory with no note prompts.' : 'Outline the next bars a little ahead of the strike.'}</small></span><input type="checkbox" checked={settings.preview} onChange={e => setSettings(s => ({ ...s, preview: e.target.checked }))} /></label>
        <label><span><strong>Metronome</strong><small>{drum ? 'A steady click alongside the music.' : 'A steady click alongside the drums.'}</small></span><input type="checkbox" checked={settings.metronome} onChange={e => setSettings(s => ({ ...s, metronome: e.target.checked }))} /></label>
        <label><span><strong>{backingLabel}</strong><small>{drum ? 'Hear the selected drum part as you play.' : 'Hear the written melody as you play.'}</small></span><input type="checkbox" checked={settings.backing} onChange={e => setSettings(s => ({ ...s, backing: e.target.checked }))} /></label>
      </div>
      <p className="game-setup-note">{drum ? 'Other parts always play' : 'Drums always play'} · One-bar count-in · Results aren’t saved</p>
      {message ? <p className="game-message" role="status">{message}</p> : null}
      <button className="game-primary game-start" onClick={() => void start()}>Start attempt <span aria-hidden="true">→</span></button>
    </section> : phase === 'results' && result ? <GameResult result={result} backingLabel={backingLabel} settings={settings} transport={transport} onRetry={() => stop()} onExit={onExit} /> : <>
      <div className="game-progress"><progress ref={attachProgress} aria-label="Piece progress" max={timeline.duration} /><span>{Math.round(settings.speed * 100)}% · {count > 0 ? 'Count-in' : `Bar ${view.bar}`}</span></div>
      <div className="game-playing-status" aria-live="off">
        {count > 0 ? <span className="game-count-in">Count in {count} / {leadIn.beats}</span> : <>
          <span className="game-perfect-slot">{visibleFeedback?.text && (drum || visibleFeedback.text === 'Perfect') ? <span className={visibleFeedback.text === 'Perfect' ? 'game-perfect' : 'game-judgement'} key={visibleFeedback.at}>{visibleFeedback.text === 'Perfect' ? 'Perfect!' : visibleFeedback.text}</span> : null}</span>
          {perfectStreak >= 3 ? <span className={`game-perfect-streak streak-${streakTier}`}>
            <span className="game-streak-spark" aria-hidden="true">✦</span>
            <span>Perfect streak ·</span><strong className="game-streak-count">{perfectStreak}</strong>
          </span> : null}
        </>}
      </div>
      {drum ? <DrumBoard upcoming={view.upcoming} eitherHand={view.eitherHand} position={position.current} speed={settings.speed} preview={settings.preview} animationRef={drumAnimation} feedback={visibleFeedback} onTap={tap} />
        : <LyreBoard part={part} cuePitches={cuePitches} feedback={visibleFeedback} onTap={tap} />}
    </>}
  </main>;
}
