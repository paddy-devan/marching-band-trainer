import { memo } from 'react';
import type { Movement, Part } from '../score/model';
import { pitchLabel, type Spelling } from '../score/labels';

export function movementLabel(m: Movement, part: Part, spelling: Spelling) {
  if (!m.percussion) return pitchLabel(m.pitch + part.register.transpose, m.tpc, spelling);
  if (part.renderer === 'snare') return m.roll ? `Roll ${m.hand || '—'}` : m.hand || '—';
  return 'Strike';
}
type Props = { part: Part; active: Movement[]; spelling: Spelling; position: number };

export const InstrumentView = memo(function InstrumentView({ part, active, spelling, position }: Props) {
  if (part.renderer === 'lyre') return <Lyre part={part} active={active} spelling={spelling} />;
  if (part.renderer === 'snare') return <Snare active={active} position={position} />;
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
    const ratio = (pitch - part.register.min) / Math.max(1, part.register.max - part.register.min);
    bars.push({ pitch, x: accidental ? 65 : 242, y: 478 - (slot(pitch) - bottom) / span * 418, width: 155 - ratio * 32, accidental });
  }
  return bars;
}
function Lyre({ part, active, spelling }: Omit<Props, 'position'>) {
  const bars = lyreBars(part);
  const pitches = new Set(active.map(m => m.pitch + part.register.transpose));
  const hit = bars.find(b => pitches.has(b.pitch));
  const outside = [...pitches].filter(p => p < part.register.min || p > part.register.max);
  return <div className="lyre-view">
    <svg viewBox="0 0 480 540" role="img" aria-label={`Bell lyre, ${pitchLabel(part.register.min)} to ${pitchLabel(part.register.max)}${outside.length ? ', note out of range' : ''}`} className="instrument-svg lyre">
      <path d="M90 53 C25 26 7 77 44 108 L23 450 Q8 511 83 510 H395 Q462 511 442 450 L418 108 C459 76 434 26 387 53" className="lyre-frame" />
      <path d="M117 45 L73 488 M205 45 L199 488 M285 45 L278 488 M374 45 L421 488" className="lyre-rails" />
      {bars.map(b => <g key={b.pitch}>
        <rect x={b.x} y={b.y} width={b.width} height="19" rx="3" className={`lyre-bar ${pitches.has(b.pitch) ? 'lit' : ''}`} />
        <circle cx={b.x + 9} cy={b.y + 9.5} r="2" className="bar-pin" />
        <text x={b.x + b.width - 9} y={b.y + 13} textAnchor="end" className="bar-letter">{pitchLabel(b.pitch, undefined, spelling === 'score' ? 'sharps' : spelling)}</text>
      </g>)}
      {hit ? <g className="mallet"><line x1={hit.x + 40} y1={hit.y + 7} x2={hit.x + 2} y2={hit.y - 52} /><circle cx={hit.x + 40} cy={hit.y + 7} r="8" /></g> : null}
      <text x="142" y="531" textAnchor="middle" className="column-label">Accidentals</text>
      <text x="315" y="531" textAnchor="middle" className="column-label">Naturals</text>
    </svg>
    {outside.length ? <p className="range-warning" role="status">Out of range: {outside.map(p => pitchLabel(p)).join(', ')}</p> : null}
  </div>;
}
function Snare({ active, position }: Pick<Props, 'active' | 'position'>) {
  // Sticks only move for known hands. Unknown hands use a central neutral indicator.
  const hands = new Set(active.map(m => m.hand));
  const recent = active.some(m => position - m.time < Math.min(0.12, m.seconds));
  const left = hands.has('L') && recent;
  const right = hands.has('R') && recent;
  return <svg viewBox="0 0 480 360" role="img" aria-label={`Side drum: ${active.length ? active.map(m => m.hand || 'unspecified hand').join(', ') : 'rest'}`} className="instrument-svg snare">
    <ellipse cx="240" cy="211" rx="147" ry="94" className="drum-shell" />
    <path d="M93 161 V210 M387 161 V210" className="drum-rim" />
    <ellipse cx="240" cy="166" rx="147" ry="89" className="drum-head" />
    <ellipse cx="240" cy="166" rx="134" ry="77" className="drum-inner" />
    <circle cx="176" cy="173" r={left ? 23 : 13} className={`strike ${left ? 'lit left' : ''}`} />
    <circle cx="304" cy="173" r={right ? 23 : 13} className={`strike ${right ? 'lit right' : ''}`} />
    {hands.has(undefined) && recent ? <circle cx="240" cy="173" r="19" className="strike lit neutral" /> : null}
    <g className={`stick left-stick ${left ? 'down' : ''}`} style={{ transformOrigin: '155px 125px' }}><line x1="70" y1="39" x2="177" y2="144" /></g>
    <g className={`stick right-stick ${right ? 'down' : ''}`} style={{ transformOrigin: '325px 125px' }}><line x1="410" y1="39" x2="303" y2="144" /></g>
    <text x="153" y="320" textAnchor="middle">Left · L</text><text x="327" y="320" textAnchor="middle">Right · R</text>
  </svg>;
}
