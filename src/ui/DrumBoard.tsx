import { memo, useEffect, useImperativeHandle, useLayoutEffect, useRef, type RefObject } from 'react';
import type { Target } from '../game/scoring';
import type { Hand } from '../score/model';
import type { Feedback } from './game-types';
import { DRUM_LOOK_AHEAD } from './challenge-frame';

export type DrumAnimation = { update: (position: number) => void };

export const DrumBoard = memo(function DrumBoard({ upcoming, eitherHand, position, speed, preview, animationRef, feedback, onTap }: {
  upcoming: Target[]; eitherHand: boolean; position: number; speed: number; preview: boolean;
  animationRef: RefObject<DrumAnimation | null>; feedback?: Feedback; onTap: (hand: Hand, timestamp: number) => void;
}) {
  const board = useRef<HTMLDivElement>(null);
  const cues = useRef<HTMLDivElement>(null);
  const notes = useRef(new Map<string, HTMLDivElement>());
  const height = useRef(0);
  const currentPosition = useRef(position);
  const update = (at: number) => {
    currentPosition.current = at;
    for (const target of upcoming) {
      const node = notes.current.get(target.id);
      if (node) node.style.transform = `translateY(${(1 - (target.time - at) / speed / DRUM_LOOK_AHEAD) * height.current}px) translateY(-50%)`;
    }
  };
  useImperativeHandle(animationRef, () => ({ update }), [upcoming, speed]);
  useLayoutEffect(() => { update(currentPosition.current); }, [upcoming, speed]);
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
      <div className="drum-lane left" /><div className="drum-lane right" />
      {preview ? <>
        <div className="drum-cues" ref={cues}>
          {eitherHand ? <div className="drum-cue-bar drum-hit-target either">Either</div> : <>
            <div className="drum-cue-bar drum-hit-target left">L</div>
            <div className="drum-cue-bar drum-hit-target right">R</div>
          </>}
          {upcoming.map(target => <div key={target.id} data-time={target.time}
            ref={node => { if (node) notes.current.set(target.id, node); else notes.current.delete(target.id); }}
            className={`drum-cue-bar drum-note ${target.hand === 'L' ? 'left' : target.hand === 'R' ? 'right' : 'either'}`}>
            <span>{target.hand ?? 'Either'}</span>
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
