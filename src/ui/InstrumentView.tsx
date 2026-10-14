import { memo, useEffect, useId, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import type { Movement, Part } from '../score/model';
import { pitchLabel } from '../score/labels';
import { malletPose, type MalletTarget } from './mallet';
import { drumFrame, drumLanes, type DrumTiming } from './drum-timing';

export function movementLabel(m: Movement, part: Part) {
  if (!m.percussion) return pitchLabel(m.pitch + part.register.transpose, m.tpc, 'sharps');
  if (part.renderer === 'snare') return m.roll ? `${m.hand || '—'} Roll` : m.hand || '—';
  return 'Strike';
}
type Props = { part: Part; active: Movement[]; position: number; movements?: Movement[]; speed?: number; playing?: boolean; drumTiming?: DrumTiming; readPosition?: (timestamp?: number) => number; closeUp?: boolean; allowMotion?: boolean };

export const InstrumentView = memo(function InstrumentView(props: Props) {
  const { part, active, position } = props;
  if (part.renderer === 'lyre') return <Lyre {...props} />;
  if (part.renderer === 'snare') return <Snare key={props.drumTiming ? 'calibrated' : 'original'} {...props} />;
  return <svg viewBox="0 0 480 360" role="img" aria-label={`${part.name}: ${active.length ? 'strike' : 'rest'}`} className="instrument-svg pulse">
    <circle cx="240" cy="175" r="120" className="drum-shell" />
    <circle cx="240" cy="175" r="106" className={`drum-head ${active.length ? 'lit' : ''}`} />
    <circle cx="240" cy="175" r={active.length ? 42 : 18} className={`strike ${active.length ? 'lit' : ''}`} />
    <text x="240" y="322" textAnchor="middle">{active.length ? 'Strike' : 'Ready'}</text>
  </svg>;
});

export function lyreBars(part: Part) {
  const bars: { pitch: number; x: number; y: number; width: number; accidental: boolean }[] = [];
  const naturals = [0, 2, 4, 5, 7, 9, 11];
  const slot = (pitch: number) => {
    const pc = pitch % 12;
    const lower = naturals.filter(n => n <= pc).length - 1;
    return Math.floor(pitch / 12) * 7 + lower + (naturals.includes(pc) ? 0 : 0.5);
  };
  const bottom = slot(part.register.min);
  const span = Math.max(1, slot(part.register.max) - bottom);
  for (let pitch = part.register.min; pitch <= part.register.max; pitch++) {
    const accidental = [1, 3, 6, 8, 10].includes(pitch % 12);
    const ratio = (slot(pitch) - bottom) / span;
    const width = 188 - ratio * 80;
    // Both columns have straight inner edges, with longer low bars extending
    // outwards toward the wide base of the photographed instrument.
    bars.push({ pitch, x: accidental ? 234 - width : 250, y: 568 - ratio * 496, width, accidental });
  }
  return bars;
}
function Lyre({ part, active, position, movements = active, speed = 1, playing = false }: Props) {
  const bars = useMemo(() => lyreBars(part), [part]);
  const rails = useMemo(() => [true, false].flatMap(accidental => {
    const column = bars.filter(bar => bar.accidental === accidental);
    if (!column.length) return [];
    const low = column[0];
    const high = column[column.length - 1];
    return [0.23, 0.77].map(offset => ({
      topX: high.x + high.width * offset, topY: high.y - 24,
      bottomX: low.x + low.width * offset, bottomY: low.y + 48,
    }));
  }), [bars]);
  const targets = useMemo(() => {
    const result: MalletTarget[] = [];
    for (const movement of movements) {
      if (movement.percussion) continue;
      const bar = bars.find(b => b.pitch === movement.pitch + part.register.transpose);
      if (!bar) continue;
      const target = { time: movement.time, pitch: bar.pitch, x: bar.x + bar.width / 2, y: bar.y + 7 };
      const previous = result.at(-1);
      // A single beater cues the lowest pitch of a simultaneous chord.
      if (previous && Math.abs(previous.time - target.time) < 1e-8) {
        if (target.pitch < previous.pitch) result[result.length - 1] = target;
      } else result.push(target);
    }
    return result;
  }, [movements, bars, part]);
  const pose = malletPose(targets, position, speed, playing);
  const pitches = new Set(active.map(m => m.pitch + part.register.transpose));
  const outside = [...pitches].filter(p => p < part.register.min || p > part.register.max);
  const frame = 'M20.65 94.95 A44 44 0 0 1 105.29 117.89 L24 555 C8 611 47 640 117 642 Q240 655 363 642 C433 640 472 611 456 555 L374.71 117.89 A44 44 0 0 1 459.35 94.95';
  return <div className="lyre-view">
    <svg viewBox="-30 0 540 660" role="img" aria-label={`Bell lyre, ${pitchLabel(part.register.min)} to ${pitchLabel(part.register.max)}${outside.length ? ', note out of range' : ''}`} className="instrument-svg lyre">
      <g transform="translate(-28.8 0) scale(1.12 1)">
        {rails.map((rail, index) => <g key={index} className="lyre-support">
          <line x1={rail.topX} y1={rail.topY} x2={rail.bottomX} y2={rail.bottomY} className="lyre-rail" />
          <line x1={rail.topX - 2} y1={rail.topY + 4} x2={rail.bottomX - 2} y2={rail.bottomY - 4} className="lyre-rail-shine" />
        </g>)}
        <path d={frame} className="lyre-frame" />
        <path d={frame} className="lyre-frame-metal" />
        <path d={frame} transform="translate(-1.2 -1)" className="lyre-frame-shine" />
        {bars.map(b => {
          const octave = Math.floor(b.pitch / 12) - 1;
          const name = pitchLabel(b.pitch, undefined, 'sharps').slice(0, -String(octave).length);
          return <g key={b.pitch}>
            <rect x={b.x} y={b.y} width={b.width} height="28" rx="0.8" className={`lyre-bar ${pitches.has(b.pitch) ? 'lit' : ''}`} />
            <text x={b.accidental ? b.x + b.width - 8 : b.x + 8} y={b.y + 21} textAnchor={b.accidental ? 'end' : 'start'} className="bar-letter">{name}<tspan className="bar-octave" dy="1">{octave}</tspan></text>
          </g>;
        })}
        <g className={`mallet ${playing ? 'moving' : ''}`} style={{ transform: `translate(${pose.x}px, ${pose.y}px)`, '--rest-pose': `translate(${pose.previewX}px, ${pose.previewY}px)` } as CSSProperties}>
          <line x1="0" y1="0" x2="-38" y2="59" /><circle cx="0" cy="0" r="8" />
        </g>
      </g>
    </svg>
    {outside.length ? <p className="range-warning" role="status">Out of range: {outside.map(p => pitchLabel(p)).join(', ')}</p> : null}
  </div>;
}
function snareNodes(root: SVGSVGElement) {
  return {
    sticks: root.querySelectorAll<SVGGElement>('.stick'),
    impacts: root.querySelectorAll<SVGCircleElement>('[data-impact]'),
    buzzes: root.querySelectorAll<SVGPathElement>('.drum-roll'),
  };
}
function paintSnare(nodes: ReturnType<typeof snareNodes>, frame: ReturnType<typeof drumFrame>) {
  frame.forEach((lane, i) => {
    if (nodes.sticks[i]) nodes.sticks[i].style.transform = `rotate(${lane.angle}deg)`;
    nodes.impacts[i].setAttribute('r', String(i === 2 ? 19 : lane.impact ? 23 : 13));
    nodes.impacts[i].setAttribute('class', `strike${lane.impact ? ` lit ${['left', 'right', 'neutral'][i]}` : ''}`);
    if (i === 2) nodes.impacts[i].style.display = lane.impact ? '' : 'none';
    nodes.buzzes[i].style.display = lane.buzz ? '' : 'none';
  });
}

function Snare({ active, position, movements = active, speed = 1, playing = false, drumTiming, readPosition, closeUp, allowMotion }: Props) {
  const headClip = useId();
  const svg = useRef<SVGSVGElement>(null);
  const lanes = useMemo(() => drumLanes(movements), [movements]);
  const frame = drumTiming ? drumFrame(lanes, playing && readPosition ? readPosition() : position, speed, drumTiming) : undefined;
  // Reconcile imperative frame updates when React renders, including a pause
  // whose attributes happen to match the previous React snapshot.
  useLayoutEffect(() => { if (frame && svg.current) paintSnare(snareNodes(svg.current), frame); });
  useEffect(() => {
    if (!drumTiming || !playing || !readPosition || !svg.current) return;
    const nodes = snareNodes(svg.current);
    let request: number;
    const draw = (timestamp?: number) => {
      paintSnare(nodes, drumFrame(lanes, readPosition(timestamp), speed, drumTiming));
      request = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(request);
  }, [lanes, drumTiming, playing, readPosition, speed]);
  // Sticks only move for known hands. Unknown hands use a central neutral indicator.
  const hands = new Set(active.map(m => m.hand));
  const left = frame ? frame[0].impact : hands.has('L');
  const right = frame ? frame[1].impact : hands.has('R');
  const neutral = frame ? frame[2].impact : hands.has(undefined);
  const rolls = new Set(active.filter(m => m.roll).map(m => m.hand));
  return <svg ref={svg} viewBox={closeUp ? '40 50 400 275' : '0 0 480 360'} role="img" aria-label={`Side drum: ${active.length ? active.map(m => `${m.hand || 'unspecified hand'}${m.roll ? ' roll' : ''}`).join(', ') : 'rest'}`} className={`instrument-svg snare${drumTiming ? ' calibrated' : ''}`}>
    <defs><clipPath id={headClip}><ellipse cx="240" cy="156" rx="140" ry="64" /></clipPath></defs>
    <path d="M100 170 H380 V246 A147 74 0 0 1 100 246 Z" className="drum-shell" />
    <path d="M100 170 V246 M380 170 V246" className="snare-body-edge" />
    <ellipse cx="240" cy="156" rx="140" ry="64" className="snare-recess" />
    {/* The recessed head stays inside the opening; the hoop is drawn over it. */}
    <ellipse cx="240" cy="172" rx="140" ry="64" className="drum-head" clipPath={`url(#${headClip})`} />
    <path d="M93 156 a147 74 0 1 1 294 0 a147 74 0 1 1 -294 0 Z M100 156 a140 64 0 1 1 280 0 a140 64 0 1 1 -280 0 Z" fillRule="evenodd" className="snare-rim-top" />
    <path d="M93 156 A147 74 0 0 0 387 156 V182 A147 74 0 0 1 93 182 Z" className="snare-rim-band" />
    <path d="M93 156 A147 74 0 0 0 387 156" className="snare-rim-edge" />
    <circle data-impact="left" cx="176" cy="173" r={left ? 23 : 13} className={`strike ${left ? 'lit left' : ''}`} />
    <circle data-impact="right" cx="304" cy="173" r={right ? 23 : 13} className={`strike ${right ? 'lit right' : ''}`} />
    <circle data-impact="neutral" cx="240" cy="173" r="19" className={`strike${neutral ? ' lit neutral' : ''}`} style={{ display: neutral ? undefined : 'none' }} />
    {(['L', 'R', undefined] as const).map((hand, i) => <path key={hand || 'neutral'}
      transform={`translate(${hand === 'L' ? 176 : hand === 'R' ? 304 : 240} 184)`}
      d="M-15 -1 L-9 -6 L-3 -1 L3 -6 L9 -1 L15 -6 M-15 6 L-9 1 L-3 6 L3 1 L9 6 L15 1"
      className="drum-roll" style={{ display: (frame ? frame[i].buzz : rolls.has(hand)) ? undefined : 'none' }} />)}
    <g transform="translate(88 77)"><DrumStick down={hands.has('L')} hand="left" angle={frame?.[0].angle} allowMotion={allowMotion} /></g>
    <g transform="translate(392 77) scale(-1 1)"><DrumStick down={hands.has('R')} hand="right" angle={frame?.[1].angle} allowMotion={allowMotion} /></g>
    <text x="153" y="320" textAnchor="middle">Left · L</text><text x="327" y="320" textAnchor="middle">Right · R</text>
  </svg>;
}

function DrumStick({ down, hand, angle, allowMotion }: { down: boolean; hand: 'left' | 'right'; angle?: number; allowMotion?: boolean }) {
  // Local zero is the grip, about a fifth of the way along from the butt.
  return <g className={`stick ${hand}-stick ${down ? 'down' : ''}${allowMotion ? ' motion-enabled' : ''}`} style={angle === undefined ? undefined : { transform: `rotate(${angle}deg)` }}>
    <path d="M-32 -5 Q-38 -5 -38 0 Q-38 5 -32 5 L64 5 Q88 4 108 1.8 L116 1.8 C119 6 130 6 134 2 Q136 0 134 -2 C130 -6 119 -6 116 -1.8 L108 -1.8 Q88 -4 64 -5 Z" className="stick-wood" />
    <path d="M-30 -2 H64 Q88 -2 106 0" className="stick-shine" />
  </g>;
}
