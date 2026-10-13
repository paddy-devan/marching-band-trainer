import { useMemo, type CSSProperties } from 'react';
import type { Part } from '../score/model';
import { pitchLabel } from '../score/labels';
import { lyreBars } from './InstrumentView';
import type { Feedback } from './game-types';

export function LyreBoard({ part, cuePitches, feedback, onTap }: { part: Part; cuePitches: Set<number>; feedback?: Feedback; onTap: (pitch: number, timestamp: number) => void }) {
  const bars = useMemo(() => lyreBars(part), [part]);
  const naturals = bars.filter(b => !b.accidental);
  const minY = Math.min(...bars.map(b => b.y));
  const maxY = Math.max(...bars.map(b => b.y));
  const height = 100 / naturals.length;
  return <div className="game-board" aria-label="Playable bell lyre">
    {bars.map(bar => {
      const label = pitchLabel(bar.pitch, undefined, 'sharps');
      const tapped = feedback?.strike === bar.pitch;
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
