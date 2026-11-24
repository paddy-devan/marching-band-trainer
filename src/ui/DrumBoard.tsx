import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Click } from '../audio/beats';
import type { Hand } from '../score/model';
import type { Feedback } from './game-types';
import { DRUM_LOOK_AHEAD, DRUM_RUNOUT, type DrumCue } from './challenge-frame';

export type DrumAnimation = { update: (position: number) => void };

export const DrumBoard = memo(function DrumBoard({ upcoming, guideLines, eitherHand, position, speed, preview, animationRef, feedback, onTap }: {
  upcoming: DrumCue[]; guideLines: Click[]; eitherHand: boolean; position: number; speed: number; preview: boolean;
  animationRef: RefObject<DrumAnimation | null>; feedback?: Feedback; onTap: (hand: Hand, timestamp: number) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const cues = useRef<HTMLDivElement>(null);
  const notes = useRef(new Map<string, HTMLDivElement>());
  const lines = useRef(new Map<number, HTMLDivElement>());
  const height = useRef(0);
  const currentPosition = useRef(position);
  const update = (at: number) => {
    currentPosition.current = at;
    const offset = (time: number, from = at) => (1 - (time - from) / speed / DRUM_LOOK_AHEAD) * height.current;
    for (const { time } of guideLines) {
      const node = lines.current.get(time);
      if (node) node.style.transform = `translateY(${offset(time)}px)`;
    }
    for (const { target, hit } of upcoming) {
      const node = notes.current.get(target.id);
      if (!node) continue;
      const elapsed = (at - target.time) / speed;
      node.style.transform = `translateY(${offset(target.time, hit?.at)}px) translateY(-50%)`;
      node.toggleAttribute('data-passed', !hit && elapsed > 0);
      node.style.opacity = !hit && elapsed > 0 ? String(Math.max(0, 1 - elapsed / DRUM_RUNOUT)) : '';
    }
  };
  useImperativeHandle(animationRef, () => ({ update }), [upcoming, guideLines, speed]);
  useLayoutEffect(() => { update(currentPosition.current); }, [upcoming, guideLines, speed]);
  useLayoutEffect(() => {
    const node = cues.current;
    if (!node) return;
    height.current = node.getBoundingClientRect().height;
    update(currentPosition.current);
    const observer = new ResizeObserver(entries => {
      height.current = entries[0].contentRect.height;
      // The animation handle always uses the current set of mounted notes.
      animationRef.current?.update(currentPosition.current);
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [preview, animationRef]);
  useEffect(() => { board.current?.focus(); }, []);
  return <div className="drum-board" role="group" aria-label="Playable drum" tabIndex={-1} ref={board}
    onKeyDown={event => {
      if (event.repeat || event.altKey || event.ctrlKey || event.metaKey) return;
      const key = event.key.toLowerCase();
      if (key !== 'f' && key !== 'j') return;
      event.preventDefault();
      onTap(key === 'f' ? 'L' : 'R', event.timeStamp);
    }}>
    <div className={`drum-track${preview ? '' : ' cues-off'}`} aria-hidden="true">
      {preview ? <>
        <div className="drum-cues" ref={cues}>
          {guideLines.map(({ time, accent }) => <div key={time} data-time={time} className={accent ? 'drum-bar-line' : 'drum-beat-line'}
            ref={node => { if (node) lines.current.set(time, node); else lines.current.delete(time); }} />)}
          <div className="drum-strike-line" />
          {eitherHand ? <div className="drum-cue-bar drum-hit-target either">Either</div> : <>
            <div className="drum-cue-bar drum-hit-target left">L</div>
            <div className="drum-cue-bar drum-hit-target right">R</div>
          </>}
          {upcoming.map(({ target, hit }) => <div key={target.id} data-time={target.time} data-hit={hit?.grade}
            ref={node => { if (node) notes.current.set(target.id, node); else notes.current.delete(target.id); }}
            className={`drum-cue-bar drum-note ${target.hand === 'L' ? 'left' : target.hand === 'R' ? 'right' : 'either'}`}>
            <span className="drum-note-face">{hit?.grade ?? target.hand ?? 'Either'}</span>
          </div>)}
        </div>
        <span className="drum-hit-label">Hit when bars overlap the outlines</span>
      </> : <span className="drum-memory">Cues off · Play from memory</span>}
    </div>
    <div className="drum-pads" role="group" aria-label="Drum head">
      {(['L', 'R'] as const).map(hand => {
        const tapped = feedback?.strike === hand;
        const wrong = tapped && (feedback.text === 'Wrong hand' || feedback.text === 'Extra tap');
        return <button key={hand} data-hand={hand} aria-label={`Play ${hand === 'L' ? 'left' : 'right'} stick`}
          className={`drum-pad ${hand === 'L' ? 'left' : 'right'}${tapped ? wrong ? ' wrong' : ' tapped' : ''}`}
          onPointerDown={event => {
            if (event.pointerType === 'mouse' && event.button !== 0) return;
            event.preventDefault();
            onTap(hand, event.timeStamp);
          }}
          onClick={event => { if (event.detail === 0) onTap(hand, event.timeStamp); }}
          onContextMenu={event => event.preventDefault()}>
          <span className="drum-pad-label">{hand === 'L' ? 'Left' : 'Right'}<small>{hand === 'L' ? 'F' : 'J'}</small></span>
        </button>;
      })}
    </div>
  </div>;
});
